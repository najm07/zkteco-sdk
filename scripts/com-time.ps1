param(
  [int]$Year = 0, [int]$Month = 0, [int]$Day = 0,
  [int]$Hour = 0, [int]$Minute = 0, [int]$Second = 0
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

if ($Year -eq 0) {
  $now = Get-Date
  $Year = $now.Year; $Month = $now.Month; $Day = $now.Day
  $Hour = $now.Hour; $Minute = $now.Minute; $Second = $now.Second
}

Write-Host "setting device time to $Year-$Month-$Day $Hour`:$Minute`:$Second"
$ok = $z.SetDeviceTime2(1, $Year, $Month, $Day, $Hour, $Minute, $Second)
Write-Host "SetDeviceTime2 -> $ok"

$t = ""
$gt = $z.GetDeviceTime(1, [ref]$t)
Write-Host "GetDeviceTime -> $gt / $t"

$z.Disconnect()
Write-Host "done"
