param(
  [int]$Port = 4372
)
$ErrorActionPreference = "Continue"

# Load captured face blob (Pin=1 from live device).
$faceJson = Get-Content "C:\Users\mehdi\AppData\Local\Temp\opencode\vendor-face.json" -Raw | ConvertFrom-Json
$base64 = $faceJson.faces[0].base64
$blobBytes = [Convert]::FromBase64String($base64)
Write-Host "face blob: $($blobBytes.Length) bytes, base64 len $($base64.Length)"

$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

$pin = "99999"
# Create the user first.
$ok = $z.SSR_SetUserInfo(1, $pin, "ProbeFace", "", 0, $true)
Write-Host "SSR_SetUserInfo(99999) -> $ok"
Start-Sleep -Milliseconds 300

# Enroll the face using SetUserFaceStr (base64 string variant).
$faceOk = $z.SetUserFaceStr(1, $pin, 50, $base64, $blobBytes.Length)
Write-Host "SetUserFaceStr(99999, idx50) -> $faceOk"
Start-Sleep -Milliseconds 500

# Verify it round-trips.
$buf = ""
$len = 0
$got = $z.GetUserFaceStr(1, $pin, 50, [ref]$buf, [ref]$len)
Write-Host "GetUserFaceStr verify: got=$got len=$len match=$($buf -eq $base64)"

# Clean up: delete the synthetic user.
$del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$pin", "")
Write-Host "delete user 99999 -> $del"
Start-Sleep -Milliseconds 400

$z.Disconnect()
Write-Host "done"
