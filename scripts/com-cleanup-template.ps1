param(
  [int]$Port = 4370
)
$ErrorActionPreference = "Continue"

$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("192.168.1.100", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

# Try SSR_DeleteDeviceData for pers_biotemplate
$del = $z.SSR_DeleteDeviceData(1, "pers_biotemplate", "Pin=99997", "")
Write-Host "SSR_DeleteDeviceData(pers_biotemplate, Pin=99997) -> $del"
Start-Sleep -Milliseconds 400

# Check count
$count = $z.SSR_GetDeviceDataCount("pers_biotemplate", "Pin=99997", "")
Write-Host "count after delete: $count"

# Try deleting the user (might cascade)
$del2 = $z.SSR_DeleteDeviceData(1, "user", "Pin=99997", "")
Write-Host "SSR_DeleteDeviceData(user, Pin=99997) -> $del2"
Start-Sleep -Milliseconds 400

$z.Disconnect()
Write-Host "done"
