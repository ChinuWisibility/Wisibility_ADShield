/**
 * Parse Active Directory objectSid binary value to string form (S-1-5-21-...).
 * @param {Buffer|Uint8Array|string|null|undefined} buffer
 * @returns {string}
 */
function parseSID(buffer) {
  if (buffer == null) return "";
  let b;
  try {
    b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  } catch {
    return "";
  }
  if (b.length < 8) return "";

  const revision = b.readUInt8(0);
  const subCount = b.readUInt8(1);
  let authority = 0n;
  for (let i = 2; i <= 7; i += 1) {
    authority = (authority << 8n) + BigInt(b[i]);
  }

  const parts = [`S-${revision}-${authority.toString()}`];
  let offset = 8;
  for (let i = 0; i < subCount && offset + 4 <= b.length; i += 1) {
    parts.push(String(b.readUInt32LE(offset)));
    offset += 4;
  }
  return parts.join("-");
}

export { parseSID };
export default parseSID;
