/**
 * ADShield connector catalog — Active Directory family only.
 * Family maps below still recognize legacy IGA payload codes so already-registered
 * non-AD apps continue to test/sync.
 */

export const CONNECTOR_LABELS = [
  'ADAM - Direct',
  'Active Directory - Direct',
  'Azure Active Directory',
  'Microsoft Entra ID - Graph',
];

/** Persisted Application.connectorType values from UI label */
export function payloadCodeFromLabel(label) {
  if (!label) return '';
  if (label === 'Active Directory - Direct') return 'ACTIVE_DIRECTORY';
  return `CONNECTOR_${label.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}`;
}

/**
 * Integration families — determines which runtime handler runs test + sync.
 * - ldap_ad: Windows AD semantics (existing ad block)
 * - ldap_generic: RFC LDAP / inetOrgPerson-style directories
 * - jdbc: SQL databases (MySQL, Postgres, SQL Server via drivers in repo)
 * - scim: SCIM 2.0 /Users
 * - rest_bearer: HTTPS + Bearer token + JSON user list
 * - aws_iam: AWS IAM ListUsers
 * - microsoft_graph: Entra ID via Microsoft Graph (client credentials)
 * - file_delimited: local/CSV path (limited — validation + stub ingest)
 * - stub: documented limitation; returns NOT_IMPLEMENTED until a gateway is configured
 */
const EXPLICIT_FAMILY = {
  ACTIVE_DIRECTORY: 'ldap_ad',
  /** LDAP/LDAPS to AADDS or hybrid DCs — same runtime as on-prem AD, not Microsoft Graph. */
  CONNECTOR_AZURE_ACTIVE_DIRECTORY: 'ldap_ad',
  CONNECTOR_MICROSOFT_ENTRA_ID_GRAPH: 'microsoft_graph',
  CONNECTOR_LDAP: 'ldap_generic',
  CONNECTOR_OPENLDAP_DIRECT: 'ldap_generic',
  CONNECTOR_NOVELL_EDIRECTORY_DIRECT: 'ldap_generic',
  CONNECTOR_ORACLE_INTERNET_DIRECTORY_DIRECT: 'ldap_generic',
  CONNECTOR_SUNONE_DIRECT: 'ldap_generic',
  CONNECTOR_IBM_TIVOLI_DS_DIRECT: 'ldap_generic',
  CONNECTOR_ADAM_DIRECT: 'ldap_generic',
  CONNECTOR_LDIF: 'file_delimited',
  CONNECTOR_DELIMITEDFILE: 'file_delimited',
  CONNECTOR_XML: 'file_delimited',
  CONNECTOR_RULEBASEDFILEPARSER: 'file_delimited',
  CONNECTOR_SQLLOADER: 'file_delimited',
  CONNECTOR_JDBC: 'jdbc',
  CONNECTOR_SCIM: 'scim',
  CONNECTOR_AWS_IAM: 'aws_iam',
  CONNECTOR_ORACLE_DATABASE_DIRECT: 'jdbc',
  CONNECTOR_MICROSOFT_SQL_SERVER_DIRECT: 'jdbc',
  CONNECTOR_DB2_FULL: 'jdbc',
  CONNECTOR_DB2_WINDOWS_DIRECT: 'jdbc',
  CONNECTOR_SYBASE_DIRECT: 'jdbc',
  CONNECTOR_PEOPLESOFT_HCM_DATABASE: 'jdbc',
  CONNECTOR_RACF: 'stub',
  CONNECTOR_RACF_FULL: 'stub',
  CONNECTOR_ACF2_FULL: 'stub',
  CONNECTOR_TOPSECRET: 'stub',
  CONNECTOR_TOPSECRET_FULL: 'stub',
  CONNECTOR_MAINFRAME: 'stub',
  CONNECTOR_VMS: 'stub',
  CONNECTOR_IBM_I: 'stub',
  CONNECTOR_LOGICAL: 'stub',
};

function inferFamily(code, label) {
  if (EXPLICIT_FAMILY[code]) return EXPLICIT_FAMILY[code];
  const l = (label || '').toLowerCase();
  if (l.includes('active directory')) return 'ldap_ad';
  if (
    l.includes('ldap') ||
    (l.includes('directory') && !l.includes('oracle identity')) ||
    l.includes('e-directory') ||
    l.includes('tivoli') && l.includes('ds') ||
    l.includes('domino') ||
    l.includes('sun idm') ||
    l.includes('rsa authentication')
  ) {
    return 'ldap_generic';
  }
  if (l === 'jdbc' || l.includes('database') || l.includes('sql server') || l.includes('db2') || l.includes('sybase') || l.includes('peoplesoft') && l.includes('database')) {
    return 'jdbc';
  }
  if (l.includes('scim')) return 'scim';
  if (l.includes('aws') && l.includes('iam')) return 'aws_iam';
  if (l.includes('delimited') || l.includes('ldif') || l.includes('xml') && l === 'xml' || l.includes('sqlloader')) {
    return 'file_delimited';
  }
  if (l.includes('racf') || l.includes('mainframe') || l.includes('topsecret') || l.includes('acf2') || l.includes('vms') || l === 'ibm i') {
    return 'stub';
  }
  if (
    l.includes('salesforce') ||
    l.includes('servicenow') ||
    l.includes('box') ||
    l.includes('dropbox') ||
    l.includes('google') ||
    l.includes('yammer') ||
    l.includes('netsuite') ||
    l.includes('cyberark') ||
    l.includes('duo') ||
    l.includes('webex') ||
    l.includes('goto') ||
    l.includes('sharepoint online') ||
    l.includes('azure active') ||
    l.includes('bmc') ||
    l.includes('remedy') ||
    l.includes('airwatch') ||
    l.includes('mobileiron') ||
    l.includes('jive') ||
    l.includes('siebel') ||
    l.includes('rally') ||
    l.includes('tenrox') ||
    l.includes('cloud gateway') ||
    l.includes('sap ') ||
    l.includes('oracle e-business') ||
    l.includes('oracle hrms') ||
    l.includes('oracle identity manager') ||
    l.includes('peoplesoft') ||
    l.includes('ibm security identity') ||
    l.includes('forefront') ||
    l.includes('project server') ||
    l.includes('novell identity') ||
    l.includes('aix ') ||
    l.includes('linux ') ||
    l.includes('unix') ||
    l.includes('solaris') ||
    l.includes('windows local')
  ) {
    return 'rest_bearer';
  }
  return 'rest_bearer';
}

export function getConnectorDefinition(connectorType, labelHint = '') {
  if (!connectorType) {
    return { family: 'none', payloadCode: '', label: '' };
  }
  const label =
    labelHint ||
    CONNECTOR_LABELS.find((x) => payloadCodeFromLabel(x) === connectorType) ||
    '';
  const family = inferFamily(connectorType, label);
  return {
    family,
    payloadCode: connectorType,
    label,
    description: stubMessage(family, label),
  };
}

function stubMessage(family, label) {
  if (family !== 'stub') return null;
  return `Connector "${label}" typically requires mainframe or vendor-specific agents. Configure a REST/SFTP bridge or use JDBC/LDAP where your platform exposes them.`;
}

export function getCatalog() {
  return CONNECTOR_LABELS.map((label) => {
    const payloadCode = payloadCodeFromLabel(label);
    const def = getConnectorDefinition(payloadCode, label);
    return {
      label,
      payloadCode,
      family: def.family,
      description: def.description,
    };
  });
}
