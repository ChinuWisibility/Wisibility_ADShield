# ADSecurity Windows Installer

Offline product installer for Identity Sphere (Wisbility).

## Prerequisites (build machine)

1. Drop Node Windows x64 into `runtime/node/`
2. Drop MongoDB Community Windows binaries into `runtime/mongodb/`
3. Drop WinSW into `runtime/winsw/`
4. Install [Inno Setup](https://jrsoftware.org/isinfo.php)
5. Run `../scripts/windows/prepare-payload.ps1` on a Windows agent
6. Compile `ADSecurity.iss` → `ADSecuritySetup.exe`

## Customer experience

`ADSecuritySetup.exe` → Next → Finish → Desktop icon → Product opens.

MongoDB and Node are internal runtime components — never exposed as install choices.
