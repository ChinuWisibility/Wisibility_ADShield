#!/usr/bin/env python3
"""11 Nested Groups — parent contains child group."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Nested Groups"
FEATURE_ID = "nested_groups"
PARENT = f"{PREFIX}NestA"
CHILD = f"{PREFIX}NestB"


def _nested(client):
    return ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$p = Get-ADGroup -Identity '{PARENT}' -ErrorAction SilentlyContinue
$c = Get-ADGroup -Identity '{CHILD}' -ErrorAction SilentlyContinue
if (-not $p -or -not $c) {{ [pscustomobject]@{{ nested=$false; reason='missing' }} | ConvertTo-Json -Compress; return }}
$members = Get-ADGroupMember -Identity '{PARENT}' | Select-Object -ExpandProperty SamAccountName
$nested = $members -contains '{CHILD}'
[pscustomobject]@{{ nested=[bool]$nested; parent='{PARENT}'; child='{CHILD}' }} | ConvertTo-Json -Compress
""")


def setup(client):
    ensure_group(client, PARENT, description="nested parent")
    ensure_group(client, CHILD, description="nested child")
    before = _nested(client)
    if before.get("nested"):
        print_report(FEATURE, f"{PARENT}->{CHILD}", before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    run_ps(client, f"$ErrorActionPreference='Stop'; Import-Module ActiveDirectory; Add-ADGroupMember -Identity '{PARENT}' -Members '{CHILD}'")
    after = _nested(client)
    if not after.get("nested"):
        raise RuntimeError(after)
    print_report(FEATURE, f"{PARENT}->{CHILD}", before, "Add-ADGroupMember child into parent", after, "ANOMALY CREATED")


def status(client):
    info = _nested(client)
    print_status(FEATURE, f"{PARENT}->{CHILD}", info, "PRESENT" if info.get("nested") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory
Remove-ADGroupMember -Identity '{PARENT}' -Members '{CHILD}' -Confirm:$false
""")
    from _common import delete_if_test_object
    for n in (CHILD, PARENT):
        try: delete_if_test_object(client, n, "group")
        except Exception: pass
    print_status(FEATURE, f"{PARENT}->{CHILD}", "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

