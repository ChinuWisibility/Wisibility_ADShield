#!/usr/bin/env python3
"""24 Foreign Security Principals — NOT SAFE without inventing trust/FSP objects."""
from _common import NotSafeError, main_cli, print_status, PREFIX

FEATURE = "Foreign Security Principals"
FEATURE_ID = "foreign_security_principals"
NAME = f"{PREFIX}FSP"
REASON = (
    "ADShield enumerates foreignSecurityPrincipal objects. Creating them requires a foreign SID "
    "under CN=ForeignSecurityPrincipals and often trust context. Unsafe in this shared lab."
)
REQUIRED = "Isolated lab FSP object under ForeignSecurityPrincipals that can be deleted on reset."


def setup(client):
    err = NotSafeError(REASON)
    err.required_state = REQUIRED
    raise err


def status(client):
    print_status(FEATURE, NAME, "not created", "NOT SAFE TO CREATE LIVE")
    print(f"\nREQUIRED AD STATE:\n{REQUIRED}")


def reset(client):
    print_status(FEATURE, NAME, "n/a", "N/A")


if __name__ == "__main__":
    main_cli(feature_name=FEATURE, feature_id=FEATURE_ID, setup_fn=setup, status_fn=status, reset_fn=reset)

