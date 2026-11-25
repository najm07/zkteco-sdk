param(
  [int]$Port = 4373
)
$ErrorActionPreference = "Continue"

$faceJson = Get-Content "C:\Users\mehdi\AppData\Local\Temp\opencode\vendor-face.json" -Raw | ConvertFrom-Json
$base64 = $faceJson.faces[0].base64
$blobBytes = [Convert]::FromBase64String($base64)
Write-Host "face blob: $($blobBytes.Length) bytes"

$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

$pin = "99998"

# Create user
$ok = $z.SSR_SetUserInfo(1, $pin, "ProbeFace2", "", 0, $true)
Write-Host "SSR_SetUserInfo(99998) -> $ok"
Start-Sleep -Milliseconds 300

# Try SetUserFace (binary variant) with index 0
$faceOk = $z.SetUserFace(1, $pin, 0, $blobBytes, $blobBytes.Length)
Write-Host "SetUserFace(idx0, binary) -> $faceOk"
Start-Sleep -Milliseconds 500

# Try SetUserFaceStr with index 0
$faceOk2 = $z.SetUserFaceStr(1, $pin, 0, $base64, $blobBytes.Length)
Write-Host "SetUserFaceStr(idx0) -> $faceOk2"
Start-Sleep -Milliseconds 500

# Try with index 5
$faceOk3 = $z.SetUserFaceStr(1, $pin, 5, $base64, $blobBytes.Length)
Write-Host "SetUserFaceStr(idx5) -> $faceOk3"
Start-Sleep -Milliseconds 500

# Try with index 1
$faceOk4 = $z.SetUserFaceStr(1, $pin, 1, $base64, $blobBytes.Length)
Write-Host "SetUserFaceStr(idx1) -> $faceOk4"
Start-Sleep -Milliseconds 500

# Verify
$buf = ""
$len = 0
$got = $z.GetUserFaceStr(1, $pin, 0, [ref]$buf, [ref]$len)
Write-Host "GetUserFaceStr(idx0) verify: got=$got len=$len"

# Clean up
$del = $z.SSR_DeleteDeviceData(1, "user", "Pin=$pin", "")
Write-Host "delete user 99998 -> $del"
Start-Sleep -Milliseconds 400

$z.Disconnect()
Write-Host "done"
