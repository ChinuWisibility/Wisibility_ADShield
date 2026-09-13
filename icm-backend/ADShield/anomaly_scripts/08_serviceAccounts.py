#!/usr/bin/env python3
"""08 Service Accounts — any servicePrincipalName present."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Service Accounts"
FEATURE_ID = "service_accounts"
SAM = f"{PREFIX}SvcAcct"
TEST_SPN = "HTTP/WIS-ADShield-Test-ServiceAccount.example.invalid"


def _present(u):
    spns = u.get("servicePrincipalName") if u else None
    if not spns:
        return False
    if isinstance(spns, str):
        return bool(spns.strip())
    return len(spns) > 0


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before) and TEST_SPN in (before.get("servicePrincipalName") or []):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$u = Get-ADUser -Identity '{SAM}' -Properties servicePrincipalName
$spns = @($u.servicePrincipalName)
if ($spns -notcontains '{TEST_SPN}') {{
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
    print_status(FEATURE, SAM, f"SPNs={u.get('servicePrincipalName')}", "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
try {{ Set-ADUser -Identity '{SAM}' -ServicePrincipalNames @{{ Remove = '{TEST_SPN}' }} }} catch {{}}
""")
    after = get_user(client, SAM)
    # ABSENT if our test SPN gone (other SPNs may remain — prefer clear all test)
    spns = after.get("servicePrincipalName") or []
    gone = TEST_SPN not in spns
    print_status(FEATURE, SAM, after, "ABSENT" if gone else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
