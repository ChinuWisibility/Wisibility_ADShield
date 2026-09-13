import { getConnectorDefinition } from '../../config/connectorCatalog.js';
import {
  normalizeAdConfig,
  testAdConnection,
  fetchAdUsers,
  testGenericLdapConnection,
  fetchGenericLdapUsers,
} from '../ad/adLdapService.js';
import { testJdbcConnection, fetchJdbcUsers } from './jdbcConnectorService.js';
import {
  testRestBearer,
  fetchRestUsers,
  testScimConnection,
  fetchScimUsers,
} from './httpConnectorService.js';
import { testAwsIamConnection, fetchAwsIamUsers } from './awsIamConnectorService.js';
import { testFileConnector, fetchFileUsers } from './fileConnectorService.js';
import { testGraphConnection, fetchGraphUsers } from './graphConnectorService.js';

const MAX_USERS = 50000;

function stubError(connectorType, labelHint) {
  const def = getConnectorDefinition(connectorType, labelHint);
  return new Error(
    def.description ||
      `Connector "${def.label || labelHint}" is not available in this runtime. Use LDAP, JDBC, REST, SCIM, or AWS IAM where your vendor exposes those protocols.`
  );
}

export async function dispatchTest(connectorType, connectionConfig = {}, labelHint = '') {
  const def = getConnectorDefinition(connectorType, labelHint);
  const { family } = def;

  if (family === 'none') {
    throw new Error('connectorType is required.');
  }
  if (family === 'stub') {
    throw stubError(connectorType, def.label || labelHint);
  }

  const cfg = connectionConfig || {};

  switch (family) {
    case 'ldap_ad': {
      const raw = cfg.ad ? { ...cfg.ad } : { ...cfg };
      const n = normalizeAdConfig(raw);
      return testAdConnection(n);
    }
    case 'ldap_generic':
      return testGenericLdapConnection(cfg.ldap || cfg);
    case 'jdbc':
      return testJdbcConnection(cfg.jdbc || cfg);
    case 'rest_bearer':
      return testRestBearer(cfg.rest || cfg);
    case 'scim':
      return testScimConnection(cfg.scim || cfg);
    case 'aws_iam':
      return testAwsIamConnection(cfg.aws || cfg);
    case 'file_delimited':
      return testFileConnector(cfg.file || cfg);
    case 'microsoft_graph':
      return testGraphConnection(cfg.graph || cfg);
    default:
      throw new Error(`Unsupported connector family: ${family}`);
  }
}

export async function dispatchSync(connectorType, connectionConfig = {}, labelHint = '', options = {}) {
  const def = getConnectorDefinition(connectorType, labelHint);
  const { family } = def;
  const maxUsers = Math.min(
    Math.max(parseInt(options.maxUsers, 10) || MAX_USERS, 1),
    MAX_USERS
  );

  if (family === 'none') {
    throw new Error('connectorType is required.');
  }
  if (family === 'stub') {
    throw stubError(connectorType, def.label || labelHint);
  }

  const cfg = connectionConfig || {};

  switch (family) {
    case 'ldap_ad': {
      const raw = cfg.ad ? { ...cfg.ad } : { ...cfg };
      const n = normalizeAdConfig({ ...raw, maxUsers });
      return fetchAdUsers(n, { maxUsers });
    }
    case 'ldap_generic':
      return fetchGenericLdapUsers(
        { ...(cfg.ldap || cfg), maxUsers },
        { maxUsers }
      );
    case 'jdbc':
      return fetchJdbcUsers({ ...(cfg.jdbc || cfg), maxUsers }, { maxUsers });
    case 'rest_bearer':
      return fetchRestUsers({ ...(cfg.rest || cfg), maxUsers }, { maxUsers });
    case 'scim':
      return fetchScimUsers({ ...(cfg.scim || cfg), maxUsers }, { maxUsers });
    case 'aws_iam':
      return fetchAwsIamUsers({ ...(cfg.aws || cfg), maxUsers }, { maxUsers });
    case 'file_delimited':
      return fetchFileUsers();
    case 'microsoft_graph':
      return fetchGraphUsers(cfg.graph || cfg, { maxUsers });
    default:
      throw new Error(`Unsupported connector family: ${family}`);
  }
}
