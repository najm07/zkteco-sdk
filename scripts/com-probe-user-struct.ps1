param([int]$Port = 4376)
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", $Port)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 300

# Try different password lengths to understand encoding
$cases = @(
  @{ pin="99980"; name="PA"; pass="1"; priv=0; en=$true },
  @{ pin="99981"; name="PB"; pass="12345"; priv=0; en=$true },
  @{ pin="99982"; name="PC"; pass=""; priv=14; en=$false }
)

foreach ($c in $cases) {
  $ok = $z.SSR_SetUserInfo(1, $c.pin, $c.name, $c.pass, $c.priv, $c.en)
  Write-Host "SET pin=$($c.pin) name=$($c.name) pass='$($c.pass)' priv=$($c.priv) en=$($c.en) -> $ok"
  Start-Sleep -Milliseconds 400
  $name=""; $pass=""; $priv=0; $en=$false
  $got = $z.SSR_GetUserInfo(1, $c.pin, [ref]$name, [ref]$pass, [ref]$priv, [ref]$en)
  Write-Host "  GET got=$got name='$name' pass='$pass' priv=$priv en=$en"
  Start-Sleep -Milliseconds 200
}

# Also try SetUserInfoEx if available (has card number, group, etc.)
try {
  $ok = $z.SetUserInfoEx(1, "99983", 0, 0, "CardUser", 0, $true, "12345678", 0)
  Write-Host "SetUserInfoEx 99983 -> $ok"
} catch { Write-Host "SetUserInfoEx not available: $_" }

$z.Disconnect()
Write-Host "done"
