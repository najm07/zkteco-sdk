param(
  [int]$Port = 4374
)
$ErrorActionPreference = "Continue"

$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

$del = $z.SSR_DeleteDeviceData(1, "pers_biotemplate", "Pin=99996", "")
Write-Host "delete pers_biotemplate Pin=99996 -> $del"
Start-Sleep -Milliseconds 400

$z.Disconnect()
Write-Host "done"
