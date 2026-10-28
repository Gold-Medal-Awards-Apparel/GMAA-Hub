param([string]$AppDir, [int]$Desktop = 1)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'GoldMedalHub-shortcuts.log'
try {
  $app  = (Resolve-Path $AppDir).Path.TrimEnd('\')
  $exe  = Join-Path $app 'node_modules\electron\dist\electron.exe'
  $icon = Join-Path $app 'assets\icon.ico'
  if (-not (Test-Path $exe))  { throw "Cannot find the app engine at: $exe  (run Start Gold Medal Hub.bat first so the components download)" }
  if (-not (Test-Path $icon)) { throw "Cannot find the icon at: $icon" }
  $name = 'Gold Medal Hub (GMAA).lnk'
  $ws = New-Object -ComObject WScript.Shell
  function Make([string]$path) {
    $s = $ws.CreateShortcut($path)
    $s.TargetPath = $exe
    $s.Arguments = '"' + $app + '"'
    $s.WorkingDirectory = $app
    $s.IconLocation = $icon + ',0'
    $s.Description = 'Gold Medal Awards and Apparel (GMAA) - Gold Medal Hub'
    $s.Save()
    if (-not (Test-Path $path)) { throw "Windows did not create: $path" }
    Write-Host "Created: $path"
  }
  Make (Join-Path ([Environment]::GetFolderPath('Programs')) $name)
  if ($Desktop -eq 1) { Make (Join-Path ([Environment]::GetFolderPath('Desktop')) $name) }
  'OK ' + (Get-Date) | Out-File $log
  exit 0
} catch {
  Write-Host ''
  Write-Host 'SHORTCUT SETUP FAILED:' -ForegroundColor Red
  Write-Host $_.Exception.Message
  ('FAILED ' + (Get-Date) + ' ' + $_.Exception.Message) | Out-File $log
  exit 1
}
