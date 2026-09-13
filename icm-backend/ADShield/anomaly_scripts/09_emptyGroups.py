#!/usr/bin/env python3
"""09 Empty Groups — group with zero members."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, ps_json, run_ps

FEATURE = "Empty Groups"
FEATURE_ID = "empty_groups"
NAME = f"{PREFIX}EmptyG"


def _info(client):
    return ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup -Filter "sAMAccountName -eq '{NAME}'" -SearchBase 'OU=wisibility,DC=wisibility,DC=lcl' -Properties Members -ErrorAction SilentlyContinue
if (-not $g) {{ 'null' }} else {{
  [pscustomobject]@{{ Sam=$g.SamAccountName; DN=$g.DistinguishedName; MemberCount=@($g.Members).Count }} | ConvertTo-Json -Compress
}}
""")


def setup(client):
    before = ensure_group(client, NAME, description="ADShield empty-group anomaly")
    # Ensure no members
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup '{NAME}' -Properties Members
foreach ($m in @($g.Members)) {{ Remove-ADGroupMember -Identity '{NAME}' -Members $m -Confirm:$false }}
""")
    after = _info(client)
    if after == "null" or after is None:
        raise RuntimeError("group missing")
    if isinstance(after, str):
        import json; after = json.loads(after) if after != "null" else None
    if int(after.get("MemberCount") or 0) != 0:
        raise RuntimeError(after)
    status = "ANOMALY ALREADY EXISTS" if int(before.get("MemberCount") or 0) == 0 else "ANOMALY CREATED"
    print_report(FEATURE, NAME, before, "Ensure group with 0 members", after, status)


def status(client):
    info = _info(client)
    if not info or info == "null":
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    if isinstance(info, str):
        import json; info = json.loads(info)
    present = int(info.get("MemberCount") or 0) == 0
    print_status(FEATURE, NAME, info, "PRESENT" if present else "ABSENT")


def reset(client):
    # Delete dedicated test group if under test OU
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, NAME, "group")
        print_status(FEATURE, NAME, "deleted", "ABSENT")
    except Exception as e:
        print_status(FEATURE, NAME, str(e), "PRESENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

