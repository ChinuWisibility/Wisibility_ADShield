#!/usr/bin/env python3
"""
02 Inactive Users — create a real aged lastLogonTimestamp test state.

ADShield detector semantics:
- User must be enabled
- lastLogonTimestamp must exist
- lastLogonTimestamp must be older than 90 days

This script attempts to write the historical timestamp directly through
the remote Windows AD PowerShell session. It does not use NotSafeError.
"""

from datetime import datetime, timedelta, timezone

from _common import (
    PREFIX,
    ensure_user,
    get_user,
    main_cli,
    print_report,
    print_status,
    run_ps,
    ps_json,
)

FEATURE = "Inactive Users"
FEATURE_ID = "inactive_users"
SAM = "WIS-T-InactU"

INACTIVE_DAYS = 91


def get_inactive_user_state(client):
    """Read the actual lastLogonTimestamp from live AD."""

    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$u = Get-ADUser -Identity '{SAM}' -Properties `
    Enabled,
    lastLogonTimestamp,
    userAccountControl

if (-not $u) {{
    'null'
    return
}}

$timestamp = $null
$fileTime = $null
$ageDays = $null

if ($null -ne $u.lastLogonTimestamp) {{
    try {{
        $fileTime = [int64]$u.lastLogonTimestamp
        if ($fileTime -gt 0) {{
            $timestamp = [DateTime]::FromFileTimeUtc($fileTime)
            $ageDays = ((Get-Date).ToUniversalTime() - $timestamp).TotalDays
        }}
    }} catch {{
    }}
}}

[pscustomobject]@{{
    SamAccountName = $u.SamAccountName
    DistinguishedName = $u.DistinguishedName
    Enabled = [bool]$u.Enabled
    LastLogonTimestamp = $timestamp
    LastLogonFileTime = $fileTime
    AgeDays = $ageDays
}} | ConvertTo-Json -Compress
"""

    return ps_json(client, script)


def set_old_last_logon_timestamp(client):
    """
    Attempt to set lastLogonTimestamp to 91 days ago.

    Try multiple Windows-native mechanisms through the remote AD session.
    The function does not claim success until the value is read back.
    """

    target = datetime.now(timezone.utc) - timedelta(days=INACTIVE_DAYS)

    # Windows FILETIME = 100-ns intervals since 1601-01-01 UTC
    windows_epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
    filetime = int((target - windows_epoch).total_seconds() * 10_000_000)

    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$sam = '{SAM}'
$fileTime = [Int64]{filetime}

# First attempt: AD PowerShell attribute replacement.
try {{
    Set-ADUser -Identity $sam -Replace @{{lastLogonTimestamp = $fileTime}} -ErrorAction Stop
    Write-Output "SET-ADUSER-SUCCESS"
}} catch {{
    Write-Output ("SET-ADUSER-ERROR: " + $_.Exception.Message)
}}

# Second attempt: native ADSI DirectoryEntry modification.
try {{
    $root = New-Object System.DirectoryServices.DirectoryEntry(
        "LDAP://$((Get-ADUser -Identity $sam).DistinguishedName)"
    )

    $root.Properties["lastLogonTimestamp"].Clear()
    $root.Properties["lastLogonTimestamp"].Add($fileTime)
    $root.CommitChanges()

    Write-Output "SET-ADSI-SUCCESS"
}} catch {{
    Write-Output ("SET-ADSI-ERROR: " + $_.Exception.Message)
}}

# Read the value back from AD.
$u = Get-ADUser -Identity $sam -Properties `
    Enabled,
    lastLogonTimestamp

$actualFileTime = 0
$actualTimestamp = $null
$ageDays = $null

if ($null -ne $u.lastLogonTimestamp) {{
    try {{
        $actualFileTime = [int64]$u.lastLogonTimestamp

        if ($actualFileTime -gt 0) {{
            $actualTimestamp = [DateTime]::FromFileTimeUtc($actualFileTime)
            $ageDays = ((Get-Date).ToUniversalTime() - $actualTimestamp).TotalDays
        }}
    }} catch {{
    }}
}}

[pscustomobject]@{{
    TargetFileTime = $fileTime
    TargetTimestamp = [DateTime]::FromFileTimeUtc($fileTime)
    ActualFileTime = $actualFileTime
    ActualTimestamp = $actualTimestamp
    AgeDays = $ageDays
    Enabled = [bool]$u.Enabled
}} | ConvertTo-Json -Compress
"""

    out, err, code = run_ps(client, script)

    if code != 0 and not out:
        raise RuntimeError(err or "Failed to modify lastLogonTimestamp")

    # Find the final JSON object in the mixed PowerShell output.
    lines = [line.strip() for line in out.splitlines() if line.strip()]

    json_line = None
    for line in reversed(lines):
        if line.startswith("{") and line.endswith("}"):
            json_line = line
            break

    if not json_line:
        raise RuntimeError(
            f"Could not read verification result from AD. "
            f"PowerShell output: {out}\nError: {err}"
        )

    import json

    result = json.loads(json_line)

    # CRITICAL: success only if AD itself contains the required state.
    actual_age = result.get("AgeDays")

    if (
        result.get("Enabled") is True
        and result.get("ActualFileTime", 0) > 0
        and actual_age is not None
        and float(actual_age) >= 90
    ):
        return result

    raise RuntimeError(
        "AD did not contain the required inactive-user state after the "
        "write attempt. "
        f"ActualFileTime={result.get('ActualFileTime')}, "
        f"ActualTimestamp={result.get('ActualTimestamp')}, "
        f"AgeDays={result.get('AgeDays')}, "
        f"Enabled={result.get('Enabled')}. "
        f"PowerShell output: {out}"
    )


def setup(client):
    before = ensure_user(client, SAM)

    current = get_inactive_user_state(client)

    if (
        current
        and current.get("Enabled") is True
        and current.get("LastLogonFileTime", 0)
        and current.get("AgeDays") is not None
        and float(current["AgeDays"]) >= 90
    ):
        print_report(
            FEATURE,
            SAM,
            current,
            "none",
            current,
            "ANOMALY ALREADY EXISTS",
        )
        return

    after = set_old_last_logon_timestamp(client)

    print_report(
        FEATURE,
        SAM,
        before,
        f"Set lastLogonTimestamp to {after.get('TargetTimestamp')}",
        after,
        "ANOMALY CREATED",
    )


def status(client):
    u = get_inactive_user_state(client)

    if not u:
        print_status(
            FEATURE,
            SAM,
            "object missing",
            "ABSENT",
        )
        return

    present = (
        u.get("Enabled") is True
        and u.get("LastLogonFileTime", 0) > 0
        and u.get("AgeDays") is not None
        and float(u["AgeDays"]) >= 90
    )

    current = (
        f"Enabled={u.get('Enabled')} "
        f"lastLogonTimestamp={u.get('LastLogonTimestamp')} "
        f"AgeDays={u.get('AgeDays')}"
    )

    print_status(
        FEATURE,
        SAM,
        current,
        "PRESENT" if present else "ABSENT",
    )


def reset(client):
    """
    Restore the dedicated lab account to a non-inactive state.

    Since lastLogonTimestamp is system-maintained, do not attempt to fabricate
    a new timestamp during reset. Delete the dedicated test account instead.
    """

    script = f"""
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$u = Get-ADUser -Identity '{SAM}' -ErrorAction SilentlyContinue

if ($u) {{
    Remove-ADUser -Identity $u -Confirm:$false
    Write-Output "DELETED"
}} else {{
    Write-Output "MISSING"
}}
"""

    out, err, code = run_ps(client, script)

    if code != 0:
        raise RuntimeError(err or out)

    print_status(
        FEATURE,
        SAM,
        "dedicated test account removed",
        "ABSENT",
    )


if __name__ == "__main__":
    main_cli(
        feature_name=FEATURE,
        feature_id=FEATURE_ID,
        setup_fn=setup,
        status_fn=status,
        reset_fn=reset,
    )