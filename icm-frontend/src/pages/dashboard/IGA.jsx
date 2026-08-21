import { memo, useDeferredValue, useMemo, useState } from "react";

const PHASES = [
    {
        id: "P1", name: "Connectors & App Foundation", sprint: "S1", quarter: "Q2 2026",
        color: "#E74C3C", icon: "🔌",
        goal: "Replace CSV-only intake with live connectors, application registry, schema management",
        domains: ["Application", "Account & Entitlement", "Schema Mgmt", "Connector Mgmt", "Sync Scheduler", "Realtime Events"],
        frCount: 125, newCount: 90, reuseCount: 35,
        sailpointParity: "Application registry, ConnectorConfig, ApplicationSchema, GlobalSchema, AccountAggregation",
        frontendIntegration: [
            "Application Registry CRUD pages with risk-rating badges",
            "Connector Configuration wizard (multi-step form)",
            "Schema Builder drag-and-drop UI",
            "Real-time sync status WebSocket dashboard",
            "Upload History table with AI quality scores"
        ],
        dataModels: [
            { name: "Application", file: "Application.js", fields: "name, type, owner, riskRating, complianceFlags, tenantId, isActive", status: "REUSE", fk: "owner→User, type→ApplicationType" },
            { name: "ConnectorConfig", file: "ConnectorConfig.js", fields: "appId, connectorType, schedule, lastRun, status, credentials(encrypted)", status: "NEW", fk: "appId→Application" },
            { name: "ApplicationSchema", file: "ApplicationSchema.js", fields: "appId, objectType, attributes[], nativeType, displayAttribute", status: "NEW", fk: "appId→Application" },
            { name: "GlobalSchema", file: "GlobalSchema.js", fields: "name, version, attributes[], mappingRules", status: "NEW", fk: "—" },
            { name: "AccountAggregation", file: "AccountAggregation.js", fields: "appId, status, startTime, endTime, totalAccounts, errors[], stats", status: "NEW", fk: "appId→Application" },
            { name: "ConnectorMgmt", file: "ConnectorMgmt.js", fields: "type, version, capabilities, configSchema, healthCheck", status: "NEW", fk: "—" },
            { name: "SyncScheduler", file: "SyncScheduler.js", fields: "connectorId, cronExpr, lastRun, nextRun, status, retryPolicy", status: "NEW", fk: "connectorId→ConnectorConfig" },
            { name: "RealtimeEvents", file: "RealtimeEvents.js", fields: "source, eventType, payload, timestamp, processed, correlationId", status: "NEW", fk: "—" },
        ],
        keyAPIs: [
            { method: "GET", endpoint: "/api/applications", fn: "List Applications", auth: "admin,appOwner" },
            { method: "POST", endpoint: "/api/applications", fn: "Create Application", auth: "admin" },
            { method: "POST", endpoint: "/api/connectors/config", fn: "Configure Connector", auth: "admin" },
            { method: "POST", endpoint: "/api/connectors/test", fn: "Test Connectivity", auth: "admin" },
            { method: "POST", endpoint: "/api/aggregation/trigger", fn: "Trigger Aggregation", auth: "admin" },
            { method: "GET", endpoint: "/api/schema/global", fn: "Get Global Schema", auth: "admin" },
            { method: "POST", endpoint: "/api/schema/builder", fn: "Build Schema", auth: "admin" },
            { method: "GET", endpoint: "/api/sync/status", fn: "Sync Status (WS)", auth: "admin" },
        ],
    },
    {
        id: "P2", name: "Identity Lifecycle & Correlation", sprint: "S1–S2", quarter: "Q2–Q3 2026",
        color: "#3498DB", icon: "👤",
        goal: "Full identity lifecycle with JML states, correlation engine, NHI detection, manager hierarchy",
        domains: ["Identity", "Detection & NHI", "Identity & account correlation"],
        frCount: 115, newCount: 65, reuseCount: 46, enhanceCount: 4,
        sailpointParity: "IdentityIQ core identity, Account correlation, NHI Detection (EXCEEDS), Manager hierarchy",
        frontendIntegration: [
            "Identity 360° Profile page (tabbed: attributes, accounts, entitlements, violations, history)",
            "Bulk Import wizard with progress bar + error report",
            "Manager Hierarchy org-chart visualization (D3 tree)",
            "NHI Detection dashboard with confidence scores + rule config",
            "Identity & account correlation results with match indicators",
            "Identity Search with advanced filters (department, status, risk)"
        ],
        dataModels: [
            { name: "SodUserIdentity", file: "SodUserIdentity.js", fields: "firstName, lastName, email, department, title, manager, lifecycleState, riskScore, isNHI, identityType, source", status: "ENHANCE", fk: "manager→SodUserIdentity" },
            { name: "IdentityProfile", file: "IdentityProfile.js", fields: "name, description, jobTitle, department, accessTemplate, autoAssignRoles", status: "REUSE", fk: "—" },
            { name: "IdentityAccountLink", file: "IdentityAccountLink.js", fields: "identityId, accountId, appId, correlationMethod, matchScore, status", status: "NEW", fk: "identityId→SodUserIdentity, appId→Application" },
            { name: "ManagerHierarchy", file: "ManagerHierarchy.js", fields: "identityId, managerId, skipManager, depth, effectiveDate", status: "NEW", fk: "identityId→SodUserIdentity, managerId→SodUserIdentity" },
            { name: "LifecycleEvent", file: "LifecycleEvent.js", fields: "identityId, eventType(JML), previousState, newState, triggeredBy, automatedActions", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "DetectionRuleSet", file: "DetectionRuleSet.js", fields: "ruleType, name, conditions[], confidenceThreshold, action, isActive", status: "ENHANCE", fk: "—" },
            { name: "NHIProfile", file: "NHIProfile.js", fields: "identityId, nhiType, owner, expiryDate, lastActivity, riskLevel", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "CorrelationRule", file: "CorrelationRule.js", fields: "appId, matchAttributes[], algorithm, threshold, priority", status: "NEW", fk: "appId→Application" },
            { name: "CorrelationResult", file: "CorrelationResult.js", fields: "identityId, accountId, ruleId, score, status, reviewedBy", status: "NEW", fk: "identityId→SodUserIdentity" },
        ],
        keyAPIs: [
            { method: "GET", endpoint: "/api/profiles", fn: "List Identities", auth: "admin,certAdmin" },
            { method: "POST", endpoint: "/api/profiles/bulk", fn: "Bulk Import", auth: "admin" },
            { method: "POST", endpoint: "/api/profiles/:id/lifecycle", fn: "Trigger JML Event", auth: "system" },
            { method: "GET", endpoint: "/api/profiles/:id/360", fn: "Identity 360° View", auth: "admin" },
            { method: "GET", endpoint: "/api/hierarchy/:id", fn: "Manager Chain", auth: "admin" },
            { method: "POST", endpoint: "/api/detection/scan", fn: "Run NHI Detection", auth: "admin" },
            { method: "GET", endpoint: "/api/correlation/results", fn: "Correlation Results", auth: "admin" },
            { method: "POST", endpoint: "/api/correlation/manual", fn: "Manual Correlate", auth: "admin" },
        ],
    },
    {
        id: "P3", name: "Provisioning Engine", sprint: "S2–S3", quarter: "Q3 2026",
        color: "#2ECC71", icon: "⚙️",
        goal: "Automated provisioning/deprovisioning with approval workflows, lifecycle-driven actions",
        domains: ["Provisioning", "Provisioning Policy", "Identity (lifecycle)"],
        frCount: 66, newCount: 66,
        sailpointParity: "ProvisioningPlan, ProvisioningTask, AccessRequest, WorkflowDefinition, DeprovisioningRecord",
        frontendIntegration: [
            "Access Request shopping cart UI (search → select → submit → track)",
            "Approval Workflow builder (visual drag-and-drop)",
            "Provisioning Dashboard with real-time task status",
            "Deprovisioning confirmation modal with impact analysis",
            "Provisioning Policy editor with condition builder",
            "My Requests tracker with timeline view"
        ],
        dataModels: [
            { name: "ProvisioningRequest", file: "ProvisioningRequest.js", fields: "identityId, requestType, items[], approvalStatus, requestedBy, priority", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "ProvisioningPlan", file: "ProvisioningPlan.js", fields: "requestId, steps[], status, retryCount, scheduledAt, completedAt", status: "NEW", fk: "requestId→ProvisioningRequest" },
            { name: "ProvisioningTask", file: "ProvisioningTask.js", fields: "planId, appId, operation, accountAttributes, status, error, attempts", status: "NEW", fk: "planId→ProvisioningPlan, appId→Application" },
            { name: "AccessRequest", file: "AccessRequest.js", fields: "identityId, requestedItems[], justification, approvers[], status, decisions[]", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "WorkflowDefinition", file: "WorkflowDefinition.js", fields: "name, trigger, steps[], conditions[], approvalLevels, escalation", status: "NEW", fk: "—" },
            { name: "WorkflowInstance", file: "WorkflowInstance.js", fields: "definitionId, triggerId, currentStep, state, startedAt, completedAt", status: "NEW", fk: "definitionId→WorkflowDefinition" },
            { name: "ProvisioningPolicy", file: "ProvisioningPolicy.js", fields: "appId, operation, conditions[], defaultAction, approvalRequired", status: "NEW", fk: "appId→Application" },
            { name: "DeprovisioningRecord", file: "DeprovisioningRecord.js", fields: "identityId, appId, reason, revokedEntitlements[], completedAt", status: "NEW", fk: "identityId→SodUserIdentity" },
        ],
        keyAPIs: [
            { method: "POST", endpoint: "/api/access-requests", fn: "Submit Access Request", auth: "all" },
            { method: "GET", endpoint: "/api/access-requests/mine", fn: "My Requests", auth: "all" },
            { method: "PUT", endpoint: "/api/access-requests/:id/approve", fn: "Approve Request", auth: "approver" },
            { method: "POST", endpoint: "/api/provisioning/execute", fn: "Execute Plan", auth: "system" },
            { method: "GET", endpoint: "/api/provisioning/tasks", fn: "Task Dashboard", auth: "admin" },
            { method: "POST", endpoint: "/api/workflows", fn: "Create Workflow", auth: "admin" },
            { method: "POST", endpoint: "/api/deprovisioning/trigger", fn: "Deprovision", auth: "admin,system" },
        ],
    },
    {
        id: "P4", name: "Role Management & Mining", sprint: "S3", quarter: "Q3 2026",
        color: "#9B59B6", icon: "🏗️",
        goal: "Role engineering, hierarchy, mining, request/approval flow, compliance mapping",
        domains: ["Role", "Provisioning (role requests)"],
        frCount: 19, newCount: 19,
        sailpointParity: "RoleEngineering, RoleHierarchy, RoleMining, RoleAssignment, ApprovalWorkflow",
        frontendIntegration: [
            "Role Catalog browser with hierarchy tree view",
            "Role Mining wizard (select population → analyze → suggest → create)",
            "Role Request form with SoD pre-check",
            "Role Entitlement matrix editor (role × entitlement grid)",
            "Approval Queue with bulk approve/reject",
            "Role Compliance mapping dashboard"
        ],
        dataModels: [
            { name: "RoleEngineering", file: "RoleEngineering.js", fields: "name, description, roleType, owner, isActive, entitlements[], criteria", status: "ENHANCE", fk: "owner→User" },
            { name: "RoleEntitlement", file: "RoleEntitlement.js", fields: "roleId, entitlementId, appId, isRequired, provisioningAction", status: "NEW", fk: "roleId→RoleEngineering, entitlementId→Entitlement" },
            { name: "RoleHierarchy", file: "RoleHierarchy.js", fields: "parentRoleId, childRoleId, inheritEntitlements", status: "NEW", fk: "parentRoleId→RoleEngineering" },
            { name: "RoleRequest", file: "RoleRequest.js", fields: "identityId, roleId, justification, approvers[], status, sodCheckResult", status: "NEW", fk: "identityId→SodUserIdentity, roleId→RoleEngineering" },
            { name: "RoleMiningResult", file: "RoleMiningResult.js", fields: "population, suggestedRoles[], confidence, entitlementClusters", status: "NEW", fk: "—" },
            { name: "ApprovalWorkflow", file: "ApprovalWorkflow.js", fields: "entityType, entityId, approvers[], decisions[], status, escalatedAt", status: "NEW", fk: "—" },
        ],
        keyAPIs: [
            { method: "GET", endpoint: "/api/roles", fn: "List Roles", auth: "admin,certAdmin" },
            { method: "POST", endpoint: "/api/roles/mine", fn: "Run Role Mining", auth: "admin" },
            { method: "POST", endpoint: "/api/role-requests", fn: "Submit Role Request", auth: "all" },
            { method: "PUT", endpoint: "/api/role-requests/:id/approve", fn: "Approve Role Request", auth: "approver" },
            { method: "GET", endpoint: "/api/roles/:id/entitlements", fn: "Role Entitlements", auth: "admin" },
        ],
    },
    {
        id: "P5", name: "SoD Policy Engine", sprint: "S3–S4", quarter: "Q3–Q4 2026",
        color: "#E67E22", icon: "🛡️",
        goal: "Full SoD evaluation cycle: policies, rules, violations, exceptions, risk scoring, remediation",
        domains: ["SoD", "Role (SoD checks)", "Identity (violations)", "Account & Entitlement (risk)"],
        frCount: 112, newCount: 53, reuseCount: 58,
        sailpointParity: "SoD Policy, SoD Rule evaluation, Violation detection, Exception management, Risk scoring (EXCEEDS)",
        frontendIntegration: [
            "SoD Policy builder with visual rule composer",
            "Violation Dashboard with severity heatmap",
            "Exception Request/Approval workflow UI",
            "Risk Score widget on Identity 360° page",
            "Policy Impact Analysis preview before activation",
            "SoD Audit Log viewer with filter/export",
            "Entitlement conflict matrix visualization"
        ],
        dataModels: [
            { name: "SodPolicy", file: "SodPolicy.js", fields: "name, description, status, severity, conflictType, ruleSetId, owner", status: "REUSE", fk: "ruleSetId→SodRuleSet, owner→User" },
            { name: "SodRuleSet", file: "SodRuleSet.js", fields: "policyId, ruleType, rules[], evaluationLogic(AND|OR)", status: "REUSE", fk: "policyId→SodPolicy" },
            { name: "SodViolation", file: "SodViolation.js", fields: "identityId, policyId, conflictingEntitlements[], severity, status, detectedAt", status: "REUSE", fk: "identityId→SodUserIdentity, policyId→SodPolicy" },
            { name: "SodException", file: "SodException.js", fields: "violationId, justification, approvedBy, expiryDate, compensatingControls", status: "REUSE", fk: "violationId→SodViolation" },
            { name: "SodRiskScore", file: "SodRiskScore.js", fields: "identityId, overallScore, factors[], lastCalculated, trend", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "SodRemediationAction", file: "SodRemediationAction.js", fields: "violationId, actionType, targetEntitlement, status, executedBy", status: "NEW", fk: "violationId→SodViolation" },
            { name: "SodPolicyImpactAnalysis", file: "SodPolicyImpactAnalysis.js", fields: "policyId, affectedIdentities, potentialViolations, impactScore", status: "NEW", fk: "policyId→SodPolicy" },
        ],
        keyAPIs: [
            { method: "GET", endpoint: "/api/sod/policies", fn: "List Policies", auth: "sodAdmin" },
            { method: "POST", endpoint: "/api/sod/policies", fn: "Create Policy", auth: "sodAdmin" },
            { method: "POST", endpoint: "/api/sod/evaluate", fn: "Evaluate SoD", auth: "system" },
            { method: "GET", endpoint: "/api/sod/violations", fn: "List Violations", auth: "sodAdmin,certAdmin" },
            { method: "POST", endpoint: "/api/sod/exceptions", fn: "Request Exception", auth: "all" },
            { method: "GET", endpoint: "/api/sod/risk-scores/:id", fn: "Get Risk Score", auth: "admin" },
            { method: "POST", endpoint: "/api/sod/impact-analysis", fn: "Impact Analysis", auth: "sodAdmin" },
        ],
    },
    {
        id: "P6", name: "Access Certification", sprint: "S4", quarter: "Q4 2026",
        color: "#1ABC9C", icon: "✅",
        goal: "4 campaign types, email-token reviews, bulk decisions, sign-off, escalation, scheduling",
        domains: ["Access Cert", "Provisioning (cert-driven)"],
        frCount: 59, newCount: 36, reuseCount: 23,
        sailpointParity: "Campaign types, Certification results, Email decisions, Scheduling, Escalation, Sign-off",
        frontendIntegration: [
            "Campaign Creation wizard (type → scope → reviewers → schedule)",
            "Reviewer Inbox with bulk approve/revoke/reassign",
            "Email-token click-through decision landing page",
            "Campaign Progress dashboard with completion % per reviewer",
            "Sign-off page with digital signature + attestation",
            "Certification Report builder with export to PDF"
        ],
        dataModels: [
            { name: "Campaign", file: "Campaign.js", fields: "name, type(MANAGER|APP_OWNER|ENTITLEMENT|ROLE), status, startDate, endDate, reviewers[], scope", status: "REUSE", fk: "—" },
            { name: "Result", file: "Result.js", fields: "campaignId, identityId, entitlementId, decision, reviewer, decidedAt, comments", status: "REUSE", fk: "campaignId→Campaign, identityId→SodUserIdentity" },
            { name: "EmailDecisionToken", file: "EmailDecisionToken.js", fields: "resultId, token, decision, expiresAt, usedAt", status: "REUSE", fk: "resultId→Result" },
            { name: "CertificationSchedule", file: "CertificationSchedule.js", fields: "campaignTemplateId, cronExpr, nextRun, isActive", status: "NEW", fk: "—" },
            { name: "CertificationEscalation", file: "CertificationEscalation.js", fields: "campaignId, reviewerId, escalatedTo, reason, escalatedAt", status: "NEW", fk: "campaignId→Campaign" },
            { name: "CertSignOff", file: "CertSignOff.js", fields: "campaignId, signedBy, attestation, signature, signedAt", status: "NEW", fk: "campaignId→Campaign" },
        ],
        keyAPIs: [
            { method: "POST", endpoint: "/api/certifications/campaigns", fn: "Create Campaign", auth: "certAdmin" },
            { method: "GET", endpoint: "/api/certifications/inbox", fn: "Reviewer Inbox", auth: "reviewer" },
            { method: "PATCH", endpoint: "/api/certifications/decisions/bulk", fn: "Bulk Decision", auth: "reviewer" },
            { method: "POST", endpoint: "/api/certifications/signoff", fn: "Sign Off", auth: "certAdmin" },
            { method: "GET", endpoint: "/api/certifications/email-decide/:token", fn: "Email Decision", auth: "public" },
            { method: "GET", endpoint: "/api/certifications/report/:id", fn: "Campaign Report", auth: "certAdmin" },
        ],
    },
    {
        id: "P7", name: "Platform, Compliance & Intelligence", sprint: "S4+", quarter: "Q4 2026+",
        color: "#34495E", icon: "🧠",
        goal: "Platform foundation, audit/compliance, governance, branding, integrations, data hygiene, analytics",
        domains: ["Platform & Auth", "Audit & Compliance", "Governance & Risk", "Scheduler & Jobs", "Branding & UI", "Platform Integrations", "Data Hygiene", "Access Intelligence", "Email & Notifications"],
        frCount: 230, newCount: 188, reuseCount: 38, enhanceCount: 4,
        sailpointParity: "Compliance frameworks, SIEM integration, Webhooks, Data retention, Access intelligence, Risk trends",
        frontendIntegration: [
            "Admin Settings panel (tenant config, password policy, MFA)",
            "Compliance Framework mapper (SOX, GDPR, HIPAA → controls)",
            "Unified Audit Log viewer with advanced search + export",
            "Governance Policy editor with approval chain",
            "Branding customizer (logo, colors, themes)",
            "Analytics Dashboard with risk trends, access outliers, peer analysis",
            "SIEM/Webhook integration config panel",
            "Data Hygiene findings report with remediation actions",
            "Email template editor with Handlebars preview"
        ],
        dataModels: [
            { name: "User", file: "User.js", fields: "firstName, lastName, email, password(bcrypt), role, isActive, mfaEnabled, lastLogin", status: "REUSE", fk: "createdBy→User" },
            { name: "TenantConfig", file: "TenantConfig.js", fields: "tenantId, name, features[], ssoConfig, branding, limits", status: "NEW", fk: "—" },
            { name: "ComplianceFramework", file: "ComplianceFramework.js", fields: "name, version, controls[], mappings[], isActive", status: "NEW", fk: "—" },
            { name: "UnifiedAuditEvent", file: "UnifiedAuditEvent.js", fields: "actor, action, resource, result, ipAddress, timestamp, metadata", status: "NEW", fk: "actor→User" },
            { name: "GovernancePolicy", file: "GovernancePolicy.js", fields: "name, type, conditions[], actions[], owner, status, effectiveDate", status: "NEW", fk: "owner→User" },
            { name: "WebhookConfig", file: "WebhookConfig.js", fields: "url, events[], secret, isActive, retryPolicy, lastDelivery", status: "NEW", fk: "—" },
            { name: "SIEMConfig", file: "SIEMConfig.js", fields: "type(Splunk|ELK|QRadar), endpoint, format, filters[], isActive", status: "NEW", fk: "—" },
            { name: "AccessOutlier", file: "AccessOutlier.js", fields: "identityId, outlierType, score, peerGroupId, details, status", status: "NEW", fk: "identityId→SodUserIdentity" },
            { name: "RiskTrendSnapshot", file: "RiskTrendSnapshot.js", fields: "date, overallRisk, byDomain, topRisks[], trend", status: "NEW", fk: "—" },
        ],
        keyAPIs: [
            { method: "POST", endpoint: "/api/auth/register", fn: "Register User", auth: "admin" },
            { method: "POST", endpoint: "/api/auth/login", fn: "Login", auth: "all" },
            { method: "GET", endpoint: "/api/audit/events", fn: "Query Audit Log", auth: "auditor,admin" },
            { method: "POST", endpoint: "/api/compliance/frameworks", fn: "Create Framework", auth: "admin" },
            { method: "POST", endpoint: "/api/webhooks", fn: "Register Webhook", auth: "admin" },
            { method: "GET", endpoint: "/api/analytics/risk-trends", fn: "Risk Trends", auth: "admin" },
            { method: "GET", endpoint: "/api/analytics/outliers", fn: "Access Outliers", auth: "admin" },
            { method: "POST", endpoint: "/api/data-hygiene/scan", fn: "Run Hygiene Scan", auth: "admin" },
        ],
    },
];

const ARCHITECTURE_LAYERS = [
    { name: "React Frontend", tech: "React 18 + Tailwind + Zustand + React Query", color: "#3498DB" },
    { name: "API Gateway", tech: "Express.js + JWT + Rate Limiter + CORS", color: "#2ECC71" },
    { name: "Service Layer", tech: "Domain Services + CQRS pattern + Event Bus", color: "#E67E22" },
    { name: "Data Layer", tech: "Mongoose ODM + MongoDB Atlas + Redis Cache", color: "#9B59B6" },
    { name: "Integration Layer", tech: "Connector Framework + Webhooks + SIEM + IdP", color: "#E74C3C" },
];

const METHOD_COLORS = { GET: "#3498DB", POST: "#2ECC71", PUT: "#E67E22", DELETE: "#E74C3C", PATCH: "#9B59B6" };

const MethodBadge = memo(function MethodBadge({ method }) {
    return (
        <span style={{ background: METHOD_COLORS[method] || "#666", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, fontFamily: "monospace" }}>
            {method}
        </span>
    );
});

const StatusBadge = memo(function StatusBadge({ status }) {
    const colors = { NEW: "#E74C3C", REUSE: "#2ECC71", ENHANCE: "#E67E22" };
    return (
        <span style={{ background: `${colors[status] || "#666"}22`, color: colors[status] || "#666", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, border: `1px solid ${colors[status] || "#666"}44` }}>
            {status}
        </span>
    );
});

const PhaseCard = memo(function PhaseCard({ phase, isSelected, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: isSelected ? `${phase.color}15` : "var(--bg-card)",
                border: `2px solid ${isSelected ? phase.color : "var(--border)"}`,
                borderRadius: 12,
                padding: "14px 16px",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
                width: "100%",
                position: "relative",
                overflow: "hidden",
            }}
        >
            {isSelected && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: phase.color }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{phase.icon}</span>
                <span style={{ fontWeight: 700, color: phase.color, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{phase.id}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto", background: "var(--bg-code)", padding: "2px 6px", borderRadius: 4 }}>{phase.quarter}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.3 }}>{phase.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>{phase.frCount} FRs · {phase.domains.length} domains</div>
        </button>
    );
});

const DataModelTable = memo(function DataModelTable({ models }) {
    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                    <tr style={{ background: "var(--bg-code)" }}>
                        {["Collection", "Mongoose File", "Status", "Key Fields", "FK Dependencies"].map(h => (
                            <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-primary)", borderBottom: "2px solid var(--border)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {models.map((m, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{m.name}</td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>{m.file}</td>
                            <td style={{ padding: "10px 12px" }}><StatusBadge status={m.status} /></td>
                            <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)", maxWidth: 300, lineHeight: 1.5 }}>
                                <code style={{ background: "var(--bg-code)", padding: "1px 4px", borderRadius: 3, fontSize: 11, wordBreak: "break-all" }}>{m.fields}</code>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)", fontFamily: "monospace" }}>{m.fk}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
});

const APITable = memo(function APITable({ apis }) {
    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                    <tr style={{ background: "var(--bg-code)" }}>
                        {["Method", "Endpoint", "Function", "Auth Roles"].map(h => (
                            <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-primary)", borderBottom: "2px solid var(--border)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {apis.map((a, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "8px 12px" }}><MethodBadge method={a.method} /></td>
                            <td style={{ padding: "8px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--accent)" }}>{a.endpoint}</td>
                            <td style={{ padding: "8px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{a.fn}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-dim)" }}>{a.auth}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
});

function ProgressBar({ label, value, max, color }) {
    const pct = Math.round((value / max) * 100);
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span style={{ fontWeight: 600, color }}>{value} <span style={{ color: "var(--text-dim)" }}>/ {max}</span></span>
            </div>
            <div style={{ height: 6, background: "var(--bg-code)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
            </div>
        </div>
    );
}

export default function SailPointIGAGuide() {
    const [selectedPhase, setSelectedPhase] = useState("P1");
    const [activeTab, setActiveTab] = useState("overview");
    const [searchTerm, setSearchTerm] = useState("");
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const phase = useMemo(
        () => PHASES.find((p) => p.id === selectedPhase) || PHASES[0],
        [selectedPhase],
    );

    const totals = useMemo(
        () =>
            PHASES.reduce(
                (acc, p) => {
                    acc.totalFRs += p.frCount;
                    acc.totalNew += p.newCount || 0;
                    acc.totalReuse += p.reuseCount || 0;
                    acc.totalModels += p.dataModels.length;
                    return acc;
                },
                { totalFRs: 0, totalNew: 0, totalReuse: 0, totalModels: 0 },
            ),
        [],
    );

    const headerStats = useMemo(
        () => [
            { label: "Total FRs", value: totals.totalFRs, color: "#3b82f6" },
            { label: "New Build", value: totals.totalNew, color: "#ef4444" },
            { label: "Reuse", value: totals.totalReuse, color: "#22c55e" },
            { label: "Data Models", value: totals.totalModels, color: "#a855f7" },
            { label: "Phases", value: 7, color: "#f59e0b" },
            { label: "SailPoint Parity", value: "130+", color: "#06b6d4" },
        ],
        [totals],
    );

    const phaseTabs = useMemo(
        () => [
            { id: "overview", label: "Overview" },
            { id: "models", label: `Data Models (${phase.dataModels.length})` },
            { id: "apis", label: `APIs (${phase.keyAPIs.length})` },
            { id: "frontend", label: "Frontend Integration" },
            { id: "architecture", label: "Architecture" },
        ],
        [phase],
    );

    const filteredAPIs = useMemo(() => {
        if (!deferredSearchTerm) return phase.keyAPIs;
        const t = deferredSearchTerm.toLowerCase();
        return phase.keyAPIs.filter(a => a.endpoint.toLowerCase().includes(t) || a.fn.toLowerCase().includes(t));
    }, [phase, deferredSearchTerm]);

    const filteredModels = useMemo(() => {
        if (!deferredSearchTerm) return phase.dataModels;
        const t = deferredSearchTerm.toLowerCase();
        return phase.dataModels.filter(m => m.name.toLowerCase().includes(t) || m.fields.toLowerCase().includes(t));
    }, [phase, deferredSearchTerm]);

    return (
        <div style={{
            fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
            background: "var(--bg)",
            color: "var(--text-primary)",
            minHeight: "100vh",
            "--bg": "#0a0e17",
            "--bg-card": "#111827",
            "--bg-code": "#1a2234",
            "--border": "#1e293b",
            "--text-primary": "#e2e8f0",
            "--text-secondary": "#94a3b8",
            "--text-dim": "#64748b",
            "--accent": "#38bdf8",
        }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg-card); }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        button { font-family: inherit; }
      `}</style>

            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)", borderBottom: "1px solid #1e293b", padding: "28px 32px" }}>
                <div style={{ maxWidth: 1400, margin: "0 auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⛵</div>
                        <div>
                            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>ICM × SailPoint IGA</h1>
                            <div style={{ fontSize: 13, color: "#94a3b8" }}>Developer Implementation Guide · 726 FRs · 128 Collections · 19 Domains · 7 Phases</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, flexWrap: "wrap" }}>
                        {headerStats.map(s => (
                            <div key={s.label} style={{ textAlign: "center" }}>
                                <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px", display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }}>
                {/* Left: Phase Navigator */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-dim)", marginBottom: 4 }}>Implementation Phases</div>
                    {PHASES.map(p => (
                        <PhaseCard key={p.id} phase={p} isSelected={selectedPhase === p.id} onClick={() => { setSelectedPhase(p.id); setActiveTab("overview"); setSearchTerm(""); }} />
                    ))}
                </div>

                {/* Right: Phase Detail */}
                <div>
                    {/* Phase Header */}
                    <div style={{ background: `linear-gradient(135deg, ${phase.color}15, ${phase.color}08)`, border: `1px solid ${phase.color}33`, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 32 }}>{phase.icon}</span>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontWeight: 700, fontSize: 20, color: phase.color }}>{phase.id}</span>
                                    <span style={{ fontWeight: 700, fontSize: 20 }}>{phase.name}</span>
                                </div>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{phase.goal}</div>
                            </div>
                            <div style={{ marginLeft: "auto", textAlign: "right" }}>
                                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{phase.sprint} · {phase.quarter}</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: phase.color, marginTop: 2 }}>{phase.frCount} Functional Requirements</div>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
                            <ProgressBar label="NEW" value={phase.newCount || 0} max={phase.frCount} color="#ef4444" />
                            <ProgressBar label="REUSE" value={phase.reuseCount || 0} max={phase.frCount} color="#22c55e" />
                            {phase.enhanceCount && <ProgressBar label="ENHANCE" value={phase.enhanceCount} max={phase.frCount} color="#f59e0b" />}
                        </div>
                    </div>

                    {/* Tabs */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-card)", padding: 4, borderRadius: 10 }}>
                        {phaseTabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: activeTab === tab.id ? phase.color : "transparent",
                                    color: activeTab === tab.id ? "#fff" : "var(--text-secondary)",
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: "pointer",
                                    transition: "all 0.2s",
                                    flex: 1,
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    {(activeTab === "models" || activeTab === "apis") && (
                        <input
                            type="text"
                            placeholder={`Search ${activeTab === "models" ? "collections, fields..." : "endpoints, functions..."}`}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "10px 16px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--bg-card)",
                                color: "var(--text-primary)",
                                fontSize: 13,
                                marginBottom: 16,
                                outline: "none",
                                fontFamily: "'JetBrains Mono', monospace",
                            }}
                        />
                    )}

                    {/* Tab Content */}
                    <div style={{ background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
                        {activeTab === "overview" && (
                            <div style={{ padding: 24 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                                    <div>
                                        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: phase.color, marginBottom: 10 }}>Domains Covered</h3>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                            {phase.domains.map(d => (
                                                <span key={d} style={{ background: `${phase.color}15`, color: phase.color, padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, border: `1px solid ${phase.color}33` }}>{d}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#06b6d4", marginBottom: 10 }}>SailPoint Parity</h3>
                                        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{phase.sailpointParity}</p>
                                    </div>
                                </div>

                                <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#a855f7", marginBottom: 10 }}>Developer Checklist</h3>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    {[
                                        `Create ${phase.dataModels.length} Mongoose schemas with validators`,
                                        `Build ${phase.keyAPIs.length}+ REST endpoints with Joi validation`,
                                        "Write domain service layer with business logic",
                                        "Implement role-based middleware guards",
                                        "Add compound indexes for query performance",
                                        "Write unit + integration tests (80% coverage)",
                                        "Create Swagger/OpenAPI documentation",
                                        "Build React pages + connect with React Query",
                                    ].map((item, i) => (
                                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", background: "var(--bg-code)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                                            <span style={{ color: "#22c55e", flexShrink: 0 }}>□</span>
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === "models" && (
                            <div style={{ padding: 16 }}>
                                <DataModelTable models={filteredModels} />
                                <div style={{ padding: "16px 12px", borderTop: "1px solid var(--border)", marginTop: 12 }}>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 10 }}>Mongoose Schema Pattern</h4>
                                    <pre style={{ background: "#0a0e17", padding: 16, borderRadius: 8, fontSize: 12, color: "#38bdf8", lineHeight: 1.6, overflow: "auto", fontFamily: "'JetBrains Mono', monospace" }}>
                                        {`// ${phase.dataModels[0]?.file || "Model.js"}
const mongoose = require('mongoose');

const ${phase.dataModels[0]?.name || "Model"}Schema = new mongoose.Schema({
  // --- Core Fields ---
  ${(phase.dataModels[0]?.fields || "").split(", ").slice(0, 5).map(f => {
                                            const clean = f.replace(/\(.*\)/, "").replace(/\[.*\]/, "");
                                            return `${clean}: { type: ${f.includes("[]") ? "[String]" : f.includes("Id") ? "mongoose.Schema.Types.ObjectId" : "String"}, required: true },`;
                                        }).join("\n  ")}
  
  // --- FK References ---
  ${(phase.dataModels[0]?.fk || "—").split(", ").filter(f => f !== "—").map(f => {
                                            const [field, ref] = f.split("→");
                                            return `${field?.trim()}: { type: mongoose.Schema.Types.ObjectId, ref: '${ref?.trim()}' },`;
                                        }).join("\n  ") || "// No foreign keys"}
  
  // --- Timestamps ---
}, { timestamps: true, collection: '${(phase.dataModels[0]?.name || "model").toLowerCase()}s' });

// Indexes for query performance
${phase.dataModels[0]?.name || "Model"}Schema.index({ createdAt: -1 });

module.exports = mongoose.model('${phase.dataModels[0]?.name || "Model"}', ${phase.dataModels[0]?.name || "Model"}Schema);`}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {activeTab === "apis" && (
                            <div style={{ padding: 16 }}>
                                <APITable apis={filteredAPIs} />
                                <div style={{ padding: "16px 12px", borderTop: "1px solid var(--border)", marginTop: 12 }}>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 10 }}>Express Route Pattern</h4>
                                    <pre style={{ background: "#0a0e17", padding: 16, borderRadius: 8, fontSize: 12, color: "#22c55e", lineHeight: 1.6, overflow: "auto", fontFamily: "'JetBrains Mono', monospace" }}>
                                        {`// routes/${phase.dataModels[0]?.name?.toLowerCase() || "model"}.routes.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const ctrl = require('../controllers/${phase.dataModels[0]?.name?.toLowerCase() || "model"}.controller');

router.get('/', authenticate, authorize(['admin']), ctrl.list);
router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(['admin']), validate('create'), ctrl.create);
router.put('/:id', authenticate, authorize(['admin']), validate('update'), ctrl.update);
router.delete('/:id', authenticate, authorize(['admin']), ctrl.remove);

module.exports = router;

// controllers/${phase.dataModels[0]?.name?.toLowerCase() || "model"}.controller.js
const ${phase.dataModels[0]?.name || "Model"} = require('../models/${phase.dataModels[0]?.file || "Model.js"}');
const { AppError } = require('../utils/errors');

exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, sort = '-createdAt', ...filters } = req.query;
    const docs = await ${phase.dataModels[0]?.name || "Model"}.find(filters)
      .sort(sort).skip((page - 1) * limit).limit(+limit).lean();
    const total = await ${phase.dataModels[0]?.name || "Model"}.countDocuments(filters);
    res.json({ data: docs, pagination: { page: +page, limit: +limit, total } });
  } catch (err) { next(err); }
};`}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {activeTab === "frontend" && (
                            <div style={{ padding: 24 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, color: phase.color, marginBottom: 16 }}>React Frontend Components for {phase.id}</h3>
                                <div style={{ display: "grid", gap: 12 }}>
                                    {phase.frontendIntegration.map((item, i) => (
                                        <div key={i} style={{ background: "var(--bg-code)", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 12, alignItems: "flex-start", borderLeft: `3px solid ${phase.color}` }}>
                                            <span style={{ color: phase.color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, flexShrink: 0, marginTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>{item}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                                                    Component: <code style={{ color: "var(--accent)" }}>{item.split(" ")[0].replace(/[^a-zA-Z]/g, "")}{item.split(" ").slice(1, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).replace(/[^a-zA-Z]/g, "")).join("")}.jsx</code>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ marginTop: 24, background: "#0a0e17", borderRadius: 10, padding: 16 }}>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 10 }}>React Query + API Hook Pattern</h4>
                                    <pre style={{ fontSize: 12, color: "#f59e0b", lineHeight: 1.6, overflow: "auto", fontFamily: "'JetBrains Mono', monospace" }}>
                                        {`// hooks/use${phase.dataModels[0]?.name || "Model"}.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

export const use${phase.dataModels[0]?.name || "Model"}List = (filters) =>
  useQuery({
    queryKey: ['${phase.dataModels[0]?.name?.toLowerCase() || "model"}s', filters],
    queryFn: () => api.get('${phase.keyAPIs[0]?.endpoint || "/api/resource"}', { params: filters }),
    staleTime: 30_000,
  });

export const useCreate${phase.dataModels[0]?.name || "Model"} = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('${phase.keyAPIs.find(a => a.method === "POST")?.endpoint || "/api/resource"}', data),
    onSuccess: () => qc.invalidateQueries(['${phase.dataModels[0]?.name?.toLowerCase() || "model"}s']),
  });
};

// pages/${phase.dataModels[0]?.name || "Model"}List.jsx
import { use${phase.dataModels[0]?.name || "Model"}List } from '../hooks/use${phase.dataModels[0]?.name || "Model"}';

export default function ${phase.dataModels[0]?.name || "Model"}List() {
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const { data, isLoading, error } = use${phase.dataModels[0]?.name || "Model"}List(filters);

  if (isLoading) return <Skeleton rows={5} />;
  if (error) return <ErrorBanner message={error.message} />;

  return (
    <DataTable
      columns={columns}
      data={data?.data}
      pagination={data?.pagination}
      onPageChange={(p) => setFilters(f => ({ ...f, page: p }))}
    />
  );
}`}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {activeTab === "architecture" && (
                            <div style={{ padding: 24 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 20 }}>Full-Stack Architecture · SailPoint IGA Pattern</h3>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                    {ARCHITECTURE_LAYERS.map((layer, i) => (
                                        <div key={i} style={{ background: `${layer.color}15`, border: `1px solid ${layer.color}44`, borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 8, background: layer.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{i + 1}</div>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 14, color: layer.color }}>{layer.name}</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>{layer.tech}</div>
                                            </div>
                                            {i < ARCHITECTURE_LAYERS.length - 1 && (
                                                <div style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 20 }}>↕</div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    <div style={{ background: "var(--bg-code)", borderRadius: 10, padding: 16 }}>
                                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", marginBottom: 10 }}>Frontend Stack</h4>
                                        {[
                                            "React 18 with Vite bundler",
                                            "Zustand for global state (auth, tenant)",
                                            "React Query for server state cache",
                                            "React Router v6 with lazy routes",
                                            "Tailwind CSS + shadcn/ui components",
                                            "Recharts for analytics dashboards",
                                            "React Hook Form + Zod validation",
                                            "Socket.IO for real-time events",
                                            "Axios with JWT interceptor",
                                        ].map((t, i) => (
                                            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0", display: "flex", gap: 8 }}>
                                                <span style={{ color: "#3b82f6" }}>▸</span> {t}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ background: "var(--bg-code)", borderRadius: 10, padding: 16 }}>
                                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", marginBottom: 10 }}>Backend Stack</h4>
                                        {[
                                            "Node.js + Express.js REST API",
                                            "Mongoose ODM with schema validators",
                                            "JWT auth + refresh token rotation",
                                            "Joi request validation middleware",
                                            "Winston structured logging",
                                            "Bull queue for async provisioning",
                                            "Redis for session + cache layer",
                                            "Helmet + rate-limiter security",
                                            "Swagger auto-gen from JSDoc",
                                        ].map((t, i) => (
                                            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0", display: "flex", gap: 8 }}>
                                                <span style={{ color: "#22c55e" }}>▸</span> {t}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginTop: 20, background: "#0a0e17", borderRadius: 10, padding: 16 }}>
                                    <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 10 }}>Project Structure</h4>
                                    <pre style={{ fontSize: 11, color: "#64748b", lineHeight: 1.7, fontFamily: "'JetBrains Mono', monospace" }}>
                                        {`icm-iga/
├── client/                    # React Frontend
│   ├── src/
│   │   ├── components/        # Shared UI (DataTable, Modal, Badge...)
│   │   ├── pages/             # Route pages per domain
│   │   │   ├── identity/      # Identity 360, Bulk Import, Hierarchy
│   │   │   ├── applications/  # App Registry, Connector Config
│   │   │   ├── sod/           # Policy Builder, Violations, Exceptions
│   │   │   ├── certification/ # Campaigns, Reviewer Inbox, Sign-off
│   │   │   ├── provisioning/  # Access Requests, Task Dashboard
│   │   │   ├── roles/         # Role Catalog, Mining, Requests
│   │   │   ├── admin/         # Settings, Branding, Integrations
│   │   │   └── analytics/     # Risk Trends, Outliers, Compliance
│   │   ├── hooks/             # React Query hooks per domain
│   │   ├── stores/            # Zustand stores (auth, tenant, ui)
│   │   ├── services/          # Axios API client + interceptors
│   │   └── utils/             # Formatters, validators, constants
│   └── vite.config.js
│
├── server/                    # Express Backend
│   ├── models/                # 128 Mongoose schemas
│   │   ├── identity/          # SodUserIdentity, LifecycleEvent...
│   │   ├── application/       # Application, ConnectorConfig...
│   │   ├── sod/               # SodPolicy, SodViolation...
│   │   ├── certification/     # Campaign, Result, CertSignOff...
│   │   ├── provisioning/      # ProvisioningPlan, AccessRequest...
│   │   ├── role/              # RoleEngineering, RoleAssignment...
│   │   └── platform/          # User, Audit, TenantConfig...
│   ├── routes/                # Express route definitions
│   ├── controllers/           # Request handlers
│   ├── services/              # Business logic layer
│   ├── middleware/             # auth, rbac, validate, audit
│   ├── jobs/                  # Bull queue processors
│   ├── events/                # Event bus (lifecycle, provisioning)
│   └── config/                # DB, Redis, JWT, SIEM configs
│
└── docker-compose.yml         # MongoDB + Redis + Node + React`}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
