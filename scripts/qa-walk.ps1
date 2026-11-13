param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$false)][string]$Tap,      # "x,y" 可选点击坐标
  [Parameter(Mandatory=$false)][int]$Wait = 3,
  [Parameter(Mandatory=$false)][string]$Device = "127.0.0.1:16384"
)
$adb = "D:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe"
$qa = "E:\yymsg\yaya_msg_mobile\scratch\qa"
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
node "E:\yymsg\yaya_msg_mobile\scripts\qa-check.js" "$qa\$Name.xml" 2>&1 | Select-Object -First 40
