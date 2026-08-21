/** Graph node types (tenant + application scoped). */
export const GRAPH_NODE_TYPES = Object.freeze({
  USER: "USER",
  GROUP: "GROUP",
  ENTITLEMENT: "ENTITLEMENT",
  SERVICE: "SERVICE",
});

/** Directed relationship types stored on IdentityGraphEdge. */
export const GRAPH_EDGE_TYPES = Object.freeze({
  MEMBER_OF: "MEMBER_OF",
  NESTED_MEMBER_OF: "NESTED_MEMBER_OF",
  PRIVILEGED_ACCESS: "PRIVILEGED_ACCESS",
  ACL_CONTROL: "ACL_CONTROL",
  SERVICE_RELATIONSHIP: "SERVICE_RELATIONSHIP",
});

/** Default traversal safety limits (enterprise scale). */
export const GRAPH_DEFAULTS = Object.freeze({
  MAX_TRAVERSAL_DEPTH: 32,
  MAX_TRAVERSAL_NODES: 50_000,
  MAX_PATH_SEARCH_DEPTH: 16,
  EDGE_BATCH_SIZE: 1000,
  MATERIALIZE_USER_CHUNK: 500,
  MATERIALIZE_ENTITLEMENT_CHUNK: 200,
  CACHE_MAX_NODES: 10_000,
  CACHE_TTL_MS: 120_000,
});

/** Privileged group name heuristics (no AI). */
export const PRIVILEGED_NAME_TOKENS = [
  "domain admins",
  "enterprise admins",
  "schema admins",
  "administrators",
  "account operators",
  "backup operators",
  "server operators",
  "privileged",
  "admin",
];

export const TOXIC_PRIVILEGE_MIN_GROUPS = 2;
export const EXCESSIVE_PRIVILEGE_THRESHOLD = 5;
