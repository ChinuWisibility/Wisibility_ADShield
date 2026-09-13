#!/usr/bin/env python3
"""35 AS-REP Roastable Users — DONT_REQ_PREAUTH on enabled user (UAC 0x400000)."""
from _common import PREFIX, ensure_user, get_user, main_cli, print_report, print_status, run_ps

FEATURE = "AS-REP Roastable Users"
FEATURE_ID = "asrep_roastable_users"
SAM = f"{PREFIX}Asrep"


def _present(u):
    if not u or u.get("Enabled") is False:
        return False
    if u.get("DoesNotRequirePreAuth") is True:
        return True
    return (int(u.get("userAccountControl") or 0) & 0x400000) != 0


def setup(client):
    before = ensure_user(client, SAM)
    if _present(before):
        print_report(FEATURE, SAM, before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Enable-ADAccount -Identity '{SAM}' -EA SilentlyContinue
Set-ADAccountControl -Identity '{SAM}' -DoesNotRequirePreAuth $true
""")
    if code != 0:
        raise RuntimeError(err or out)
    after = get_user(client, SAM)
    if not _present(after):
        raise RuntimeError(after)
    print_report(FEATURE, SAM, before, "DoesNotRequirePreAuth=$true", after, "ANOMALY CREATED")


def status(client):
    u = get_user(client, SAM)
    if not u:
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    print_status(FEATURE, SAM, f"UAC={u.get('userAccountControl')} DoesNotRequirePreAuth={u.get('DoesNotRequirePreAuth')}",
                 "PRESENT" if _present(u) else "ABSENT")


def reset(client):
    if not get_user(client, SAM):
        print_status(FEATURE, SAM, "object missing", "ABSENT"); return
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Set-ADAccountControl -Identity '{SAM}' -DoesNotRequirePreAuth $false
""")
    after = get_user(client, SAM)
    print_status(FEATURE, SAM, after, "ABSENT" if not _present(after) else "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

