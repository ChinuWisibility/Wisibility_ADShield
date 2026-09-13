#!/usr/bin/env python3
"""06 Reversible Encryption — UAC ENCRYPTED_TEXT_PASSWORD_ALLOWED 0x80."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "Reversible Encryption"
FEATURE_ID = "reversible_encryption_enabled"
SAM = f"{PREFIX}RevEnc"


def _present(u):
    return bool(u) and (
        bool(u.get("AllowReversiblePasswordEncryption"))
        or (int(u.get("userAccountControl") or 0) & 0x80) != 0
    )


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADUser -Identity '{SAM}' -AllowReversiblePasswordEncryption $true")
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, SAM, before, "Set-ADUser -AllowReversiblePasswordEncryption $true", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    print_status(FEATURE, SAM, f"AllowReversiblePasswordEncryption={u.get('AllowReversiblePasswordEncryption')} UAC={u.get('userAccountControl')}",
                 "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADUser -Identity '{SAM}' -AllowReversiblePasswordEncryption $false")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)
