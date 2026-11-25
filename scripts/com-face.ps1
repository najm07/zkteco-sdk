param(
  [string]$Pin = "1",
  [string]$Out = "C:\Users\mehdi\AppData\Local\Temp\opencode\vendor-face.json",
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 150

$result = [ordered]@{ pin = $Pin; face = $null; fingers = @() }

foreach ($idx in 0, 1, 2) {
  $face = ""
  $len = 0
  $ok = $z.GetUserFaceStr(1, $Pin, $idx, [ref]$face, [ref]$len)
  if ($null -eq $face) { $face = "" }
  Write-Host "GetUserFaceStr(index=$idx) -> $ok len=$len chars=$($face.Length)"
  if ($ok) {
    $result.face = @{ index = $idx; length = $len; base64 = $face }
    break
  }
}

for ($i = 0; $i -lt 10; $i++) {
  $tmp = ""
  $len = 0
  $ok = $z.GetUserTmpStr(1, $Pin, $i, [ref]$tmp, [ref]$len)
  if ($null -eq $tmp) { $tmp = "" }
  if ($ok) {
    Write-Host "GetUserTmpStr(index=$i) -> $ok len=$len"
    $result.fingers += @{ index = $i; length = $len; base64 = $tmp }
  }
}
Write-Host "finger templates: $($result.fingers.Count)"

$result | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $Out -Encoding UTF8
Write-Host "wrote $Out"

$z.Disconnect()
Write-Host "done"
