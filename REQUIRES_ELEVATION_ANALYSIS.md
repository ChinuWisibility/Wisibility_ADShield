# Requires Elevation Analysis

**Scope:** Only the apparent inconsistency between (a) Inno Setup running in Administrative install mode and (b) the conclusion that `Configure-ADSecurity.ps1` died on `#Requires -RunAsAdministrator`.

**No code was changed. No fixes are proposed.**

---

## Short verdict

The two facts are **not logically contradictory** once separated carefully:

| Fact | What it actually proves |
| --- | --- |
| Inno “User privileges: Administrative” / “Administrative install mode: Yes” | The **Setup** process could perform elevated install actions (write `Program Files`, `HKLM`). |
| Configure exit code **1**, no `logs\installer` from install time, body side effects absent | The **PowerShell child** stopped before Configure’s first body side effect. |

They become inconsistent only if we also assume: *“therefore the child must have been elevated, therefore `#Requires` cannot have failed.”*

That extra assumption is **Inno’s documented intent** for this `[Run]` entry, but it is **not directly measured** for the child token. The prior root-cause report treated a strong behavioral match as proof of both (1) `#Requires` as the error and (2) a non-elevated child. This analysis separates those claims.

---

## 1. Why would an elevated Inno process launch a PowerShell child that fails `#Requires -RunAsAdministrator`?

### What the evidence supports

**Setup was elevated (well supported):**

```text
User privileges: Administrative
Administrative install mode: Yes
Install mode root key: HKEY_LOCAL_MACHINE
```

Concrete elevated actions succeeded: install under `C:\Program Files\ADSecurity`, write `HKLM\Software\...\Uninstall\...` and `HKLM\Software\Wisbility\ADSecurity`.

**Configure child failed immediately (well supported):**

```text
-- Run entry --
Run as: Current user
Filename: powershell.exe
Parameters: -NoProfile -ExecutionPolicy Bypass -File "…\Configure-ADSecurity.ps1" …
Process exit code: 1          # ~1097 ms later
```

At investigation time (before any later probes): `C:\ProgramData\ADSecurity\logs\installer` did **not** exist. That directory is created on the first lines of the script body, **before** `try/catch`. So the body did not get that far during install.

### What would make `#Requires` fail

PowerShell evaluates `#Requires -RunAsAdministrator` **before** running the script body. It fails when the current Windows identity is not in role `Administrator` under an elevated token (UAC-filtered admin → fail; elevated admin → pass). Failure id: `ScriptRequiresElevation`. Exit code in reproduction: **1**. Body does not run.

### Why that sits awkwardly next to elevated Setup

For this `[Run]` entry, Inno’s own rules say the child should **inherit Setup’s credentials** (see §3–4). If that happened, `#Requires` should pass.

So there are only a few coherent possibilities:

1. **Child did not actually get an elevated admin token**, despite Setup being elevated and despite Inno intending inheritance. Then `#Requires` fails. **Mechanism not proven** from logs (no process-token / integrity capture for PID 5400).
2. **Child was elevated and `#Requires` passed**, and some **other** pre-`New-Item` failure produced exit code 1 without creating `logs\installer`. For *this* script, that set is very small (see §5); none fit as well as `#Requires`.
3. **Attribution error:** install-time stderr was hidden (`runhidden`), so the exact exception text was never recorded; `#Requires` is inferred.

There is **no demonstrated, flag-based Inno path in this script** that deliberately drops elevation for this entry (the famous `postinstall` → `runasoriginaluser` footgun does **not** apply here).

**Answer to Q1:** An elevated Setup *can* still be followed by a Configure failure that *looks like* `#Requires` if the child session is not admin-elevated for PowerShell’s check—or if we are mis-attributing another exit-1 abort. The logs prove Setup elevation and child abort; they do **not** prove the CreateProcess token of the child. The “why” of a non-elevated child under these flags is **not established**.

---

## 2. Does Inno actually launch the child with a non-elevated token?

### What Inno says it did

Log line:

```text
Run as: Current user
```

Per Inno documentation, for `[Run]` entries:

| Flag situation | Token used |
| --- | --- |
| `runascurrentuser` (default when **`postinstall` is absent**) | Inherit Setup/Uninstall credentials (typically elevated admin) |
| `runasoriginaluser` (default when **`postinstall` is present**) | Pre-UAC / original user credentials (typically **non**-elevated) |

This entry has **no** `postinstall`. So “Run as: Current user” means **inherit Setup**, not “original unelevated user.”

### Direct measurement of the child token?

**No.**

- No Security 4688 process-creation events with integrity/elevation fields for that interval.
- PowerShell operational events recorded PID **5400** starting/stopping but **not** Mandatory Label / elevation type.
- `runhidden` discarded console stderr/stdout that would have printed `ScriptRequiresElevation` verbatim.

### Indirect inference

| Observation | Suggests |
| --- | --- |
| Exit code **1** | Compatible with `ScriptRequiresElevation` (and several other failures) |
| Exit code **not** `-196608` | **Against** broken `-File` path / missing `.ps1` (those reproduced as `-196608`) |
| No install-time `logs\installer` | Body did not reach `New-Item` |
| Same script without `#Requires`, non-admin, same args | **Creates** `logs\installer` successfully (ProgramData ACLs allow it) |

So: if the child had been a normal non-elevated user **and** had passed `#Requires` (impossible) or had no `#Requires`, it still could have created `logs\installer`. The missing directory therefore points to **stop before body**, not “non-admin cannot write ProgramData.”

**Answer to Q2:** Inno’s log and docs indicate the child was **intended** to use Setup’s (elevated) token. There is **no direct proof** that the child was non-elevated. Behavioral evidence is **consistent with** a session that failed the admin `#Requires` check, which usually means non-elevated—but that remains an **inference**, not a token dump.

---

## 3. Are any `[Run]` flags responsible?

Actual flags on the Configure entry:

```iss
Flags: runhidden waituntilterminated
```

| Flag | Effect on elevation | Relevant here? |
| --- | --- | --- |
| `runhidden` | Hides window; **does not** change token. **Does** hide the `#Requires` error text from the user and from easy capture. | Explains missing stderr proof |
| `waituntilterminated` | Wait for exit; **no** token effect | No |
| `postinstall` | **Absent.** If present, default would be `runasoriginaluser` (often non-elevated). | **Not responsible** |
| `runasoriginaluser` | **Absent.** Would force original (often non-elevated) token. | **Not responsible** |
| `runascurrentuser` | **Absent explicitly**, but is the **default** without `postinstall`. | Intended elevated inherit |
| `shellexec` | **Absent** | N/A |

**Answer to Q3:** No flag on this entry selects the unelevated-original-user path. The flags that *are* present do not explain a privilege drop. `runhidden` only explains why the exact `#Requires` message was not retained.

---

## 4. Is there a known Inno Setup behavior that explains this?

### Known behavior that *would* explain unelevated children

**Yes, but it does not match this script:**

- `[Run]` + `postinstall` → default `runasoriginaluser` → child often **not** elevated even when Setup is admin.
- Documented repeatedly; fixed by adding `runascurrentuser` on postinstall entries.

**This Configure entry is not `postinstall`.** Setup log shows it ran in the main install `[Run]` phase (`StatusMsg` / immediate Run after “Installation process succeeded”), not as a finish-page checkbox action.

### Other known behaviors checked

| Behavior | Applies? |
| --- | --- |
| `postinstall` ⇒ unelevated default | **No** — flag absent |
| Explicit `runasoriginaluser` | **No** — flag absent |
| Setup not elevated | **No** — Administrative mode + HKLM/Program Files writes |
| `Compatibility mode: Yes (DetectorsAppHealth Installer)` | Present in log; this is a common Windows installer-detection shim layer. **No evidence** in this investigation that it strips elevation from `[Run]` children. Treat as **unproven correlating detail**, not a demonstrated cause. |
| 32-bit Inno (`Setup version: … (32-bit)`) spawning `powershell.exe` | May resolve to WOW64 PowerShell; elevation should still inherit from parent if CreateProcess uses the elevated token. **Not shown** to cause `#Requires` failure by itself. |

**Answer to Q4:** The well-known Inno elevation footgun (`postinstall` / `runasoriginaluser`) **does not explain this case**. There is **no confirmed documented Inno behavior** that, given these exact flags, requires the child to be non-elevated under an Administrative Setup. The inconsistency with `#Requires`-failure attribution is therefore **unresolved at the mechanism layer**.

---

## 5. Is the evidence sufficient to prove `#Requires` itself is the root cause, or only the first observed failure?

### Evidence grades

#### A. Proven (install logs / filesystem)

1. Inno invoked Configure via `[Run]`.
2. Child exited **1** in ~1.1s.
3. Install-time Configure did **not** produce `logs\installer` / `install-*.log` (observed in the earlier installer investigation before later analysis probes).
4. Configure `catch` / `Rollback-Install` did not run (no rollback log; `{app}` remains).
5. WinSW service install lines were never reached.

#### B. Strong inference (script structure + exit-code fingerprints)

Configure body order:

```text
#Requires -RunAsAdministrator     ← pre-body gate
param(...)                        ← binding
$ErrorActionPreference = "Stop"
New-Item ... logs\installer       ← first durable side effect
try { ... services ... }
```

Fingerprint tests on this machine:

| Condition | Exit code | `logs\installer` / body |
| --- | --- | --- |
| `#Requires` fail (non-admin) | **1** | No |
| `-File` path broken / missing script | **-196608** | No |
| Same script **without** `#Requires`, non-admin, Inno-like args | **0** | **Yes** (ProgramData writable) |
| Install-time Configure | **1** | No (at install investigation) |

So:

- Path/`-File` failure is **ruled out** by exit code mismatch (`1` vs `-196608`).
- “Non-admin cannot create ProgramData” is **ruled out** as the reason for missing `logs\installer`.
- If execution passed `#Requires` and `param`, `New-Item` should have left `logs\installer`.

For **this** script, the only remaining pre-side-effect gate that matches exit **1** + no directory is **`#Requires -RunAsAdministrator` failing** (or an exotic abort hard to reconcile with the file contents).

#### C. Not proven

1. **Install-time stderr text** was never captured (`runhidden`) — we never logged `FullyQualifiedErrorId : ScriptRequiresElevation` from the Inno child itself.
2. **Child token elevation / integrity level** was never captured.
3. **Why** an inherit-Setup `[Run]` would yield a non-admin PowerShell session — **no established mechanism** for these flags.
4. Exit code **1** alone is **not unique** (parse error, other `#Requires`, mandatory param, top-level throw also returned 1 in probes). Uniqueness comes only when combined with this script’s structure and the ruled-out alternatives.

### Answer to Q5

| Claim | Status |
| --- | --- |
| Configure failed before any intended install side effects | **Proven** |
| First gate in the script is `#Requires -RunAsAdministrator` | **Proven** (source order) |
| Install-time failure is **best explained** as that gate rejecting the session | **Strong inference** |
| `#Requires` failure is **proven by captured install-time error text** | **No** |
| Inno launched a **proven** non-elevated token | **No** |
| Elevated Setup + failed `#Requires` is fully explained by a known Inno flag behavior | **No** |

So: `#Requires` is **not merely “the first line of the file”** in a vague sense — it is the **only remaining plausible pre-body abort** after eliminating `-File` errors and post-gate body execution. But calling it an airtight root cause **overstates** what was directly observed. Safer statement:

> **Root observation:** Configure aborted before body side effects with exit code 1.  
> **Best-fit cause given script structure and fingerprints:** `#Requires -RunAsAdministrator` rejected the PowerShell session.  
> **Unresolved:** how that reconciles with Inno Administrative mode + default `runascurrentuser` inheritance; child token was not measured; stderr was not captured.

---

## Reconciliation of the “inconsistency”

```text
Elevated Setup (proven)
    │
    │  [Run] flags: runhidden waituntilterminated
    │  privilege mode: default runascurrentuser ("Run as: Current user")
    │  docs: child SHOULD inherit Setup elevation
    │
    ▼
PowerShell child (PID 5400)
    │
    ├─ Intent (Inno): elevated admin token
    ├─ Direct token evidence: none
    ├─ Outcome: exit 1, no logs\installer
    └─ Best-fit interpretation: session failed admin #Requires
         (stderr hidden; mechanism for privilege mismatch unknown)
```

The earlier installer report’s conclusion is **directionally reasonable** as a best-fit failure mode, but the elevation story was **underspecified**: Administrative Setup does **not** by itself prove the child passed PowerShell’s admin check, and these `[Run]` flags do **not** provide a known Inno reason for a deliberate drop to a non-elevated token.

---

## Direct answers (checklist)

1. **Why elevated Inno → child fails `#Requires`?**  
   Unknown mechanism. Outcome matches a non-admin PowerShell session; Inno intent was inheritance of Setup’s elevated token. Not explained by the flags used.

2. **Did Inno launch a non-elevated token?**  
   **Not proven.** Docs/log say inherit Setup (elevated). Behavioral inference suggests the session failed an admin requires check; no token capture.

3. **Are `[Run]` flags responsible?**  
   **No elevation-dropping flags present.** `runhidden` only hides the error. `postinstall` / `runasoriginaluser` (the known footgun) are absent.

4. **Known Inno behavior that explains this?**  
   **Not for this entry.** The known `postinstall` → unelevated default does not apply.

5. **Is evidence enough to prove `#Requires` is the root cause?**  
   **Enough for a strong best-fit inference** that the process never passed the `#Requires` gate (or never reached body). **Not enough** for courtroom-level proof of the exact exception text or of a non-elevated CreateProcess token. It is more than “first line we noticed,” but less than fully closed.
