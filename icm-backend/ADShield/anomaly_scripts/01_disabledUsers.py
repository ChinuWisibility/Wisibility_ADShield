#!/usr/bin/env python3
"""01 Disabled Users — create Enabled=False on dedicated test user (ADShield disabled_users)."""
from _common import (
    PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps,
)

FEATURE = "Disabled Users"
FEATURE_ID = "disabled_users"
SAM = f"{PREFIX}DisUsr"


def setup(client):
    before = ensure_user(client, SAM)
    if before.get("Enabled") is False or (int(before.get("userAccountControl") or 0) & 2):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Disable-ADAccount -Identity '{SAM}'")
    after = get_user(client, SAM)
    if after and after.get("Enabled") is False:
        print_report(FEATURE, SAM, before, "Disable-ADAccount", after, "ANOMALY CREATED")
    else:
        raise RuntimeError(f"Disable failed: {after}")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    present = u.get("Enabled") is False or (int(u.get("userAccountControl") or 0) & 2) != 0
    print_status(FEATURE, SAM, f"Enabled={u.get('Enabled')} UAC={u.get('userAccountControl')}", "PRESENT" if present else "ABSENT")


def reset(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT")
        return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Enable-ADAccount -Identity '{SAM}'")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, f"Enabled={after.get('Enabled')}", "ABSENT" if after and after.get("Enabled") else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

