param(
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

# Field order taken from zkemsdk.dll's own default list for the `user` table.
$header = "Pin,Name,Password,CardNo,Pri,f,Group,IsGroupTz,verified,valid,ValidCount,StartDatetime,EndDatetime,Timezone1,Timezone2,Timezone3"
$dt = "1899-12-30T00:00:00"
$nameB64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("probe"))

function Row([string]$pin, [string]$name) {
  return "$pin,$name,,,0,0,1,1,0,0,0,$dt,$dt,0,0,0"
}

Write-Host "users before: $($z.SSR_GetDeviceDataCount('user','',''))"

$variants = @(
  @{ Name = "A header+b64";   Pin = 65040; Csv = "$header`r`n$(Row 65040 $nameB64)`r`n" },
  @{ Name = "B row only b64"; Pin = 65041; Csv = "$(Row 65041 $nameB64)`r`n" },
  @{ Name = "C header+plain"; Pin = 65042; Csv = "$header`r`n$(Row 65042 probe)`r`n" }
)

foreach ($v in $variants) {
  $ok = $z.SSR_SetDeviceData(1, "user", $v.Csv, "")
  Start-Sleep -Milliseconds 500
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
