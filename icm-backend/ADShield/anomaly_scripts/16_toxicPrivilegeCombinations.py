#!/usr/bin/env python3
"""16 Toxic Privilege Combinations — user reaches >=2 privileged-named groups."""
from _common import PREFIX, ensure_user, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Toxic Privilege Combinations"
FEATURE_ID = "toxic_privilege_combinations"
USER = f"{PREFIX}ToxicU"
G1 = f"{PREFIX}TAdmin1"  # privileged token 'admin'
G2 = f"{PREFIX}TAdmin2"  # privileged token 'admin'


def setup(client):
    ensure_user(client, USER)
    ensure_group(client, G1, description="lab privileged token admin")
    ensure_group(client, G2, description="lab privileged token admin")
    run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Add-ADGroupMember -Identity '{G1}' -Members '{USER}' -ErrorAction SilentlyContinue
Add-ADGroupMember -Identity '{G2}' -Members '{USER}' -ErrorAction SilentlyContinue
""")
    print_report(FEATURE, USER, "not in both", f"Add to {G1}+{G2}", "member of both admin-named groups", "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g1 = @((Get-ADGroupMember '{G1}' -EA SilentlyContinue).SamAccountName) -contains '{USER}'
$g2 = @((Get-ADGroupMember '{G2}' -EA SilentlyContinue).SamAccountName) -contains '{USER}'
[pscustomobject]@{{ inG1=[bool]$g1; inG2=[bool]$g2; toxic=([bool]$g1 -and [bool]$g2) }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, USER, info, "PRESENT" if info.get("toxic") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory
Remove-ADGroupMember '{G1}' -Members '{USER}' -Confirm:$false
Remove-ADGroupMember '{G2}' -Members '{USER}' -Confirm:$false
""")
    from _common import delete_if_test_object
    for n, t in ((USER, "user"), (G1, "group"), (G2, "group")):
        try:
            delete_if_test_object(client, n, t)
        except Exception:
            pass
    print_status(FEATURE, USER, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

