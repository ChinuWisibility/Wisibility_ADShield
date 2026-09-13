#!/usr/bin/env python3
"""32 Duplicate SPNs — same custom SPN on two lab computers."""
from _common import (
    PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps,
)

FEATURE = "Duplicate SPNs"
FEATURE_ID = "duplicate_spns"
A = f"{PREFIX}DupSpA"
B = f"{PREFIX}DupSpB"
DUP_SPN = "HTTP/WIS-ADShield-Test-DupSpn.example.invalid"


def setup(client):
    ensure_computer(client, A)
    ensure_computer(client, B)
    for name in (A, B):
        out, err, code = run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
$c = Get-ADComputer -Identity '{name}$' -Properties servicePrincipalName
if (@($c.servicePrincipalName) -notcontains '{DUP_SPN}') {{
  Set-ADComputer -Identity '{name}$' -ServicePrincipalNames @{{ Add = '{DUP_SPN}' }}
}}
""")
        if code != 0:
            raise RuntimeError(err or out)
    after = {"a": get_computer(client, A), "b": get_computer(client, B), "spn": DUP_SPN}
    print_report(FEATURE, f"{A}+{B}", "unique SPNs", f"Add shared SPN {DUP_SPN}", after, "ANOMALY CREATED")


def status(client):
    ca, cb = get_computer(client, A), get_computer(client, B)
    if not ca or not cb:
        print_status(FEATURE, f"{A}+{B}", "missing object(s)", "ABSENT"); return
    sa = ca.get("servicePrincipalName") or []
    sb = cb.get("servicePrincipalName") or []
    present = DUP_SPN in sa and DUP_SPN in sb
    print_status(FEATURE, f"{A}+{B}", {"a": sa, "b": sb}, "PRESENT" if present else "ABSENT")


def reset(client):
    for name in (A, B):
        run_ps(client, f"""
$ErrorActionPreference='SilentlyContinue'
Import-Module ActiveDirectory
try {{ Set-ADComputer -Identity '{name}$' -ServicePrincipalNames @{{ Remove = '{DUP_SPN}' }} }} catch {{}}
""")
    from _common import delete_if_test_object
    for name in (A, B):
        try: delete_if_test_object(client, f"{name}$", "computer")
        except Exception: pass
    print_status(FEATURE, f"{A}+{B}", "cleaned", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

