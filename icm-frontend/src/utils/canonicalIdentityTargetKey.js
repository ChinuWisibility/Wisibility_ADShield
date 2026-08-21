/**
 * Align list/detail UI reads with backend identity refresh canonical keys
 * (identityProfileMappingUtils.canonicalIdentityMappingTargetKey).
 */
export function canonicalIdentityMappingTargetKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return raw;
  const n = raw.replace(/_/g, '').toLowerCase();
  const aliases = {
    workemail: 'email',
    useremail: 'email',
    primaryemail: 'email',
    givenname: 'firstname',
    familyname: 'lastname',
    surname: 'lastname',
    firstname: 'firstname',
    lastname: 'lastname',
    email: 'email',
    uid: 'uid',
    employeeid: 'employeeId',
    department: 'department',
    title: 'title',
    phone: 'phone',
    displayname: 'displayName',
    manageremail: 'managerEmail',
    manageremployeeid: 'managerEmployeeId',
    startdate: 'startDate',
    status: 'status',
  };
  return Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : raw;
}
