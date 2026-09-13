#!/usr/bin/env python3
"""31 Servers in Workstation OU — server OS computer under OU=Workstations in test OU."""
from _common import (
    PREFIX, SCOPE_OU, TEST_OU, TEST_OU_NAME, assert_sam_account_name,
    ensure_test_ou, main_cli, print_report, print_status, run_ps, ps_json,
)

FEATURE = "Servers in Workstation OU"
FEATURE_ID = "servers_in_wrong_ou"
NAME = f"{PREFIX}SrvWs"
assert_sam_account_name(NAME, is_computer=True)
WS_OU_NAME = "Workstations"
WS_OU = f"OU={WS_OU_NAME},{TEST_OU}"
OS_VALUE = "Windows Server 2022 Datacenter"


def setup(client):
    ensure_test_ou(client)
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$ws = '{WS_OU}'
if (-not (Get-ADOrganizationalUnit -Identity $ws -EA SilentlyContinue)) {{
  New-ADOrganizationalUnit -Name '{WS_OU_NAME}' -Path '{TEST_OU}' -ProtectedFromAccidentalDeletion $false
}}
$sam = '{NAME}$'
$c = Get-ADComputer -Filter "sAMAccountName -eq '$sam'" -SearchBase '{SCOPE_OU}' -EA SilentlyContinue
if (-not $c) {{
  New-ADComputer -Name '{NAME}' -SamAccountName $sam -Path $ws -Enabled $true | Out-Null
  $c = Get-ADComputer -Identity $sam
}} elseif ($c.DistinguishedName -notlike '*OU={WS_OU_NAME},*') {{
  Move-ADObject -Identity $c.DistinguishedName -TargetPath $ws
}}
Set-ADComputer -Identity $sam -OperatingSystem '{OS_VALUE}'
$c = Get-ADComputer -Identity $sam -Properties operatingSystem,DistinguishedName
[pscustomobject]@{{
  SamAccountName=$c.SamAccountName
  DistinguishedName=$c.DistinguishedName
  operatingSystem=$c.operatingSystem
}} | ConvertTo-Json -Compress
""")
    if code != 0:
        raise RuntimeError(err or out)
    import json
    after = json.loads(out[out.find("{"):])
    dn = (after.get("DistinguishedName") or "").lower()
    if "ou=workstations" not in dn or "server" not in (after.get("operatingSystem") or "").lower():
        raise RuntimeError(f"Placement/OS not matching detector: {after}")
    print_report(FEATURE, NAME, "absent", f"Create under {WS_OU} with OS={OS_VALUE}", after, "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$c = Get-ADComputer -Identity '{NAME}$' -Properties operatingSystem -EA SilentlyContinue
if (-not $c) {{ [pscustomobject]@{{ present=$false }} | ConvertTo-Json -Compress; return }}
$dn = $c.DistinguishedName.ToLower()
$hit = ($dn -like '*ou=workstations,*') -and ($c.operatingSystem -match 'server')
[pscustomobject]@{{ present=[bool]$hit; dn=$c.DistinguishedName; os=$c.operatingSystem }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, NAME, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, f"{NAME}$", "computer")
    except Exception:
        pass
    # Leave OU=Workstations in place (empty) — safe under test OU
    print_status(FEATURE, NAME, "computer deleted", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

