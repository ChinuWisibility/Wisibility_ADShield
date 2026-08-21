import Campaign from '../src/models/certification/Campaign.js';
import ReviewItem from '../src/models/certification/ReviewItem.js';
import CampaignReminderLog from '../src/models/certification/CampaignReminderLog.js';
import CertificationSchedule from '../src/models/certification/CertificationSchedule.js';
import CertificationReport from '../src/models/certification/CertificationReport.js';
import CertificationEscalation from '../src/models/certification/CertificationEscalation.js';
import CertificationSignOff from '../src/models/certification/CertificationSignOff.js';
import EmailReminderSettings from '../src/models/certification/EmailReminderSettings.js';
import CertificationReviewerActionLog from '../src/models/certification/CertificationReviewerActionLog.js';
import CertificationReviewerPortalSession from '../src/models/certification/CertificationReviewerPortalSession.js';
import CertificationProfileSnapshot from '../src/models/certification/CertificationProfileSnapshot.js';
import CertificationDecisionOverride from '../src/models/certification/CertificationDecisionOverride.js';
import CertificationEscalationChain from '../src/models/certification/CertificationEscalationChain.js';

import Entitlement from '../src/models/access/Entitlement.js';
import EntitlementHierarchy from '../src/models/access/EntitlementHierarchy.js';
import EntitlementOwnershipReview from '../src/models/access/EntitlementOwnershipReview.js';
import AccountAggregation from '../src/models/access/AccountAggregation.js';
import AccountLifecycleLog from '../src/models/access/AccountLifecycleLog.js';

import SodEntitlement from '../src/models/sod/SodEntitlement.js';
import SodUserEntitlement from '../src/models/sod/SodUserEntitlement.js';
import SodPolicy from '../src/models/sod/SodPolicy.js';
import SodViolation from '../src/models/sod/SodViolation.js';

import AccessOutlier from '../src/models/accessIntelligence/AccessOutlier.js';
import AccessRecommendation from '../src/models/accessIntelligence/AccessRecommendation.js';
import RiskTrendSnapshot from '../src/models/accessIntelligence/RiskTrendSnapshot.js';

import Application from '../src/models/application/Application.js';
import UploadHistory from '../src/models/application/UploadHistory.js';
import ApplicationType from '../src/models/application/ApplicationType.js';
import ApplicationConnectionConfig from '../src/models/application/ApplicationConnectionConfig.js';
import ApplicationRiskProfile from '../src/models/application/ApplicationRiskProfile.js';
import ConnectorConfig from '../src/models/application/ConnectorConfig.js';
import IntegrationLog from '../src/models/application/IntegrationLog.js';

import Identity from '../src/models/identity/Identity.js';
import IdentitySnapshot from '../src/models/identity/IdentitySnapshot.js';
import IdentityAccountLink from '../src/models/identity/IdentityAccountLink.js';
import ManagerHierarchy from '../src/models/identity/ManagerHierarchy.js';
import OrphanAccount from '../src/models/identity/OrphanAccount.js';
import LifecycleEvent from '../src/models/identity/LifecycleEvent.js';
import ContractorProfile from '../src/models/identity/ContractorProfile.js';
import TenantCorrelationStats from '../src/models/identity/TenantCorrelationStats.js';

import ProvisioningRequest from '../src/models/provisioning/ProvisioningRequest.js';
import ProvisioningPlan from '../src/models/provisioning/ProvisioningPlan.js';
import ProvisioningTask from '../src/models/provisioning/ProvisioningTask.js';
import ProvisioningResult from '../src/models/provisioning/ProvisioningResult.js';
import DeprovisioningRecord from '../src/models/provisioning/DeprovisioningRecord.js';

import Role from '../src/models/access/Role.js';
import RoleEntitlement from '../src/models/access/RoleEntitlement.js';

import UnifiedAuditEvent from '../src/models/compliance/UnifiedAuditEvent.js';
import TaskExecution from '../src/models/compliance/TaskExecution.js';
import ComplianceFramework from '../src/models/compliance/ComplianceFramework.js';
import ComplianceEvidence from '../src/models/compliance/ComplianceEvidence.js';
import ComplianceMapping from '../src/models/compliance/ComplianceMapping.js';
import ReportDefinition from '../src/models/compliance/ReportDefinition.js';
import ReportHistory from '../src/models/compliance/ReportHistory.js';

import DataHygieneReport from '../src/models/dataHygiene/DataHygieneReport.js';
import DormantAccountRecord from '../src/models/dataHygiene/DormantAccountRecord.js';
import EntitlementHygieneRule from '../src/models/dataHygiene/EntitlementHygieneRule.js';
import EntitlementHygieneFinding from '../src/models/dataHygiene/EntitlementHygieneFinding.js';

import DetectionRuleSet from '../src/models/detectionNhi/DetectionRuleSet.js';
import NHIProfile from '../src/models/detectionNhi/NHIProfile.js';
import PrivilegedAccessRecord from '../src/models/detectionNhi/PrivilegedAccessRecord.js';
import SecurityAlert from '../src/models/detectionNhi/SecurityAlert.js';

import EmailConfiguration from '../src/models/notifications/EmailConfiguration.js';
import NotificationQueue from '../src/models/notifications/NotificationQueue.js';

import GovernancePolicy from '../src/models/governance/GovernancePolicy.js';
import DataRetentionPolicy from '../src/models/governance/DataRetentionPolicy.js';
import AuditComment from '../src/models/governance/AuditComment.js';
import RiskMatrix from '../src/models/governance/RiskMatrix.js';

import User from '../src/models/platform/User.js';
import Activity from '../src/models/platform/Activity.js';
import Audit from '../src/models/platform/Audit.js';
import AuditExportJob from '../src/models/platform/AuditExportJob.js';
import SystemConfiguration from '../src/models/platform/SystemConfiguration.js';
import TenantConfig from '../src/models/platform/TenantConfig.js';
import MFAConfiguration from '../src/models/platform/MFAConfiguration.js';

export default async function ensureIndexes() {
  await Promise.all([
    // Certification
    Campaign.syncIndexes(),
    ReviewItem.syncIndexes(),
    CampaignReminderLog.syncIndexes(),
    CertificationSchedule.syncIndexes(),
    CertificationReport.syncIndexes(),
    CertificationEscalation.syncIndexes(),
    CertificationSignOff.syncIndexes(),
    EmailReminderSettings.syncIndexes(),
    CertificationReviewerActionLog.syncIndexes(),
    CertificationReviewerPortalSession.syncIndexes(),
    CertificationProfileSnapshot.syncIndexes(),
    CertificationDecisionOverride.syncIndexes(),
    CertificationEscalationChain.syncIndexes(),

    // Access & Entitlements
    Entitlement.syncIndexes(),
    EntitlementHierarchy.syncIndexes(),
    EntitlementOwnershipReview.syncIndexes(),
    AccountAggregation.syncIndexes(),
    AccountLifecycleLog.syncIndexes(),

    // SoD
    SodEntitlement.syncIndexes(),
    SodUserEntitlement.syncIndexes(),
    SodPolicy.syncIndexes(),
    SodViolation.syncIndexes(),

    // Access Intelligence
    AccessOutlier.syncIndexes(),
    AccessRecommendation.syncIndexes(),
    RiskTrendSnapshot.syncIndexes(),

    // Application
    Application.syncIndexes(),
    UploadHistory.syncIndexes(),
    ApplicationType.syncIndexes(),
    ApplicationConnectionConfig.syncIndexes(),
    ApplicationRiskProfile.syncIndexes(),
    ConnectorConfig.syncIndexes(),
    IntegrationLog.syncIndexes(),

    // Identity
    Identity.syncIndexes(),
    IdentitySnapshot.syncIndexes(),
    IdentityAccountLink.syncIndexes(),
    ManagerHierarchy.syncIndexes(),
    OrphanAccount.syncIndexes(),
    LifecycleEvent.syncIndexes(),
    ContractorProfile.syncIndexes(),
    TenantCorrelationStats.syncIndexes(),

    // Provisioning & Roles
    ProvisioningRequest.syncIndexes(),
    ProvisioningPlan.syncIndexes(),
    ProvisioningTask.syncIndexes(),
    ProvisioningResult.syncIndexes(),
    DeprovisioningRecord.syncIndexes(),
    Role.syncIndexes(),
    RoleEntitlement.syncIndexes(),

    // Compliance & Audit
    UnifiedAuditEvent.syncIndexes(),
    TaskExecution.syncIndexes(),
    ComplianceFramework.syncIndexes(),
    ComplianceEvidence.syncIndexes(),
    ComplianceMapping.syncIndexes(),
    ReportDefinition.syncIndexes(),
    ReportHistory.syncIndexes(),

    // Data Hygiene
    DataHygieneReport.syncIndexes(),
    DormantAccountRecord.syncIndexes(),
    EntitlementHygieneRule.syncIndexes(),
    EntitlementHygieneFinding.syncIndexes(),

    // Detection & NHI
    DetectionRuleSet.syncIndexes(),
    NHIProfile.syncIndexes(),
    PrivilegedAccessRecord.syncIndexes(),
    SecurityAlert.syncIndexes(),

    // Notifications
    EmailConfiguration.syncIndexes(),
    NotificationQueue.syncIndexes(),

    // Governance & Platform
    GovernancePolicy.syncIndexes(),
    DataRetentionPolicy.syncIndexes(),
    AuditComment.syncIndexes(),
    RiskMatrix.syncIndexes(),
    User.syncIndexes(),
    Activity.syncIndexes(),
    Audit.syncIndexes(),
    AuditExportJob.syncIndexes(),
    SystemConfiguration.syncIndexes(),
    TenantConfig.syncIndexes(),
    MFAConfiguration.syncIndexes(),
  ]);
}

