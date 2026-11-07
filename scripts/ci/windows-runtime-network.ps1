param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$RuntimePath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$rulePrefix = 'OfficeRuntimeQualification-' + [Guid]::NewGuid().ToString('N')
$rules = @()
$profileState = @()
$probe = "const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(5000);s.once('connect',()=>{s.destroy();process.exit(0)});s.once('timeout',()=>{s.destroy();process.exit(2)});s.once('error',e=>{s.destroy();console.log(e.code);process.exit(['EPERM','EACCES'].includes(e.code)?3:4)});"
try {
  # A real positive control distinguishes an enforced denial from no connectivity.
  & $NodePath -e $probe
  if ($LASTEXITCODE -ne 0) { throw 'Outbound positive control failed; network-denied evidence unavailable' }
  $service = Get-Service -Name mpssvc
  if ($service.Status -ne 'Running') { Start-Service -Name mpssvc }
  $profileState = @(Get-NetFirewallProfile | Select-Object Name,Enabled)
  Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True
  $programs = @((Resolve-Path -LiteralPath $NodePath).Path)
  foreach ($app in @('wordcraft','pdfcraft','deckcraft','gridcraft')) {
    $programs += (Resolve-Path -LiteralPath (Join-Path $RuntimePath "runtime/bin/$app-cli.exe")).Path
  }
  foreach ($program in $programs) {
    $name = "$rulePrefix-$($rules.Count)"
    New-NetFirewallRule -Name $name -DisplayName $name -Direction Outbound -Action Block -Enabled True -Profile Any -Program $program | Out-Null
    $rules += $name
    $rule = Get-NetFirewallRule -Name $name
    if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Block' -or $rule.Direction -ne 'Outbound') { throw 'Firewall rule did not become active' }
  }
  $denial = & $NodePath -e $probe
  if ($LASTEXITCODE -ne 3) { throw 'Node outbound connect was not denied by OS permission; refusing offline claim' }
  & $NodePath (Join-Path $SourcePath 'scripts/verify-extracted-runtime.mjs') --directory $RuntimePath --output $OutputPath
  if ($LASTEXITCODE -ne 0) { throw 'Exact extracted Windows runtime qualification failed' }
  $proof = [ordered]@{
    schemaVersion=1; passed=$true; policy='Windows Defender Firewall explicit outbound block rules for Node and all four exact worker paths';
    positiveControlConnected=$true; nodeDirectIpDenied=$true; nodeError=($denial -join ''); workerRulesVerified=4;
    rulePrograms=$programs; innerReport=$OutputPath;
    limits=@('Inner verifier reports NOT_ENFORCED because restriction is supplied by this outer driver','Rules are per executable and do not claim arbitrary descendant or OS-wide isolation','Windows Server CI is not Windows 11 client or private-host acceptance')
  }
  $proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($OutputPath + '.network.json') -Encoding utf8
} finally {
  foreach ($name in $rules) { Remove-NetFirewallRule -Name $name -ErrorAction Continue }
  foreach ($profile in $profileState) { Set-NetFirewallProfile -Name $profile.Name -Enabled $profile.Enabled -ErrorAction Continue }
}
