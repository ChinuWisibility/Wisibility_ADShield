#!/usr/bin/env python3
"""23 SID History Analysis — NOT SAFE: sIDHistory typically not writable in this lab."""
from _common import NotSafeError, main_cli, print_status, PREFIX

FEATURE = "SID History Analysis"
FEATURE_ID = "sid_history_analysis"
SAM = f"{PREFIX}SidHist"
REASON = (
    "ADShield detects any sIDHistory values. Writing sIDHistory requires migration/"
    "special privileges and is commonly rejected in shared labs. Do not clear real SIDHistory."
)
REQUIRED = "Dedicated test user with a controlled sIDHistory entry in an isolated lab."


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

