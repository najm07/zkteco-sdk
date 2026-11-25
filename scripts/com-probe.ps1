param(
  [string]$HostAddr = "127.0.0.1",
  [int]$Port = 4371,
  [int]$PullMode = -1
)
$ErrorActionPreference = "Continue"
Write-Host "creating zkemkeeper.ZKEM ..."
$z = New-Object -ComObject zkemkeeper.ZKEM
if ($PullMode -ge 0) { $z.PullMode = $PullMode; Write-Host "PullMode := $($z.PullMode)" }
Write-Host "Connect_Net($HostAddr, $Port) ..."
$ok = $z.Connect_Net($HostAddr, $Port)
Write-Host "Connect_Net -> $ok"
Start-Sleep -Milliseconds 300
$v = ""
$r = $z.GetSDKVersion([ref]$v); Write-Host "GetSDKVersion -> $r / $v"
$sn = ""
$r = $z.GetSerialNumber(1, [ref]$sn); Write-Host "GetSerialNumber -> $r / $sn"
$fw = ""
$r = $z.GetFirmwareVersion(1, [ref]$fw); Write-Host "GetFirmwareVersion -> $r / $fw"
$pc = ""
$r = $z.GetProductCode(1, [ref]$pc); Write-Host "GetProductCode -> $r / $pc"
Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "disconnected"
