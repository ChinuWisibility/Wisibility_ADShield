#!/usr/bin/env python3
"""21 Orphan SIDs — ACE trustee that does not resolve (lab-owned test object only)."""
from _common import (
    PREFIX, SCOPE_OU, ensure_group, ensure_user, main_cli, print_report, print_status, run_ps, ps_json,
)

FEATURE = "Orphan SIDs"
FEATURE_ID = "orphan_sids"
TARGET = f"{PREFIX}OrphSid"
# Synthetic SID unlikely to exist in domain (still well-formed)
FAKE_SID = "S-1-5-21-1111111111-2222222222-3333333333-9999"


def setup(client):
    ensure_group(client, TARGET, description="orphan SID ACE target")
    before = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$dn = (Get-ADGroup '{TARGET}').DistinguishedName
[pscustomobject]@{{ DN=$dn; note='before ACE add' }} | ConvertTo-Json -Compress
""")
    # Add allow ACE for unresolved SID via ADSI
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$dn = (Get-ADGroup '{TARGET}').DistinguishedName
$acl = Get-Acl -Path "AD:$dn"
$sid = New-Object System.Security.Principal.SecurityIdentifier '{FAKE_SID}'
# GenericRead identity reference for test ACE
$rule = New-Object System.DirectoryServices.ActiveDirectoryAccessRule(
  $sid,
  [System.DirectoryServices.ActiveDirectoryRights]::GenericRead,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$exists = $false
foreach ($ace in $acl.Access) {{
  if ($ace.IdentityReference.Value -eq '{FAKE_SID}') {{ $exists = $true; break }}
}}
if (-not $exists) {{
  $acl.AddAccessRule($rule)
  Set-Acl -Path "AD:$dn" -AclObject $acl
}}
'OK'
""")
    if code != 0:
        raise RuntimeError(err or out)
    after = {"target": TARGET, "orphanSid": FAKE_SID, "ace": "GenericRead Allow"}
    print_report(FEATURE, TARGET, before, f"Add ACE trustee={FAKE_SID}", after, "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup -Identity '{TARGET}' -EA SilentlyContinue
if (-not $g) {{ [pscustomobject]@{{ present=$false; reason='missing' }} | ConvertTo-Json -Compress; return }}
$acl = Get-Acl -Path ("AD:" + $g.DistinguishedName)
$hit = $false
foreach ($ace in $acl.Access) {{
  if ($ace.IdentityReference.Value -eq '{FAKE_SID}') {{ $hit = $true; break }}
}}
[pscustomobject]@{{ present=[bool]$hit; sid='{FAKE_SID}'; dn=$g.DistinguishedName }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, TARGET, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
$g = Get-ADGroup -Identity '{TARGET}' -EA SilentlyContinue
if ($g) {{
  $dn = $g.DistinguishedName
  $acl = Get-Acl -Path "AD:$dn"
  $sid = New-Object System.Security.Principal.SecurityIdentifier '{FAKE_SID}'
  $toRemove = @()
  foreach ($ace in $acl.Access) {{
    if ($ace.IdentityReference.Value -eq '{FAKE_SID}') {{ $toRemove += $ace }}
  }}
  foreach ($ace in $toRemove) {{ $acl.RemoveAccessRuleSpecific($ace) | Out-Null }}
  Set-Acl -Path "AD:$dn" -AclObject $acl
}}
""")
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, TARGET, "group")
    except Exception:
        pass
    print_status(FEATURE, TARGET, "ACE removed / object deleted", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

