const NOISY_PREFIXES = new Set([
  "ACCESS",
  "ADM",
  "ADMIN",
  "ADMINS",
  "ALL",
  "APP",
  "APPLICATION",
  "AUTH",
  "BUILTIN",
  "DEFAULT",
  "DIRECTORY",
  "DOMAIN",
  "GLOBAL",
  "GRP",
  "GROUP",
  "GROUPS",
  "LOCAL",
  "ROLE",
  "ROLES",
  "SEC",
  "SECURITY",
  "TEAM",
  "USER",
  "USERS",
]);

const ENV_PREFIXES = new Set([
  "DEV",
  "INT",
  "LAB",
  "NONPROD",
  "PREPROD",
  "PROD",
  "PRD",
  "QA",
  "SIT",
  "STAGE",
  "STAGING",
  "TEST",
  "UAT",
]);

function sanitizeToken(token) {
  return String(token || "")
    .trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function isWeakPrefix(token) {
  const clean = sanitizeToken(token);
  if (!clean) return true;
  if (clean.length < 2) return true;
  if (/^\d+$/.test(clean)) return true;
  return NOISY_PREFIXES.has(clean.toUpperCase());
}

export function detectAppPrefix(groupName) {
  const raw = String(groupName || "").trim();
  if (!raw) return "";

  const parts = raw
    .split(/[^A-Za-z0-9]+/)
    .map(sanitizeToken)
    .filter(Boolean);

  if (!parts.length) return "";

  let idx = 0;
  while (idx < parts.length && ENV_PREFIXES.has(parts[idx].toUpperCase())) {
    idx += 1;
  }

  for (; idx < parts.length; idx += 1) {
    const candidate = parts[idx];
    if (isWeakPrefix(candidate)) continue;
    return candidate.toUpperCase();
  }

  return "";
}

function compareGroups(a, b) {
  const nameCmp = String(a?.groupName || "").localeCompare(String(b?.groupName || ""), undefined, {
    sensitivity: "base",
  });
  if (nameCmp !== 0) return nameCmp;
  return String(a?.groupDN || "").localeCompare(String(b?.groupDN || ""), undefined, {
    sensitivity: "base",
  });
}

export function clusterGroupsByPrefix(groups) {
  if (!Array.isArray(groups) || !groups.length) return [];

  const clusters = new Map();

  for (const group of groups) {
    const normalized = {
      groupName: String(group?.groupName || "").trim(),
      groupDN: String(group?.groupDN || "").trim(),
      members: Array.isArray(group?.members) ? group.members.filter(Boolean) : [],
    };
    if (!normalized.groupName && !normalized.groupDN) continue;

    const prefix = detectAppPrefix(normalized.groupName || normalized.groupDN);
    if (!prefix) continue;

    if (!clusters.has(prefix)) {
      clusters.set(prefix, {
        appName: prefix,
        groups: [],
      });
    }

    clusters.get(prefix).groups.push(normalized);
  }

  return [...clusters.values()]
    .map((cluster) => ({
      appName: cluster.appName,
      groups: [...cluster.groups].sort(compareGroups),
    }))
    .sort((a, b) => {
      if (b.groups.length !== a.groups.length) return b.groups.length - a.groups.length;
      return a.appName.localeCompare(b.appName, undefined, { sensitivity: "base" });
    });
}
