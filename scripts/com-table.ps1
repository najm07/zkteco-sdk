param(
  [string]$HostAddr = "127.0.0.1",
  [int]$Port = 4371,
  [string]$Table = "user",
  [int]$Limit = 1
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net($HostAddr, $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$count = $z.SSR_GetDeviceDataCount($Table, "", "")
Write-Host "SSR_GetDeviceDataCount('$Table') -> $count"

$buf = ""
$size = 1024 * 1024
$ok = $z.SSR_GetDeviceData(1, [ref]$buf, $size, $Table, "*", "", "")
if ($null -eq $buf) { $buf = "" }
Write-Host "SSR_GetDeviceData('$Table') -> $ok  chars=$($buf.Length)"
if ($buf.Length -gt 0) {
  $preview = $buf.Substring(0, [Math]::Min(600, $buf.Length))
  Write-Host "PREVIEW: $preview"
}

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
