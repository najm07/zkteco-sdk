param(
  [string]$Filter = "UID=500"
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

Write-Host "before: $($z.SSR_GetDeviceDataCount('user','',''))"
Write-Host "match before: $($z.SSR_GetDeviceDataCount('user',$Filter,''))"
$del = $z.SSR_DeleteDeviceData(1, "user", $Filter, "")
Write-Host "delete '$Filter' -> $del"
Start-Sleep -Milliseconds 400
Write-Host "after: $($z.SSR_GetDeviceDataCount('user','',''))"
Write-Host "match after: $($z.SSR_GetDeviceDataCount('user',$Filter,''))"

$z.Disconnect()
Write-Host "done"
