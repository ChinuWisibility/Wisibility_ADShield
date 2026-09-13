#!/usr/bin/env python3
"""05 Password Not Required — UAC PASSWD_NOTREQD 0x20."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Password Not Required"
FEATURE_ID = "password_not_required"
SAM = f"{PREFIX}PwdNR"


def _present(u):
    return bool(u) and (int(u.get("userAccountControl") or 0) & 0x20) != 0


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADAccountControl -Identity '{SAM}' -PasswordNotRequired $true")
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, SAM, before, "Set-ADAccountControl -PasswordNotRequired $true", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    print_status(FEATURE, SAM, f"UAC={u.get('userAccountControl')}", "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADAccountControl -Identity '{SAM}' -PasswordNotRequired $false")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
