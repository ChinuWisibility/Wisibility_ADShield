#!/usr/bin/env python3
"""20 Privilege Escalation Paths — User -> G1 -> G2(privileged-named), path length >= 3."""
from _common import PREFIX, ensure_user, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Privilege Escalation Paths"
FEATURE_ID = "privilege_escalation_paths"
USER = f"{PREFIX}EscUsr"
G1 = f"{PREFIX}EscMid"
G2 = f"{PREFIX}EscAdmin"  # privileged name token 'admin'


def setup(client):
    ensure_user(client, USER)
    ensure_group(client, G1)
    ensure_group(client, G2)
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Add-ADGroupMember -Identity '{G1}' -Members '{USER}' -EA SilentlyContinue
Add-ADGroupMember -Identity '{G2}' -Members '{G1}' -EA SilentlyContinue
""")
    print_report(FEATURE, USER, "no path", f"{USER}->{G1}->{G2}", "escalation path", "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$uIn = @((Get-ADGroupMember '{G1}' -EA SilentlyContinue).SamAccountName) -contains '{USER}'
$gIn = @((Get-ADGroupMember '{G2}' -EA SilentlyContinue).SamAccountName) -contains '{G1}'
[pscustomobject]@{{ userInMid=[bool]$uIn; midInAdmin=[bool]$gIn; present=([bool]$uIn -and [bool]$gIn) }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, USER, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory
Remove-ADGroupMember '{G1}' -Members '{USER}' -Confirm:$false
Remove-ADGroupMember '{G2}' -Members '{G1}' -Confirm:$false
""")
    from _common import delete_if_test_object
    for n, t in ((USER, "user"), (G1, "group"), (G2, "group")):
        try: delete_if_test_object(client, n, t)
        except Exception: pass
    print_status(FEATURE, USER, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

