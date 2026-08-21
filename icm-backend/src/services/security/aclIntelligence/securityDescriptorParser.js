import { parseSID } from "../../../utils/sidParser.js";
import { ACE_TYPES_WITH_ACCESS_MASK } from "./aceConstants.js";

const SD_CONTROL_SELF_RELATIVE = 0x8000;

function toBuffer(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
      try {
        return Buffer.from(trimmed, "base64");
      } catch {
        /* fall through */
      }
    }
    try {
      return Buffer.from(trimmed, "binary");
    } catch {
      return null;
    }
  }
  try {
    return Buffer.from(value);
  } catch {
    return null;
  }
}

/**
 * Parse binary SID at offset within buffer.
 * @param {Buffer} buf
 * @param {number} offset
 */
export function parseSidAtOffset(buf, offset) {
  if (!buf || offset < 0 || offset + 8 > buf.length) return "";
  const revision = buf.readUInt8(offset);
  const subCount = buf.readUInt8(offset + 1);
  const needed = 8 + subCount * 4;
  if (offset + needed > buf.length) return "";
  return parseSID(buf.subarray(offset, offset + needed));
}

/**
 * Parse one ACE starting at offset.
 * @param {Buffer} buf
 * @param {number} offset
 */
export function parseAceAtOffset(buf, offset) {
  if (!buf || offset + 4 > buf.length) return null;
  const aceType = buf.readUInt8(offset);
  const aceFlags = buf.readUInt8(offset + 1);
  const aceSize = buf.readUInt16LE(offset + 2);
  if (aceSize < 4 || offset + aceSize > buf.length) return null;

  let accessMask = 0;
  let trusteeSid = "";
  if (ACE_TYPES_WITH_ACCESS_MASK.has(aceType) && aceSize >= 12) {
    accessMask = buf.readUInt32LE(offset + 4);
    trusteeSid = parseSidAtOffset(buf, offset + 8);
  }

  return {
    aceType,
    aceFlags,
    aceSize,
    accessMask,
    trusteeSid,
    offset,
    rawType: aceType,
    isAllowed: aceType === 0x00 || aceType === 0x05,
    isDenied: aceType === 0x01 || aceType === 0x06,
  };
}

/**
 * Parse self-relative SECURITY_DESCRIPTOR (MS-DTYP 2.4.6).
 * @param {Buffer|Uint8Array|string|null} input
 * @returns {{
 *   revision: number,
 *   control: number,
 *   ownerSid: string,
 *   groupSid: string,
 *   dacl: { present: boolean, aces: object[] },
 *   sacl: { present: boolean, aces: object[] },
 *   rawLength: number,
 * }|null}
 */
export function parseSecurityDescriptor(input) {
  const buf = toBuffer(input);
  if (!buf || buf.length < 20) return null;

  const revision = buf.readUInt8(0);
  const control = buf.readUInt16LE(2);
  const ownerRel = buf.readUInt32LE(4);
  const groupRel = buf.readUInt32LE(8);
  const saclRel = buf.readUInt32LE(12);
  const daclRel = buf.readUInt32LE(16);

  const ownerSid =
    ownerRel > 0 && ownerRel < buf.length ? parseSidAtOffset(buf, ownerRel) : "";
  const groupSid =
    groupRel > 0 && groupRel < buf.length ? parseSidAtOffset(buf, groupRel) : "";

  function parseAcl(relativeOffset) {
    if (!relativeOffset || relativeOffset + 8 > buf.length) {
      return { present: false, aces: [], aclRevision: 0, aceCount: 0 };
    }
    const aclRevision = buf.readUInt8(relativeOffset);
    const aceCount = buf.readUInt16LE(relativeOffset + 2);
    const aclSize = buf.readUInt16LE(relativeOffset + 4);
    const aces = [];
    let cursor = relativeOffset + 8;
    const aclEnd = Math.min(relativeOffset + aclSize, buf.length);
    let parsed = 0;
    while (cursor + 4 <= aclEnd && parsed < aceCount) {
      const ace = parseAceAtOffset(buf, cursor);
      if (!ace || ace.aceSize < 4) break;
      aces.push(ace);
      cursor += ace.aceSize;
      parsed += 1;
    }
    return {
      present: true,
      aclRevision,
      aceCount,
      aces,
    };
  }

  const dacl = parseAcl(daclRel);
  const sacl = parseAcl(saclRel);

  return {
    revision,
    control,
    selfRelative: (control & SD_CONTROL_SELF_RELATIVE) !== 0,
    ownerSid,
    groupSid,
    dacl,
    sacl,
    rawLength: buf.length,
  };
}

/**
 * Extract nTSecurityDescriptor from synced LDAP rawData.
 * @param {object} raw
 */
export function extractSecurityDescriptorRaw(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  return (
    raw.nTSecurityDescriptor ??
    raw.ntSecurityDescriptor ??
    raw["nTSecurityDescriptor;binary"] ??
    null
  );
}

/**
 * Flatten DACL + SACL ACEs from parsed descriptor.
 * @param {ReturnType<typeof parseSecurityDescriptor>} parsed
 */
export function listDescriptorAces(parsed) {
  if (!parsed) return [];
  const out = [];
  for (const ace of parsed.dacl?.aces || []) {
    out.push({ ...ace, aclType: "DACL" });
  }
  for (const ace of parsed.sacl?.aces || []) {
    out.push({ ...ace, aclType: "SACL" });
  }
  return out;
}
