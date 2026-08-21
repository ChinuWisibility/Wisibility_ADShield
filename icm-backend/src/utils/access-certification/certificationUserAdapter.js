import {
  pickFromRawData,
  resolveUserDepartment as _resolveUserDepartment,
  resolveUserTitle as _resolveUserTitle,
  resolveUserManagerEmail as _resolveUserManagerEmail,
} from './certificationUserDisplay.js';

export function adaptUserToSnapshotRow(row) {
  const raw = row.rawData || {};

  const name =
    row.display_name   ||
    row.displayName    ||
    row.name           ||
    [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
    row.identityName   ||
    row.userName       ||
    row.email          ||
    row.employeeId     ||
    '';

  const email        = row.email         || row.identityEmail  || pickFromRawData(raw, 'email', 'mail') || '';
  const manager      = row.manager_name  || row.manager        || pickFromRawData(raw, 'manager', 'supervisor', 'reports_to') || '';
  const managerEmail = row.managerEmail  || row.manager_email  || _resolveUserManagerEmail(raw) || '';
  const department   = row.department    || _resolveUserDepartment(raw) || '';
  const title        = row.title         || row.role           || _resolveUserTitle(raw) || '';
  const access       = row.member_of_entitlements || row.memberOf || row.displayAccess || '';

  return {
    ...row,
    name,
    display_name:            name,
    displayName:             name,
    email,
    manager,
    managerEmail,
    department,
    title,
    member_of_entitlements:  access,
    memberOf:                access,
  };
}

