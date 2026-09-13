#!/usr/bin/env python3
"""26 Broken ACLs — orphan/unresolved ACE on dedicated object (orphan_acl_principal)."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Broken ACLs"
FEATURE_ID = "broken_acls"
TARGET = f"{PREFIX}BrkAcl"
FAKE_SID = "S-1-5-21-7777777777-8888888888-9999999999-7777"


def setup(client):
    ensure_group(client, TARGET, description="broken ACL anomaly target")
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$dn = (Get-ADGroup '{TARGET}').DistinguishedName
$acl = Get-Acl -Path "AD:$dn"
$sid = New-Object System.Security.Principal.SecurityIdentifier '{FAKE_SID}'
$exists = $false
foreach ($ace in $acl.Access) {{ if ($ace.IdentityReference.Value -eq '{FAKE_SID}') {{ $exists=$true; break }} }}
if (-not $exists) {{
  $rule = New-Object System.DirectoryServices.ActiveDirectoryAccessRule(
    $sid,
    [System.DirectoryServices.ActiveDirectoryRights]::GenericWrite,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -Path "AD:$dn" -AclObject $acl
}}
[pscustomobject]@{{ dn=$dn; orphanSid='{FAKE_SID}'; ace='GenericWrite Allow'; already=$exists }} | ConvertTo-Json -Compress
""")
    if code != 0:
        raise RuntimeError(err or out)
    import json
    after = json.loads(out[out.find("{"):])
    print_report(FEATURE, TARGET, "clean DACL for test SID", "Add orphan trustee ACE", after,
                 "ANOMALY ALREADY EXISTS" if after.get("already") else "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup '{TARGET}' -EA SilentlyContinue
if (-not $g) {{ [pscustomobject]@{{ present=$false }} | ConvertTo-Json -Compress; return }}
$acl = Get-Acl -Path ("AD:" + $g.DistinguishedName)
$hit = $false
foreach ($ace in $acl.Access) {{ if ($ace.IdentityReference.Value -eq '{FAKE_SID}') {{ $hit=$true; break }} }}
[pscustomobject]@{{ present=[bool]$hit; orphanSid='{FAKE_SID}'; dn=$g.DistinguishedName }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, TARGET, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
$g = Get-ADGroup '{TARGET}' -EA SilentlyContinue
if ($g) {{
  $acl = Get-Acl -Path ("AD:" + $g.DistinguishedName)
  $toRemove = @($acl.Access | Where-Object {{ $_.IdentityReference.Value -eq '{FAKE_SID}' }})
  foreach ($ace in $toRemove) {{ $acl.RemoveAccessRuleSpecific($ace) | Out-Null }}
  Set-Acl -Path ("AD:" + $g.DistinguishedName) -AclObject $acl
}}
""")
    from _common import delete_if_test_object
    try: delete_if_test_object(client, TARGET, "group")
    except Exception: pass
    print_status(FEATURE, TARGET, "test ACE removed", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

