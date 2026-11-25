param(
  [string]$Filter = "",
  [string]$Columns = "Pin,Type,Index,No",
  [string]$Table = "pers_biotemplate",
  [int]$Port = 4372,
  [int]$Limit = 65536
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 150

$limit = $Limit
$buf = ""
try {
  $ok = $z.SSR_GetDeviceData(1, [ref]$buf, $limit, $Table, $Columns, $Filter, "")
} catch {
  Write-Host "exception: $($_.Exception.Message)"
  $ok = $false
}
if ($null -eq $buf) { $buf = "" }
$preview = $buf.Replace("`r", "<CR>").Replace("`n", "<LF>")
if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) + "..." }
Write-Host "table=$Table filter='$Filter' cols='$Columns' -> $ok len=$($buf.Length)"
Write-Host "  $preview"

Start-Sleep -Milliseconds 100
$z.Disconnect()
Write-Host "done"
