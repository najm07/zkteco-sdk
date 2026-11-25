param()
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$header = "UID,Pin,Name,Password,CardNo,Group,TZ,Pri,f,h,IsGroupTz,verified,valid,VaildCount,StartDatetime,EndDatetime,Timezone1,Timezone2,Timezone3"
$crlf = "`r`n"
$lf = "`n"
$dt = "1899-12-30T00:00:00"

function Row([string]$pin, [string]$uid) {
  return "$uid,$pin,zz$pin,,,1,,0,0,0,1,0,0,0,$dt,$dt,0,0,0"
}

$variants = @(
  @{ Name = "A header+row+crlf"; Pin = 65010; Data = "$header$crlf$(Row 65010 0)$crlf" },
  @{ Name = "B row only crlf";    Pin = 65011; Data = "$(Row 65011 0)$crlf" },
  @{ Name = "C header+row lf";    Pin = 65012; Data = "$header$lf$(Row 65012 0)$lf" },
  @{ Name = "D header+row noeol"; Pin = 65013; Data = "$header$crlf$(Row 65013 0)" },
  @{ Name = "E uid=pin crlf";     Pin = 65014; Data = "$header$crlf$(Row 65014 65014)$crlf" }
)

foreach ($v in $variants) {
  $ok = $z.SSR_SetDeviceData(1, "user", $v.Data, "")
  Start-Sleep -Milliseconds 300
  $n = $z.SSR_GetDeviceDataCount("user", "Pin=$($v.Pin)", "")
  Write-Host "$($v.Name): SetDeviceData=$ok  count(Pin=$($v.Pin))=$n"
}

Write-Host "total users: $($z.SSR_GetDeviceDataCount('user','',''))"

foreach ($v in $variants) {
  $del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$($v.Pin)", "")
  Write-Host "delete $($v.Pin) -> $del"
}
Start-Sleep -Milliseconds 300
Write-Host "final users: $($z.SSR_GetDeviceDataCount('user','',''))"

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
