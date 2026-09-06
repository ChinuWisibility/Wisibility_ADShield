#!/usr/bin/env bash
# Live AD security-descriptor proof against VPN-reachable AD.
# Reads credentials from environment or .env.local (never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${ADSHIELD_LDAP_URL:?Set ADSHIELD_LDAP_URL}"
: "${ADSHIELD_BIND_DN:?Set ADSHIELD_BIND_DN}"
: "${ADSHIELD_BIND_PASSWORD:?Set ADSHIELD_BIND_PASSWORD}"
: "${ADSHIELD_BASE_DN:?Set ADSHIELD_BASE_DN}"

OBJECT_DN="${ADSHIELD_OBJECT_DN:-$ADSHIELD_BASE_DN}"
TLS_INSECURE="${ADSHIELD_TLS_INSECURE:-false}"
TIMEOUT_MS="${ADSHIELD_TIMEOUT_MS:-30000}"
BASE_URL="${ADSHIELD_API_URL:-http://127.0.0.1:5088}"

# Build JSON without echoing the password to the terminal via set -x
PAYLOAD=$(python3 - <<PY
import json, os
print(json.dumps({
  "connection": {
    "url": os.environ["ADSHIELD_LDAP_URL"],
    "bindDn": os.environ["ADSHIELD_BIND_DN"],
    "bindPassword": os.environ["ADSHIELD_BIND_PASSWORD"],
    "baseDn": os.environ["ADSHIELD_BASE_DN"],
    "searchBaseDn": os.environ.get("ADSHIELD_SEARCH_BASE_DN") or None,
    "timeoutMs": int(os.environ.get("ADSHIELD_TIMEOUT_MS", "30000")),
    "tlsInsecure": os.environ.get("ADSHIELD_TLS_INSECURE", "false").lower() in ("1","true","yes"),
    "authType": "Basic"
  },
  "objectDn": os.environ.get("ADSHIELD_OBJECT_DN") or os.environ["ADSHIELD_BASE_DN"],
  "readSecurityDescriptor": True
}))
PY
)

echo "POST ${BASE_URL}/api/v1/ad/connectivity-test"
echo "endpoint=${ADSHIELD_LDAP_URL} objectDn=${OBJECT_DN} (password redacted)"

curl -sS -X POST "${BASE_URL}/api/v1/ad/connectivity-test" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" | python3 -m json.tool
