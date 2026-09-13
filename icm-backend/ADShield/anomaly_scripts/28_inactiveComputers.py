#!/usr/bin/env python3
"""28 Inactive Computers — enabled computer with null/0 lastLogonTimestamp (never logged on).

Unlike inactive_users, Node/ADShield treats null/0 lastLogonTimestamp as inactive for computers.
"""
from _common import (
    PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps, ps_json,
)

FEATURE = "Inactive Computers"
FEATURE_ID = "inactive_computers"
NAME = f"{PREFIX}InactC"


def _props(client):
    return ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$c = Get-ADComputer -Identity '{NAME}$' -Properties Enabled,userAccountControl,lastLogonTimestamp -EA SilentlyContinue
if (-not $c) {{ 'null' | Write-Output; return }}
$ll = $c.lastLogonTimestamp
[pscustomobject]@{{
  SamAccountName=$c.SamAccountName
  DistinguishedName=$c.DistinguishedName
  Enabled=[bool]$c.Enabled
  userAccountControl=[int]$c.userAccountControl
  lastLogonTimestamp= if ($null -eq $ll) {{ $null }} else {{ $ll.ToFileTime().ToString() }}
  neverLoggedOn= ($null -eq $ll)
}} | ConvertTo-Json -Compress
""")


def _present(info):
    if not info or info == "null":
        return False
    if info.get("Enabled") is False or (int(info.get("userAccountControl") or 0) & 2):
        return False
    ll = info.get("lastLogonTimestamp")
    return info.get("neverLoggedOn") is True or ll in (None, "", "0", 0)


def setup(client):
    ensure_computer(client, NAME)
    # Ensure enabled (Disable would exclude from inactive detector)
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Enable-ADAccount -Identity '{NAME}$' -ErrorAction SilentlyContinue
""")
    after = _props(client)
    if not _present(after):
        raise RuntimeError(
            "Computer has a lastLogonTimestamp; cannot safely age it. "
            f"Got: {after}"
        )
    print_report(
        FEATURE, NAME,
        "new computer account",
        "Ensure enabled computer with null lastLogonTimestamp (never authenticated)",
        after,
        "ANOMALY CREATED",
    )


def status(client):
    info = _props(client)
    if not info or info == "null":
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    print_status(FEATURE, NAME, info, "PRESENT" if _present(info) else "ABSENT")


def reset(client):
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, f"{NAME}$", "computer")
    except Exception as e:
        print(f"reset note: {e}")
    print_status(FEATURE, NAME, "deleted if present", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

