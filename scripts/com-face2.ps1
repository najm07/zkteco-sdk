param(
  [string]$Pin = "1",
  [string]$Out = "C:\Users\mehdi\AppData\Local\Temp\opencode\vendor-face.json",
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 150

$faces = @()
foreach ($idx in 48..55) {
  $face = ""
  $len = 0
  $ok = $z.GetUserFaceStr(1, $Pin, $idx, [ref]$face, [ref]$len)
  if ($null -eq $face) { $face = "" }
  Write-Host "GetUserFaceStr(index=$idx) -> $ok len=$len chars=$($face.Length) head=$($face.Substring(0, [Math]::Min(24, $face.Length)))"
  if ($ok -and $face.Length -gt 0) {
    $faces += @{ index = $idx; length = $len; base64 = $face }
  }
}

$payload = [ordered]@{ pin = $Pin; faces = $faces }
$payload | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $Out -Encoding UTF8
Write-Host "wrote $Out"

$z.Disconnect()
Write-Host "done"
