# Configure Script Parser Root Cause

**Scope:** Only the elevated-validation `ParserError` / `MissingEndParenthesisInExpression` at line 94 of `Configure-ADSecurity.ps1`.

**No files were modified.**

---

## Verdict

The parser failure is caused by a **UTF-8 em dash (U+2014, bytes `E2 80 94`) inside an ASCII double-quoted string**, in a **BOM-less** `.ps1` file that **Windows PowerShell 5.1 reads as Windows-1252**.

Under Windows-1252, `E2 80 94` becomes three characters: `â` + `€` + `”` (U+201D RIGHT DOUBLE QUOTATION MARK). PowerShell treats that U+201D as a **string delimiter**, so the quoted string ends early and the rest of the line is parsed as code → `MissingEndParenthesisInExpression`.

This defect is **already present in the source repository copy** when parsed the same way. Packaging did **not** corrupt the em-dash bytes. Payload/staging copies are **not on disk** for comparison; installed vs source differ mainly by **line endings** (CRLF vs LF), which is **not** the parser cause.

---

## Copies examined

| Copy | Path | Present? |
| --- | --- | --- |
| Source repo | `D:\Work\Wisibility_IGA\installer\scripts\Configure-ADSecurity.ps1` | **Yes** |
| Installed | `C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1` | **Yes** |
| Installer payload | `D:\Work\Wisibility_IGA\installer\payload\scripts\Configure-ADSecurity.ps1` | **Missing** |
| Build staging | `D:\Work\Wisibility_IGA\installer\staging\scripts\Configure-ADSecurity.ps1` | **Missing** |

Workspace search found **only** the source and installed copies. No `installer\payload` or staging tree currently contains this script (payload was consumed/cleaned after the Jul 26 package build that produced the installed file).

---

## Side-by-side: source vs installed

| Property | Source repo | Installed |
| --- | --- | --- |
| Size | 6116 bytes | 5942 bytes |
| SHA-256 | `fad1708b8fffb99f5337fbf314cc8e0bc1b5fe7b2ece78a8715f2691cab61480` | `54c571e16a8b325b45d2860377cc8d3d2b68a6bf2239c9806d84bd499676cc92` |
| mtime | 2026-07-28 (repo) | 2026-07-26 (packaged into Setup) |
| BOM | **none** | **none** |
| First bytes | `23 52 65 71…` (`#Req…`) | same |
| Line endings | **CRLF = 174**, LF_only = 0 | **LF_only = 174**, CRLF = 0 |
| Size delta | — | **174 bytes smaller** = exactly one `0x0D` removed per line |
| Non-ASCII byte counts | `0xE2×3`, `0x80×3`, `0x94×2`, `0xA6×1` | **identical** |
| Em dash on line 94 | UTF-8 `E2 80 94` | UTF-8 `E2 80 94` (**same**) |

Packaging / install transformed **CRLF → LF** (or the Jul 26 artifact was already LF). It did **not** alter the Unicode em-dash sequence on line 94.

---

## Line 94 exact contents

### As UTF-8 (intended text)

```powershell
    Write-Log "Wrote config.json (no JWT secret — backend will generate)"
```

Specials on that line (UTF-8 decode):

| Index | Code point | Meaning |
| --- | --- | --- |
| 14 | U+0022 | ASCII `"` (string open) |
| 33 | U+0028 | ASCII `(` |
| 48 | U+2014 | **EM DASH —** (utf8 `e28094`) |
| 71 | U+0029 | ASCII `)` |
| 72 | U+0022 | ASCII `"` (string close) |

ASCII `(` / `)` on the line are balanced **inside** the string when the em dash is a single character.

### As Windows-1252 (how PS 5.1 reads this BOM-less file on this machine)

System ANSI: **Windows-1252** (code page 1252).

Same bytes `E2 80 94` decode to **three** characters:

| Bytes | CP1252 chars | Code points |
| --- | --- | --- |
| `E2 80 94` | `â` `€` `”` | U+00E2, U+20AC, **U+201D** |

So PowerShell effectively sees:

```powershell
    Write-Log "Wrote config.json (no JWT secret â€” backend will generate)"
```

U+201D `”` is a **curly/smart double quote**. In Windows PowerShell, that is a valid **alternate string terminator**. The string that began with ASCII `"` therefore **ends at `”`**, and the trailing text:

```text
 backend will generate)"
```

is parsed as code. That yields:

```text
Missing closing ')' in expression.
FullyQualifiedErrorId : MissingEndParenthesisInExpression
```

at **line 94, column 76** — matching elevated validation and `Parser.ParseFile`.

---

## Exact bytes around line 94 (`JWT secret`)

### Source (CRLF before/after)

```text
... 73 65 63 72 65 74 20 E2 80 94 20 62 61 63 6B 65 6E 64 ...
                s  e  c  r  e  t  _  ——emdash——  _  b  a  c  k  e  n  d
```

Em dash at byte offset **3196**.

### Installed (LF before/after)

```text
... 73 65 63 72 65 74 20 E2 80 94 20 62 61 63 6B 65 6E 64 ...
```

Em dash at byte offset **3103** (earlier only because CR bytes were stripped).

**Same three-byte UTF-8 em dash in both files.**

---

## Surrounding lines 74–113 (both copies; logical content identical)

```text
  74|    $cfg = @{
  ...
  93|    $cfg | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8
  94|    Write-Log "Wrote config.json (no JWT secret — backend will generate)"
  95|  }
  ...
 108|  # mongod.cfg
 109|  $mongoCfg = @"
```

Quotes on line 94 are ASCII `"` … `"` when viewed as UTF-8. The break appears only after **mis-decoding**.

---

## Other Unicode in the same file (both copies)

| Line | Character | UTF-8 | Inside `"..."`? |
| --- | --- | --- | --- |
| 60 | EM DASH — | `E2 80 94` | Yes: `"Port $Port in use — selected $chosen"` |
| 94 | EM DASH — | `E2 80 94` | Yes: the failing line |
| 138 | ELLIPSIS … | `E2 80 A6` | Yes: `"Waiting for Mongo readiness…"` |

Non-ASCII inventory `E2×3, 80×3, 94×2, A6×1` = two em dashes + one ellipsis. All three are in double-quoted strings. The **reported** parser error is on **line 94** (see below).

---

## Parentheses balance

| Decode | ASCII `(` count | ASCII `)` count | Delta |
| --- | --- | --- | --- |
| UTF-8 (source & installed) | 50 | 50 | **0** |
| CP1252 (source & installed) | 50 | 50 | **0** |

The file is **not** missing a literal `)`. The error is from **premature string termination**, so the parser’s expression/`()` state machine gets confused—not from an unbalanced source file under correct UTF-8 reading.

---

## Direct PowerShell parse proof

On this machine (`ANSI=Windows-1252`):

```text
FILE=D:\Work\Wisibility_IGA\installer\scripts\Configure-ADSecurity.ps1
ERR=...Configure-ADSecurity.ps1:94 char:76
Missing closing ')' in expression.
STARTLINE=94 STARTCOL=76

FILE=C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1
ERR=...Configure-ADSecurity.ps1:94 char:76
Missing closing ')' in expression.
STARTLINE=94 STARTCOL=76
```

Both copies fail **identically** via `[Parser]::ParseFile`.

---

## Answers to the investigation questions

### Is the parser error already present in source?

**Yes.** Source fails `ParseFile` at line 94 char 76 with the same `MissingEndParenthesisInExpression` as the installed script.

### Did packaging corrupt the file?

**Not the em dash / parser-relevant bytes.** Those are identical (`E2 80 94` on line 94).

Packaging (or the Jul 26 artifact vs today’s repo save) **did** change line endings **CRLF → LF** (6116 → 5942). That does **not** cause this parser error.

Payload/staging copies are **unavailable** now, so a third/fourth on-disk generation cannot be hashed; installed content is enough to show the Unicode sequence survived install.

### Did PowerShell interpret the encoding incorrectly?

**Yes — relative to the file’s real encoding.**

| Fact | Value |
| --- | --- |
| File encoding (actual) | UTF-8 **without BOM** |
| Host default ANSI | Windows-1252 |
| PS 5.1 behavior for BOM-less scripts | Read using **system ANSI**, not UTF-8 |
| Effect on U+2014 | Becomes `â€”` including **U+201D `”`**, which terminates `"..."` early |

This is the mechanism that turns a visually fine UTF-8 line into a parse error.

### Is line 94 actually the broken line, or is syntax broken earlier?

**The parser attributes the error to line 94, column 76** (`STARTLINE=94`). That is where the em dash sits inside a double-quoted string that also contains `(...)`.

Line 60 also contains a UTF-8 em dash in a double-quoted string and is subject to the **same encoding hazard**. Ellipsis on line 138 is another UTF-8 sequence in quotes. The **first/reported hard failure** from `ParseFile` and from elevated execution is **line 94**. There is no evidence of a missing parenthesis earlier in the file under UTF-8; under CP1252 the failure mode is **string-delimiter injection from mojibake**, reported at line 94.

---

## Causal chain (exact)

```text
Source authored as UTF-8 text containing U+2014 EM DASH inside "..."
    → saved WITHOUT UTF-8 BOM
    → installed copy keeps E2 80 94 (LF-only line endings)
    → Windows PowerShell 5.1 opens BOM-less .ps1 as Windows-1252
    → E2 80 94 ⇒ U+00E2 U+20AC U+201D
    → U+201D closes the ASCII-opened double-quoted string early
    → trailing ` backend will generate)"` parsed as code
    → ParserError MissingEndParenthesisInExpression @ line 94 char 76
```

---

## What this is / is not

| Claim | Result |
| --- | --- |
| Root cause is `#Requires -RunAsAdministrator` | **No** (elevated run / ParseFile) |
| Root cause is unbalanced `()` in UTF-8 source | **No** (50/50) |
| Root cause is Inno corrupting line 94 bytes | **No** (bytes match intent; same em dash) |
| Root cause is UTF-8 em dash + BOM-less + PS ANSI read | **Yes** |
| Line 94 is where PS reports the failure | **Yes** |

---

## One-sentence root cause

**A BOM-less UTF-8 `Configure-ADSecurity.ps1` contains an em dash (U+2014) in a double-quoted string on line 94; Windows PowerShell 5.1 reads the file as Windows-1252, turns that em dash into a curly `”`, terminates the string early, and raises `MissingEndParenthesisInExpression`—already reproducible on the source file, not introduced by packaging byte corruption.**
