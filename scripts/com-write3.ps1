param()
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

Write-Host "before: $($z.SSR_GetDeviceDataCount('user','',''))"

$a = $z.SetUserInfo(1, 65000, "aaa", "", 0, $true)
Write-Host "SetUserInfo(65000, 'aaa', priv=0, enabled=true) -> $a"
Start-Sleep -Milliseconds 300

$b = $z.SetUserInfo(1, 65001, "bbb", "", 2, $false)
Write-Host "SetUserInfo(65001, 'bbb', priv=2, enabled=false) -> $b"
Start-Sleep -Milliseconds 300

$c = $z.SetUserInfo(1, 65002, "ccc", "1234", 14, $true)
Write-Host "SetUserInfo(65002, 'ccc', pw=1234, priv=14, enabled=true) -> $c"
Start-Sleep -Milliseconds 300

Write-Host "after: $($z.SSR_GetDeviceDataCount('user','',''))"

foreach ($pin in 65000, 65001, 65002) {
  $buf = ""
  $got = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, "user", "UID,Pin,Name,Password,Group,Pri", "Pin=$pin", "")
  if ($null -eq $buf) { $buf = "" }
  $preview = $buf.Replace("`r", "").Replace("`n", " | ")
  Write-Host "read $pin -> $got : $preview"
}

foreach ($pin in 65000, 65001, 65002) {
  $del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$pin", "")
  Write-Host "delete $pin -> $del"
}
Start-Sleep -Milliseconds 300
Write-Host "final: $($z.SSR_GetDeviceDataCount('user','',''))"

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
