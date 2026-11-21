param(
    [string]$Task = 'assembleRelease'
)
$ErrorActionPreference = 'Continue'
$proj = 'E:\yymsg\_gh_analysis\android'
$log = Join-Path $proj 'build-last.log'

$env:JAVA_HOME = 'E:\yymsg\sdk\jdk'
$env:ANDROID_HOME = 'E:\yymsg\sdk\android'
$env:ANDROID_SDK_ROOT = 'E:\yymsg\sdk\android'
$env:GRADLE_USER_HOME = 'E:\yymsg\sdk\gradle'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

Set-Location $proj
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] START $Task" | Set-Content $log -Encoding UTF8
& .\gradlew.bat $Task --no-daemon *>> $log
$code = $LASTEXITCODE
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] EXIT=$code" | Add-Content $log -Encoding UTF8
exit $code
