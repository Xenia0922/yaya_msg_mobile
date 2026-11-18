param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$false)][string]$Tap,      # "x,y" 可选点击坐标
  [Parameter(Mandatory=$false)][int]$Wait = 3,
  [Parameter(Mandatory=$false)][string]$Device = "127.0.0.1:16384"
)
# 跨平台：优先 YAYA_ADB，其次 PATH 中的 adb（MuMu 等模拟器可用 YAYA_ADB 指到自带 adb）。
$adb = if ($env:YAYA_ADB) { $env:YAYA_ADB } else { 'adb' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$qa = if ($env:YAYA_QA_DIR) { $env:YAYA_QA_DIR } else { Join-Path $repoRoot 'scratch\qa' }
New-Item -ItemType Directory -Force -Path $qa | Out-Null
if ($Tap) {
  $xy = $Tap -split ','
  & $adb -s $Device shell input tap $xy[0] $xy[1] | Out-Null
}
Start-Sleep -Seconds $Wait
& $adb -s $Device shell screencap -p /sdcard/qa.png | Out-Null
& $adb -s $Device pull /sdcard/qa.png "$qa\$Name.png" | Out-Null
& $adb -s $Device shell uiautomator dump /sdcard/qa.xml | Out-Null
& $adb -s $Device pull /sdcard/qa.xml "$qa\$Name.xml" | Out-Null
Write-Host "=== [$Name] screenshot + dump captured ==="
node (Join-Path $PSScriptRoot 'qa-check.js') "$qa\$Name.xml" 2>&1 | Select-Object -First 40
