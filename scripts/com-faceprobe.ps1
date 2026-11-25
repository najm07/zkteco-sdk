param(
  [string]$Pin = "1",
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 150

foreach ($t in "templatev10", "facetemplatev07", "pers_biotemplate", "user", "transaction") {
  $c = $z.SSR_GetDeviceDataCount($t, "", "")
  Write-Host "count $t = $c"
}
foreach ($t in "templatev10", "facetemplatev07") {
  $buf = ""
  $ok = $z.SSR_GetDeviceData(1, [ref]$buf, 65536, $t, "*", "", "")
  if ($null -eq $buf) { $buf = "" }
  Write-Host "read $t -> $ok len=$($buf.Length)"
}

foreach ($idx in 0, 1, 2, 50, 51) {
  $face = ""
  $len = 0
  $ok = $z.GetUserFaceStr(1, $Pin, $idx, [ref]$face, [ref]$len)
  Write-Host "GetUserFaceStr(index=$idx) -> $ok len=$len"
}
foreach ($idx in 0, 1, 2, 50, 51) {
  $face = ""
  $len = 0
  $ok = $z.GetUserFace(1, $Pin, $idx, [ref]$face, [ref]$len)
  Write-Host "GetUserFace(index=$idx) -> $ok len=$len"
}

$z.Disconnect()
Write-Host "done"
