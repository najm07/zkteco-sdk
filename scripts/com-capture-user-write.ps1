param(
  [int]$Port = 4376
)
$ErrorActionPreference = "Continue"

$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

# Vary: pin, name, password, privilege, enabled
$cases = @(
  @{ pin="99990"; name="TestA"; pass=""; priv=0; en=$true },
  @{ pin="99991"; name="TestB"; pass="1234"; priv=0; en=$true },
  @{ pin="99992"; name="TestC"; pass=""; priv=14; en=$true },
  @{ pin="99993"; name="TestD"; pass=""; priv=0; en=$false }
)

foreach ($c in $cases) {
  $ok = $z.SSR_SetUserInfo(1, $c.pin, $c.name, $c.pass, $c.priv, $c.en)
  Write-Host "SSR_SetUserInfo pin=$($c.pin) name=$($c.name) pass='$($c.pass)' priv=$($c.priv) en=$($c.en) -> $ok"
  Start-Sleep -Milliseconds 400
  # verify by reading back
  $name=""; $pass=""; $priv=0; $en=$false
  $got = $z.SSR_GetUserInfo(1, $c.pin, [ref]$name, [ref]$pass, [ref]$priv, [ref]$en)
  Write-Host "  readback: got=$got name='$name' pass='$pass' priv=$priv en=$en"
  Start-Sleep -Milliseconds 200
}

# cleanup
foreach ($c in $cases) {
  $del = $z.SSR_DeleteEnrollData(1, $c.pin, 1, 10) # backup=10 means delete all? or use DeleteEnrollData
}
Start-Sleep -Milliseconds 300
# better cleanup: delete user
foreach ($c in $cases) {
  $del = $z.SSR_DeleteUserInfoExt(1, $c.pin)
  Write-Host "delete $($c.pin) -> $del"
  Start-Sleep -Milliseconds 200
}

$z.Disconnect()
Write-Host "done"
