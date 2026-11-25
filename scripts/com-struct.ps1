param()
$ErrorActionPreference = "Continue"
$z = New-Object -ComObject zkemkeeper.ZKEM
if (-not $z.Connect_Net("127.0.0.1", 4371)) { Write-Host "connect failed"; exit 1 }
Start-Sleep -Milliseconds 200

# Each call changes exactly one field so the packed record can be mapped by
# diffing captured payloads. All are expected to be refused by this firmware.
$cases = @(
  @{ Name = "A base";      Pin = 100; User = "AAAA"; Pw = "";     Priv = 0;  En = $true  },
  @{ Name = "B name";      Pin = 100; User = "BBBB"; Pw = "";     Priv = 0;  En = $true  },
  @{ Name = "C password";  Pin = 100; User = "AAAA"; Pw = "ZZZZ"; Priv = 0;  En = $true  },
  @{ Name = "D privilege"; Pin = 100; User = "AAAA"; Pw = "";     Priv = 7;  En = $true  },
  @{ Name = "E disabled";  Pin = 100; User = "AAAA"; Pw = "";     Priv = 0;  En = $false },
  @{ Name = "F pin";       Pin = 101; User = "AAAA"; Pw = "";     Priv = 0;  En = $true  }
)

foreach ($c in $cases) {
  $r = $z.SetUserInfo(1, [int]$c.Pin, $c.User, $c.Pw, [int]$c.Priv, [bool]$c.En)
  Write-Host "$($c.Name): $r"
  Start-Sleep -Milliseconds 150
}

Write-Host "users: $($z.SSR_GetDeviceDataCount('user','',''))"
$z.Disconnect()
Write-Host "done"
