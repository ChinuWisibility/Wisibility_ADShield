#!/usr/bin/env python3
"""39 Constrained Delegation — msDS-AllowedToDelegateTo on dedicated lab computer."""
from _common import PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps

FEATURE = "Constrained Delegation"
FEATURE_ID = "constrained_delegation"
NAME = f"{PREFIX}ConDel"
TARGET_SPN = "cifs/WIS-ADShield-Test-ConstDel-Target.example.invalid"


def _present(c):
    if not c:
        return False
    targets = c.get("AllowedToDelegateTo") or []
    if isinstance(targets, str):
        targets = [targets]
    if any(targets):
        return True
    return (int(c.get("userAccountControl") or 0) & 0x1000000) != 0  # TRUSTED_TO_AUTH_FOR_DELEGATION


def setup(client):
    before = ensure_computer(client, NAME)
    if _present(before) and TARGET_SPN in (before.get("AllowedToDelegateTo") or []):
        print_report(FEATURE, NAME, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
# Protocol transition + constrained targets (lab-only fake SPN)
Set-ADComputer -Identity '{NAME}$' -Add @{{ 'msDS-AllowedToDelegateTo' = '{TARGET_SPN}' }}
Set-ADAccountControl -Identity '{NAME}$' -TrustedToAuthForDelegation $true
""")
    if code != 0:
        raise RuntimeError(err or out)
    after = get_computer(client, NAME)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, NAME, before, f"Add msDS-AllowedToDelegateTo={TARGET_SPN}", after, "ANOMALY CREATED")


def status(client):
    c = get_computer(client, NAME)
    if not c:
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    print_status(FEATURE, NAME, {"AllowedToDelegateTo": c.get("AllowedToDelegateTo"), "UAC": c.get("userAccountControl")},
                 "PRESENT" if _present(c) else "ABSENT")


def reset(client):
    if not get_computer(client, NAME):
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
try {{ Set-ADComputer -Identity '{NAME}$' -Remove @{{ 'msDS-AllowedToDelegateTo' = '{TARGET_SPN}' }} }} catch {{}}
try {{ Set-ADAccountControl -Identity '{NAME}$' -TrustedToAuthForDelegation $false }} catch {{}}
""")
    after = get_computer(client, NAME)
    print_status(FEATURE, NAME, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

