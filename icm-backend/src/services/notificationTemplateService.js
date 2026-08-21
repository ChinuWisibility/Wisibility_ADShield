import NotificationTemplate from '../models/platform/NotificationTemplate.js';
import { AppError } from '../middleware/errorHandler.js';

const DEFAULT_TEMPLATES = {
  'password-reset': {
    templateKey: 'password-reset',
    subject: 'Password Reset',
    bodyHtml: '<p>Hello {{firstName}},</p><p>Your password has been reset. Your temporary password is: <strong>{{tempPassword}}</strong></p>',
    bodyText: 'Hello {{firstName}}, Your password has been reset. Your temporary password is: {{tempPassword}}',
    variables: ['firstName', 'tempPassword'],
    channel: 'EMAIL',
    isActive: true,
  },
  'welcome': {
    templateKey: 'welcome',
    subject: 'Welcome to ICM Platform',
    bodyHtml: '<p>Welcome {{firstName}} {{lastName}}!</p><p>Your account has been created. Please login at {{loginUrl}}</p>',
    bodyText: 'Welcome {{firstName}} {{lastName}}! Your account has been created. Please login at {{loginUrl}}',
    variables: ['firstName', 'lastName', 'loginUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
  'certification-reminder': {
    templateKey: 'certification-reminder',
    subject: 'Certification Review Reminder',
    bodyHtml: '<p>Hello {{reviewerName}},</p><p>Campaign <strong>{{campaignName}}</strong> has {{pendingItems}} items pending your review. Due date: {{dueDate}}</p>',
    bodyText: 'Hello {{reviewerName}}, Campaign {{campaignName}} has {{pendingItems}} items pending. Due: {{dueDate}}',
    variables: ['reviewerName', 'campaignName', 'pendingItems', 'dueDate'],
    channel: 'EMAIL',
    isActive: true,
  },
  'remediation-revoke-access': {
    templateKey: 'remediation-revoke-access',
    subject: 'Remediation Required: Revoke Access',
    bodyHtml: '<p>Hello,</p><p>A remediation event requires access revocation.</p><p><strong>User:</strong> {{identityName}} ({{identityEmail}})<br/><strong>Account:</strong> {{accountId}}<br/><strong>Application:</strong> {{applicationName}}</p><p><strong>Ticket:</strong> {{ticketId}} ({{ticketStatus}})</p><p>{{description}}</p><p>Open remediation workspace: <a href="{{remediationUrl}}">{{remediationUrl}}</a></p>',
    bodyText: 'A remediation event requires access revocation. User: {{identityName}} ({{identityEmail}}), Account: {{accountId}}, Application: {{applicationName}}, Ticket: {{ticketId}} ({{ticketStatus}}). {{description}} Remediation: {{remediationUrl}}',
    variables: ['identityName', 'identityEmail', 'accountId', 'applicationName', 'ticketId', 'ticketStatus', 'description', 'remediationUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
  'remediation-missing-manager': {
    templateKey: 'remediation-missing-manager',
    subject: 'Remediation Required: Missing Manager',
    bodyHtml: '<p>Hello,</p><p>A remediation event detected a missing manager.</p><p><strong>User:</strong> {{identityName}} ({{identityEmail}})</p><p><strong>Ticket:</strong> {{ticketId}} ({{ticketStatus}})</p><p>{{description}}</p><p>Open remediation workspace: <a href="{{remediationUrl}}">{{remediationUrl}}</a></p>',
    bodyText: 'A remediation event detected a missing manager. User: {{identityName}} ({{identityEmail}}). Ticket: {{ticketId}} ({{ticketStatus}}). {{description}} Remediation: {{remediationUrl}}',
    variables: ['identityName', 'identityEmail', 'ticketId', 'ticketStatus', 'description', 'remediationUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
  'remediation-duplicate-account': {
    templateKey: 'remediation-duplicate-account',
    subject: 'Remediation Required: Duplicate Account',
    bodyHtml: '<p>Hello,</p><p>A remediation event detected a duplicate account.</p><p><strong>User:</strong> {{identityName}} ({{identityEmail}})<br/><strong>Account:</strong> {{accountId}}<br/><strong>Application:</strong> {{applicationName}}</p><p><strong>Ticket:</strong> {{ticketId}} ({{ticketStatus}})</p><p>{{description}}</p><p>Open remediation workspace: <a href="{{remediationUrl}}">{{remediationUrl}}</a></p>',
    bodyText: 'A remediation event detected a duplicate account. User: {{identityName}} ({{identityEmail}}), Account: {{accountId}}, Application: {{applicationName}}, Ticket: {{ticketId}} ({{ticketStatus}}). {{description}} Remediation: {{remediationUrl}}',
    variables: ['identityName', 'identityEmail', 'accountId', 'applicationName', 'ticketId', 'ticketStatus', 'description', 'remediationUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
  'remediation-orphan-account': {
    templateKey: 'remediation-orphan-account',
    subject: 'Remediation Required: Orphan Account',
    bodyHtml: '<p>Hello,</p><p>A remediation event detected an orphan account.</p><p><strong>Account:</strong> {{accountId}}<br/><strong>Application:</strong> {{applicationName}}</p><p><strong>Ticket:</strong> {{ticketId}} ({{ticketStatus}})</p><p>{{description}}</p><p>Open remediation workspace: <a href="{{remediationUrl}}">{{remediationUrl}}</a></p>',
    bodyText: 'A remediation event detected an orphan account. Account: {{accountId}}, Application: {{applicationName}}, Ticket: {{ticketId}} ({{ticketStatus}}). {{description}} Remediation: {{remediationUrl}}',
    variables: ['accountId', 'applicationName', 'ticketId', 'ticketStatus', 'description', 'remediationUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
  'remediation-revoke-privileged-access': {
    templateKey: 'remediation-revoke-privileged-access',
    subject: 'Remediation Required: Revoke Privileged Access',
    bodyHtml: '<p>Hello,</p><p>A remediation event requires privileged access revocation.</p><p><strong>User:</strong> {{identityName}} ({{identityEmail}})<br/><strong>Account:</strong> {{accountId}}<br/><strong>Application:</strong> {{applicationName}}</p><p><strong>Ticket:</strong> {{ticketId}} ({{ticketStatus}})</p><p>{{description}}</p><p>Open remediation workspace: <a href="{{remediationUrl}}">{{remediationUrl}}</a></p>',
    bodyText: 'A remediation event requires privileged access revocation. User: {{identityName}} ({{identityEmail}}), Account: {{accountId}}, Application: {{applicationName}}, Ticket: {{ticketId}} ({{ticketStatus}}). {{description}} Remediation: {{remediationUrl}}',
    variables: ['identityName', 'identityEmail', 'accountId', 'applicationName', 'ticketId', 'ticketStatus', 'description', 'remediationUrl'],
    channel: 'EMAIL',
    isActive: true,
  },
};

export async function listTemplates({ page = 1, limit = 20, channel }) {
  const query = {};
  if (channel) query.channel = channel;

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    NotificationTemplate.find(query).sort({ templateKey: 1 }).skip(skip).limit(Number(limit)),
    NotificationTemplate.countDocuments(query),
  ]);

  return { items, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) };
}

export async function getTemplate(key) {
  const template = await NotificationTemplate.findOne({ templateKey: key });
  if (!template) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
  return template;
}

export async function updateTemplate(key, updates) {
  const allowed = ['subject', 'bodyHtml', 'bodyText', 'variables', 'channel', 'isActive'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));

  const template = await NotificationTemplate.findOneAndUpdate(
    { templateKey: key },
    filtered,
    { new: true, runValidators: true }
  );
  if (!template) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
  return template;
}

export async function previewTemplate(key, { sampleData = {} }) {
  const template = await NotificationTemplate.findOne({ templateKey: key });
  if (!template) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');

  let renderedSubject = template.subject || '';
  let renderedHtml = template.bodyHtml || '';
  let renderedText = template.bodyText || '';

  for (const [variable, value] of Object.entries(sampleData)) {
    const pattern = new RegExp(`\\{\\{${variable}\\}\\}`, 'g');
    renderedSubject = renderedSubject.replace(pattern, String(value));
    renderedHtml = renderedHtml.replace(pattern, String(value));
    renderedText = renderedText.replace(pattern, String(value));
  }

  return { subject: renderedSubject, bodyHtml: renderedHtml, bodyText: renderedText };
}

export async function resetTemplate(key) {
  const defaults = DEFAULT_TEMPLATES[key];
  if (!defaults) throw new AppError('No default template exists for this key', 404, 'NO_DEFAULT_TEMPLATE');

  const template = await NotificationTemplate.findOneAndUpdate(
    { templateKey: key },
    defaults,
    { new: true, upsert: true }
  );
  return template;
}
