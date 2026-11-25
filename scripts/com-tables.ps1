param(
  [string]$HostAddr = "127.0.0.1",
  [int]$Port = 4371
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net($HostAddr, $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

function Try-Read([string]$Table, [string]$Filter) {
  $count = $z.SSR_GetDeviceDataCount($Table, $Filter, "")
  $buf = ""
  $size = 4 * 1024 * 1024
  $ok = $z.SSR_GetDeviceData(1, [ref]$buf, $size, $Table, "*", $Filter, "")
  if ($null -eq $buf) { $buf = "" }
  $preview = ""
  if ($buf.Length -gt 0) { $preview = $buf.Substring(0, [Math]::Min(200, $buf.Length)).Replace("`r", "").Replace("`n", "|") }
  Write-Host "TABLE=$Table FILTER='$Filter' COUNT=$count OK=$ok CHARS=$($buf.Length)"
  if ($preview) { Write-Host "  PREVIEW: $preview" }
}

Try-Read "transaction" ""
Try-Read "transaction" "time_second>=0"
Try-Read "pers_biotemplate" ""
Try-Read "pers_biotemplate" "Type=2"
Try-Read "pers_biotemplate" "Pin=1`tType=2"

Start-Sleep -Milliseconds 200
$z.Disconnect()
Write-Host "done"
