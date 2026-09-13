#!/usr/bin/env python3
"""40 RBCD — msDS-AllowedToActOnBehalfOfOtherIdentity on lab computer for lab user trustee."""
from _common import (
    PREFIX, ensure_computer, ensure_user, get_computer, main_cli, print_report, print_status, run_ps, ps_json,
)

FEATURE = "Resource-Based Constrained Delegation"
FEATURE_ID = "rbcd"
RESOURCE = f"{PREFIX}RbcdRes"
TRUSTEE = f"{PREFIX}RbcdTru"


def setup(client):
    ensure_user(client, TRUSTEE)
    before = ensure_computer(client, RESOURCE)
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$user = Get-ADUser -Identity '{TRUSTEE}'
# PrincipalsAllowedToDelegateToAccount writes msDS-AllowedToActOnBehalfOfOtherIdentity
Set-ADComputer -Identity '{RESOURCE}$' -PrincipalsAllowedToDelegateToAccount $user
$c = Get-ADComputer -Identity '{RESOURCE}$' -Properties msDS-AllowedToActOnBehalfOfOtherIdentity
$has = $null -ne $c.'msDS-AllowedToActOnBehalfOfOtherIdentity'
[pscustomobject]@{{ resource=$c.DistinguishedName; trustee='{TRUSTEE}'; hasRbcd=[bool]$has }} | ConvertTo-Json -Compress
""")
    if code != 0:
        raise RuntimeError(err or out)
    import json
    after = json.loads(out[out.find("{"):])
    if not after.get("hasRbcd"):
        raise RuntimeError(after)
    print_report(FEATURE, RESOURCE, before, f"PrincipalsAllowedToDelegateToAccount={TRUSTEE}", after, "ANOMALY CREATED")


def status(client):
    info = ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
$c = Get-ADComputer -Identity '{RESOURCE}$' -Properties msDS-AllowedToActOnBehalfOfOtherIdentity -EA SilentlyContinue
if (-not $c) {{ [pscustomobject]@{{ present=$false }} | ConvertTo-Json -Compress; return }}
$has = $null -ne $c.'msDS-AllowedToActOnBehalfOfOtherIdentity'
[pscustomobject]@{{ present=[bool]$has; dn=$c.DistinguishedName; trustee='{TRUSTEE}' }} | ConvertTo-Json -Compress
""")
    print_status(FEATURE, RESOURCE, info, "PRESENT" if info.get("present") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
# Clear RBCD attribute
try {{ Set-ADComputer -Identity '{RESOURCE}$' -PrincipalsAllowedToDelegateToAccount $null }} catch {{}}
try {{
  $c = Get-ADComputer '{RESOURCE}$'
  Set-ADObject -Identity $c.DistinguishedName -Clear 'msDS-AllowedToActOnBehalfOfOtherIdentity'
}} catch {{}}
""")
    from _common import delete_if_test_object
    for n, t in ((f"{RESOURCE}$", "computer"), (TRUSTEE, "user")):
        try: delete_if_test_object(client, n, t)
        except Exception: pass
    print_status(FEATURE, RESOURCE, "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

