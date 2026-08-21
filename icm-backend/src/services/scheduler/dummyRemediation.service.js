import mongoose from 'mongoose';

const EVENT_TYPES = [
  { eventType: 'ACCESS_REVOKE', eventName: 'SAP_AUDIT_VIEW' },
  { eventType: 'ACCESS_REVOKE', eventName: 'SAP_ORDER_APPROVE' },
  { eventType: 'ACCESS_REVOKE', eventName: 'FINANCE_REPORT_ACCESS' },
];
const WORKFLOWS = [
  { workflowId: '6a26bf099287fd327b2d70d8', workflowName: 'Revoke Notify' },
  { workflowId: '6b37cf1a9287fe437c3d80f9', workflowName: 'Revoke Escalation' },
];
const CAMPAIGNS = [
  { campaignId: '6a3163923f91bba56282d1b8', campaignName: 'SAP Certification revoke user Campaign' },
  { campaignId: '6b4265823f91cca55283d2a1', campaignName: 'Finance Access Review Campaign' },
];
const APPLICATIONS = [
  { applicationId: '6a0c9631ef2e72d877e56699', applicationName: 'SAP' },
  { applicationId: '6b1d8731ef2e72d877e56700', applicationName: 'Workday' },
];
const IDENTITIES = [
  { identityId: 'marta.huang', identityName: 'Marta Huang', identityEmail: 'marta.huang@wisibility.lcl' },
  { identityId: 'amit.kumar', identityName: 'Amit Kumar', identityEmail: 'amit.kumar@wisibility.lcl' },
  { identityId: 'nisha.patel', identityName: 'Nisha Patel', identityEmail: 'nisha.patel@wisibility.lcl' },
];
const EVENT_OWNERS = ['amitkumarsahoo1010@gmail.com', 'ops-team@wisibility.lcl', 'security@wisibility.lcl'];

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export async function createDummyRecords(orgId, count = 5) {
  const col = mongoose.connection.collection('remediation_workflow_executions');
  const tid = orgId == null ? null : String(orgId);
  const now = new Date();
  const docs = [];

  for (let i = 0; i < count; i++) {
    const event = randomItem(EVENT_TYPES);
    const workflow = randomItem(WORKFLOWS);
    const campaign = randomItem(CAMPAIGNS);
    const app = randomItem(APPLICATIONS);
    const identity = randomItem(IDENTITIES);

    docs.push({
      tenantId: tid,
      orgId: tid,
      executionId: makeId('exec_'),
      eventType: event.eventType,
      eventName: event.eventName,
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      reviewItemId: makeId('rev_'),
      entitlementName: event.eventName,
      applicationId: app.applicationId,
      applicationName: app.applicationName,
      identityId: identity.identityId,
      identityName: identity.identityName,
      eventOwner: randomItem(EVENT_OWNERS),
      status: 'NEW',
      stepStatuses: ['Queued'],
      currentStepLabel: 'Verify Access Removed',
      currentNodeId: 'verify',
      currentNodeName: 'Verify Access Removed',
      triggerPayload: {
        decision: 'Revoke',
        identityId: identity.identityId,
        identityName: identity.identityName,
        identityEmail: identity.identityEmail,
        managerEmail: '',
        managerName: '',
        applicationId: app.applicationId,
        applicationName: app.applicationName,
        entitlementId: '',
        entitlementName: event.eventName,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        reviewItemId: makeId('rev_'),
        provisioningAction: 'REMOVE_ENTITLEMENT',
        nativeIdentity: '',
      },
      waitReason: null,
      checkpointNodeId: null,
      nextPollAt: null,
      pollIntervalMs: null,
      reminderPhaseIndex: 0,
      reminderEmailConfig: null,
      provisioningRequestId: null,
      itsmTicketStatus: null,
      failureReasonCode: null,
      failureReasonLabel: null,
      failureReasonDetail: null,
      runId: makeId('run_'),
      runIds: [],
      durationMs: null,
      errorMessage: null,
      ticketEventId: null,
      isSchedulerTestRecord: true,
      createdBy: 'scheduler-module',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    });
  }

  const res = await col.insertMany(docs);
  return res.insertedCount ?? docs.length;
}

export async function deleteDummyRecords(orgId) {
  const col = mongoose.connection.collection('remediation_workflow_executions');
  const tid = orgId == null ? null : String(orgId);
  const filter = {
    isSchedulerTestRecord: true,
    $or: [{ tenantId: tid }, { orgId: tid }],
  };
  const res = await col.deleteMany(filter);
  return res.deletedCount ?? 0;
}
