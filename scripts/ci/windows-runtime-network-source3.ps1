param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$RuntimePath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$rulePrefix = 'OfficeRuntimeSource3Qualification-' + [Guid]::NewGuid().ToString('N')
$ownedRules = @()
$profileState = @()
$profilesMayHaveChanged = $false
$serviceState = $null
$primaryError = $null
$cleanupErrors = [System.Collections.Generic.List[string]]::new()
$ruleCleanup = @()
$profileCleanup = @()
$programs = @()
$denial = @()
$probe = "const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(5000);s.once('connect',()=>{s.destroy();process.exit(0)});s.once('timeout',()=>{s.destroy();process.exit(2)});s.once('error',e=>{s.destroy();console.log(e.code);process.exit(['EPERM','EACCES'].includes(e.code)?3:4)});"

function Read-ProfileState([string]$Store) {
  $rows = @(Get-NetFirewallProfile -PolicyStore $Store -ErrorAction Stop)
  if ($rows.Count -ne 3) { throw "Expected exactly three firewall profiles in $Store" }
  $state = @()
  foreach ($name in @('Domain','Private','Public')) {
    $matches = @($rows | Where-Object { $_.Name -ceq $name })
    if ($matches.Count -ne 1) { throw "Missing or duplicate firewall profile $name in $Store" }
    $enabled = $matches[0].Enabled.ToString()
    if ($enabled -notin @('True','False','NotConfigured')) { throw "Unexpected profile state $enabled" }
    $state += [pscustomobject]@{Name=$name; Enabled=$enabled}
  }
  return $state
}

try {
  if ((Test-Path -LiteralPath ($OutputPath + '.network.json')) -or (Test-Path -LiteralPath $OutputPath)) { throw 'Qualification output must be absent before this run' }
  # A non-running service is an unmet prerequisite. Never start/stop it here.
  $serviceState = (Get-Service -Name mpssvc -ErrorAction Stop).Status.ToString()
  if ($serviceState -ne 'Running') { throw 'Windows Firewall service must already be running; no service state was changed' }
  $paths = @($NodePath)
  foreach ($app in @('wordcraft','pdfcraft','deckcraft','gridcraft')) { $paths += Join-Path $RuntimePath "runtime/bin/$app-cli.exe" }
  foreach ($path in $paths) {
    $resolved = (Resolve-Path -LiteralPath $path -ErrorAction Stop).Path
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Program path must be an exact regular file' }
    if (@($programs | Where-Object { [string]::Equals($_.Path, $resolved, [StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) { throw 'Node and worker paths must be distinct' }
    $programs += [pscustomobject]@{Path=$resolved; Sha256=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()}
  }
  if ($programs.Count -ne 5) { throw 'Exactly Node and all four worker programs are required' }
  $NodePath = $programs[0].Path
  $verifier = (Resolve-Path -LiteralPath (Join-Path $SourcePath 'scripts/verify-extracted-runtime.mjs') -ErrorAction Stop).Path
  # A real positive TCP control precedes every firewall modification.
  & $NodePath -e $probe
  if ($LASTEXITCODE -ne 0) { throw 'Outbound positive control failed; network-denied evidence unavailable' }
  $persistent = @(Read-ProfileState 'PersistentStore')
  $active = @(Read-ProfileState 'ActiveStore')
  foreach ($profile in $persistent) {
    $effective = @($active | Where-Object { $_.Name -ceq $profile.Name })[0]
    $profileState += [pscustomobject]@{Name=$profile.Name; PersistentEnabled=$profile.Enabled; ActiveEnabled=$effective.Enabled}
  }
  # Register all original states before the first potentially partial mutation.
  $profilesMayHaveChanged = $true
  foreach ($profile in $profileState) { Set-NetFirewallProfile -Name $profile.Name -PolicyStore PersistentStore -Enabled True -ErrorAction Stop }
  foreach ($profile in @(Read-ProfileState 'ActiveStore')) {
    if ($profile.Enabled -ne 'True') { throw 'Firewall profiles did not become effective' }
  }
  foreach ($program in $programs) {
    $name = "$rulePrefix-$($ownedRules.Count)"
    # Queue before creation: New-NetFirewallRule can create then report failure.
    $ownedRules += $name
    New-NetFirewallRule -Name $name -DisplayName $name -PolicyStore PersistentStore -Direction Outbound -Action Block -Enabled True -Profile Any -Program $program.Path -ErrorAction Stop | Out-Null
    $rules = @(Get-NetFirewallRule -Name $name -PolicyStore ActiveStore -ErrorAction Stop)
    if ($rules.Count -ne 1) { throw 'Firewall rule identity is not unique in ActiveStore' }
    $rule = $rules[0]
    if ($rule.Name -cne $name -or $rule.Enabled.ToString() -ne 'True' -or $rule.Action.ToString() -ne 'Block' -or $rule.Direction.ToString() -ne 'Outbound' -or $rule.Profile.ToString() -ne 'Any') { throw 'Firewall rule did not become active as requested' }
    $filters = @(Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -PolicyStore ActiveStore -ErrorAction Stop)
    if ($filters.Count -ne 1 -or -not [string]::Equals($filters[0].Program, $program.Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'Firewall application filter differs from exact program path' }
  }
  $denial = @(& $NodePath -e $probe)
  if ($LASTEXITCODE -ne 3 -or ($denial -join '').Trim() -notin @('EACCES','EPERM')) { throw 'Node outbound connect was not denied by OS permission; refusing offline claim' }
  & $NodePath $verifier --directory $RuntimePath --output $OutputPath
  if ($LASTEXITCODE -ne 0) { throw 'Exact extracted Windows runtime qualification failed' }
  $inner = Get-Content -LiteralPath $OutputPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($inner.passed -ne $true -or $inner.native.allFourRequested -ne $true -or @($inner.native.results).Count -ne 4) { throw 'Inner qualification did not prove all four exact workers' }
  $apps = @('wordcraft','pdfcraft','deckcraft','gridcraft')
  for ($index=0; $index -lt $apps.Count; $index++) {
    $rows = @($inner.native.results | Where-Object { $_.app -ceq $apps[$index] })
    if ($rows.Count -ne 1 -or $rows[0].passed -ne $true -or $rows[0].binarySha256 -cne $programs[$index+1].Sha256) { throw 'Inner worker evidence differs from exact blocked worker' }
  }
  foreach ($program in $programs) {
    if ((Get-FileHash -LiteralPath $program.Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() -cne $program.Sha256) { throw 'Program bytes changed during qualification' }
  }
} catch {
  $primaryError = $_
} finally {
  # Each action and readback has its own catch; one failure never skips another.
  foreach ($name in $ownedRules) {
    try { Remove-NetFirewallRule -Name $name -PolicyStore PersistentStore -ErrorAction Stop } catch { $cleanupErrors.Add("Remove rule $name : $($_.Exception.Message)") }
    $absent = $true
    foreach ($store in @('PersistentStore','ActiveStore')) {
      try {
        $remaining = @(Get-NetFirewallRule -PolicyStore $store -ErrorAction Stop | Where-Object { $_.Name -ceq $name })
        if ($remaining.Count -ne 0) { $absent=$false; $cleanupErrors.Add("Rule remains in $store : $name") }
      } catch { $absent=$false; $cleanupErrors.Add("Read rule absence $store $name : $($_.Exception.Message)") }
    }
    $ruleCleanup += [pscustomobject]@{Name=$name; AbsentFromPersistentAndActiveStore=$absent}
  }
  if ($profilesMayHaveChanged) {
    foreach ($profile in $profileState) {
      try { Set-NetFirewallProfile -Name $profile.Name -PolicyStore PersistentStore -Enabled $profile.PersistentEnabled -ErrorAction Stop } catch { $cleanupErrors.Add("Restore profile $($profile.Name) : $($_.Exception.Message)") }
      $restored = $true
      foreach ($store in @('PersistentStore','ActiveStore')) {
        try {
          $rows = @(Get-NetFirewallProfile -PolicyStore $store -ErrorAction Stop | Where-Object { $_.Name -ceq $profile.Name })
          $expected = if ($store -eq 'PersistentStore') { $profile.PersistentEnabled } else { $profile.ActiveEnabled }
          if ($rows.Count -ne 1 -or $rows[0].Enabled.ToString() -cne $expected) { $restored=$false; $cleanupErrors.Add("Profile state not restored in $store : $($profile.Name)") }
        } catch { $restored=$false; $cleanupErrors.Add("Read profile restoration $store $($profile.Name) : $($_.Exception.Message)") }
      }
      $profileCleanup += [pscustomobject]@{Name=$profile.Name; PersistentEnabled=$profile.PersistentEnabled; ActiveEnabled=$profile.ActiveEnabled; Restored=$restored}
    }
  }
  if ($null -ne $serviceState) {
    try {
      if ((Get-Service -Name mpssvc -ErrorAction Stop).Status.ToString() -cne $serviceState) { $cleanupErrors.Add('Firewall service state changed; wrapper never starts or stops the service') }
    } catch { $cleanupErrors.Add("Read firewall service final state : $($_.Exception.Message)") }
  }
}
if ($null -ne $primaryError -or $cleanupErrors.Count -ne 0) {
  $messages = @()
  if ($null -ne $primaryError) { $messages += 'Primary: ' + $primaryError.Exception.Message }
  if ($cleanupErrors.Count -ne 0) { $messages += 'Cleanup: ' + ($cleanupErrors -join ' | ') }
  throw ($messages -join '; ')
}
# No passed network proof exists until all cleanup commands and readbacks pass.
$proof = [ordered]@{
  schemaVersion=1; passed=$true; policy='Windows Defender Firewall explicit outbound block rules for Node and all four exact worker paths';
  positiveControlConnected=$true; nodeDirectIpDenied=$true; nodeError=($denial -join '').Trim(); workerRulesVerified=4;
  rulePrograms=@($programs | ForEach-Object { $_.Path }); programIdentities=$programs; innerReport=$OutputPath;
  cleanupVerified=$true; rulesRemoved=$ruleCleanup; profilesRestored=$profileCleanup;
  firewallService=@{RequiredAlreadyRunning=$true; Initial=$serviceState; Final=$serviceState; ChangedByWrapper=$false};
  limits=@('Inner verifier reports NOT_ENFORCED because restriction is supplied by this outer driver','Rules are per executable and do not claim arbitrary descendant or OS-wide isolation','Windows Server CI is not Windows 11 client or private-host acceptance')
}
$proof | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath ($OutputPath + '.network.json') -Encoding utf8 -ErrorAction Stop
