#!/usr/bin/env python3
"""34 Kerberoastable Accounts — enabled user with any servicePrincipalName."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Kerberoastable Accounts"
FEATURE_ID = "kerberoastable_accounts"
SAM = f"{PREFIX}KerbRst"
TEST_SPN = "HTTP/WIS-ADShield-Test-Kerberoast.example.invalid"


def _present(u):
    if not u or u.get("Enabled") is False:
        return False
    spns = u.get("servicePrincipalName") or []
    if isinstance(spns, str):
        return bool(spns.strip())
    return len(spns) > 0


def setup(client):
    before = ensure_user(client, SAM)
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Enable-ADAccount -Identity '{SAM}' -EA SilentlyContinue
$u = Get-ADUser -Identity '{SAM}' -Properties servicePrincipalName
if (@($u.servicePrincipalName) -notcontains '{TEST_SPN}') {{
  Set-ADUser -Identity '{SAM}' -ServicePrincipalNames @{{ Add = '{TEST_SPN}' }}
}}
""")
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, SAM, before, f"Add SPN {TEST_SPN}", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    print_status(FEATURE, SAM, f"SPNs={u.get('servicePrincipalName')} Enabled={u.get('Enabled')}",
                 "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if get_user(client, SAM):
        run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
try {{ Set-ADUser -Identity '{SAM}' -ServicePrincipalNames @{{ Remove = '{TEST_SPN}' }} }} catch {{}}
""")
    after = get_user(client, SAM)
    present = _present(after) if after else False
    print_status(FEATURE, SAM, after or "missing", "ABSENT" if not present else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

