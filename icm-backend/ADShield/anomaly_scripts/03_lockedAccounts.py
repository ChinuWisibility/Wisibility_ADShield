#!/usr/bin/env python3
"""03 Locked Accounts — lockoutTime>0 or UAC LOCKOUT (ADShield locked_accounts)."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Locked Accounts"
FEATURE_ID = "locked_accounts"
SAM = f"{PREFIX}LockUsr"


def _present(u):
    if not u:
        return False
    try:
        lt = int(str(u.get("lockoutTime") or "0"))
    except ValueError:
        lt = 0
    return lt > 0 or (int(u.get("userAccountControl") or 0) & 0x10) != 0


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    script = f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$sam = '{SAM}'
$ft = [DateTime]::UtcNow.ToFileTime()
try {{
  Set-ADUser -Identity $sam -Replace @{{ lockoutTime = $ft }}
}} catch {{
  $uac = [int](Get-ADUser $sam -Properties userAccountControl).userAccountControl
  Set-ADUser -Identity $sam -Replace @{{ userAccountControl = ($uac -bor 16) }}
}}
"""
    out, err, code = run_ps(client, script)
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(f"Could not create lockout anomaly (AD may reject lockoutTime): {err or after}")
    print_report(FEATURE, SAM, before, "Set lockoutTime / LOCKOUT bit", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    print_status(FEATURE, SAM, f"lockoutTime={u.get('lockoutTime')} UAC={u.get('userAccountControl')}",
                 "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    script = f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$sam = '{SAM}'
try {{ Set-ADUser -Identity $sam -Replace @{{ lockoutTime = 0 }} }} catch {{}}
$uac = [int](Get-ADUser $sam -Properties userAccountControl).userAccountControl
if (($uac -band 16) -ne 0) {{ Set-ADUser -Identity $sam -Replace @{{ userAccountControl = ($uac -bxor 16) }} }}
"""
    run_ps(client, script)
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
