param(
  [string]$Pin = "999999",
  [switch]$CleanupOnly
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$before = $z.SSR_GetDeviceDataCount("user", "", "")
Write-Host "users before: $before"

if (-not $CleanupOnly) {
  $ok = $z.SetUserInfo(1, [int]$Pin, "sdk probe", "", 0, $true)
  Write-Host "SetUserInfo($Pin) -> $ok"
  Start-Sleep -Milliseconds 300
  $one = $z.SSR_GetDeviceDataCount("user", "Pin=$Pin", "")
  Write-Host "count Pin=$Pin -> $one"

  $buf = ""
  $got = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, "user", "Pin,Name,Group", "Pin=$Pin", "")
  if ($null -eq $buf) { $buf = "" }
  Write-Host "read Pin=$Pin -> $got"
  $preview = $buf.Replace("`r", "").Replace("`n", " | ")
  Write-Host "  $preview"
}

$del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$Pin", "")
Write-Host "SSR_DeleteDeviceData($Pin) -> $del"
Start-Sleep -Milliseconds 300
$after = $z.SSR_GetDeviceDataCount("user", "", "")
$afterOne = $z.SSR_GetDeviceDataCount("user", "Pin=$Pin", "")
Write-Host "users after: $after (Pin=$Pin count $afterOne)"

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
