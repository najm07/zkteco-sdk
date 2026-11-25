param(
  [string]$Table = "transaction",
  [string]$Filter = "",
  [int]$Size = 4194304
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

$count = $z.SSR_GetDeviceDataCount($Table, $Filter, "")
Write-Host "COUNT('$Table','$Filter') = $count"

$buf = ""
$ok = $z.SSR_GetDeviceData(1, [ref]$buf, $Size, $Table, "*", $Filter, "")
if ($null -eq $buf) { $buf = "" }
Write-Host "GET('$Table','$Filter') OK=$ok CHARS=$($buf.Length)"
if ($buf.Length -gt 0) {
  $lines = $buf.Split("`n")
  Write-Host "LINES=$($lines.Count)"
  $preview = $buf.Substring(0, [Math]::Min(300, $buf.Length)).Replace("`r", "").Replace("`n", " | ")
  Write-Host "PREVIEW: $preview"
}

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
