/** Known auth/session paths → friendly action labels. */
const PATH_ACTIONS = {
  '/api/auth/profile': { GET: 'get_profile', PUT: 'update_profile' },
  '/api/auth/change-password': { PUT: 'change_password' },
  '/api/auth/logout': { POST: 'logout' },
  '/api/auth/login': { POST: 'login' },
  '/api/auth/users': { GET: 'list_users', POST: 'bulk_import_users' },
};

/**
 * Build a snake_case action name from an API path (no HTTP method).
 * `/api/workflow-remediation/check-queued` → `workflow_remediation_check_queued`
 */
export function pathToActionName(path) {
  if (!path) return '';
  const pathOnly = String(path).split('?')[0];
  const segments = pathOnly
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .filter((s) => !/^[0-9a-fA-F]{24}$/.test(s) && !s.startsWith(':'));
  return segments.join('_');
}

/**
 * Display label for an audit row. Rewrites legacy `api_call` and
 * `METHOD /api/...` values using the request path so Method is not duplicated.
 */
export function formatAuditAction(action, path, method) {
  const raw = (action || '').trim();
  const pathOnly = (path || '').split('?')[0];
  const methodKey = (method || '').toUpperCase();

  const mapped = PATH_ACTIONS[pathOnly]?.[methodKey];
  if (mapped) return mapped;

  // "POST /api/foo/bar" (legacy auditTrail format)
  const methodPrefixed = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i.exec(raw);
  if (methodPrefixed) {
    const fromActionPath = pathToActionName(methodPrefixed[2]);
    if (fromActionPath) return fromActionPath;
  }

  // Generic session tracker placeholder
  if (!raw || raw === 'api_call') {
    const fromPath = pathToActionName(pathOnly);
    if (fromPath) return fromPath;
    return raw || '—';
  }

  return raw;
}
