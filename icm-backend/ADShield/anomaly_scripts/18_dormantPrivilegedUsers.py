#!/usr/bin/env python3
"""18 Dormant Privileged Users — needs aged lastLogon on privileged user (NOT SAFE)."""
from _common import NotSafeError, main_cli, print_status, PREFIX

FEATURE = "Dormant Privileged Users"
FEATURE_ID = "dormant_privileged_users"
SAM = f"{PREFIX}DormPriv"
REASON = (
    "Requires privileged reachability AND lastLogonTimestamp older than 90 days (or never-logon depending on graph path). "
    "Direct lastLogonTimestamp writes are rejected by AD (WILL_NOT_PERFORM)."
)
REQUIRED = "Privileged user with naturally aged/never-used lastLogon in an isolated lab."


def setup(client):
    err = NotSafeError(REASON)
    err.required_state = REQUIRED
    raise err


def status(client):
    print_status(FEATURE, SAM, "not created", "NOT SAFE TO CREATE LIVE")
    print(f"\nREQUIRED AD STATE:\n{REQUIRED}")


def reset(client):
    print_status(FEATURE, SAM, "n/a", "N/A")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

