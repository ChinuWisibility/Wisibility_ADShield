# Active Directory Security Posture Framework - Gap Analysis

Date: 2026-06-06

## Executive Summary

- Total Features Required: 52
- Implemented: 18
- Partially Implemented: 4
- Missing: 30
- Completion Percentage: 34.6%
- MVP Ready: NO

Reasoning: The codebase contains a real security scan framework with LDAP-backed user checks and graph-backed group/privilege/ACL-style analytics, but it does not yet cover several required MVP items including stale computers, delegation risks in executable code, and broad AD-specific analytics such as GPO, trust, authentication, and full SID/ACL parsing.

## Existing Architecture

### Current AD Connector Design

- AD/LDAP connectivity exists through `ldapts` in [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:1).
- AD config normalization supports multi-URL and multi-base-DN failover in [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:81) and [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:316).
- Full directory fetch supports users, groups, and optionally computers in [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:367).
- AD sync orchestration and job handling exist in [adConnectorController.js](/d:/Work/Wisibility_IGA/icm-backend/src/controllers/adConnectorController.js:17), [adSyncJobService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adSyncJobService.js), and [adSyncPipelineService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adSyncPipelineService.js).

### Existing Scan Framework

- Feature registry and discovery payload exist in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:6).
- Two executable scan modules exist:
  - `user_account_security` in [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:30)
  - `identity_graph_security` in [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:46)
- Scan orchestration, module routing, and result aggregation exist in [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:84) and [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:158).
- Security Center endpoints exist in [securityRoutes.js](/d:/Work/Wisibility_IGA/icm-backend/src/routes/securityRoutes.js:14) and [securityController.js](/d:/Work/Wisibility_IGA/icm-backend/src/controllers/securityController.js:40).

### Existing Analytics Engine

- LDAP user analytics exist in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:24).
- Group analytics exist in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:391).
- Privileged access analytics exist in [privilegedAccessService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/privilegedAccess/privilegedAccessService.js:379).
- ACL-style analytics currently mean only orphan SID and shadow-admin heuristics in [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:17) and [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:107).

### Existing Storage Strategy

- Scan snapshots are stored as JSON files under `icm-backend/src/data/scanResults` in [postureScanResultsStore.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureScanResultsStore.js:6).
- No dedicated MongoDB posture-scan collection exists for these scan results; the store is filesystem JSON in [postureScanResultsStore.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureScanResultsStore.js:20).

## Feature Matrix

| Module | Feature | Status | Evidence | Gap |
| ------ | ------- | ------ | -------- | --- |
| User Account Security | Enabled Users | Not Implemented | No executable feature for enabled-user inventory in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:24) | No findings/reporting path for enabled accounts |
| User Account Security | Disabled Users | Implemented | Feature and analyzer in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:25) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:130) | None |
| User Account Security | Inactive Users | Implemented | Feature and 90-day last-logon logic in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:26) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:146) | Threshold not externally configurable in Security Center flow |
| User Account Security | Locked Accounts | Implemented | Feature and lockout/UAC logic in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:27) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:167) | None |
| User Account Security | Password Never Expires | Implemented | Feature and UAC check in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:28) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:183) | None |
| User Account Security | Password Not Required | Implemented | Feature and UAC check in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:29) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:197) | None |
| User Account Security | Smartcard Not Required | Implemented | Feature and UAC check in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:31) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:228) | None |
| User Account Security | Reversible Password Encryption | Implemented | Feature and UAC check in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:30) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:211) | None |
| User Account Security | DES Encryption Enabled | Not Implemented | No DES-specific feature in executable list; registry lacks DES item in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:50) | Missing UAC/attribute analyzer |
| User Account Security | Accounts Without Manager | Not Implemented | `manager` is fetched as LDAP attribute in [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:49) but no posture feature consumes it | Missing finding builder and UI exposure |
| User Account Security | Shared Accounts Detection | Not Implemented | No shared-account heuristics in posture modules | Missing naming/pattern/risk logic |
| User Account Security | Service Accounts | Implemented | SPN-based detection in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:32) and [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:242) | Uses SPN heuristic only |
| User Account Security | Expiring Accounts | Not Implemented | No account-expiry feature in registry or analyzer | Missing LDAP accountExpires analysis |
| User Account Security | Dormant Privileged Accounts | Implemented | Graph+activity feature in [privilegedAccessService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/privilegedAccess/privilegedAccessService.js:383) and exposed in UI [PrivilegedAccessView.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/privileged/PrivilegedAccessView.jsx:12) | None |
| Group Security | Empty Groups | Implemented | Feature runner in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:443) | None |
| Group Security | Groups Without Owners | Implemented | Owner/managedBy fallback logic in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:123) and [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:151) | Depends on ingested owner metadata quality |
| Group Security | Nested Groups | Implemented | Executable feature in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:397) and graph scan [identityGraphSecurityScan.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/identityGraphSecurityScan.js:181) | None |
| Group Security | Excessively Nested Groups | Partially Implemented | Nested depth is present in finding metadata and tree UI in [NestedGroupTree.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/components/security/NestedGroupTree.jsx:100) | No separate thresholded feature for “excessive” nesting |
| Group Security | Privileged Groups | Partially Implemented | Heuristic privileged-group tokens in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:31) | No explicit privileged-group inventory/report |
| Group Security | Unused Groups | Implemented | Derived from empty-group cache in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:457) | None |
| Group Security | Circular Membership Detection | Implemented | Executable feature in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:455) | None |
| Group Security | Multiple Privileged Membership Detection | Implemented | Toxic combination feature in [groupIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/groupIntelligence/groupIntelligenceService.js:499) | None |
| Group Security | Shadow Admin Detection | Implemented | Feature in [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:107) | Heuristic graph reachability, not real ACL parsing |
| Privileged Group Analytics | Domain Admins | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:32) | Heuristic name match only |
| Privileged Group Analytics | Enterprise Admins | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:33) | Heuristic name match only |
| Privileged Group Analytics | Schema Admins | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:34) | Heuristic name match only |
| Privileged Group Analytics | Administrators | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:35) | Heuristic name match only |
| Privileged Group Analytics | Account Operators | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:36) | Heuristic name match only |
| Privileged Group Analytics | Server Operators | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:38) | Heuristic name match only |
| Privileged Group Analytics | Backup Operators | Implemented | Token present in [graphConstants.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/graph/graphConstants.js:37) | Heuristic name match only |
| Privileged Group Analytics | Print Operators | Not Implemented | No token or dedicated logic | Missing group recognition |
| Privileged Group Analytics | DnsAdmins | Not Implemented | No token or dedicated logic | Missing group recognition |
| Privileged Group Analytics | Remote Desktop Users | Not Implemented | No token or dedicated logic | Missing group recognition |
| Privileged Group Analytics | Group Policy Creator Owners | Not Implemented | No token or dedicated logic | Missing group recognition |
| SID & ACL Analysis | SID History Detection | Partially Implemented | `sIDHistory` is examined only as candidate orphan SID input in [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:49) | No standalone SID-history finding or abuse analysis |
| SID & ACL Analysis | Orphan SID Detection | Implemented | Executable analyzer in [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:17) | Compares against known entitlement SIDs only |
| SID & ACL Analysis | Foreign Security Principals | Not Implemented | No FSP feature or parser | Missing CN=ForeignSecurityPrincipals analysis |
| SID & ACL Analysis | ACL Parsing | Not Implemented | No `nTSecurityDescriptor` parsing; current “ACL” module is heuristic only | Missing descriptor fetch and ACE parser |
| SID & ACL Analysis | Unknown SID Bindings | Not Implemented | No binding-resolution analyzer beyond orphan SID heuristic | Missing SID-to-principal reconciliation |
| SID & ACL Analysis | Broken ACL Detection | Not Implemented | No ACL integrity analysis | Missing ACE validation engine |
| SID & ACL Analysis | Shadow Admin Discovery | Implemented | Heuristic path-based detection in [aclIntelligenceService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/aclIntelligence/aclIntelligenceService.js:107) | Not backed by parsed DACL/SACL data |
| Computer Security | Enabled Computers | Not Implemented | Computers are ingestable in [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:367) but no posture analyzer exists | Missing executable computer module |
| Computer Security | Disabled Computers | Not Implemented | Same evidence as above | Missing executable computer module |
| Computer Security | Inactive Computers | Not Implemented | Same evidence as above | Missing last-logon computer analytics |
| Computer Security | Missing OS Information | Not Implemented | `operatingSystem` is normalized in [ldapNormalizer.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/ldapNormalizer.js:172) but unused by posture scans | Missing finding generation |
| Computer Security | Unsupported OS Detection | Not Implemented | No OS policy/risk logic | Missing version baseline engine |
| Computer Security | Duplicate SPN Detection | Not Implemented | SPN is used only for service-account detection in users | Missing directory-wide SPN collision analysis |
| Computer Security | Unconstrained Delegation | Partially Implemented | Planned feature exists in registry at [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:359) | Not in executable feature arrays, so no actual scan execution |
| Computer Security | Missing Owners | Not Implemented | No computer owner model/analysis | Missing owner source and findings |
| Computer Security | Servers in Wrong OU | Not Implemented | No OU placement policy engine | Missing OU inventory/policy mapping |
| Authentication Security | Kerberos Pre-Auth Disabled | Not Implemented | No feature or UAC analyzer | Missing DONT_REQ_PREAUTH logic |
| Authentication Security | AS-REP Roastable Users | Not Implemented | No feature or UAC analyzer | Missing roastable-account logic |
| Authentication Security | NTLM Usage Detection | Not Implemented | No event/log or auth telemetry ingestion | Missing data source |
| Authentication Security | LM Hash Detection | Not Implemented | No password storage/hash inspection logic | Missing source data and analyzer |
| Authentication Security | Password Spray Detection | Not Implemented | No log/event analytics pipeline for sprays | Missing auth telemetry ingestion |
| Authentication Security | MFA Mapping Validation | Not Implemented | No MFA mapping module in AD posture area | Missing identity-to-MFA control correlation |
| Kerberos & Delegation | Service Principal Names | Partially Implemented | SPN-based service-account detection in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:242) | No full SPN inventory/analytics view |
| Kerberos & Delegation | Kerberoastable Accounts | Not Implemented | No roastability feature despite SPN collection | Missing privilege/etype analysis |
| Kerberos & Delegation | Unconstrained Delegation | Partially Implemented | Registry-only planned feature in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:359) | Not executable |
| Kerberos & Delegation | Constrained Delegation | Not Implemented | Registry bundle mentions it as planned in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:34) | No feature definition or analyzer |
| Kerberos & Delegation | Resource-Based Constrained Delegation | Not Implemented | Registry bundle mentions it as planned in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:36) | No feature definition or analyzer |
| Kerberos & Delegation | Duplicate SPN Detection | Not Implemented | No duplicate-SPN analyzer | Missing collision index/report |
| GPO & OU Security | OU Inventory | Not Implemented | No OU scan service or UI | Missing LDAP scope/objectClass traversal for OUs |
| GPO & OU Security | GPO Inventory | Not Implemented | No GPO query/parser | Missing CN=Policies support |
| GPO & OU Security | Recently Modified GPOs | Not Implemented | No GPO timestamps analytics | Missing source and analyzer |
| GPO & OU Security | Unlinked GPOs | Not Implemented | No GPO link analysis | Missing `gPLink` parsing |
| GPO & OU Security | GPO Ownership Validation | Not Implemented | No GPO ownership metadata analysis | Missing ownership extraction |
| GPO & OU Security | Privileged GPO Editors | Not Implemented | No ACL/GPO editor analysis | Missing DACL parser and GPO scope |
| GPO & OU Security | OU Permission Analysis | Not Implemented | No OU ACL parser | Missing OU permission model |
| Trust Analytics | Domain Trust Discovery | Not Implemented | No trust discovery module | Missing trustedDomain ingestion |
| Trust Analytics | Forest Trust Discovery | Not Implemented | No trust discovery module | Missing forest trust analysis |
| Trust Analytics | Trust Authentication Validation | Not Implemented | No trust-auth inspection logic | Missing trust property parser |
| Trust Analytics | Expired Trust Detection | Not Implemented | No trust lifecycle data or analyzer | Missing trust metadata model |

## Query Registry

- Centralized feature registry exists for posture features in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:50).
- This is not a centralized AD query registry of the requested kind:
  - No `AdQueryDefinition`
  - No `QueryRegistry`
  - No `LdapQueryRegistry`
  - No `QueryRepository`
  - No `ad_security_queries` table or collection found
- Static LDAP filters are embedded per feature in [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:63).
- Dynamic custom LDAP definitions are validated, but not executed, in [ldapFilterValidator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/ldapFilterValidator.js:62) and [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:240).

Assessment: Partial foundation only.

## Scan Execution Pipeline

| Component | Status | Evidence | Notes |
| ------ | ------ | ------ | ------ |
| Feature Selection Engine | Implemented | [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:419), [securityController.js](/d:/Work/Wisibility_IGA/icm-backend/src/controllers/securityController.js:153) | Selects executable feature IDs |
| Query Execution Manager | Partially Implemented | [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:109), [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:316) | Works for LDAP user fetch, but no generalized query engine |
| Result Normalizer | Implemented | [securityFindingsService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/securityFindingsService.js:18) | Flattens module findings for UI |
| Risk Scoring Engine | Not Implemented | Only severity normalization in [securityFindingsService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/securityFindingsService.js:8) | No numeric posture score, weights, or formulas |
| Temporary Storage Manager | Implemented | JSON snapshot store in [postureScanResultsStore.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureScanResultsStore.js:20) | Filesystem-backed only |
| Scan Scheduler | Not Implemented | Security scans are invoked manually via [securityController.js](/d:/Work/Wisibility_IGA/icm-backend/src/controllers/securityController.js:148) | No scheduled posture scan job found |

## Storage Layer

- Security posture scan results: JSON files in `icm-backend/src/data/scanResults` via [postureScanResultsStore.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureScanResultsStore.js:6).
- MongoDB exists elsewhere in the platform, but not as the storage of record for posture scan snapshots.
- No SQLite, PostgreSQL, Elasticsearch, or dedicated posture Mongo collection found for these results.

## Risk Engine

- Finding severity exists as categorical `riskLevel` and UI `severity` in [userAccountSecurity.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/userAccountSecurity.js:22) and [securityFindingsService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/security/securityFindingsService.js:32).
- Severity levels observed: `critical`, `high`, `medium`, `low`.
- No posture scoring formula, weights, security rating, or aggregate numeric risk score exists in the posture/security scan path.

Assessment: severity tagging exists; risk scoring engine does not.

## UI Implementation

| UI Requirement | Status | Evidence | Gap |
| ------ | ------ | ------ | ------ |
| Security Posture Dashboard | Implemented | [SecurityDashboard.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/dashboard/SecurityDashboard.jsx:28) | Focused on current findings, not full AD framework coverage |
| Feature Selection Screen | Partially Implemented | Feature discovery API exists in [securityApi.js](/d:/Work/Wisibility_IGA/icm-frontend/src/services/securityApi.js:28) | No dedicated UI to choose scan features before running |
| Risk Findings Table | Implemented | [FindingsExplorer.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/findings/FindingsExplorer.jsx:23), [FindingsTable.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/components/security/FindingsTable.jsx:55) | None |
| Scan History | Implemented | [ScanCenter.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/scans/ScanCenter.jsx:40) | None |
| Risk Trends | Not Implemented | Dashboard shows snapshot distribution only in [SecurityDashboard.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/dashboard/SecurityDashboard.jsx:174) | No time-series trend view for posture scans |
| Export Functionality | Not Implemented | No export action in Security Center pages | Missing CSV/PDF/API export |

Additional implemented views:

- Group intelligence: [GroupIntelligenceView.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/groups/GroupIntelligenceView.jsx:21)
- Privileged access: [PrivilegedAccessView.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/privileged/PrivilegedAccessView.jsx:19)
- Drilldown drawer with path rendering: [RiskDrilldownDrawer.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/components/security/RiskDrilldownDrawer.jsx:18)

## Missing Components

### Critical Missing Features

- Real ACL parsing and security descriptor analysis
- Kerberos risk analytics: pre-auth disabled, AS-REP roastable, Kerberoastable
- Delegation analytics as executable features: unconstrained, constrained, RBCD
- Computer security analytics: stale/disabled/unsupported/misplaced servers
- GPO and OU security analytics
- Trust discovery and validation
- Scan scheduler for recurring posture scans
- Risk scoring engine with weighted scoring

### Medium Priority Features

- Accounts without manager
- Expiring accounts
- DES encryption enabled
- Duplicate SPN detection
- Full privileged-group catalog coverage including `DnsAdmins`, `Print Operators`, `Remote Desktop Users`, `Group Policy Creator Owners`
- Export/reporting
- Risk trends
- Centralized executable AD query registry

### Low Priority Features

- Enabled-user and enabled-computer inventory findings
- Shared account heuristics
- Foreign security principal inventory
- Explicit unused privileged group inventory

## MVP Readiness Assessment

MVP Ready = NO

Reasoning:

- Supported today:
  - Disabled Users
  - Inactive Users
  - Privileged Users and escalation-style paths
  - Password Never Expires
  - Empty Groups
  - Nested Groups
- Not supported today:
  - Stale Computers
  - Executable Delegation Risks
- The requested MVP explicitly includes stale computers and delegation risks, and both are missing from executable scan logic.

## Final Roadmap

### Phase 1 (MVP)

- Add executable `computer_security` module using already-ingested computer LDAP data.
- Implement:
  - enabled/disabled/inactive computers
  - missing OS
  - unsupported OS
  - duplicate SPN detection
- Promote delegation items from registry-only to executable features:
  - unconstrained delegation
  - constrained delegation
  - RBCD
- Add feature-selection UI before scan launch, reusing feature discovery API.

Complexity: Medium-High

Dependencies:

- Existing LDAP connector and directory fetch path
- Existing posture registry and orchestrator
- Existing findings UI

Reusable Components:

- [adLdapService.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/adLdapService.js:367)
- [postureFeatureRegistry.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureFeatureRegistry.js:50)
- [postureOrchestrator.js](/d:/Work/Wisibility_IGA/icm-backend/src/services/posture/postureOrchestrator.js:158)
- [FindingsExplorer.jsx](/d:/Work/Wisibility_IGA/icm-frontend/src/pages/security/findings/FindingsExplorer.jsx:23)

New Components Required:

- `computerSecurity.js`
- delegation analyzers
- feature-selector UI

### Phase 2 (Advanced Analytics)

- Implement authentication risk features:
  - pre-auth disabled
  - AS-REP roastable
  - Kerberoastable
- Add explicit privileged-group inventory and broaden known built-in group list.
- Add SID history analyzer, foreign security principals, duplicate SPN report.
- Add export endpoints and UI.
- Add posture trend snapshots.

Complexity: High

Dependencies:

- Better LDAP attribute coverage
- Possibly event/log telemetry for NTLM and spray-style detections

### Phase 3 (Enterprise Features)

- Implement real ACL parsing from security descriptors and OU/GPO permission analysis.
- Add GPO inventory, linkage, ownership, privileged editors.
- Add domain/forest trust analytics.
- Introduce a persistent posture results data model in MongoDB and a scheduled posture scan engine.
- Build aggregate scoring and rating framework.

Complexity: Very High

Dependencies:

- Security descriptor acquisition/parsing
- Expanded AD object coverage
- Persistent storage redesign
- Scheduler/orchestration model for recurring scans

## Bottom Line

This codebase already has a credible foundation for AD security posture scanning, but it is currently a focused subset centered on:

- LDAP user account checks
- graph-based group hygiene
- privileged path analysis
- heuristic shadow-admin and orphan-SID findings
- snapshot-style UI and JSON result storage

It is not yet a complete Active Directory Security Posture Framework implementation, and the most important missing areas are computers, delegation, Kerberos/authentication, real ACL parsing, GPO/OU, trust analytics, scheduling, and scoring.



# AD Commands

## Domain Admin Steps

### These are used to connect to remote powershell session

Step 1: Create the credential object
```powershell
$username = "WISIBILITY\Administrator"
$password = ConvertTo-SecureString "P@ssw0rd" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($username, $password)
```
**password : P@ssw0rd**

Step 2: Connect using the server name
```powershell
Enter-PSSession `
    -ComputerName 192.168.68.107 `
    -Credential $cred `
    -Authentication Negotiate
```

## LDAP account query

### These are used for groups and all which do not require domain admin permissions
```powershell
$username = "icmadmin@wisibility.lcl"
$password = Read-Host "Password" -AsSecureString

$cred = New-Object System.Management.Automation.PSCredential($username,$password)

Get-ADUser -Identity icmadmin -Server 192.168.68.107 -Credential $cred
```

**password : gSo4|2@22*Gg**
# Now you can verify your Wisibility findings using PowerShell directly from your laptop.

For every command below, **append**:

```powershell
-Server 192.168.68.107 -Credential $cred
```

so that the cmdlet authenticates against your domain controller.

---

# 1. Disabled Users

```powershell
Get-ADUser `
-Filter 'Enabled -eq $False' `
-Properties Enabled `
-Server 192.168.68.107 `
-Credential $cred |
Select Name,SamAccountName,Enabled
```

---

# 2. Inactive Users (90 days)

```powershell
$days = 90
$date = (Get-Date).AddDays(-$days)

Get-ADUser `
-Filter * `
-Properties LastLogonDate `
-Server 192.168.68.107 `
-Credential $cred |
Where-Object {
    $_.LastLogonDate -lt $date
} |
Select Name,SamAccountName,LastLogonDate
```

---

# 3. Password Never Expires

```powershell
Get-ADUser `
-Filter * `
-Properties PasswordNeverExpires `
-Server 192.168.68.107 `
-Credential $cred |
Where-Object {
    $_.PasswordNeverExpires
} |
Select Name,SamAccountName
```

---

# 4. Password Not Required

```powershell
Get-ADUser `
-LDAPFilter "(userAccountControl:1.2.840.113556.1.4.803:=32)" `
-Server 192.168.68.107 `
-Credential $cred |
Select Name,SamAccountName
```

---

# 5. Service Accounts

```powershell
Get-ADUser `
-LDAPFilter "(servicePrincipalName=*)" `
-Properties ServicePrincipalName `
-Server 192.168.68.107 `
-Credential $cred |
Select Name,SamAccountName,ServicePrincipalName
```

---

# 6. Privileged Users

```powershell
$groups = @(
"Domain Admins",
"Enterprise Admins",
"Schema Admins",
"Administrators",
"Account Operators",
"Server Operators",
"Backup Operators",
"Print Operators"
)

foreach($g in $groups)
{
    Get-ADGroupMember $g -Recursive `
    -Server 192.168.68.107 `
    -Credential $cred |
    Select @{Name="Group";Expression={$g}},Name,SamAccountName,ObjectClass
}
```

---

# 7. Empty Groups

```powershell
Get-ADGroup `
-Filter * `
-Server 192.168.68.107 `
-Credential $cred |
Where-Object {
    (Get-ADGroupMember $_ `
        -Server 192.168.68.107 `
        -Credential $cred `
        -ErrorAction SilentlyContinue).Count -eq 0
} |
Select Name,SamAccountName
```

---

# 8. Nested Groups

```powershell
Get-ADGroup `
-Filter * `
-Server 192.168.68.107 `
-Credential $cred |
ForEach-Object {

    $parent = $_

    Get-ADGroupMember $parent `
        -Server 192.168.68.107 `
        -Credential $cred |
    Where-Object {
        $_.objectClass -eq "group"
    } |
    Select @{Name="Parent";Expression={$parent.Name}},Name
}
```

---

# 9. Dormant Computers

```powershell
$days = 90
$date = (Get-Date).AddDays(-$days)

Get-ADComputer `
-Filter * `
-Properties LastLogonDate `
-Server 192.168.68.107 `
-Credential $cred |
Where-Object {
    $_.LastLogonDate -lt $date
} |
Select Name,LastLogonDate
```

---

# 10. Unconstrained Delegation

```powershell
Get-ADComputer `
-Filter {TrustedForDelegation -eq $true} `
-Properties TrustedForDelegation `
-Server 192.168.68.107 `
-Credential $cred |
Select Name
```

---

# 11. AS-REP Roastable

```powershell
Get-ADUser `
-LDAPFilter "(userAccountControl:1.2.840.113556.1.4.803:=4194304)" `
-Properties DoesNotRequirePreAuth `
-Server 192.168.68.107 `
-Credential $cred |
Select Name,SamAccountName
```

---

# 12. Kerberoastable Accounts

```powershell
Get-ADUser `
-LDAPFilter "(servicePrincipalName=*)" `
-Properties ServicePrincipalName `
-Server 192.168.68.107 `
-Credential $cred |
Select Name,SamAccountName,ServicePrincipalName
```

---

## Recommendation for your validation work

Since you're validating your Wisibility platform, I'd suggest this workflow for each feature:

1. Seed or identify a known condition in your AD.
2. Run your Wisibility scan.
3. Run the corresponding PowerShell verification command above.
4. Compare:

   * Total count
   * `SamAccountName`
   * Distinguished Name
   * Relevant attributes (such as `LastLogonDate` or `ServicePrincipalName`)
5. Investigate any mismatches.

At this point, your laptop is fully capable of performing AD PowerShell validation over the VPN using the credentials you've been given.

I can also provide the remaining verification scripts (Locked Accounts, Orphan SIDs, Shadow Admins, SID History, ACL analysis, GPO analysis, Trusts, etc.) with the same `-Server` and `-Credential` pattern, and note which ones require higher privileges versus those that work with your current account.
