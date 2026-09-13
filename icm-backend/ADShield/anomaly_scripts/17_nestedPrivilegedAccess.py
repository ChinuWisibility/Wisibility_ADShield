#!/usr/bin/env python3
"""17 Nested Privileged Access — privileged-named group nested under parent with a user member."""
from _common import PREFIX, ensure_user, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Nested Privileged Access"
FEATURE_ID = "nested_privileged_access"
PARENT = f"{PREFIX}PNPar"
PRIV = f"{PREFIX}PNAdmin"  # name contains 'admin'
USER = f"{PREFIX}PNUser"


def setup(client):
    ensure_group(client, PARENT)
    ensure_group(client, PRIV)
    ensure_user(client, USER)
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Add-ADGroupMember -Identity '{PARENT}' -Members '{PRIV}' -EA SilentlyContinue
Add-ADGroupMember -Identity '{PRIV}' -Members '{USER}' -EA SilentlyContinue
""")
    print_report(FEATURE, PRIV, "unrelated", f"{PARENT}->{PRIV} + user member", "nested privileged path", "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$pHas = @((Get-ADGroupMember '{PARENT}' -EA SilentlyContinue).SamAccountName) -contains '{PRIV}'
$uHas = @((Get-ADGroupMember '{PRIV}' -EA SilentlyContinue).SamAccountName) -contains '{USER}'
[pscustomobject]@{{ parentHasPriv=[bool]$pHas; privHasUser=[bool]$uHas; present=([bool]$pHas -and [bool]$uHas) }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, PRIV, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory
Remove-ADGroupMember '{PARENT}' -Members '{PRIV}' -Confirm:$false
Remove-ADGroupMember '{PRIV}' -Members '{USER}' -Confirm:$false
""")
    from _common import delete_if_test_object
    for n, t in ((USER, "user"), (PRIV, "group"), (PARENT, "group")):
        try: delete_if_test_object(client, n, t)
        except Exception: pass
    print_status(FEATURE, PRIV, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

