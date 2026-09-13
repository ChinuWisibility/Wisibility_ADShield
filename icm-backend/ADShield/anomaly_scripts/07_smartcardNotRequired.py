#!/usr/bin/env python3
"""07 Smartcard Not Required — SMARTCARD_REQUIRED (0x40000) NOT set."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Smartcard Not Required"
FEATURE_ID = "smartcard_not_required"
SAM = f"{PREFIX}SmCard"


def _present(u):
    # Anomaly = smartcard NOT required
    return bool(u) and not bool(u.get("SmartcardLogonRequired")) and (int(u.get("userAccountControl") or 0) & 0x40000) == 0


def setup(client):
    before = ensure_user(client, SAM)
    # Ensure smartcard is NOT required
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADUser -Identity '{SAM}' -SmartcardLogonRequired $false")
    after = get_user(client, SAM)
    if _present(after):
        status = "ANOMALY ALREADY EXISTS" if _present(before) else "ANOMALY CREATED"
        print_report(FEATURE, SAM, before, "Set-ADUser -SmartcardLogonRequired $false", after, status)
    else:
        raise RuntimeError(after)


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    print_status(FEATURE, SAM, f"SmartcardLogonRequired={u.get('SmartcardLogonRequired')}",
                 "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    # Safe baseline for this test object: require smartcard (clears finding)
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADUser -Identity '{SAM}' -SmartcardLogonRequired $true")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
