#!/usr/bin/env python3
"""15 Duplicate Groups — identical non-empty Description on >=2 groups."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps

FEATURE = "Duplicate Groups"
FEATURE_ID = "duplicate_groups"
A = f"{PREFIX}DupA"
B = f"{PREFIX}DupB"
DESC = "WIS-ADShield-Duplicate-Description-Marker"


def setup(client):
    ensure_group(client, A)
    ensure_group(client, B)
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Set-ADGroup -Identity '{A}' -Description '{DESC}'
Set-ADGroup -Identity '{B}' -Description '{DESC}'
""")
    print_report(FEATURE, f"{A},{B}", "descriptions differ or unset", f"Set Description='{DESC}' on both", DESC, "ANOMALY CREATED")


def status(client):
    from _common import ps_json
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$a = (Get-ADGroup -Identity '{A}' -Properties Description -EA SilentlyContinue).Description
$b = (Get-ADGroup -Identity '{B}' -Properties Description -EA SilentlyContinue).Description
[pscustomobject]@{{ a=$a; b=$b; match=($a -and $b -and ($a -eq $b)) }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, f"{A},{B}", info, "PRESENT" if info.get("match") else "ABSENT")


def reset(client):
    from _common import delete_if_test_object
    for n in (A, B):
        try: delete_if_test_object(client, n, "group")
        except Exception: pass
    print_status(FEATURE, f"{A},{B}", "deleted", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

