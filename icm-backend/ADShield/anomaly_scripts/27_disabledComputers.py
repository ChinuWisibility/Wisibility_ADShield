#!/usr/bin/env python3
"""27 Disabled Computers — Disable-ADAccount on dedicated test computer."""
from _common import (
    PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps,
)

FEATURE = "Disabled Computers"
FEATURE_ID = "disabled_computers"
NAME = f"{PREFIX}DisComp"


def setup(client):
    before = ensure_computer(client, NAME)
    if before.get("Enabled") is False or (int(before.get("userAccountControl") or 0) & 2):
        print_report(FEATURE, NAME, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Disable-ADAccount -Identity '{NAME}$'
""")
    if code != 0:
        raise RuntimeError(err or out)
    after = get_computer(client, NAME)
    if not after or after.get("Enabled") is not False:
        raise RuntimeError(f"Disable failed: {after}")
    print_report(FEATURE, NAME, before, "Disable-ADAccount", after, "ANOMALY CREATED")


def status(client):
    c = get_computer(client, NAME)
    if not c:
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    present = c.get("Enabled") is False or (int(c.get("userAccountControl") or 0) & 2) != 0
    print_status(FEATURE, NAME, f"Enabled={c.get('Enabled')} UAC={c.get('userAccountControl')}",
                 "PRESENT" if present else "ABSENT")


def reset(client):
    c = get_computer(client, NAME)
    if not c:
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Enable-ADAccount -Identity '{NAME}$'")
    after = get_computer(client, NAME)
    print_status(FEATURE, NAME, after, "ABSENT" if after and after.get("Enabled") else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

