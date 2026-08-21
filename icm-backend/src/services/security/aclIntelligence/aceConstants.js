/** Windows access mask bits used by ACL intelligence (MS-DTYP / MS-ADTS). */
export const ACCESS_MASK = Object.freeze({
  GENERIC_ALL: 0x10000000,
  GENERIC_WRITE: 0x40000000,
  WRITE_DAC: 0x00040000,
  WRITE_OWNER: 0x00080000,
  DELETE: 0x00010000,
  READ_CONTROL: 0x00020000,
});

/** Rights that indicate shadow-admin / takeover capability on AD objects. */
export const SHADOW_ADMIN_ACCESS_MASK =
  ACCESS_MASK.GENERIC_ALL |
  ACCESS_MASK.GENERIC_WRITE |
  ACCESS_MASK.WRITE_DAC |
  ACCESS_MASK.WRITE_OWNER;

export const DANGEROUS_RIGHT_LABELS = Object.freeze({
  [ACCESS_MASK.GENERIC_ALL]: "GenericAll",
  [ACCESS_MASK.GENERIC_WRITE]: "GenericWrite",
  [ACCESS_MASK.WRITE_DAC]: "WriteDACL",
  [ACCESS_MASK.WRITE_OWNER]: "WriteOwner",
});

/**
 * @param {number} accessMask
 * @returns {string[]}
 */
export function describeDangerousRights(accessMask) {
  const mask = Number(accessMask) || 0;
  const labels = [];
  for (const [bit, label] of Object.entries(DANGEROUS_RIGHT_LABELS)) {
    if (mask & Number(bit)) labels.push(label);
  }
  return labels;
}

/**
 * @param {number} accessMask
 * @returns {boolean}
 */
export function hasShadowAdminRights(accessMask) {
  const mask = Number(accessMask) || 0;
  return (mask & SHADOW_ADMIN_ACCESS_MASK) !== 0;
}

/** ACE type constants (MS-DTYP). */
export const ACE_TYPE = Object.freeze({
  ACCESS_ALLOWED: 0x00,
  ACCESS_DENIED: 0x01,
  SYSTEM_AUDIT: 0x02,
  ACCESS_ALLOWED_OBJECT: 0x05,
  ACCESS_DENIED_OBJECT: 0x06,
});

export const ACE_TYPES_WITH_ACCESS_MASK = new Set([
  ACE_TYPE.ACCESS_ALLOWED,
  ACE_TYPE.ACCESS_DENIED,
  ACE_TYPE.SYSTEM_AUDIT,
  ACE_TYPE.ACCESS_ALLOWED_OBJECT,
  ACE_TYPE.ACCESS_DENIED_OBJECT,
]);
