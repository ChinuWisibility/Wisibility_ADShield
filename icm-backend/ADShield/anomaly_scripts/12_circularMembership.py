#!/usr/bin/env python3
"""12 Circular Membership — A contains B, B contains A (if AD allows)."""
from _common import PREFIX, ensure_group, main_cli, print_report, print_status, run_ps, ps_json

FEATURE = "Circular Membership"
FEATURE_ID = "circular_memberships"
A = f"{PREFIX}CircA"
B = f"{PREFIX}CircB"


def _state(client):
    return ps_json(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
function HasMember($g,$m) {{
  $names = @(Get-ADGroupMember -Identity $g -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SamAccountName)
  return [bool]($names -contains $m)
}}
if (-not (Get-ADGroup -Identity '{A}' -EA SilentlyContinue) -or -not (Get-ADGroup -Identity '{B}' -EA SilentlyContinue)) {{
  [pscustomobject]@{{ circular=$false; aHasB=$false; bHasA=$false }} | ConvertTo-Json -Compress; return
}}
$ab = HasMember '{A}' '{B}'
$ba = HasMember '{B}' '{A}'
[pscustomobject]@{{ circular=($ab -and $ba); aHasB=$ab; bHasA=$ba }} | ConvertTo-Json -Compress
""")


def setup(client):
    ensure_group(client, A, description="circle A")
    ensure_group(client, B, description="circle B")
    before = _state(client)
    if before.get("circular"):
        print_report(FEATURE, f"{A}<->{B}", before, "none", before, "ANOMALY ALREADY EXISTS")
        return
    out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'; Import-Module ActiveDirectory
Add-ADGroupMember -Identity '{A}' -Members '{B}'
try {{ Add-ADGroupMember -Identity '{B}' -Members '{A}' }} catch {{ throw "AD rejected circular membership: $($_.Exception.Message)" }}
""")
    if code != 0:
        print_report(FEATURE, f"{A}<->{B}", before, "Add circular membership", err or out, "NOT SAFE / BLOCKED BY AD")
        raise RuntimeError(err or out)
    after = _state(client)
    if not after.get("circular"):
        raise RuntimeError(after)
    print_report(FEATURE, f"{A}<->{B}", before, "A->B and B->A", after, "ANOMALY CREATED")


def status(client):
    info = _state(client)
    print_status(FEATURE, f"{A}<->{B}", info, "PRESENT" if info.get("circular") else "ABSENT")


def reset(client):
    run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'; Import-Module ActiveDirectory
Remove-ADGroupMember -Identity '{A}' -Members '{B}' -Confirm:$false
Remove-ADGroupMember -Identity '{B}' -Members '{A}' -Confirm:$false
""")
    from _common import delete_if_test_object
    for n in (A, B):
        try: delete_if_test_object(client, n, "group")
        except Exception: pass
    print_status(FEATURE, f"{A}<->{B}", "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

