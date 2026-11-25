param(
  [string]$Pin = "65000"
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$header = "UID,Pin,Name,Password,CardNo,Group,TZ,Pri,f,h,IsGroupTz,verified,valid,VaildCount,StartDatetime,EndDatetime,Timezone1,Timezone2,Timezone3"
$row = "$Pin,$Pin,zz sdk probe,,,1,,0,0,0,1,0,0,0,1899-12-30T00:00:00,1899-12-30T00:00:00,0,0,0"
$csv = "$header`r`n$row"

Write-Host "SetDeviceData user ..."
$ok = $z.SSR_SetDeviceData(1, "user", $csv, "")
Write-Host "SSR_SetDeviceData -> $ok"
Start-Sleep -Milliseconds 400

$count = $z.SSR_GetDeviceDataCount("user", "Pin=$Pin", "")
Write-Host "count Pin=$Pin -> $count"

$buf = ""
$got = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, "user", "UID,Pin,Name,Group", "Pin=$Pin", "")
if ($null -eq $buf) { $buf = "" }
$preview = $buf.Replace("`r", "").Replace("`n", " | ")
Write-Host "read -> $got : $preview"

Write-Host "deleting ..."
$del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$Pin", "")
Start-Sleep -Milliseconds 300
$after = $z.SSR_GetDeviceDataCount("user", "Pin=$Pin", "")
Write-Host "delete -> $del, remaining Pin=$Pin count $after"

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
