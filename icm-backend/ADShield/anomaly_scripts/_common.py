#!/usr/bin/env python3
"""
Shared helpers for ADShield anomaly scripts (NON-PRODUCTION).

Uses pypsrp + WinRM + NTLM against the lab AD host.
Credentials: AD_PASSWORD must be replaced by the operator — never logged.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Callable, Optional

# ---------------------------------------------------------------------------
# Operator configuration (replace password locally — never commit a real one)
# ---------------------------------------------------------------------------
AD_IP = "192.168.68.107"
AD_USERNAME = r"wisibility\Administrator"
AD_PASSWORD = "P@ssw0rd"

DOMAIN_DN = "DC=wisibility,DC=lcl"
SCOPE_OU = "OU=wisibility,DC=wisibility,DC=lcl"
TEST_OU_NAME = "wisibility"
TEST_OU = SCOPE_OU
PREFIX = "WIS-T-"  # short so sAMAccountName stays <= 20 chars

SAM_MAX_LEN = 20  # AD sAMAccountName limit (computers include trailing $)


def assert_sam_account_name(sam: str, *, is_computer: bool = False) -> str:
    """Validate / normalize SAM; computers must include trailing $ within 20 chars."""
    s = (sam or "").strip()
    if is_computer:
        if not s.endswith("$"):
            s = f"{s}$"
        if len(s) > SAM_MAX_LEN:
            raise ValueError(
                f"Computer sAMAccountName exceeds {SAM_MAX_LEN} chars (incl. $): {s!r} ({len(s)})"
            )
    else:
        if len(s) > SAM_MAX_LEN:
            raise ValueError(
                f"sAMAccountName exceeds {SAM_MAX_LEN} chars: {s!r} ({len(s)})"
            )
    return s


PASSWORD_PLACEHOLDER = "REPLACE_WITH_YOUR_AD_PASSWORD"


class ConfigError(SystemExit):
    pass


class NotSafeError(Exception):
    """Feature cannot safely create the required live AD state in this lab."""


def ensure_password_configured() -> None:
    if not AD_PASSWORD or AD_PASSWORD == PASSWORD_PLACEHOLDER:
        raise ConfigError(
            "Set AD_PASSWORD in this script's imported config "
            f"(currently '{PASSWORD_PLACEHOLDER}'). "
            "Do not commit real passwords."
        )


def get_client():
    ensure_password_configured()
    try:
        from pypsrp.client import Client
    except ImportError as e:
        raise ConfigError(
            "pypsrp is required. Install with: pip3 install pypsrp"
        ) from e
    return Client(
        AD_IP,
        username=AD_USERNAME,
        password=AD_PASSWORD,
        ssl=False,
        auth="ntlm",
    )


def run_ps(client, script: str) -> tuple[str, str, int]:
    """Execute PowerShell remotely. Never echo credentials."""
    # Strip accidental credential leakage from scripts before send.
    if "P@ssw0rd" in script and AD_PASSWORD != PASSWORD_PLACEHOLDER:
        pass  # password only in Client auth, not script body
    if re.search(r"(?i)password\s*=\s*['\"][^'\"]+['\"]", script):
        raise RuntimeError("Refusing to send a PowerShell script that embeds a password literal.")

    output, streams, had_errors = client.execute_ps(script)
    err_parts = []
    if streams and getattr(streams, "error", None):
        for e in streams.error:
            err_parts.append(str(e))
    stderr = "\n".join(err_parts)
    code = 1 if had_errors else 0
    return (output or "").strip(), stderr.strip(), code


def ps_json(client, script: str) -> Any:
    """Run PowerShell that writes ConvertTo-Json to stdout and parse it."""
    wrapped = script.strip() + "\n"
    if "ConvertTo-Json" not in wrapped:
        wrapped = (
            "$ErrorActionPreference='Stop'\n"
            + wrapped
            + "\n| ConvertTo-Json -Depth 6 -Compress\n"
        )
    out, err, code = run_ps(client, wrapped)
    if code != 0 and not out:
        raise RuntimeError(err or "PowerShell failed with no output")
    if not out:
        return None
    # pypsrp may prepend warnings; find JSON start
    start = out.find("{")
    start_arr = out.find("[")
    if start < 0 and start_arr < 0:
        if err:
            raise RuntimeError(err)
        return out
    idx = start if start >= 0 and (start_arr < 0 or start < start_arr) else start_arr
    try:
        return json.loads(out[idx:])
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse PS JSON: {e}; raw={out[:400]}") from e


def verify_connectivity(client) -> None:
    out, err, code = run_ps(
        client,
        "$ErrorActionPreference='Stop'; "
        "Import-Module ActiveDirectory; "
        f"if (-not (Get-ADOrganizationalUnit -Identity '{SCOPE_OU}' -ErrorAction SilentlyContinue)) "
        "{ throw 'OU=wisibility not found' }; "
        "'OK'",
    )
    if code != 0 or "OK" not in out:
        raise RuntimeError(f"AD/WinRM connectivity failed: {err or out}")


def ensure_test_ou(client) -> str:
    """Use the existing dedicated ADShield test OU."""
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$ou = '{SCOPE_OU}'

if (-not (Get-ADOrganizationalUnit -Identity $ou -ErrorAction SilentlyContinue)) {{
    throw "Required test OU not found: $ou"
}}

$ou
"""

    out, err, code = run_ps(client, script)

    if code != 0:
        raise RuntimeError(f"ensure_test_ou failed: {err or out}")

    return SCOPE_OU


def ensure_user(client, sam: str, *, password: str = "Wis!Test#Anomaly1", name: str | None = None) -> dict:
    """Create dedicated test user under TEST_OU if missing. Returns live props.
    sam must be <= 20 chars; optional name sets CN/Name independently.
    """
    sam = assert_sam_account_name(sam)
    cn = (name or sam).replace("'", "''")
    ensure_test_ou(client)
    # password for new account only — not AD_PASSWORD; still avoid printing
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$sam = '{sam}'
$cn = '{cn}'
$path = '{TEST_OU}'
$u = Get-ADUser -Filter "sAMAccountName -eq '$sam'" -SearchBase '{SCOPE_OU}' -Properties Enabled,userAccountControl,PasswordNeverExpires,CannotChangePassword,SmartcardLogonRequired,servicePrincipalName,lockoutTime,DoesNotRequirePreAuth,TrustedForDelegation,TrustedToAuthForDelegation,AllowReversiblePasswordEncryption -ErrorAction SilentlyContinue
if (-not $u) {{
  $sec = ConvertTo-SecureString '{password}' -AsPlainText -Force
  New-ADUser -Name $cn -SamAccountName $sam -UserPrincipalName "$sam@wisibility.lcl" `
    -Path $path -AccountPassword $sec -Enabled $true -ChangePasswordAtLogon $false `
    -PasswordNeverExpires $false -PassThru | Out-Null
  $u = Get-ADUser -Identity $sam -Properties Enabled,userAccountControl,PasswordNeverExpires,CannotChangePassword,SmartcardLogonRequired,servicePrincipalName,lockoutTime,DoesNotRequirePreAuth,TrustedForDelegation,TrustedToAuthForDelegation,AllowReversiblePasswordEncryption
}}
[pscustomobject]@{{
  SamAccountName = $u.SamAccountName
  DistinguishedName = $u.DistinguishedName
  Enabled = [bool]$u.Enabled
  userAccountControl = [int]$u.userAccountControl
  PasswordNeverExpires = [bool]$u.PasswordNeverExpires
  SmartcardLogonRequired = [bool]$u.SmartcardLogonRequired
  AllowReversiblePasswordEncryption = [bool]$u.AllowReversiblePasswordEncryption
  DoesNotRequirePreAuth = [bool]$u.DoesNotRequirePreAuth
  TrustedForDelegation = [bool]$u.TrustedForDelegation
  TrustedToAuthForDelegation = [bool]$u.TrustedToAuthForDelegation
  lockoutTime = if ($u.lockoutTime) {{ $u.lockoutTime.ToFileTime().ToString() }} else {{ '0' }}
  servicePrincipalName = @($u.servicePrincipalName)
}} | ConvertTo-Json -Compress
"""
    data = ps_json(client, script)
    if not isinstance(data, dict):
        raise RuntimeError(f"ensure_user unexpected: {data}")
    return data


def get_user(client, sam: str) -> Optional[dict]:
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$u = Get-ADUser -Filter "sAMAccountName -eq '{sam}'" -SearchBase '{SCOPE_OU}' -Properties Enabled,userAccountControl,PasswordNeverExpires,SmartcardLogonRequired,servicePrincipalName,lockoutTime,DoesNotRequirePreAuth,TrustedForDelegation,TrustedToAuthForDelegation,AllowReversiblePasswordEncryption,msDS-AllowedToDelegateTo,SIDHistory -ErrorAction SilentlyContinue
if (-not $u) {{ 'null' }} else {{
  [pscustomobject]@{{
    SamAccountName = $u.SamAccountName
    DistinguishedName = $u.DistinguishedName
    Enabled = [bool]$u.Enabled
    userAccountControl = [int]$u.userAccountControl
    PasswordNeverExpires = [bool]$u.PasswordNeverExpires
    SmartcardLogonRequired = [bool]$u.SmartcardLogonRequired
    AllowReversiblePasswordEncryption = [bool]$u.AllowReversiblePasswordEncryption
    DoesNotRequirePreAuth = [bool]$u.DoesNotRequirePreAuth
    TrustedForDelegation = [bool]$u.TrustedForDelegation
    TrustedToAuthForDelegation = [bool]$u.TrustedToAuthForDelegation
    lockoutTime = if ($u.lockoutTime) {{ $u.lockoutTime.ToFileTime().ToString() }} else {{ '0' }}
    servicePrincipalName = @($u.servicePrincipalName)
    AllowedToDelegateTo = @($u.'msDS-AllowedToDelegateTo')
    SIDHistory = @($u.SIDHistory | ForEach-Object {{ $_.Value }})
  }} | ConvertTo-Json -Compress
}}
"""
    out, err, code = run_ps(client, script)
    if code != 0:
        raise RuntimeError(err or out)
    if out.strip() == "null" or not out.strip():
        return None
    start = out.find("{")
    return json.loads(out[start:])


def ensure_group(client, name: str, *, description: str = "", display_name: str | None = None) -> dict:
    name = assert_sam_account_name(name)
    ensure_test_ou(client)
    desc = description.replace("'", "''")
    cn = (display_name or name).replace("'", "''")
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$name = '{name}'
$cn = '{cn}'
$path = '{TEST_OU}'
$g = Get-ADGroup -Filter "sAMAccountName -eq '$name'" -SearchBase '{SCOPE_OU}' -Properties managedBy,Description,Members -ErrorAction SilentlyContinue
if (-not $g) {{
  New-ADGroup -Name $cn -SamAccountName $name -GroupScope Global -GroupCategory Security -Path $path -Description '{desc}' | Out-Null
  $g = Get-ADGroup -Identity $name -Properties managedBy,Description,Members
}}
[pscustomobject]@{{
  SamAccountName = $g.SamAccountName
  DistinguishedName = $g.DistinguishedName
  managedBy = $g.managedBy
  Description = $g.Description
  MemberCount = @($g.Members).Count
}} | ConvertTo-Json -Compress
"""
    data = ps_json(client, script)
    return data


def ensure_computer(client, name: str, *, display_name: str | None = None) -> dict:
    """Create a disabled-capable test computer account (no OS join required)."""
    ensure_test_ou(client)
    # AD computer sAMAccountName ends with $ and total length must be <= 20
    sam = assert_sam_account_name(name, is_computer=True)
    cn = (display_name or name.rstrip("$")).replace("'", "''")
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$sam = '{sam}'
$cn = '{cn}'
$path = '{TEST_OU}'
$c = Get-ADComputer -Filter "sAMAccountName -eq '$sam'" -SearchBase '{SCOPE_OU}' -Properties Enabled,userAccountControl,operatingSystem,managedBy,servicePrincipalName,TrustedForDelegation -ErrorAction SilentlyContinue
if (-not $c) {{
  New-ADComputer -Name $cn -SamAccountName $sam -Path $path -Enabled $true -PassThru | Out-Null
  $c = Get-ADComputer -Identity $sam -Properties Enabled,userAccountControl,operatingSystem,managedBy,servicePrincipalName,TrustedForDelegation
}}
[pscustomobject]@{{
  SamAccountName = $c.SamAccountName
  DistinguishedName = $c.DistinguishedName
  Enabled = [bool]$c.Enabled
  userAccountControl = [int]$c.userAccountControl
  operatingSystem = $c.operatingSystem
  managedBy = $c.managedBy
  servicePrincipalName = @($c.servicePrincipalName)
  TrustedForDelegation = [bool]$c.TrustedForDelegation
}} | ConvertTo-Json -Compress
"""
    return ps_json(client, script)


def get_computer(client, name: str) -> Optional[dict]:
    sam = name if name.endswith("$") else f"{name}$"
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$c = Get-ADComputer -Filter "sAMAccountName -eq '{sam}'" -SearchBase '{SCOPE_OU}' -Properties Enabled,userAccountControl,operatingSystem,managedBy,servicePrincipalName,TrustedForDelegation,msDS-AllowedToActOnBehalfOfOtherIdentity,msDS-AllowedToDelegateTo -ErrorAction SilentlyContinue
if (-not $c) {{ 'null' }} else {{
  [pscustomobject]@{{
    SamAccountName = $c.SamAccountName
    DistinguishedName = $c.DistinguishedName
    Enabled = [bool]$c.Enabled
    userAccountControl = [int]$c.userAccountControl
    operatingSystem = $c.operatingSystem
    managedBy = $c.managedBy
    servicePrincipalName = @($c.servicePrincipalName)
    TrustedForDelegation = [bool]$c.TrustedForDelegation
    HasRbcd = [bool]($null -ne $c.'msDS-AllowedToActOnBehalfOfOtherIdentity')
    AllowedToDelegateTo = @($c.'msDS-AllowedToDelegateTo')
  }} | ConvertTo-Json -Compress
}}
"""
    out, err, code = run_ps(client, script)
    if code != 0:
        raise RuntimeError(err or out)
    if out.strip() == "null" or not out.strip():
        return None
    return json.loads(out[out.find("{") :])


def delete_if_test_object(client, identity: str, object_class: str = "user") -> None:
    """Delete only objects under TEST_OU with our prefix."""
    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$obj = $null
try {{
  if ('{object_class}' -eq 'user') {{ $obj = Get-ADUser -Identity '{identity}' -ErrorAction Stop }}
  elseif ('{object_class}' -eq 'group') {{ $obj = Get-ADGroup -Identity '{identity}' -ErrorAction Stop }}
  elseif ('{object_class}' -eq 'computer') {{ $obj = Get-ADComputer -Identity '{identity}' -ErrorAction Stop }}
}} catch {{ return }}
if ($obj.DistinguishedName -notlike '*{TEST_OU_NAME}*') {{
  throw "Refusing to delete object outside test OU: $($obj.DistinguishedName)"
}}
if ($obj.Name -notlike '{PREFIX}*' -and $obj.SamAccountName -notlike '{PREFIX}*' -and $obj.SamAccountName -notlike '{PREFIX}*`$') {{
  throw "Refusing to delete non-test object: $($obj.SamAccountName)"
}}
if ('{object_class}' -eq 'user') {{ Remove-ADUser -Identity $obj -Confirm:$false }}
elseif ('{object_class}' -eq 'group') {{ Remove-ADGroup -Identity $obj -Confirm:$false }}
else {{ Remove-ADComputer -Identity $obj -Confirm:$false }}
"""
    out, err, code = run_ps(client, script)
    if code != 0 and err and "Refusing" in err:
        raise RuntimeError(err)


def print_report(feature: str, target: str, before: Any, action: str, after: Any, status: str) -> None:
    print(f"FEATURE:\n{feature}\n")
    print(f"TARGET:\n{target}\n")
    print(f"BEFORE:\n{before}\n")
    print(f"ACTION:\n{action}\n")
    print(f"AFTER:\n{after}\n")
    print(f"STATUS:\n{status}")


def print_status(feature: str, target: str, current: Any, anomaly: str) -> None:
    print(f"FEATURE:\n{feature}\n")
    print(f"TARGET:\n{target}\n")
    print(f"CURRENT:\n{current}\n")
    print(f"ANOMALY:\n{anomaly}")


def print_not_safe(feature: str, reason: str, required_state: str) -> None:
    print(f"FEATURE:\n{feature}\n")
    print("STATUS:\nNOT SAFE TO CREATE LIVE\n")
    print(f"REASON:\n{reason}\n")
    print(f"REQUIRED AD STATE:\n{required_state}")


def main_cli(
    *,
    feature_name: str,
    feature_id: str,
    setup_fn: Callable,
    status_fn: Callable,
    reset_fn: Callable,
):
    parser = argparse.ArgumentParser(description=f"ADShield anomaly: {feature_name}")
    parser.add_argument("--status", action="store_true", help="Query live AD for anomaly presence")
    parser.add_argument("--reset", action="store_true", help="Restore safe baseline for this feature")
    args = parser.parse_args()

    try:
        client = get_client()
        verify_connectivity(client)
        if args.status:
            status_fn(client)
            return
        if args.reset:
            reset_fn(client)
            return
        setup_fn(client)
    except ConfigError as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
    except NotSafeError as e:
        print_not_safe(feature_name, str(e), getattr(e, "required_state", "See detector docs"))
        sys.exit(3)
    except Exception as e:
        print(f"FAILED:\n{e}", file=sys.stderr)
        sys.exit(1)
