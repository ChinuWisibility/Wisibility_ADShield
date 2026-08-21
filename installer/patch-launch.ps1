Copy-Item -LiteralPath 'D:\Work\Wisibility_IGA\installer\scripts\Launch-ADSecurity.ps1' -Destination 'C:\Program Files\ADSecurity\scripts\Launch-ADSecurity.ps1' -Force
# Quick self-test of new launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Program Files\ADSecurity\scripts\Launch-ADSecurity.ps1'
