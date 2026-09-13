#!/usr/bin/env python3
"""10 Groups Without Owners — managedBy empty."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Groups Without Owners"
FEATURE_ID = "groups_without_owners"
NAME = f"{PREFIX}NoOwnG"


def setup(client):
    before = ensure_group(client, NAME, description="ADShield no-owner anomaly")
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Set-ADGroup -Identity '{NAME}' -Clear managedBy")
    after = ensure_group(client, NAME)
    if after.get("managedBy"):
        raise RuntimeError(after)
    print_report(FEATURE, NAME, before, "Clear managedBy", after, "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup -Filter "sAMAccountName -eq '{NAME}'" -Properties managedBy -ErrorAction SilentlyContinue
if (-not $g) {{ 'null' }} else {{ [pscustomobject]@{{ Sam=$g.SamAccountName; managedBy=$g.managedBy }} | ConvertTo-Json -Compress }}
""")
    if not info or info == "null":
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    present = not info.get("managedBy")
    print_status(FEATURE, NAME, info, "PRESENT" if present else "ABSENT")


def reset(client):
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, NAME, "group")
        print_status(FEATURE, NAME, "deleted", "ABSENT")
    except Exception as e:
        print_status(FEATURE, NAME, str(e), "N/A")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

