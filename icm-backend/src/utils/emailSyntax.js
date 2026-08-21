const EMAIL_SYNTAX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function normalizeEmailAddress(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmailSyntax(value) {
  const email = normalizeEmailAddress(value);
  if (!email || email.length > 254) return false;
  const [local] = email.split("@");
  if (!local || local.length > 64) return false;
  return EMAIL_SYNTAX.test(email);
}
