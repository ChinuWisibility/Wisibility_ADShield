#!/usr/bin/env python3
"""37 SPN Misconfigurations — malformed user SPN matching isMalformedSpn()."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "SPN Misconfigurations"
FEATURE_ID = "spn_misconfigurations"
SAM = f"{PREFIX}SpnMis"
# Trailing colon is rejected by isMalformedSpn; AD often still stores it.
BAD_SPN_PRIMARY = "HTTP/WIS-ADShield-Test-Misconfig.example.invalid:"
BAD_SPN_FALLBACK = "INVALID_SPN_NO_SLASH"
BAD_SPNS = (BAD_SPN_PRIMARY, BAD_SPN_FALLBACK)


def _present(u):
    if not u:
        return False
    spns = u.get("servicePrincipalName") or []
    if isinstance(spns, str):
        spns = [spns]
    return any(s in spns for s in BAD_SPNS)


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    applied = None
    last_err = None
    for spn in BAD_SPNS:
        out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$u = Get-ADUser -Identity '{SAM}' -Properties servicePrincipalName
if (@($u.servicePrincipalName) -notcontains '{spn}') {{
  Set-ADUser -Identity '{SAM}' -ServicePrincipalNames @{{ Add = '{spn}' }}
}}
""")
        if code == 0:
            applied = spn
            break
        last_err = err or out
    if not applied:
        raise RuntimeError(last_err or "Could not set malformed SPN")
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, SAM, before, f"Add malformed SPN {applied}", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    print_status(FEATURE, SAM, u.get("servicePrincipalName"), "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    for spn in BAD_SPNS:
        run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
try {{ Set-ADUser -Identity '{SAM}' -ServicePrincipalNames @{{ Remove = '{spn}' }} }} catch {{}}
""")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
