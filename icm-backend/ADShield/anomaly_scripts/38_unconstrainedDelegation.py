#!/usr/bin/env python3
"""38 Unconstrained Delegation — TrustedForDelegation on dedicated lab computer (not DC)."""
from _common import PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps

FEATURE = "Unconstrained Delegation"
FEATURE_ID = "unconstrained_delegation"
NAME = f"{PREFIX}UncDel"


def _present(c):
    if not c:
        return False
    if c.get("TrustedForDelegation") is True:
        return True
    return (int(c.get("userAccountControl") or 0) & 0x80000) != 0


def setup(client):
    before = ensure_computer(client, NAME)
    if _present(before):
        print_report(FEATURE, NAME, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Set-ADAccountControl -Identity '{NAME}$' -TrustedForDelegation $true
""")
    if code != 0:
        raise RuntimeError(err or out)
    after = get_computer(client, NAME)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, NAME, before, "TrustedForDelegation=$true", after, "ANOMALY CREATED")


def status(client):
    c = get_computer(client, NAME)
    if not c:
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    print_status(FEATURE, NAME, f"TrustedForDelegation={c.get('TrustedForDelegation')} UAC={c.get('userAccountControl')}",
                 "PRESENT" if _present(c) else "ABSENT")


def reset(client):
    if not get_computer(client, NAME):
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Set-ADAccountControl -Identity '{NAME}$' -TrustedForDelegation $false
""")
    after = get_computer(client, NAME)
    print_status(FEATURE, NAME, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

