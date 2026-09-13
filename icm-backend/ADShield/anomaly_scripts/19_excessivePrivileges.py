#!/usr/bin/env python3
"""19 Excessive Privileges — user reaches >=5 privileged-named groups."""
from _common import PREFIX, ensure_user, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Excessive Privileges"
FEATURE_ID = "excessive_privileges"
USER = f"{PREFIX}ExcUser"
GROUPS = [f"{PREFIX}EAdmin{i}" for i in range(1, 6)]  # privileged token 'admin'


def setup(client):
    ensure_user(client, USER)
    for g in GROUPS:
        ensure_group(client, g, description="lab admin token")
        run_ps(client, f"$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory; Add-ADGroupMember '{g}' -Members '{USER}'")
    print_report(FEATURE, USER, "<5 priv groups", f"Add to {len(GROUPS)} admin-named groups", GROUPS, "ANOMALY CREATED")


def status(client):
    checks = []
    for g in GROUPS:
        info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$has = @((Get-ADGroupMember '{g}' -EA SilentlyContinue).SamAccountName) -contains '{USER}'
[pscustomobject]@{{ group='{g}'; has=[bool]$has }} | ConvertTo-Json -Compress
""")
        checks.append(info)
    count = sum(1 for c in checks if c.get("has"))
    print_status(FEATURE, USER, {"privGroupCount": count, "groups": checks}, "PRESENT" if count >= 5 else "ABSENT")


def reset(client):
    for g in GROUPS:
        run_ps(client, f"$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory; Remove-ADGroupMember '{g}' -Members '{USER}' -Confirm:$false")
    from _common import delete_if_test_object
    try: delete_if_test_object(client, USER, "user")
    except Exception: pass
    for g in GROUPS:
        try: delete_if_test_object(client, g, "group")
        except Exception: pass
    print_status(FEATURE, USER, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

