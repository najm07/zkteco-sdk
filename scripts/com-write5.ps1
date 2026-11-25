param(
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$header = "UID,Pin,Name,Password,CardNo,Group,TZ,Pri,f,h,IsGroupTz,verified,valid,VaildCount,StartDatetime,EndDatetime,Timezone1,Timezone2,Timezone3"
$dt = "1899-12-30T00:00:00"
$nameB64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("probe"))

Write-Host "users before: $($z.SSR_GetDeviceDataCount('user','',''))"

$variants = @(
  @{ Name = "A uid0 b64";    Pin = 65030; Csv = "$header`r`n0,65030,$nameB64,,,1,,0,0,0,1,0,0,0,$dt,$dt,0,0,0`r`n" },
  @{ Name = "B uid=pin b64"; Pin = 65031; Csv = "$header`r`n65031,65031,$nameB64,,,1,,0,0,0,1,0,0,0,$dt,$dt,0,0,0`r`n" },
  @{ Name = "C no header";   Pin = 65032; Csv = "0,65032,$nameB64,,,1,,0,0,0,1,0,0,0,$dt,$dt,0,0,0`r`n" }
)

foreach ($v in $variants) {
  $ok = $z.SSR_SetDeviceData(1, "user", $v.Csv, "")
  Start-Sleep -Milliseconds 400
  $n = $z.SSR_GetDeviceDataCount("user", "Pin=$($v.Pin)", "")
  Write-Host "$($v.Name): write=$ok count(Pin=$($v.Pin))=$n"
  if ($n -gt 0) {
    $buf = ""
    $got = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, "user", "*", "Pin=$($v.Pin)", "")
    if ($null -eq $buf) { $buf = "" }
    $preview = $buf.Replace("`r", "").Replace("`n", " | ")
    Write-Host "   read=$got $preview"
  }
}

Write-Host "users now: $($z.SSR_GetDeviceDataCount('user','',''))"

foreach ($v in $variants) {
  $d = $z.SSR_DeleteDeviceData(1, "user", "Pin=$($v.Pin)", "")
  Write-Host "delete $($v.Pin) -> $d"
}
Start-Sleep -Milliseconds 400
Write-Host "users after cleanup: $($z.SSR_GetDeviceDataCount('user','',''))"

$z.Disconnect()
Write-Host "done"
