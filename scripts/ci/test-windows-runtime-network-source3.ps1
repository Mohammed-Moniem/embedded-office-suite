param(
  [Parameter(Mandatory=$true)][string]$CandidatePath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$candidate = (Resolve-Path -LiteralPath $CandidatePath).Path
$candidateSha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($candidate, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw ('Candidate parse errors: ' + ($parseErrors -join '; ')) }
# Reject an unmocked effect or qualified command before executing candidate text.
$safeCommands = @('Read-ProfileState','Test-Path','Get-Service','Resolve-Path','Get-Item','Get-FileHash','Join-Path','Where-Object','ForEach-Object','Get-NetFirewallProfile','Set-NetFirewallProfile','New-NetFirewallRule','Get-NetFirewallRule','Get-NetFirewallApplicationFilter','Remove-NetFirewallRule','Out-Null','Get-Content','ConvertFrom-Json','ConvertTo-Json','Set-Content')
foreach ($command in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)) {
  $name = $command.GetCommandName()
  if ($null -eq $name) {
    if ($command.InvocationOperator -ne 'Ampersand' -or $command.CommandElements[0].Extent.Text -cne '$NodePath') { throw 'Unexpected dynamic command in candidate' }
  } elseif ($name -cnotin $safeCommands) { throw "Unmocked candidate command: $name" }
}
function Assert-Control([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-MockHash([string]$Path) {
  $apps = @('wordcraft','pdfcraft','deckcraft','gridcraft')
  for ($n=0; $n -lt $apps.Count; $n++) { if ($Path.EndsWith($apps[$n] + '-cli.exe')) { return ([string]($n+1) * 64) } }
  return ('a' * 64)
}
function Invoke-ControlCase([string]$Scenario) {
  $script:state = @{
    Scenario=$Scenario; Rules=@{}; Created=@(); Removed=@(); Profiles=@{Domain='False'; Private='True'; Public='False'};
    InitialProfiles=@{Domain='False'; Private='True'; Public='False'}; Phase='setup'; ProfileCleanup=@(); ProfileReadbacks=@();
    NodeCalls=0; OutputCreated=$false; Proof=$null; ProofWrites=0; ServiceReads=0; ServiceMutations=0; ApplicationReads=0; Events=@(); EnableWrites=@(); OneReadFailure=$false
  }
  function Join-Path { [CmdletBinding()] param([string]$Path,[string]$ChildPath) return (($Path -replace '[\\/]+$','') + '/' + $ChildPath) }
  function Test-Path { [CmdletBinding()] param([string]$LiteralPath) return $false }
  function Resolve-Path { [CmdletBinding()] param([string]$LiteralPath) return [pscustomobject]@{Path=$LiteralPath} }
  function Get-Item { [CmdletBinding()] param([string]$LiteralPath,[switch]$Force) return [pscustomobject]@{PSIsContainer=$false; Attributes=[IO.FileAttributes]::Normal} }
  function Get-FileHash { [CmdletBinding()] param([string]$LiteralPath,[string]$Algorithm) return [pscustomobject]@{Hash=(Get-MockHash $LiteralPath)} }
  function Get-Service {
    [CmdletBinding()] param([string]$Name)
    $script:state.ServiceReads++
    $script:state.Events += 'service-read'
    $status = if ($script:state.Scenario -eq 'service-prerequisite' -or ($script:state.Scenario -eq 'service-final-state' -and $script:state.ServiceReads -gt 1)) { 'Stopped' } else { 'Running' }
    return [pscustomobject]@{Status=$status}
  }
  function Start-Service { throw 'Forbidden real or mocked service mutation' }
  function Stop-Service { throw 'Forbidden real or mocked service mutation' }
  function Get-NetFirewallProfile {
    [CmdletBinding()] param([string]$PolicyStore)
    if ($script:state.Phase -eq 'cleanup') {
      $script:state.ProfileReadbacks += $PolicyStore
      if ($script:state.Scenario -eq 'profile-query-failure' -and -not $script:state.OneReadFailure) { $script:state.OneReadFailure=$true; throw 'mock profile readback failure' }
    }
    foreach ($name in @('Domain','Private','Public')) {
      $enabled = $script:state.Profiles[$name]
      if ($script:state.Scenario -eq 'profile-active-verification' -and $PolicyStore -eq 'ActiveStore' -and $script:state.EnableWrites.Count -eq 3 -and $script:state.Phase -eq 'setup') { $enabled='False'; $script:state.Phase='cleanup' }
      if ($script:state.Scenario -eq 'profile-active-restore-readback' -and $PolicyStore -eq 'ActiveStore' -and $script:state.Phase -eq 'cleanup' -and $name -eq 'Domain') { $enabled='NotConfigured' }
      [pscustomobject]@{Name=$name; Enabled=$enabled}
    }
  }
  function Set-NetFirewallProfile {
    [CmdletBinding()] param([string]$Name,[string]$PolicyStore,[string]$Enabled)
    if ($script:state.Phase -eq 'cleanup') {
      $script:state.ProfileCleanup += $Name
      $script:state.Events += 'restore-' + $Name
      if ($Name -eq 'Domain' -and $script:state.Scenario -eq 'profile-failure') { throw 'mock profile restore failure' }
      if ($Name -eq 'Domain' -and $script:state.Scenario -eq 'profile-readback') { return }
    } else { $script:state.EnableWrites += $Name }
    $script:state.Profiles[$Name]=$Enabled
    if ($script:state.Scenario -eq 'profile-enable-partial' -and $script:state.Phase -eq 'setup') { $script:state.Phase='cleanup'; throw 'mock profile enable partial failure' }
  }
  function New-NetFirewallRule {
    [CmdletBinding()] param([string]$Name,[string]$DisplayName,[string]$PolicyStore,[string]$Direction,[string]$Action,[string]$Enabled,[string]$Profile,[string]$Program)
    Assert-Control ($script:state.NodeCalls -eq 1) 'Rules must follow exactly one positive control'
    $rule=[pscustomobject]@{Name=$Name; Direction=$Direction; Action=$Action; Enabled=$Enabled; Profile=$Profile; Program=$Program}
    $script:state.Rules[$Name]=$rule; $script:state.Created += $Name
    if ($script:state.Scenario -eq 'create-partial' -and $Name.EndsWith('-2')) { throw 'mock creation failed after creating rule' }
    return $rule
  }
  function Get-NetFirewallRule {
    [CmdletBinding()] param([string]$Name,[string]$PolicyStore)
    if ($script:state.Phase -eq 'cleanup' -and $script:state.Scenario -eq 'rule-absence-query-failure' -and -not $script:state.OneReadFailure) { $script:state.OneReadFailure=$true; throw 'mock rule absence query failure' }
    if ($Name) { if ($script:state.Rules.ContainsKey($Name)) { return $script:state.Rules[$Name] }; return }
    return @($script:state.Rules.Values)
  }
  function Get-NetFirewallApplicationFilter {
    [CmdletBinding()] param($AssociatedNetFirewallRule,[string]$PolicyStore)
    Assert-Control ($PolicyStore -eq 'ActiveStore') 'Application filter must be read from ActiveStore'
    $script:state.ApplicationReads++
    $program=$AssociatedNetFirewallRule.Program
    if ($script:state.Scenario -eq 'rule-verification' -and $AssociatedNetFirewallRule.Name.EndsWith('-1')) { $program='C:/wrong-program.exe' }
    return [pscustomobject]@{Program=$program}
  }
  function Remove-NetFirewallRule {
    [CmdletBinding()] param([string]$Name,[string]$PolicyStore)
    $script:state.Phase='cleanup'; $script:state.Removed += $Name; $script:state.Events += 'remove-' + $Name
    if ($Name.EndsWith('-1') -and $script:state.Scenario -in @('delete-failure','primary-and-cleanup')) { throw 'mock rule delete failure' }
    if ($Name.EndsWith('-1') -and $script:state.Scenario -eq 'delete-readback') { return }
    $script:state.Rules.Remove($Name)
  }
  function Invoke-MockNode {
    $arguments=@($args); $script:state.NodeCalls++
    if ($script:state.NodeCalls -eq 1) {
      Assert-Control ($arguments[0] -eq '-e' -and $script:state.Created.Count -eq 0) 'First child must be unblocked TCP positive control'
      Assert-Control ($arguments[1].Contains("host:'1.1.1.1',port:443")) 'Positive control must target actual direct-IP TCP endpoint'
      $global:LASTEXITCODE=if ($script:state.Scenario -eq 'positive-control') {2} else {0}
      return
    }
    if ($script:state.NodeCalls -eq 2) {
      Assert-Control ($arguments[0] -eq '-e' -and $script:state.Rules.Count -eq 5) 'Denial probe must follow five active rules'
      $global:LASTEXITCODE=if ($script:state.Scenario -eq 'denial-not-permission') {4} else {3}
      if ($script:state.Scenario -eq 'denial-not-permission') { return 'EHOSTUNREACH' }
      return 'EACCES'
    }
    Assert-Control ($script:state.NodeCalls -eq 3 -and $arguments[0].EndsWith('scripts/verify-extracted-runtime.mjs')) 'Actual child verifier path was changed'
    Assert-Control ($arguments[1] -eq '--directory' -and $arguments[3] -eq '--output') 'Actual verifier arguments were changed'
    $global:LASTEXITCODE=if ($script:state.Scenario -in @('primary-operation','primary-and-cleanup')) {1} else {0}
    $script:state.OutputCreated=$true
  }
  function Get-Content {
    [CmdletBinding()] param([string]$LiteralPath,[switch]$Raw)
    Assert-Control $script:state.OutputCreated 'Inner report read without invoking actual verifier command'
    $results=@(); foreach ($app in @('wordcraft','pdfcraft','deckcraft','gridcraft')) { $results += @{app=$app; passed=$true; binarySha256=(Get-MockHash ($app+'-cli.exe'))} }
    return (@{passed=($script:state.Scenario -ne 'inner-report'); native=@{allFourRequested=$true; results=$results}} | ConvertTo-Json -Depth 8)
  }
  function Set-Content {
    [CmdletBinding()] param([string]$LiteralPath,[Parameter(ValueFromPipeline=$true)]$Value,[string]$Encoding)
    process {
      Assert-Control ($LiteralPath.EndsWith('.network.json')) 'Unexpected candidate file write'
      Assert-Control ($script:state.Phase -eq 'cleanup' -and $script:state.Rules.Count -eq 0 -and $script:state.Removed.Count -eq 5) 'Passed proof attempted before complete rule cleanup'
      Assert-Control ($script:state.ProfileCleanup.Count -eq 3 -and $script:state.ProfileReadbacks.Count -eq 6 -and $script:state.ServiceReads -eq 2) 'Passed proof attempted before all restoration readbacks'
      foreach ($name in @('Domain','Private','Public')) { Assert-Control ($script:state.Profiles[$name] -eq $script:state.InitialProfiles[$name]) 'Passed proof attempted with changed profiles' }
      $script:state.ProofWrites++; $script:state.Proof=($Value | ConvertFrom-Json); $script:state.Events += 'proof'
    }
  }
  $failure=$null
  try { . $candidate -NodePath 'Invoke-MockNode' -SourcePath 'C:/fixture/source' -RuntimePath 'C:/fixture/runtime' -OutputPath 'C:/fixture/RESULT.json' } catch { $failure=$_.Exception.Message }
  $expectedSuccess=$Scenario -eq 'successful-restore'
  if ($expectedSuccess) {
    Assert-Control ($null -eq $failure) ('Successful restore rejected: '+$failure)
    Assert-Control ($script:state.ProofWrites -eq 1 -and $script:state.Proof.passed -and $script:state.Proof.cleanupVerified) 'Successful restore lacks verified proof'
    Assert-Control ($script:state.Proof.rulesRemoved.Count -eq 5 -and $script:state.Proof.profilesRestored.Count -eq 3) 'Successful cleanup inventory is incomplete'
    Assert-Control ($script:state.ApplicationReads -eq 5 -and $script:state.Proof.workerRulesVerified -eq 4) 'Exact application filters were not verified'
    Assert-Control ($script:state.Events[-1] -eq 'proof') 'Success proof is not the final observed action'
  } else {
    Assert-Control ($null -ne $failure) ('Failure case accepted: '+$Scenario)
    Assert-Control ($script:state.ProofWrites -eq 0) ('Failure case wrote passed proof: '+$Scenario)
    $expectedFailures=@{
      'create-partial'='mock creation failed after creating rule'; 'rule-verification'='Firewall application filter differs';
      'delete-failure'='mock rule delete failure'; 'delete-readback'='Rule remains in';
      'profile-failure'='mock profile restore failure'; 'profile-readback'='Profile state not restored';
      'profile-enable-partial'='mock profile enable partial failure'; 'profile-active-verification'='Firewall profiles did not become effective';
      'primary-operation'='Exact extracted Windows runtime qualification failed'; 'primary-and-cleanup'='Exact extracted Windows runtime qualification failed';
      'denial-not-permission'='not denied by OS permission'; 'positive-control'='Outbound positive control failed';
      'service-prerequisite'='must already be running'; 'service-final-state'='Firewall service state changed';
      'inner-report'='Inner qualification did not prove all four'; 'profile-active-restore-readback'='Profile state not restored in ActiveStore';
      'rule-absence-query-failure'='mock rule absence query failure'; 'profile-query-failure'='mock profile readback failure'
    }
    Assert-Control ($failure.Contains($expectedFailures[$Scenario])) ('Wrong failure branch for '+$Scenario+': '+$failure)
  }
  Assert-Control ($script:state.Removed.Count -eq $script:state.Created.Count) ('Skipped an owned rule cleanup: '+$Scenario)
  if ($Scenario -notin @('positive-control','service-prerequisite')) {
    Assert-Control (($script:state.ProfileCleanup -join ',') -eq 'Domain,Private,Public') ('Skipped later profile cleanup: '+$Scenario)
    Assert-Control ($script:state.ProfileReadbacks.Count -eq 6) ('Skipped profile restoration readback: '+$Scenario)
  } else { Assert-Control ($script:state.ProfileCleanup.Count -eq 0) 'Mutated profiles before prerequisites passed' }
  if ($Scenario -eq 'create-partial') { Assert-Control ($script:state.Removed.Count -eq 3 -and $script:state.Rules.Count -eq 0) 'Failed creation was not registered before mutation' }
  if ($Scenario -eq 'rule-verification') { Assert-Control ($script:state.Removed.Count -eq 2) 'Wrong Program verification did not reject early' }
  if ($Scenario -eq 'primary-and-cleanup') { Assert-Control ($failure.Contains('Primary:') -and $failure.Contains('Cleanup:') -and $failure.Contains('mock rule delete failure')) 'Primary or cleanup error was lost' }
  Assert-Control ($script:state.ServiceMutations -eq 0) 'Service state was mutated'
  return [pscustomobject]@{name=$Scenario; passed=$true; expectedSuccess=$expectedSuccess; failure=$failure; rulesCreated=$script:state.Created.Count; ruleCleanupAttempts=$script:state.Removed.Count; profileCleanupAttempts=$script:state.ProfileCleanup.Count; profileReadbacks=$script:state.ProfileReadbacks.Count; proofWrites=$script:state.ProofWrites}
}
$cases=@('create-partial','rule-verification','delete-failure','delete-readback','profile-failure','profile-readback','profile-enable-partial','profile-active-verification','primary-operation','primary-and-cleanup','denial-not-permission','positive-control','service-prerequisite','service-final-state','inner-report','profile-active-restore-readback','rule-absence-query-failure','profile-query-failure','successful-restore')
$results=@(); foreach ($scenario in $cases) { $results += Invoke-ControlCase $scenario }
$report=[ordered]@{schemaVersion=1; scope='ACTUAL_POWERSHELL_CANDIDATE_SOURCE_WITH_NO_EFFECTS_API_MOCKS'; passed=$true; candidateSha256=$candidateSha256; count=$results.Count; controls=$results; powershellVersion=$PSVersionTable.PSVersion.ToString(); actualFirewallChanged=$false; actualNetworkProbed=$false; actualWorkersExecuted=$false; limits=@('Only mocked API branches of actual candidate source','No Windows target runtime, firewall enforcement, OS-wide isolation or Windows11 acceptance')}
$fullOutput=[IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fullOutput)) | Out-Null
[IO.File]::WriteAllText($fullOutput, ($report | ConvertTo-Json -Depth 12) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('Source3 Windows network PowerShell mock controls passed: ' + $results.Count)
