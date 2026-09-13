#!/usr/bin/env python3
"""22 Shadow Admins — GenericAll ACE from lab user onto lab *Admin* group (not Domain Admins)."""
from _common import PREFIX, ensure_user, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Shadow Admins"
FEATURE_ID = "shadow_admins"
TRUSTEE = f"{PREFIX}ShTrus"
TARGET = f"{PREFIX}ShAdmin"  # privileged name token 'admin'


def setup(client):
    ensure_user(client, TRUSTEE)
    ensure_group(client, TARGET, description="lab privileged shadow-admin target")
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$targetDn = (Get-ADGroup '{TARGET}').DistinguishedName
$trustee = Get-ADUser '{TRUSTEE}' -Properties objectSid
$sid = $trustee.SID
$acl = Get-Acl -Path "AD:$targetDn"
$exists = $false
foreach ($ace in $acl.Access) {{
  if ($ace.IdentityReference -eq $sid -and [int]$ace.ActiveDirectoryRights -band [int][System.DirectoryServices.ActiveDirectoryRights]::GenericAll) {{
    $exists = $true; break
  }}
}}
if (-not $exists) {{
  $rule = New-Object System.DirectoryServices.ActiveDirectoryAccessRule(
    $sid,
    [System.DirectoryServices.ActiveDirectoryRights]::GenericAll,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -Path "AD:$targetDn" -AclObject $acl
}}
[pscustomobject]@{{ targetDn=$targetDn; trusteeSid=$sid.Value; ace='GenericAll Allow'; already=$exists }} | ConvertTo-Json -Compress
""")
    if code != 0:
        raise RuntimeError(err or out)
    import json
    after = json.loads(out[out.find("{"):]) if "{" in out else {"raw": out}
    status = "ANOMALY ALREADY EXISTS" if after.get("already") else "ANOMALY CREATED"
    print_report(FEATURE, f"{TRUSTEE}->{TARGET}", "no GenericAll", "Add GenericAll ACE", after, status)


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$g = Get-ADGroup '{TARGET}' -EA SilentlyContinue
$u = Get-ADUser '{TRUSTEE}' -EA SilentlyContinue
if (-not $g -or -not $u) {{ [pscustomobject]@{{ present=$false }} | ConvertTo-Json -Compress; return }}
$acl = Get-Acl -Path ("AD:" + $g.DistinguishedName)
$sid = $u.SID.Value
$hit = $false
foreach ($ace in $acl.Access) {{
  if ($ace.IdentityReference.Value -eq $sid -and ([int]$ace.ActiveDirectoryRights -band 983551) -ne 0) {{ $hit = $true; break }}
}}
[pscustomobject]@{{ present=[bool]$hit; trustee=$sid; target=$g.DistinguishedName }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, TARGET, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
$g = Get-ADGroup '{TARGET}' -EA SilentlyContinue
$u = Get-ADUser '{TRUSTEE}' -EA SilentlyContinue
if ($g -and $u) {{
  $acl = Get-Acl -Path ("AD:" + $g.DistinguishedName)
  $sid = $u.SID
  $toRemove = @()
  foreach ($ace in $acl.Access) {{
    if ($ace.IdentityReference -eq $sid) {{ $toRemove += $ace }}
  }}
  foreach ($ace in $toRemove) {{ $acl.RemoveAccessRuleSpecific($ace) | Out-Null }}
  Set-Acl -Path ("AD:" + $g.DistinguishedName) -AclObject $acl
}}
""")
    from _common import delete_if_test_object
    for n, t in ((TRUSTEE, "user"), (TARGET, "group")):
        try: delete_if_test_object(client, n, t)
        except Exception: pass
    print_status(FEATURE, TARGET, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

