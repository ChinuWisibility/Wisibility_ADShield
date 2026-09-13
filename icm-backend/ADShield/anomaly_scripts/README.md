# ADShield anomaly scripts (lab only)

Independent Python scripts that **create, check, and reset** Active Directory security anomalies for ADShield live testing.

They talk to the lab DC over **WinRM + NTLM** via `pypsrp`. They do **not** call the ADShield API and do **not** remediate findings.

## Lab target

| Setting | Value |
|--------|--------|
| Host | `192.168.68.107` |
| User | `wisibility\Administrator` |
| Password | Set `AD_PASSWORD` in `_common.py` to your lab password (`P@ssw0rd` placeholder) |
| Scope | `OU=wisibility,DC=wisibility,DC=lcl` |
| Test OU | `OU=ADShieldAnomalyTests,OU=wisibility,...` |
| Object prefix | `WIS-T-` (sAMAccountName ≤ 20 chars, computers include `$`) |

Never commit a real password. Scripts refuse to run until the placeholder is replaced.

## Setup

```bash
pip3 install pypsrp
cd icm-backend/ADShield/anomaly_scripts
# edit _common.py → AD_PASSWORD = "..."
```

## Usage (every script)

```bash
python3 01_disabledUsers.py           # create anomaly, then stop
python3 01_disabledUsers.py --status  # PRESENT / ABSENT / NOT SAFE
python3 01_disabledUsers.py --reset   # restore safe baseline for this feature
```

## Safety rules

- Only creates objects under the test OU with the `WIS-T-` prefix (short SAMs ≤ 20 characters).
- Never touches built-in Admin/Guest/krbtgt, Domain Admins, Enterprise Admins, or production OUs.
- Test SPNs use `*.example.invalid`.
- Features that cannot be created safely exit with `NOT SAFE TO CREATE LIVE` and print the required AD state.

## Feature coverage (38 scripts)

Skipped by design (master prompt): **29** `missing_os_information`, **30** `unsupported_os_versions`, **41** `delegation_exposure`.

See `anomaly_manifest.json` for the full script ↔ `featureId` map and expected safety flags.

### Expected NOT SAFE (static)

| # | Feature | Why |
|---|---------|-----|
| 02 | inactive_users | `lastLogonTimestamp` not writable (WILL_NOT_PERFORM); null logon does not count |
| 18 | dormant_privileged_users | Needs aged privileged logon timestamp |
| 23 | sid_history_analysis | Writing `sIDHistory` requires migration privileges |
| 24 | foreign_security_principals | Needs trust/FSP objects |

### Expected SAFE (create via WinRM)

Accounts 01, 03–08; groups 09–17, 19–20; ACL 21–22, 25–26; computers 27–28, 31–33; Kerberos 34–37; delegation 38–40.

Live PASS/FAIL still depends on lab rights and AD policy; run each script once after setting the password.

## Shared helper

`_common.py` provides connectivity, test OU creation, ensure/get/delete for users/groups/computers, and the CLI (`setup` / `--status` / `--reset`).
