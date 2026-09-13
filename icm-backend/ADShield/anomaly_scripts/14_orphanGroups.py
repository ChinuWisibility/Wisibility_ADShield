#!/usr/bin/env python3
"""14 Orphan Groups — unused + no managedBy."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps

FEATURE = "Orphan Groups"
FEATURE_ID = "orphan_groups"
NAME = f"{PREFIX}OrphanG"


def setup(client):
    before = ensure_group(client, NAME, description="orphan anomaly")
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup '{NAME}' -Properties Members,MemberOf
foreach ($m in @($g.Members)) {{ Remove-ADGroupMember -Identity '{NAME}' -Members $m -Confirm:$false }}
foreach ($p in @($g.MemberOf)) {{ Remove-ADGroupMember -Identity $p -Members '{NAME}' -Confirm:$false }}
Set-ADGroup -Identity '{NAME}' -Clear managedBy
""")
    after = ensure_group(client, NAME)
    print_report(FEATURE, NAME, before, "Clear members/parents/managedBy", after, "ANOMALY CREATED")


def status(client):
    from _common import ps_json
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup -Filter "sAMAccountName -eq '{NAME}'" -Properties Members,MemberOf,managedBy -EA SilentlyContinue
if (-not $g) {{ 'null' }} else {{
  [pscustomobject]@{{ MemberCount=@($g.Members).Count; ParentCount=@($g.MemberOf).Count; managedBy=$g.managedBy }} | ConvertTo-Json -Compress
}}
""")
    if not info or info == "null":
        print_status(FEATURE, NAME, "missing", "ABSENT"); return
    present = int(info.get("MemberCount") or 0) == 0 and int(info.get("ParentCount") or 0) == 0 and not info.get("managedBy")
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

