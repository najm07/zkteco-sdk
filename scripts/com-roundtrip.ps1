param()
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

# Read user 1 exactly as the shim renders it (text mode, base64 binaries),
# then feed the same string back. A round trip that the shim accepts gives us
# the authoritative write record encoding.
$buf = ""
$ok = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, "user", "*", "Pin=1", "")
if ($null -eq $buf) { $buf = "" }
Write-Host "read -> $ok chars=$($buf.Length)"
Write-Host "payload: $($buf.Replace("`r", '<CR>').Replace("`n", '<LF>'))"

if ($ok -and $buf.Length -gt 0) {
  $w = $z.SSR_SetDeviceData(1, "user", $buf, "")
  Write-Host "write-back -> $w"
}

$z.Disconnect()
Write-Host "done"
