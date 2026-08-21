# Wisibility Identity Sphere

## Identity Lifecycle Management — Architecture & Functional Specification

**Document Version:** 1.0
**Status:** Product Architecture & Development Blueprint
**Product:** Wisibility Identity Sphere
**Module:** Identity Lifecycle & Provisioning
**Primary Capabilities:** Joiner, Mover, Leaver, Rehire, Lifecycle State Management, Workflow Orchestration, Provisioning, Connector Integration, Traceability & Audit

---

# 1. Executive Summary

Wisibility Identity Sphere was initially designed as an Identity Governance and Compliance platform focused on identity intelligence, identity posture, access governance, certification, security analysis, data hygiene and audit.

The Identity Lifecycle Management capability extends Identity Sphere from a primarily **compliance and governance platform** into a broader **Identity Governance and Administration (IGA) platform**.

The JML architecture shall provide:

* Joiner automation
* Mover automation
* Leaver automation
* Rehire processing
* Lifecycle state management
* Birthright access
* Policy-driven provisioning
* Configurable provisioning plans
* Low-code workflow orchestration
* Human approvals
* Automated provisioning
* Manual fulfillment
* Multi-system integration
* Parallel and sequential task execution
* Retry and exception management
* SLA and escalation
* End-to-end transaction traceability
* Provisioning simulation
* Complete audit evidence
* Identity lifecycle visualization

The architecture must be designed so that JML is **not implemented as three isolated workflows**.

Instead, JML shall use reusable platform services:

> **Lifecycle Event Engine → Policy & Access Decision Engine → Provisioning Plan Engine → Workflow Engine → Task Orchestration → Connector Runtime → Target Systems → Verification & Evidence**

This foundation shall subsequently support:

* Access Requests
* Role-based provisioning
* Access profiles
* Automated remediation
* Privileged access workflows
* ITSM workflows
* Periodic access revalidation
* Policy-driven provisioning
* Advanced identity governance

---

# 2. Product Vision

## 2.1 Vision

Wisibility Identity Sphere shall enable organizations to answer four fundamental questions:

### Who is the identity?

Identity intelligence and identity repository.

### What should the identity have?

Policy, role, birthright and governance decisions.

### What should happen when the identity changes?

Lifecycle and workflow orchestration.

### What actually happened?

Provisioning transaction history, verification and audit evidence.

The target operating model is:

```text
                 IDENTITY SPHERE

                    DISCOVER
                       ↓
                   UNDERSTAND
                       ↓
                    GOVERN
                       ↓
                     DECIDE
                       ↓
                   ORCHESTRATE
                       ↓
                   PROVISION
                       ↓
                    VERIFY
                       ↓
                     AUDIT
```

---

# 3. Functional Scope

## 3.1 Phase 1 — Core JML

### Joiner

* Pre-hire detection
* New identity creation
* Identity profile evaluation
* Birthright access calculation
* Account creation
* Entitlement assignment
* Manager approval
* Application-owner approval
* Parallel provisioning
* Provisioning verification

### Mover

* Attribute change detection
* Organizational change detection
* Role change detection
* Manager change detection
* Location change detection
* Before/after access comparison
* Access addition
* Access removal
* Access retention
* Approval based on change type

### Leaver

* Future termination detection
* Immediate termination
* Scheduled termination
* Account disablement
* Entitlement removal
* Privileged access revocation
* Application deprovisioning
* Mailbox handling
* Delayed account deletion
* Legal-hold exceptions

### Rehire

* Reuse existing identity
* Reactivate accounts
* Recalculate birthright access
* Remove stale access
* Provision current access
* Rehire-specific workflow

---

# 4. Functional Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                  WISIBILITY IDENTITY SPHERE                 │
├─────────────────────────────────────────────────────────────┤
│                    EXPERIENCE LAYER                         │
│                                                             │
│ Identity │ Lifecycle │ Workflow │ Provisioning │ Tasks     │
│ Governance │ Analytics │ Audit │ Administration             │
├─────────────────────────────────────────────────────────────┤
│                     API / EVENT LAYER                       │
│                                                             │
│ REST APIs │ Webhooks │ Event Bus │ Scheduled Jobs           │
├─────────────────────────────────────────────────────────────┤
│                   IDENTITY INTELLIGENCE                     │
│                                                             │
│ Identity Repository │ Correlation │ Identity Posture        │
│ Data Hygiene │ Analytics │ Identity Relationships            │
├─────────────────────────────────────────────────────────────┤
│                    LIFECYCLE ENGINE                         │
│                                                             │
│ Event Detection │ State Engine │ JML Rules │ Rehire         │
├─────────────────────────────────────────────────────────────┤
│                  DECISION & POLICY ENGINE                   │
│                                                             │
│ Birthright │ Access Profiles │ Policy │ Role │ SoD          │
├─────────────────────────────────────────────────────────────┤
│                 PROVISIONING PLAN ENGINE                    │
│                                                             │
│ Plan Builder │ Plan Evaluator │ Plan Modifier │ Compiler    │
├─────────────────────────────────────────────────────────────┤
│                  WORKFLOW ORCHESTRATOR                      │
│                                                             │
│ Workflow Runtime │ Approvals │ Conditions │ Parallelism     │
│ Retry │ Timeout │ SLA │ Escalation │ Manual Tasks           │
├─────────────────────────────────────────────────────────────┤
│                   TASK ORCHESTRATOR                         │
│                                                             │
│ Queue │ Dependency │ Execution │ Retry │ State              │
├─────────────────────────────────────────────────────────────┤
│                   CONNECTOR RUNTIME                         │
│                                                             │
│ REST │ SCIM │ LDAP │ JDBC │ AD │ Entra │ SaaS │ Custom      │
├─────────────────────────────────────────────────────────────┤
│                    EVIDENCE LAYER                           │
│                                                             │
│ Transaction │ Audit │ Execution Logs │ Correlation          │
└─────────────────────────────────────────────────────────────┘
```

---

# 5. Microservices / Component Architecture

The implementation may use microservices or modular services depending on the deployment model. The logical service boundaries shall be maintained even if some services initially share a deployment unit.

## 5.1 Identity Service

Responsibilities:

* Identity master record
* Identity attributes
* Identity profiles
* Identity relationships
* Manager relationships
* Employment information
* Organizational information
* Identity status

Primary APIs:

```text
GET    /api/v1/identities/{id}
POST   /api/v1/identities
PATCH  /api/v1/identities/{id}
GET    /api/v1/identities/{id}/history
GET    /api/v1/identities/{id}/access
```

---

# 6. Lifecycle Event Service

The Lifecycle Event Service detects meaningful identity changes.

Supported events:

```text
IDENTITY_CREATED
PRE_HIRE
JOINER
IDENTITY_UPDATED
MOVER
DEPARTMENT_CHANGED
LOCATION_CHANGED
MANAGER_CHANGED
ROLE_CHANGED
EMPLOYEE_TYPE_CHANGED
LEAVE_OF_ABSENCE
REHIRE
LEAVER
TERMINATION_SCHEDULED
TERMINATION_EFFECTIVE
IDENTITY_SUSPENDED
IDENTITY_ARCHIVED
```

## 6.1 Event Detection

The service compares:

```text
Previous Identity State
+
Current Identity State
=
Identity Change Delta
```

Example:

```text
BEFORE

Department = Finance
Job Code = FIN-ANALYST
Manager = John
Status = Active

AFTER

Department = Sales
Job Code = SALES-MGR
Manager = Mary
Status = Active
```

Detected:

```text
MOVER
DEPARTMENT_CHANGED
JOB_CHANGED
MANAGER_CHANGED
```

---

# 7. Lifecycle State Machine

Identity Sphere shall use a generic lifecycle state model rather than hard-coding only Joiner, Mover and Leaver.

Recommended default states:

```text
PRE_HIRE
   ↓
JOINER
   ↓
ACTIVE
   ├───────────────┐
   ↓               ↓
MOVER       LEAVE_OF_ABSENCE
   │               │
   └──────→ ACTIVE ←┘
                 │
                 ↓
             TERMINATED
                 ↓
              ARCHIVED
```

Additional states:

* Contractor
* Suspended
* Extended Leave
* Retired
* Pending Rehire

Lifecycle states shall be configurable.

## 7.1 State Transition Definition

Each transition shall support:

```text
Transition ID
Source State
Target State
Trigger
Conditions
Effective Date
Workflow
Policy
Provisioning Plan
Approvals
Rollback Strategy
```

Example:

```text
Transition:
ACTIVE → TERMINATED

Trigger:
HR termination event

Conditions:
Termination Date <= Current Date

Workflow:
Employee Leaver v3

Provisioning:
Disable accounts
Remove access
Revoke privileged access

Effective:
Termination Date 23:59
```

---

# 8. Policy & Access Decision Engine

The Decision Engine determines what access an identity should receive.

It shall evaluate:

* Identity attributes
* Organizational attributes
* Employee type
* Job code
* Job level
* Department
* Location
* Manager
* Role
* Identity risk
* Existing access
* Birthright policies
* Access profiles
* SoD policies
* Application policies

Example:

```text
IF

Employee Type = Employee
AND Country = India
AND Status = Active

THEN

AD Employee
M365 Standard
VPN Standard
ServiceNow Employee
```

---

# 9. Birthright Access

Birthright policies represent automatically assigned baseline access.

A birthright policy shall contain:

```text
Policy Name
Description
Scope
Conditions
Applications
Entitlements
Account Profile
Effective Date
Priority
Exception Rules
Approval Requirement
```

Example:

```text
Policy:
India Employee Birthright

Conditions:
Employee Type = Employee
Country = India

Assignments:
AD Employee
Microsoft 365
VPN
ServiceNow
```

Birthright access shall be recalculated during:

* Joiner
* Mover
* Rehire
* Lifecycle state changes

---

# 10. Mover Access Delta Engine

Mover processing shall not simply rerun Joiner.

The platform shall calculate:

```text
Access Before
        ↓
Access Required After
        ↓
Difference Engine
        ↓
ADD / REMOVE / RETAIN
```

Example:

```text
BEFORE
Finance
SAP Finance
Finance SharePoint

AFTER
Sales
Salesforce
Sales SharePoint
```

Result:

```text
ADD

Salesforce
Sales SharePoint

REMOVE

SAP Finance
Finance SharePoint

RETAIN

M365
VPN
Corporate Email
```

The resulting delta becomes the input to the provisioning plan.

---

# 11. Provisioning Plan Engine

The Provisioning Plan Engine is a core component.

Its purpose is to convert an identity/governance decision into an executable set of changes.

Architecture:

```text
Lifecycle Event
       ↓
Policy Evaluation
       ↓
Access Decision
       ↓
Provisioning Plan
       ↓
Workflow
       ↓
Plan Modification
       ↓
Plan Compilation
       ↓
Application Partitioning
       ↓
Task Creation
       ↓
Connector Execution
```

---

# 12. Provisioning Plan Model

A provisioning plan contains:

```text
Plan ID
Correlation ID
Identity ID
Lifecycle Event ID
Workflow Instance ID
Requested By
Source
Created Date
Effective Date
Priority
Status
Plan Items
```

Each plan item contains:

```text
Application
Account
Operation
Attribute Changes
Entitlement Changes
Execution Mode
Approval State
Risk
Dependency
Effective Date
```

---

# 13. Provisioning Plan JSON Model

Example:

```json
{
  "planId": "PLAN-20260816-000982",
  "correlationId": "JML-20260816-000982",
  "identity": {
    "identityId": "EMP10282",
    "name": "Ravi Kumar",
    "employeeType": "Employee",
    "lifecycleState": "JOINER"
  },
  "event": {
    "eventId": "EVT-88921",
    "eventType": "JOINER",
    "effectiveDate": "2026-08-17T09:00:00+05:30",
    "source": "HRMS"
  },
  "planItems": [
    {
      "itemId": "PI-001",
      "application": "Active Directory",
      "operation": "CREATE_ACCOUNT",
      "executionMode": "AUTOMATED",
      "attributes": {
        "accountId": "rkumar",
        "ou": "OU=Employees,DC=corp,DC=com"
      },
      "entitlements": [
        "AD_EMPLOYEE"
      ],
      "status": "PENDING"
    },
    {
      "itemId": "PI-002",
      "application": "Microsoft 365",
      "operation": "CREATE_ACCOUNT",
      "executionMode": "AUTOMATED",
      "entitlements": [
        "M365_STANDARD"
      ],
      "status": "PENDING"
    },
    {
      "itemId": "PI-003",
      "application": "Legacy ERP",
      "operation": "CREATE_ACCOUNT",
      "executionMode": "MANUAL",
      "entitlements": [
        "ERP_EMPLOYEE"
      ],
      "status": "PENDING"
    }
  ]
}
```

---

# 14. Plan Modification

Workflows shall be able to modify plans.

Supported operations:

```text
ADD_APPLICATION
REMOVE_APPLICATION

CREATE_ACCOUNT
ENABLE_ACCOUNT
DISABLE_ACCOUNT
DELETE_ACCOUNT

ADD_ENTITLEMENT
REMOVE_ENTITLEMENT

UPDATE_ACCOUNT_ATTRIBUTE
UPDATE_ENTITLEMENT

CHANGE_EFFECTIVE_DATE
CHANGE_EXECUTION_MODE

SKIP_ITEM
CANCEL_ITEM
REQUIRE_APPROVAL
```

Example workflow action:

```text
IF

Employee Department = Finance

THEN

ADD:
SAP Finance

ELSE

REMOVE:
SAP Finance
```

---

# 15. Plan Compilation

The compiler transforms the logical plan into executable tasks.

```text
Logical Plan
     ↓
Validation
     ↓
Policy Check
     ↓
SoD Check
     ↓
Dependency Resolution
     ↓
Application Partitioning
     ↓
Connector Capability Check
     ↓
Executable Tasks
```

The compiler must detect:

* Unsupported operation
* Missing connector
* Invalid entitlement
* Missing required attribute
* Policy violation
* SoD conflict
* Missing approval
* Dependency conflict

---

# 16. Workflow Engine

The Workflow Engine shall provide a low-code visual orchestration framework.

Workflow characteristics:

* Versioned
* Configurable
* Reusable
* Auditable
* Event-driven
* Long-running
* Resumable
* Retryable
* Observable

---

# 17. Workflow Node Model

Each workflow consists of nodes and edges.

```text
Workflow
 ├── Nodes
 ├── Connections
 ├── Variables
 ├── Inputs
 ├── Outputs
 ├── Version
 └── Configuration
```

Node types:

### Trigger

```text
JOINER
MOVER
LEAVER
REHIRE
ATTRIBUTE_CHANGE
MANUAL
API
SCHEDULE
```

### Identity

```text
GET_IDENTITY
GET_MANAGER
GET_ORGANIZATION
GET_ACCESS
GET_IDENTITY_ATTRIBUTE
```

### Decision

```text
IF
ELSE
SWITCH
RULE
POLICY_EVALUATION
```

### Approval

```text
MANAGER_APPROVAL
OWNER_APPROVAL
SECURITY_APPROVAL
HR_APPROVAL
CUSTOM_APPROVAL
```

### Provisioning

```text
BUILD_PLAN
MODIFY_PLAN
VALIDATE_PLAN
COMPILE_PLAN
EXECUTE_PLAN
VERIFY_PROVISIONING
```

### Task

```text
CREATE_MANUAL_TASK
WAIT_FOR_TASK
ESCALATE_TASK
```

### Integration

```text
REST
SCIM
LDAP
JDBC
WEBHOOK
ITSM
CUSTOM_CONNECTOR
```

### Control

```text
WAIT
DELAY
PARALLEL
JOIN
RETRY
TIMEOUT
LOOP
```

### Notification

```text
EMAIL
IN_APP
TEAMS
SLACK
WEBHOOK
```

---

# 18. Workflow Node Definition

Example:

```json
{
  "nodeId": "NODE-001",
  "type": "MANAGER_APPROVAL",
  "name": "Manager Approval",
  "configuration": {
    "approver": "IDENTITY_MANAGER",
    "timeout": "PT24H",
    "escalation": "MANAGER_MANAGER",
    "allowDelegate": true
  },
  "inputs": [
    "identity",
    "provisioningPlan"
  ],
  "outputs": [
    "approvalResult"
  ]
}
```

---

# 19. Workflow State Machine

```text
DRAFT
  ↓
VALIDATING
  ↓
PUBLISHED
  ↓
ACTIVE
  ↓
TRIGGERED
  ↓
RUNNING
  ├──────────────┐
  ↓              ↓
WAITING       FAILED
  │              │
  ↓              ↓
RUNNING        RETRY
                 │
                 ↓
              RUNNING

RUNNING
  ↓
COMPLETED

RUNNING
  ↓
CANCELLED
```

---

# 20. Workflow Execution State

Each workflow instance shall maintain:

```text
Workflow Instance ID
Workflow Definition ID
Workflow Version
Identity ID
Correlation ID
Current Node
Status
Started At
Completed At
Initiated By
Execution Context
Error
Retry Count
```

Execution statuses:

```text
QUEUED
RUNNING
WAITING
WAITING_APPROVAL
WAITING_TASK
PAUSED
RETRYING
FAILED
COMPLETED
CANCELLED
TIMED_OUT
```

---

# 21. Parallel Processing

The engine must support parallel branches.

Example:

```text
                  Provision Plan
                       │
              ┌────────┼────────┐
              ↓        ↓        ↓
             AD       M365     SAP
              │        │        │
              ↓        ↓        ↓
           Complete Complete Complete
              └────────┼────────┘
                       ↓
                    Verify
```

A Join node shall support:

* Wait for all
* Wait for majority
* Wait for selected branches
* Continue on failure
* Fail if any branch fails

---

# 22. Retry Model

Each executable task shall support configurable retry policies.

Example:

```text
Maximum Attempts = 3
Initial Delay = 5 minutes
Backoff = Exponential
Maximum Delay = 60 minutes
```

Retryable errors:

* Network timeout
* HTTP 429
* Temporary connector error
* Target-system unavailable

Non-retryable errors:

* Invalid credentials
* Invalid entitlement
* Invalid account data
* Authorization failure
* Schema validation failure

---

# 23. Connector Framework

The Connector Framework shall abstract target systems from the workflow and provisioning layers.

Architecture:

```text
Provisioning Task
       ↓
Connector Runtime
       ↓
Connector Adapter
       ↓
Target System
```

Supported integration mechanisms:

* REST
* SCIM
* LDAP
* JDBC
* SOAP
* PowerShell
* Webhook
* Custom SDK

---

# 24. Standard Connector Interface

Every connector should support, where applicable:

```text
testConnection()
discoverSchema()
getAccount()
createAccount()
updateAccount()
enableAccount()
disableAccount()
deleteAccount()

getEntitlements()
assignEntitlement()
removeEntitlement()

validateRequest()
getProvisioningStatus()
```

Additional operations may be connector-specific.

---

# 25. Connector Definition

```json
{
  "connectorId": "CONN-AD-001",
  "name": "Active Directory",
  "type": "LDAP",
  "version": "2.1",
  "capabilities": [
    "CREATE_ACCOUNT",
    "UPDATE_ACCOUNT",
    "ENABLE_ACCOUNT",
    "DISABLE_ACCOUNT",
    "DELETE_ACCOUNT",
    "ADD_ENTITLEMENT",
    "REMOVE_ENTITLEMENT"
  ],
  "status": "ACTIVE"
}
```

---

# 26. Connector Security

Connector credentials shall never be stored in workflow definitions.

Credentials must be maintained through:

```text
Credential Vault
       ↓
Connector Runtime
       ↓
Secure Session
       ↓
Target System
```

Requirements:

* Encryption at rest
* Encryption in transit
* Credential rotation
* Secret masking
* Least privilege
* Credential access auditing
* Connection test auditing

---

# 27. Task Orchestration Engine

The Task Engine converts provisioning-plan items into executable tasks.

Example:

```text
PLAN-001
 │
 ├── TASK-001 AD Create
 ├── TASK-002 M365 Create
 ├── TASK-003 SAP Create
 ├── TASK-004 ServiceNow Create
 └── TASK-005 VPN Create
```

Each task maintains:

```text
Task ID
Plan ID
Workflow Instance ID
Application
Connector
Operation
Priority
Status
Owner
SLA
Created At
Started At
Completed At
Retry Count
Error
Evidence
```

---

# 28. Task State Machine

```text
PENDING
   ↓
QUEUED
   ↓
IN_PROGRESS
   ├─────────────┐
   ↓             ↓
COMPLETED      FAILED
                 │
            ┌────┴─────┐
            ↓          ↓
         RETRY       ESCALATE
            │
            ↓
        IN_PROGRESS

PENDING → CANCELLED
PENDING → EXPIRED
IN_PROGRESS → TIMED_OUT
```

---

# 29. Manual Fulfillment

Applications without automation shall use manual tasks.

Example:

```text
TASK-88231

Application:
Legacy Mainframe

Action:
Create Account

Assigned To:
Mainframe Application Administrator

Priority:
High

SLA:
4 Hours

Required Evidence:
Screenshot or ticket number

[Complete Task]
[Reject]
[Reassign]
```

The workflow resumes automatically after task completion.

---

# 30. SLA & Escalation

Tasks shall support:

```text
SLA
Warning Threshold
Escalation Level 1
Escalation Level 2
Final Escalation
Expiry Action
```

Example:

```text
0 hours
    ↓
Task Assigned

3 hours
    ↓
Warning

4 hours
    ↓
Escalate to Manager

8 hours
    ↓
Escalate to IAM Administrator
```

---

# 31. Transaction Correlation

Every JML execution must receive a globally unique correlation ID.

Example:

```text
JML-20260816-000982
```

The correlation ID shall follow the complete transaction:

```text
HR Change
   ↓
Lifecycle Event
   ↓
Workflow Instance
   ↓
Provisioning Plan
   ↓
Provisioning Tasks
   ↓
Connector Transactions
   ↓
Target System Result
   ↓
Verification
   ↓
Audit Evidence
```

Every record must be queryable using this correlation ID.

---

# 32. Audit & Evidence Model

Every significant operation shall create an immutable audit event.

Audit attributes:

```text
Event ID
Correlation ID
Identity ID
Actor
Action
Object
Before Value
After Value
Source
Timestamp
IP / Session where applicable
Workflow
Workflow Version
Result
Reason
Evidence
```

Examples:

```text
WHO:
IAM Administrator

WHAT:
Modified provisioning plan

WHEN:
2026-08-16 10:31:04

WHY:
Security exception

CHANGE:
Removed SAP Finance role
```

---

# 33. Workflow Versioning

Workflow definitions must be immutable once used in production.

Example:

```text
Employee Joiner

v1.0
01-Jan → 30-Jun

v2.0
01-Jul → Current

v3.0
Draft
```

Every execution records:

```text
Workflow
Version
Definition Hash
Published By
Published Date
```

Historical executions must never change when a workflow is modified.

---

# 34. Workflow Designer — Screen Specification

## Screen: Workflow Designer

### Header

```text
Employee Joiner Workflow
Version 3.2
Status: Draft

[Save] [Validate] [Test] [Publish]
```

### Left Panel — Node Library

```text
TRIGGERS
• Joiner
• Mover
• Leaver
• Rehire

IDENTITY
• Get Identity
• Get Manager
• Get Access

LOGIC
• If/Else
• Switch
• Rule

APPROVAL
• Manager
• Owner
• Security

PROVISIONING
• Build Plan
• Modify Plan
• Execute Plan

TASK
• Manual Task
• Wait
• Escalate

INTEGRATION
• REST
• SCIM
• LDAP
• JDBC

CONTROL
• Parallel
• Join
• Retry
• Delay

NOTIFICATION
• Email
• Teams
```

### Center Canvas

Visual drag-and-drop workflow.

### Right Properties Panel

When a node is selected:

```text
Node:
Manager Approval

Approver:
Identity Manager

Timeout:
24 Hours

Escalation:
Manager's Manager

Allow Delegate:
Yes

Required:
Yes
```

### Bottom Panel

```text
Validation
────────────────────────────
✓ All nodes connected
✓ No orphan nodes
✓ Approver configured
✓ Provisioning connector available
⚠ SAP entitlement mapping missing
```

---

# 35. Workflow Designer Capabilities

Must support:

* Drag and drop
* Zoom
* Pan
* Copy/paste
* Multi-select
* Node grouping
* Comments
* Versioning
* Undo/redo
* Validation
* Test execution
* Simulation
* Draft/publish
* Import/export
* Workflow cloning

---

# 36. Workflow Monitor — Screen Specification

## Purpose

Operations teams need to see all active and historical workflows.

### Header Metrics

```text
Running        28
Waiting        14
Failed          3
Completed     842
SLA Breached    5
```

### Filters

```text
Identity
Event Type
Workflow
Application
Status
Owner
Date
Correlation ID
```

### Workflow Table

| Workflow        | Identity   | Event  | Status  | Duration | Current Step     |
| --------------- | ---------- | ------ | ------- | -------: | ---------------- |
| Employee Joiner | Ravi Kumar | Joiner | Running |      18m | SAP Provisioning |
| Employee Mover  | Anita Rao  | Mover  | Waiting |       2h | Manager Approval |
| Employee Leaver | John Smith | Leaver | Failed  |       9m | Salesforce       |

---

# 37. Workflow Execution Detail

Selecting an execution opens a visual execution graph.

```text
JOINER
  ✓
  │
Identity Evaluation
  ✓
  │
Birthright Calculation
  ✓
  │
Manager Approval
  ✓
  │
Security Approval
  ✓
  │
Provisioning Plan
  ✓
  │
  ├── AD          ✓
  ├── M365        ✓
  ├── ServiceNow  ✓
  ├── Salesforce  ✓
  └── SAP         ⚠
                   │
                   └── Retry 2/3
```

Selecting any node displays:

```text
INPUT
OUTPUT
START TIME
END TIME
DURATION
ACTOR
CONNECTOR
REQUEST
RESPONSE
ERROR
RETRY HISTORY
AUDIT EVENTS
```

---

# 38. Provisioning Plan — Screen Specification

## Header

```text
Provisioning Plan
PLAN-20260816-000982

Identity: Ravi Kumar
Event: JOINER
Status: Pending Approval
```

### Summary

```text
Applications     6
Accounts         5
Entitlements    14
Approvals        2
Risk            Medium
```

### Plan Items

| Application | Operation | Entitlements | Mode      | Status   |
| ----------- | --------- | ------------ | --------- | -------- |
| AD          | Create    | Employee     | Automatic | Ready    |
| M365        | Create    | Standard     | Automatic | Ready    |
| SAP         | Create    | Finance      | Automatic | Approval |
| ServiceNow  | Create    | Employee     | Automatic | Ready    |
| Legacy ERP  | Create    | Employee     | Manual    | Pending  |

### Actions

```text
[Simulate]
[Modify Plan]
[Approve]
[Reject]
[Cancel]
```

---

# 39. Provisioning Plan Modification Screen

Administrators with appropriate permission shall be able to modify the generated plan before execution.

Supported actions:

```text
+ Add Application
+ Add Entitlement
+ Remove Application
+ Remove Entitlement
+ Change Attribute
+ Change Effective Date
+ Change Execution Mode
+ Require Approval
+ Skip Item
```

All modifications must create audit evidence.

Example:

```text
Original:
SAP Role = FIN_EMPLOYEE

Modified:
SAP Role = FIN_MANAGER

Reason:
Promotion effective immediately

Modified By:
IAM Administrator
```

---

# 40. Task Console — Screen Specification

The Task Console provides operational management of provisioning and manual tasks.

### Metrics

```text
My Tasks          18
Unassigned         7
In Progress       12
SLA Warning        4
SLA Breached       2
Failed             3
```

### Filters

```text
Task Type
Application
Assignee
Priority
Status
SLA
Identity
Workflow
Date
```

### Task Table

| Task      | Identity   | Application | Operation | Owner     | Status   | SLA      |
| --------- | ---------- | ----------- | --------- | --------- | -------- | -------- |
| TASK-8211 | Ravi Kumar | AD          | Create    | Connector | Complete | —        |
| TASK-8212 | Ravi Kumar | SAP         | Create    | SAP Admin | Pending  | 3h       |
| TASK-8213 | Anita Rao  | Salesforce  | Remove    | Connector | Failed   | Breached |

---

# 41. Task Detail Screen

```text
TASK-8212

Identity
Ravi Kumar

Application
SAP

Operation
CREATE_ACCOUNT

Status
WAITING

Owner
SAP Administrator

SLA
4 Hours

Workflow
Employee Joiner v3.2

Correlation ID
JML-20260816-000982
```

### Execution History

```text
10:31:12 Task Created
10:31:14 Connector Started
10:31:19 Connector Timeout
10:36:19 Retry Scheduled
10:41:19 Retry Started
```

### Actions

```text
[Retry]
[Reassign]
[Cancel]
[Escalate]
[View Workflow]
[View Provisioning Plan]
[View Audit]
```

---

# 42. Identity Lifecycle Timeline — Screen Specification

This should be embedded into every identity's profile.

## Header

```text
Ravi Kumar
EMP10282

Lifecycle State:
ACTIVE

Current Department:
Sales

Manager:
Mary Thomas
```

### Timeline

```text
12-Mar-2024
JOINER
Identity Created
        │
        ▼
12-Mar-2024
PROVISIONING
8 Applications Provisioned
        │
        ▼
18-Jun-2025
MOVER
Finance → Sales
        │
        ▼
18-Jun-2025
ACCESS CHANGE
4 Removed / 6 Added
        │
        ▼
16-Aug-2026
MANAGER CHANGE
John → Mary
        │
        ▼
31-Aug-2026
LEAVER
Scheduled
```

Each event is clickable.

---

# 43. Identity Lifecycle Timeline Event Detail

Clicking an event displays:

```text
Event:
MOVER

Correlation ID:
JML-20250618-00821

Before:
Department = Finance

After:
Department = Sales

Access Removed:
4

Access Added:
6

Access Retained:
11

Workflow:
Employee Mover v2.4

Approvals:
Manager ✓
Application Owner ✓

Provisioning:
Completed

Audit:
[View Evidence]
```

---

# 44. API Architecture

All APIs should be versioned.

Base:

```text
/api/v1
```

## Identity APIs

```text
GET    /identities
GET    /identities/{id}
GET    /identities/{id}/history
GET    /identities/{id}/access
GET    /identities/{id}/lifecycle
```

## Lifecycle APIs

```text
GET    /lifecycle/events
GET    /lifecycle/events/{id}
POST   /lifecycle/events
GET    /lifecycle/states
GET    /lifecycle/transitions
POST   /lifecycle/transitions
```

## Workflow APIs

```text
GET    /workflows
POST   /workflows
GET    /workflows/{id}
PUT    /workflows/{id}
POST   /workflows/{id}/validate
POST   /workflows/{id}/publish
POST   /workflows/{id}/test
GET    /workflow-instances
GET    /workflow-instances/{id}
POST   /workflow-instances/{id}/cancel
POST   /workflow-instances/{id}/resume
```

## Provisioning APIs

```text
POST   /provisioning/plans
GET    /provisioning/plans/{id}
POST   /provisioning/plans/{id}/simulate
POST   /provisioning/plans/{id}/validate
POST   /provisioning/plans/{id}/compile
POST   /provisioning/plans/{id}/execute
POST   /provisioning/plans/{id}/cancel
```

## Task APIs

```text
GET    /tasks
GET    /tasks/{id}
POST   /tasks/{id}/assign
POST   /tasks/{id}/complete
POST   /tasks/{id}/reject
POST   /tasks/{id}/retry
POST   /tasks/{id}/escalate
```

## Connector APIs

```text
GET    /connectors
POST   /connectors
GET    /connectors/{id}
POST   /connectors/{id}/test
GET    /connectors/{id}/schema
GET    /connectors/{id}/capabilities
```

---

# 45. Event APIs

Identity Sphere shall support external event ingestion.

Example:

```text
POST /api/v1/events/identity
```

Example payload:

```json
{
  "eventType": "IDENTITY_UPDATED",
  "source": "WORKDAY",
  "eventTime": "2026-08-16T10:20:00+05:30",
  "identity": {
    "employeeId": "EMP10282"
  },
  "changes": {
    "department": {
      "old": "Finance",
      "new": "Sales"
    }
  }
}
```

The event engine evaluates the change and determines whether it represents a lifecycle event.

---

# 46. Event Bus

Recommended logical topics:

```text
identity.created
identity.updated
identity.lifecycle.changed

jml.joiner
jml.mover
jml.leaver
jml.rehire

workflow.started
workflow.completed
workflow.failed

approval.requested
approval.completed

provisioning.plan.created
provisioning.plan.modified
provisioning.plan.compiled

task.created
task.started
task.completed
task.failed

connector.requested
connector.completed
connector.failed

audit.event
```

---

# 47. Database Entity Model

Core tables/entities:

```text
IDENTITY
IDENTITY_ATTRIBUTE
IDENTITY_PROFILE
IDENTITY_RELATIONSHIP

LIFECYCLE_STATE
LIFECYCLE_TRANSITION
LIFECYCLE_EVENT
LIFECYCLE_EVENT_ATTRIBUTE

BIRTHRIGHT_POLICY
ACCESS_POLICY
ACCESS_PROFILE
POLICY_ASSIGNMENT

WORKFLOW
WORKFLOW_VERSION
WORKFLOW_NODE
WORKFLOW_EDGE
WORKFLOW_VARIABLE

WORKFLOW_INSTANCE
WORKFLOW_NODE_INSTANCE

PROVISIONING_PLAN
PROVISIONING_PLAN_ITEM
PROVISIONING_ATTRIBUTE
PROVISIONING_ENTITLEMENT

APPROVAL
APPROVAL_DECISION

TASK
TASK_DEPENDENCY
TASK_EXECUTION
TASK_ASSIGNMENT

APPLICATION
APPLICATION_SCHEMA
APPLICATION_ACCOUNT
APPLICATION_ENTITLEMENT

CONNECTOR
CONNECTOR_CONFIGURATION
CONNECTOR_CAPABILITY
CONNECTOR_TRANSACTION

AUDIT_EVENT
EXECUTION_LOG
NOTIFICATION
```

---

# 48. Key Database Relationships

```text
IDENTITY
   │
   ├── LIFECYCLE_EVENT
   │        │
   │        └── WORKFLOW_INSTANCE
   │                  │
   │                  └── PROVISIONING_PLAN
   │                            │
   │                            └── PLAN_ITEM
   │                                  │
   │                                  └── TASK
   │                                       │
   │                                       └── CONNECTOR_TRANSACTION
   │
   └── IDENTITY_ACCESS
```

---

# 49. Security Model

JML is highly privileged functionality.

Role-based access shall be enforced.

Recommended roles:

### Identity Administrator

Full lifecycle administration.

### Workflow Administrator

Create, modify and publish workflows.

### Provisioning Administrator

Manage provisioning plans and connectors.

### Application Administrator

Manage application-specific tasks.

### Manager

Approve identity-specific requests.

### Auditor

Read-only access to execution and audit history.

### Help Desk

View identity lifecycle and task status without privileged configuration access.

---

# 50. Separation of Duties

The platform should prevent users from unnecessarily combining:

```text
Workflow Designer
+
Workflow Publisher
+
Provisioning Approver
```

Recommended controls:

```text
Designer
    ↓
Reviewer
    ↓
Publisher
```

Production workflow changes should optionally require approval.

---

# 51. API Security

All APIs shall support:

* OAuth 2.0 / OIDC
* JWT
* RBAC
* Tenant isolation
* Scope-based authorization
* API rate limiting
* Request correlation IDs
* Audit logging

Sensitive data must be masked in logs.

---

# 52. Idempotency

Provisioning operations must be idempotent.

For example:

```text
CREATE_ACCOUNT
```

should not create duplicate accounts if the same request is retried.

The connector runtime should use:

```text
Idempotency Key
+
Identity ID
+
Application
+
Operation
```

Example:

```text
IDEMP-EMP10282-AD-CREATE
```

---

# 53. Concurrency Control

The platform must prevent conflicting lifecycle transactions.

Example:

```text
Mover started
     ↓
Leaver received
```

The system must not blindly execute both simultaneously.

Recommended behavior:

```text
Active Workflow
      ↓
New Lifecycle Event
      ↓
Conflict Detection
      ↓
Queue / Cancel / Merge / Escalate
```

Priority should normally be:

```text
TERMINATION
   >
SUSPENSION
   >
MOVER
   >
JOINER
```

Actual priority must remain configurable.

---

# 54. Provisioning Simulation

Before execution, Identity Sphere should provide:

> **Simulate Changes**

Simulation output:

```text
IDENTITY:
Ravi Kumar

EVENT:
MOVER

FROM:
Finance

TO:
Sales

ACCESS TO ADD:
6

ACCESS TO REMOVE:
4

ACCESS TO RETAIN:
11

APPROVALS:
2

POLICY VIOLATIONS:
0

SOD CONFLICTS:
0

CONNECTOR ERRORS:
0

RESULT:
READY FOR EXECUTION
```

Simulation must not modify target systems.

---

# 55. Verification Engine

Provisioning success should not necessarily mean:

> API returned HTTP 200.

Identity Sphere should support post-provisioning verification.

Example:

```text
Provision Account
       ↓
Wait
       ↓
Query Target
       ↓
Verify Account
       ↓
Verify Entitlements
       ↓
Compare Expected vs Actual
```

Result:

```text
Expected:
SAP Role = FIN_EMPLOYEE

Actual:
SAP Role = FIN_EMPLOYEE

Verification:
PASS
```

If mismatch:

```text
Verification:
FAILED

Reason:
Role not present

Action:
Retry / Remediate / Escalate
```

---

# 56. Rollback / Compensation

JML workflows should support compensating actions.

Example:

```text
AD Account Created ✓
M365 Account Created ✓
SAP Failed ✗
```

Depending on workflow policy:

```text
Option A:
Continue and retry SAP

Option B:
Rollback AD and M365

Option C:
Escalate and hold

Option D:
Complete partial provisioning
and create remediation task
```

Rollback shall be explicitly configured rather than assumed.

---

# 57. Notifications

Events requiring notifications:

* Approval requested
* Approval completed
* Approval rejected
* Task assigned
* SLA warning
* SLA breach
* Provisioning completed
* Provisioning failed
* Lifecycle completed
* Workflow exception

Channels:

* Email
* In-app
* Teams
* Slack
* Webhook

---

# 58. Reporting & Analytics

JML dashboards should provide:

### Lifecycle Volume

```text
Joiners
Movers
Leavers
Rehires
```

### Provisioning Performance

```text
Average Joiner Completion
Average Mover Completion
Average Leaver Completion
```

### Automation

```text
Fully Automated
Partially Automated
Manual
```

### Failures

```text
Connector Failures
Approval Delays
Task Failures
Policy Failures
```

### SLA

```text
Within SLA
SLA Warning
SLA Breached
```

---

# 59. Key Product Metrics

Recommended KPIs:

```text
JML Completion Rate
Automation Rate
Average Provisioning Time
Average Approval Time
Average Connector Time
Provisioning Failure Rate
Retry Rate
SLA Compliance
Manual Fulfillment Rate
Mover Access Delta
Leaver Deprovisioning Completion
Orphaned Account Rate
```

---

# 60. End-to-End Joiner Example

```text
HRMS
 │
 │ New Employee
 ▼
Identity Aggregation
 │
 ▼
Identity Created
 │
 ▼
Lifecycle Event Engine
 │
 ▼
JOINER
 │
 ▼
Identity Profile
 │
 ▼
Birthright Evaluation
 │
 ▼
Provisioning Plan
 │
 ▼
Joiner Workflow
 │
 ├── Manager Approval
 │
 ├── Security Approval
 │
 └── Plan Compilation
 │
 ▼
Parallel Provisioning
 │
 ├── AD
 ├── M365
 ├── ServiceNow
 ├── VPN
 └── SAP
 │
 ▼
Verification
 │
 ▼
Identity Posture Updated
 │
 ▼
Audit Evidence
 │
 ▼
JML COMPLETE
```

---

# 61. End-to-End Mover Example

```text
HRMS
 │
 ▼
Department Changed
 │
 ▼
Lifecycle Event Engine
 │
 ▼
MOVER
 │
 ▼
Capture Before State
 │
 ▼
Capture After State
 │
 ▼
Access Delta Engine
 │
 ├── ADD
 ├── REMOVE
 └── RETAIN
 │
 ▼
Provisioning Plan
 │
 ▼
Mover Workflow
 │
 ├── Manager Approval
 ├── Application Owner Approval
 └── Security Check
 │
 ▼
Execute Changes
 │
 ├── Remove Finance
 ├── Add Sales
 └── Retain Corporate Access
 │
 ▼
Verification
 │
 ▼
Identity Posture Recalculated
 │
 ▼
Audit
```

---

# 62. End-to-End Leaver Example

```text
HRMS
 │
 ▼
Termination Date
 │
 ▼
Lifecycle Event
 │
 ▼
LEAVER
 │
 ▼
Leaver Policy
 │
 ├── Immediate Revocation
 ├── Scheduled Disablement
 ├── Account Retention
 └── Data Retention
 │
 ▼
Leaver Workflow
 │
 ├── Manager Notification
 ├── Security Check
 ├── Legal Hold Check
 └── Provisioning Plan
 │
 ▼
Disable / Remove
 │
 ├── AD
 ├── M365
 ├── VPN
 ├── SaaS
 └── Privileged Access
 │
 ▼
Verification
 │
 ▼
Audit Evidence
```

---

# 63. Non-Functional Requirements

## Performance

Target:

* Event detection: < 30 seconds under normal load
* Workflow initiation: < 5 seconds
* Provisioning task creation: < 5 seconds
* UI workflow monitoring: near real-time
* API response: < 2 seconds for normal read operations

Exact targets shall be validated during capacity planning.

## Availability

Target:

* 99.9% platform availability
* No loss of provisioning transaction state
* Durable task queues
* Recoverable workflow execution

## Scalability

Architecture shall support:

* Millions of identities
* Thousands of applications
* Large provisioning bursts
* Concurrent workflow executions
* Long-running workflows

---

# 64. Reliability Requirements

The system must support:

* Persistent workflow state
* Durable queues
* Idempotent operations
* Retry
* Dead-letter queues
* Failure recovery
* Connector timeout handling
* Transaction correlation
* Disaster recovery

A workflow must be capable of resuming after a service restart.

---

# 65. Observability

Every service should produce:

```text
Metrics
Logs
Traces
Audit Events
```

Distributed tracing shall use:

```text
Correlation ID
+
Trace ID
+
Span ID
```

Example:

```text
JML-20260816-000982
        │
        ├── Lifecycle Trace
        ├── Workflow Trace
        ├── Provisioning Trace
        └── Connector Trace
```

---

# 66. Deployment Architecture

Recommended enterprise deployment:

```text
                    Load Balancer
                         │
                    API Gateway
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Identity       Workflow       Provisioning
       Service        Service          Service
          │              │              │
          └──────────────┼──────────────┘
                         │
                     Event Bus
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Task Engine   Policy Engine   Connector Runtime
                         │              │
                         │        ┌─────┼──────┐
                         │        ▼     ▼      ▼
                         │       AD    SAP    SaaS
                         │
                    Data Services
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Identity DB    Workflow DB    Audit Store
```

---

# 67. Design Principle — Reusability

The JML architecture must not contain functionality that only JML can use.

The following should be reusable:

```text
Workflow Engine
Provisioning Plan Engine
Task Engine
Approval Engine
Connector Framework
Policy Engine
Audit Framework
Notification Framework
```

This enables future capabilities without architectural redesign.

For example:

```text
JML
 │
 ├── Joiner
 ├── Mover
 ├── Leaver
 └── Rehire

Access Requests
 │
 ├── Request
 ├── Approval
 └── Provision

Certification Remediation
 │
 ├── Remove Access
 └── Provisioning

Policy Remediation
 │
 ├── Detect
 └── Remediate
```

All can reuse the same engines.

---

# 68. Recommended Initial Connector Priorities

For enterprise customers, prioritize:

### Tier 1

* Active Directory
* Microsoft Entra ID
* LDAP
* REST
* SCIM
* JDBC

### Tier 2

* Microsoft 365
* ServiceNow
* SAP
* Salesforce
* Workday
* Oracle

### Tier 3

* Custom REST
* SOAP
* PowerShell
* Mainframe
* Legacy applications

The generic REST/SCIM/LDAP/JDBC framework is more important initially than building dozens of proprietary connectors.

---

# 69. Recommended Development Sequence

## Sprint Group 1 — Platform Foundation

* Lifecycle state model
* Event model
* Correlation framework
* Workflow data model
* Task data model
* Provisioning plan model

## Sprint Group 2 — Workflow Runtime

* Workflow graph
* Node execution
* Conditions
* Variables
* Sequential execution
* Parallel execution
* Wait
* Retry

## Sprint Group 3 — Provisioning

* Plan builder
* Plan modifier
* Plan compiler
* Task generation
* Connector runtime

## Sprint Group 4 — Connectors

* AD
* Entra
* REST
* SCIM
* LDAP
* JDBC

## Sprint Group 5 — JML

* Joiner
* Mover
* Leaver
* Rehire
* Lifecycle states

## Sprint Group 6 — UI

* Workflow Designer
* Workflow Monitor
* Provisioning Plan
* Task Console
* Lifecycle Timeline

## Sprint Group 7 — Governance

* Audit
* Reporting
* SLA
* Escalation
* Simulation
* Verification

---

# 70. MVP Acceptance Criteria

The first production release should be considered successful when the following scenario can be executed without manual database intervention:

```text
1. HR creates employee
2. Identity Sphere detects identity
3. Joiner event generated
4. Identity profile evaluated
5. Birthright policies evaluated
6. Provisioning plan created
7. Workflow triggered
8. Manager approval requested
9. Approval completed
10. Security approval requested
11. Approval completed
12. Provisioning plan compiled
13. AD account created
14. M365 account created
15. ServiceNow account created
16. SAP task created
17. SAP connector executes
18. Target systems verified
19. Identity posture updated
20. Lifecycle timeline updated
21. Audit evidence generated
22. Complete transaction trace available
```

The entire transaction must be searchable using:

```text
Identity ID
Employee ID
Workflow ID
Provisioning Plan ID
Task ID
Correlation ID
```

---

# 71. Product Differentiation Opportunity

Wisibility should not attempt to differentiate purely by saying:

> "We have JML."

That is expected functionality.

A stronger differentiation is:

## **Intelligent, Observable Identity Lifecycle**

The product should make it exceptionally easy to understand:

> **Why was this access granted?**

> **Why was this access removed?**

> **Which policy caused it?**

> **Which workflow approved it?**

> **Who approved it?**

> **Which connector executed it?**

> **What happened in the target system?**

> **Was the resulting state verified?**

> **Can the entire lifecycle be reconstructed for an auditor?**

This creates a natural extension of Wisibility's existing compliance positioning.

---

# 72. Target Identity Lifecycle Experience

The ultimate user experience should be:

```text
                     RAVI KUMAR
                         │
              ┌──────────┴──────────┐
              │                     │
         Current State          Lifecycle
              │                     │
       ACTIVE / SALES        Joiner → Mover
              │               → Mover → ...
              │
       Current Access
              │
       ┌──────┴───────┐
       │              │
   Compliant       Exceptions
       │
       ▼
  Governance
       │
       ▼
  Lifecycle Action
       │
       ▼
  Workflow
       │
       ▼
  Provisioning Plan
       │
       ▼
  Tasks
       │
       ▼
  Connectors
       │
       ▼
  Target Systems
       │
       ▼
  Verification
       │
       ▼
  Audit Evidence
```

---

# 73. Final Architecture Principle

The fundamental architectural contract for Wisibility Identity Sphere JML should be:

> **The Lifecycle Engine determines WHAT happened.**
>
> **The Policy Engine determines WHAT SHOULD happen.**
>
> **The Provisioning Plan determines WHAT MUST CHANGE.**
>
> **The Workflow Engine determines HOW IT SHOULD HAPPEN.**
>
> **The Task Engine determines WHAT IS CURRENTLY BEING DONE.**
>
> **The Connector Engine determines HOW THE TARGET SYSTEM IS CHANGED.**
>
> **The Verification Engine determines WHETHER THE CHANGE ACTUALLY OCCURRED.**
>
> **The Evidence Layer proves WHAT HAPPENED, WHEN, WHY, AND BY WHOM.**

This separation should be treated as the **core architectural principle** for the implementation.

It prevents JML from becoming a collection of tightly coupled provisioning scripts and gives Identity Sphere a reusable foundation for a broader IGA platform.

---

# 74. Recommended Product Module Structure

The Identity Sphere navigation can ultimately evolve into:

```text
IDENTITY SPHERE

├── Dashboard
│
├── Identities
│   ├── Identity Directory
│   ├── Identity Profile
│   ├── Identity Posture
│   └── Lifecycle Timeline
│
├── Lifecycle
│   ├── Joiners
│   ├── Movers
│   ├── Leavers
│   ├── Rehires
│   ├── Lifecycle States
│   └── Lifecycle Policies
│
├── Access Governance
│   ├── Access Profiles
│   ├── Birthright Policies
│   ├── Access Requests
│   ├── Certifications
│   └── SoD
│
├── Provisioning
│   ├── Provisioning Plans
│   ├── Tasks
│   ├── Manual Fulfillment
│   └── Exceptions
│
├── Workflows
│   ├── Workflow Designer
│   ├── Workflow Catalog
│   ├── Workflow Monitor
│   └── Workflow History
│
├── Applications
│   ├── Applications
│   ├── Accounts
│   ├── Entitlements
│   └── Connectors
│
├── Governance
│   ├── Policies
│   ├── Compliance
│   ├── Audit
│   └── Reports
│
└── Administration
    ├── Configuration
    ├── Roles
    ├── Notifications
    ├── Integration
    └── System Monitoring
```

# 75. Final Recommendation

For the development team, the **highest-priority architectural decision** is to implement the platform around the following chain:

```text
IDENTITY
   ↓
LIFECYCLE EVENT
   ↓
POLICY DECISION
   ↓
ACCESS DELTA
   ↓
PROVISIONING PLAN
   ↓
WORKFLOW
   ↓
TASKS
   ↓
CONNECTORS
   ↓
TARGET SYSTEMS
   ↓
VERIFICATION
   ↓
IDENTITY POSTURE
   ↓
AUDIT EVIDENCE
```

If this chain is implemented correctly, **Joiner, Mover and Leaver become configurations of the platform rather than separate products/features**.

More importantly, the same architecture can subsequently power **Access Requests, Automated Remediation, Certification Remediation, Role Management and broader Identity Administration**.

That is the architecture I would recommend for taking Wisibility Identity Sphere from a **compliance-focused identity product to an enterprise-grade IGA platform**.