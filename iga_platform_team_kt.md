# IGA platform — team KT (identity, application, accounts)

This is a manager-style walkthrough: **who does what**, **what depends on what**, and **rough build order**. No API names — just concepts.

---

## 1. Why this order matters

Everything else assumes you can answer three questions reliably:

1. **What applications are in scope?** (registry, owners, risk posture over time)
2. **Who are the people (and service identities) we govern?** (identity store, profiles, attributes)
3. **What access exists in each app?** (accounts, entitlements, uploads or connectors)

If those three are weak, risk scores, JML automation, and audit exports will be **opinions built on sand**. So the roadmap stacks **foundation → inventory → governance depth → automation → long-term compliance**.

---

## 2. User roles — who performs which kind of work

| Role | Typical responsibilities |
|------|-------------------------|
| **Admin / IGA owner** | Registers applications, defines schemas and mappings, runs uploads or connector setup, manages identity and profile templates, resolves quarantine, runs correlation, configures bulk imports, handles connector credentials and sync (later phases). Owns “make the system tell the truth.” |
| **Manager (line manager)** | Sees direct reports and team-level risk (when built), handles handoffs for movers/leavers, contractor renewals where applicable, and certification-style approvals that route by hierarchy. Less configuration, more decisions on people. |
| **Audit / analytics** | Read-heavy: exports, historical views, integration health reports, evidence packs. Usually **does not** change production access without going through Admin workflows. |
| **All authenticated users** | Browse what policy allows: application and entitlement catalogs, identity 360° views, open violations for context. Day-to-day transparency, not administration. |
| **System / scheduler** | Background jobs: bulk HR attribute sync, lifecycle batch processing, connector sync windows, snapshot purge under retention policy. No human UI — service accounts and cron. |

**Rule of thumb:** If it changes **structure** (apps, schemas, connectors, bulk data), it is **Admin**. If it changes **someone’s job context** (approve, reassign, certify team), it is **Manager** where we expose it. If it is **evidence**, it is **Audit** plus Admin for remediation.

---

## 3. What depends on what (simple dependency chain)

Think of a single spine:

**Application registry → schema & mapping → data ingestion (upload or connector) → accounts & entitlements in the catalog → correlation (who owns which account) → identity 360° (person + accounts + violations + entitlements).**

- **Identity profiles and mappings** can start early, but **auto-mapping quality** improves once HR or directory attributes and app data are stable.
- **Quarantine** sits on identity quality: you need identities and rules before “hold for review” is meaningful.
- **SoD and violations** need **entitlements assigned to people** (or resolvable accounts), not just raw CSV rows.
- **Manager hierarchy** needs **manager fields** trustworthy on identities; often lands after core identity CRUD.
- **Connectors and JML** need **clear identity lifecycle semantics** and **reliable account/entitlement sync**; they are not a good first sprint.

---

## 4. Build order by phase (S0 → S4)

These labels match how we prioritise work: **S0 first**, **S4 last**.

### S0 — Foundation (ship this before promising governance automation)

- Application registry, application types, global and app schema, column mappings.
- Identity store: list, detail, create/update/delete, bulk import, 360° read paths, entitlements and violations on a person.
- Identity profiles, mappings, auto-map, custom attribute **definitions**.
- Upload pipeline and upload history; entitlement catalog for apps.
- Quarantine list and resolve (identity safety net).

**Outcome:** Ops can onboard an app, load data, see people and access in one place, and pause bad records.

### S1 — Inventory and truth

- Account aggregation (search, detail, privileged / NHI views).
- Correlation engine usage: run matching, improve link quality.
- Application-level risk and compliance tagging; entitlement risk levels.
- NHI-style filtering on identities where data supports it.

**Outcome:** “Who has what, and is it linked to a person?” becomes trustworthy.

### S2 — Governance depth and human workflows

- Identity risk scoring, lifecycle **state** (not full automation yet), exports, peer comparison, reassign work.
- Manager chain and direct reports; contractor profile and expiring contracts.
- Profile analytics (coverage, risk exposure), mapping overrides, unmapped identities.
- Richer upload and schema UX: validate before import, row-level error review.

**Outcome:** Managers and compliance can **use** the platform for decisions, not only browse it.

### S3 — Automation and connectors

- JML triggers and lifecycle **event** log and batch processing.
- Connector lifecycle: create, test, sync, credentials, integration logs.
- Deeper entitlement modelling (hierarchy, ownership reviews at scale).
- Bulk attribute sync from HR systems.

**Outcome:** Less manual CSV wrestling; operational integration story is credible.

### S4 — Long horizon compliance

- Identity snapshots, compare, retention and purge aligned to policy.

**Outcome:** Defensible historical answers for audits and privacy programmes.

---

## 5. How to use this in a sprint conversation

- **Design and backend** can walk the **dependency chain** in section 3 in order.
- **Product** can assign screens to **roles** in section 2 so we do not build Admin-only flows where Managers need answers.
- **Leadership** can map roadmap **S0–S4** to quarters without naming every feature — “we are still in S1” is a clear signal.

---

## 6. Companion diagram

See **`iga_platform_roles_and_roadmap.drawio`** in the repo root for the same story as a single-page diagram (phases, roles, and dependency reminder). Use it alongside **`identity_application_flow.drawio`** for the data-flow spine.
