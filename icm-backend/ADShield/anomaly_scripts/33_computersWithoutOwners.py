#!/usr/bin/env python3
"""33 Computers Without Owners — computer with empty managedBy."""
from _common import (
    PREFIX, ensure_computer, get_computer, main_cli, print_report, print_status, run_ps,
)

FEATURE = "Computers Without Owners"
FEATURE_ID = "computers_without_owners"
NAME = f"{PREFIX}NoOwnC"


def setup(client):
    before = ensure_computer(client, NAME)
    # Clear managedBy if somehow set
    run_ps(client, f"""
$ErrorActionPreference='Stop'
Import-Module ActiveDirectory
Set-ADComputer -Identity '{NAME}$' -Clear managedBy -ErrorAction SilentlyContinue
""")
    after = get_computer(client, NAME)
    if after and after.get("managedBy"):
        raise RuntimeError(f"managedBy still set: {after}")
    print_report(FEATURE, NAME, before, "Ensure managedBy empty", after, "ANOMALY CREATED")


def status(client):
    c = get_computer(client, NAME)
    if not c:
        print_status(FEATURE, NAME, "object missing", "ABSENT"); return
    present = not bool(str(c.get("managedBy") or "").strip())
    print_status(FEATURE, NAME, f"managedBy={c.get('managedBy')}", "PRESENT" if present else "ABSENT")


def reset(client):
    from _common import delete_if_test_object
    try:
        delete_if_test_object(client, f"{NAME}$", "computer")
    except Exception:
        pass
    print_status(FEATURE, NAME, "deleted", "ABSENT")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

