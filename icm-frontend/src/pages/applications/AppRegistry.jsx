import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Grid, Divider, FormControl, InputLabel,
  Select, OutlinedInput, Checkbox, ListItemText, Chip, Alert, Stack,
  FormControlLabel
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Add, SettingsEthernet, Info, Cloud, Dns, Sync, VerifiedUser, Apps } from '@mui/icons-material';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { applicationAPI, identityProfileAPI } from '../../services/api'; // Adjust path if needed
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';
import StatusChip from '../../components/StatusChip';
import ApplicationIconPicker, {
  resolveApplicationIconSrc,
} from '../../components/applications/ApplicationIconPicker';
import {
  isActiveDirectoryConnectorApp,
  isDerivedAdApplication,
  resolveDerivedApplicationDisplay,
} from '../../utils/applicationConnectorUi';

/** Sidebar width and top bar height (align with AccessCertificationWizard) */
const LAYOUT_SIDEBAR_W = 265;
const LAYOUT_TOPBAR_H = 70;
const GAP_RIGHT = 30;
const GAP_BOTTOM = 40;

// 1. Data Sources (Matches your Mongoose Enums)
const APP_TYPES = ['web', 'database', 'directory', 'cloud', 'erp', 'custom'];
const STATUSES = ['active', 'inactive', 'decommissioned', 'pending'];
const INTEGRATION_TYPES = ['manual', 'auto', 'api', 'connector'];
const SCHEDULES = ['daily', 'weekly', 'monthly', 'none'];

/** ADShield catalog fallback when GET /applications/connectors/catalog is empty. */
const AD_CONNECTOR_FALLBACK = [
  '',
  'ADAM - Direct',
  'Active Directory - Direct',
  'Azure Active Directory',
  'Microsoft Entra ID - Graph',
];

/** Normalize populated or raw ObjectId fields from API responses. */
function idStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v._id != null) return String(v._id);
  return String(v);
}

/**
 * True when an identity profile maps this application as HR/authoritative source
 * (Schema Management blueprint is not required for that path).
 */
function hasIdentityProfileAuthoritativeMapping(app, profiles) {
  if (!profiles?.length || !app?._id) return false;
  const appId = idStr(app._id);
  const migratedLegacyId = app.hrms?.migratedFromHrmsId ? idStr(app.hrms.migratedFromHrmsId) : '';
  return profiles.some((p) => {
    const mappings = p.attributeMappings || [];
    if (!mappings.length) return false;
    const isSource =
      idStr(p.sourceApplicationId) === appId ||
      (migratedLegacyId && idStr(p.hrmsSourceId) === migratedLegacyId);
    const mappingRefsApp = mappings.some(
      (m) =>
        idStr(m.applicationId) === appId ||
        (migratedLegacyId && idStr(m.hrmsSourceId) === migratedLegacyId)
    );
    return isSource || mappingRefsApp;
  });
}

function isActiveDirectoryConnector(uiValue) {
  return uiValue === 'Active Directory - Direct' || uiValue === 'AD connector';
}

function isAzureActiveDirectoryConnector(uiValue) {
  return uiValue === 'Azure Active Directory';
}

/** LDAP to domain controllers or AADDS — not pure Entra ID Graph API. */
function usesAdLdapConnector(uiValue) {
  return isActiveDirectoryConnector(uiValue) || isAzureActiveDirectoryConnector(uiValue);
}

/** Persisted connectorType for non-AD selections (Application.connectorType is a free string). */
function uiConnectorToPayloadType(uiValue) {
  if (!uiValue) return undefined;
  if (isActiveDirectoryConnector(uiValue)) return 'ACTIVE_DIRECTORY';
  return `CONNECTOR_${uiValue.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}`;
}

function formatStoredConnectorForTable(stored) {
  if (!stored) return null;
  if (stored === 'ACTIVE_DIRECTORY') return { short: 'AD', color: 'primary' };
  if (stored.startsWith('CONNECTOR_')) {
    const words = stored.slice('CONNECTOR_'.length).replace(/_/g, ' ');
    return { short: words.length > 28 ? `${words.slice(0, 25)}…` : words, color: 'default' };
  }
  return { short: stored, color: 'default' };
}

function appTypeForConnectorFamily(family) {
  switch (family) {
    case 'ldap_ad':
    case 'ldap_generic':
      return 'directory';
    case 'jdbc':
      return 'database';
    case 'rest_bearer':
    case 'scim':
    case 'aws_iam':
    case 'microsoft_graph':
      return 'cloud';
    default:
      return 'custom';
  }
}

function buildConnectionConfigFromForm(formData, family) {
  if (family === 'ldap_generic') {
    return {
      ldap: {
        url: formData.ldapUrl?.trim(),
        baseDn: formData.ldapBaseDn?.trim(),
        bindDn: formData.ldapBindDn?.trim(),
        bindPassword: formData.ldapBindPassword,
        tlsInsecure: formData.ldapTlsInsecure,
        userSearchFilter: formData.ldapUserFilter?.trim() || undefined,
      },
    };
  }
  if (family === 'jdbc') {
    return {
      jdbc: {
        driver: formData.jdbcDriver || 'postgres',
        host: formData.jdbcHost?.trim(),
        port: formData.jdbcPort || '',
        database: formData.jdbcDatabase?.trim(),
        user: formData.jdbcUser?.trim(),
        password: formData.jdbcPassword,
        sql: formData.jdbcQuery?.trim() || undefined,
        userSql: formData.jdbcUserQuery?.trim() || undefined,
      },
    };
  }
  if (family === 'rest_bearer') {
    return {
      rest: {
        baseUrl: formData.restBaseUrl?.trim(),
        bearerToken: formData.restToken,
        usersPath: formData.restUsersPath?.trim() || '/users',
        jsonPath: formData.restJsonPath?.trim() || undefined,
      },
    };
  }
  if (family === 'scim') {
    return {
      scim: {
        baseUrl: formData.scimBaseUrl?.trim(),
        token: formData.scimToken,
        usersPath: formData.scimUsersPath?.trim() || '/Users',
      },
    };
  }
  if (family === 'aws_iam') {
    return {
      aws: {
        accessKeyId: formData.awsAccessKeyId?.trim(),
        secretAccessKey: formData.awsSecretAccessKey,
        region: formData.awsRegion?.trim() || 'us-east-1',
      },
    };
  }
  if (family === 'file_delimited') {
    return {
      file: {
        path: formData.filePath?.trim(),
        format: formData.fileFormat || 'csv',
      },
    };
  }
  if (family === 'microsoft_graph') {
    return {
      graph: {
        tenantId: formData.graphTenantId?.trim(),
        clientId: formData.graphClientId?.trim(),
        clientSecret: formData.graphClientSecret,
        scope: formData.graphScope?.trim() || 'https://graph.microsoft.com/.default',
        authority: formData.graphAuthority?.trim() || undefined,
      },
    };
  }
  return {};
}

function RegistryTableHead() {
  const cellSx = {
    fontWeight: 700,
    color: palette.text.secondary,
    fontSize: '0.68rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    py: 1.25,
    borderBottom: `1px solid ${palette.border.default}`,
    bgcolor: alpha(palette.bg.elevated, 0.85),
  };
  return (
    <TableHead>
      <TableRow>
        <TableCell sx={cellSx}>Name</TableCell>
        <TableCell sx={cellSx}>Type</TableCell>
        <TableCell sx={cellSx}>Owner</TableCell>
        <TableCell sx={cellSx}>Connector</TableCell>
        <TableCell sx={cellSx}>Configuration</TableCell>
        <TableCell sx={cellSx}>Status</TableCell>
      </TableRow>
    </TableHead>
  );
}

function RegistrySummaryStat({ icon, label, value, accent }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.5,
        py: 1.15,
        borderRadius: 1.5,
        border: `1px solid ${palette.border.default}`,
        bgcolor: palette.bg.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(accent, 0.12),
          color: accent,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: palette.text.secondary, fontWeight: 600, display: 'block', lineHeight: 1.15, fontSize: '0.68rem' }}>
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 800, lineHeight: 1.15, color: palette.text.primary, fontSize: '1.05rem' }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

const CONNECTOR_UI_FIELD_KEYS = [
  'adUrl', 'adBaseDn', 'adBindDn', 'adBindPassword', 'adTlsInsecure', 'adUserFilter',
  'ldapUrl', 'ldapBaseDn', 'ldapBindDn', 'ldapBindPassword', 'ldapTlsInsecure', 'ldapUserFilter',
  'jdbcDriver', 'jdbcHost', 'jdbcPort', 'jdbcDatabase', 'jdbcUser', 'jdbcPassword', 'jdbcQuery', 'jdbcUserQuery',
  'restBaseUrl', 'restToken', 'restUsersPath', 'restJsonPath',
  'scimBaseUrl', 'scimToken', 'scimUsersPath',
  'awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion',
  'graphTenantId', 'graphClientId', 'graphClientSecret', 'graphScope', 'graphAuthority',
  'filePath', 'fileFormat',
];

// 2. THE BLUEPRINT
const formBlueprint = [
  {
    sectionTitle: 'GENERAL INFO',
    icon: <Info fontSize="small" />,
    color: 'primary.main',
    fields: [
      { name: 'name', label: 'Application Name', type: 'text', col: 6, required: true },
      { name: 'type', label: 'Type', type: 'select', options: APP_TYPES, col: 6 },
      { name: 'status', label: 'Status', type: 'select', options: STATUSES, col: 6 },
      { 
        name: 'customType', 
        label: 'Specify Custom Type', 
        type: 'text', 
        col: 6, 
        required: true,
        showIf: (formData) => formData.type === 'custom' 
      },
      { name: 'description', label: 'Description', type: 'textarea', col: 12 },
      { name: 'owner', label: 'Business Owner', type: 'text', col: 6 },
      { name: 'ownerEmail', label: 'Owner Email', type: 'email', col: 6 },
    ]
  },
  {
    sectionTitle: 'INTEGRATION & METADATA',
    icon: <SettingsEthernet fontSize="small" />,
    color: 'info.main',
    fields: [
      { name: 'connectorType', label: 'Connector', type: 'select', options: AD_CONNECTOR_FALLBACK, col: 4 },
      { name: 'integrationType', label: 'Integration Type', type: 'select', options: INTEGRATION_TYPES, col: 4 },
      { name: 'autoUploadSchedule', label: 'Sync Schedule', type: 'select', options: SCHEDULES, col: 4 },
      { name: 'tags', label: 'Tags (comma separated)', type: 'text', col: 4 },
      {
        name: 'authoritativeSource',
        label: 'Authoritative Source',
        type: 'checkbox',
        col: 12,
        helperText:
          'Mark if this application is a trusted identity feed (e.g. Active Directory).',
      },
    ]
  }
];

function buildInitialFormState() {
  const base = formBlueprint.reduce((acc, section) => {
    section.fields.forEach((field) => {
      if (field.type === 'multiselect') acc[field.name] = [];
      else if (field.type === 'checkbox') acc[field.name] = false;
      else acc[field.name] = field.options ? field.options[0] : '';
    });
    return acc;
  }, {});
  return {
    ...base,
    iconId: null,
    color: '',
    adUrl: '',
    adBaseDn: '',
    adBindDn: '',
    adBindPassword: '',
    adTlsInsecure: false,
    adUserFilter: '(&(objectClass=user)(objectCategory=person))',
    syncAdOnCreate: true,
    ldapUrl: '',
    ldapBaseDn: '',
    ldapBindDn: '',
    ldapBindPassword: '',
    ldapTlsInsecure: false,
    ldapUserFilter: '(|(objectClass=inetOrgPerson)(objectClass=person)(objectClass=organizationalPerson))',
    jdbcDriver: 'postgres',
    jdbcHost: '',
    jdbcPort: '5432',
    jdbcDatabase: '',
    jdbcUser: '',
    jdbcPassword: '',
    jdbcQuery: 'SELECT 1 AS ok',
    jdbcUserQuery:
      'SELECT user_id, email, display_name FROM identity_users LIMIT 50000',
    restBaseUrl: '',
    restToken: '',
    restUsersPath: '/users',
    restJsonPath: '',
    scimBaseUrl: '',
    scimToken: '',
    scimUsersPath: '/Users',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsRegion: 'us-east-1',
    graphTenantId: '',
    graphClientId: '',
    graphClientSecret: '',
    graphScope: 'https://graph.microsoft.com/.default',
    graphAuthority: '',
    filePath: '',
    fileFormat: 'csv',
  };
}

export default function AppRegistry() {
  const navigate = useNavigate(); // <-- Added for routing

  const [applications, setApplications] = useState([]);
  const [identityProfiles, setIdentityProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  
  const [openModal, setOpenModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState(() => buildInitialFormState());
  const [connectorCatalog, setConnectorCatalog] = useState([]);
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionTestMessage, setConnectionTestMessage] = useState(null);

  const connectorFamily = useMemo(() => {
    if (!formData.connectorType || !connectorCatalog.length) return null;
    const row = connectorCatalog.find((c) => c.label === formData.connectorType);
    return row?.family ?? null;
  }, [formData.connectorType, connectorCatalog]);

  const connectorSelectOptions = useMemo(() => {
    if (connectorCatalog.length) {
      return ['', ...connectorCatalog.map((c) => c.label)];
    }
    return AD_CONNECTOR_FALLBACK;
  }, [connectorCatalog]);

  const authoritativeApps = useMemo(
    () => applications.filter((a) => !!a.authoritativeSource),
    [applications],
  );
  const standardApps = useMemo(
    () => applications.filter((a) => !a.authoritativeSource),
    [applications],
  );
  const totalLinkedAccounts = useMemo(
    () => applications.reduce((sum, app) => sum + Number(app.totalUsers || 0), 0),
    [applications],
  );

  const appsById = useMemo(() => {
    const map = new Map();
    for (const app of applications) {
      const id = idStr(app._id || app.id);
      if (id) map.set(id, app);
    }
    return map;
  }, [applications]);

  const fetchApplications = async () => {
    if (!tenantId) {
      setApplications([]);
      setIdentityProfiles([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      // Lean registry payload + high limit — paint apps first
      const resApps = await applicationAPI.list({
        tenantId,
        limit: 500,
        page: 1,
        fields: 'registry',
      });
      if (resApps.data?.success) {
        setApplications(resApps.data.data || resApps.data.applications || []);
      }
      setLoading(false);

      // Profiles only needed for config-column hints — load after first paint
      identityProfileAPI
        .list({ tenantId })
        .then((resProfiles) => {
          setIdentityProfiles(resProfiles.data?.data || []);
        })
        .catch(() => {
          setIdentityProfiles([]);
        });
    } catch (error) {
      console.error("Failed to fetch applications:", error);
      setLoading(false);
    }
  };

  useEffect(() => { fetchApplications(); }, [tenantId]);

  useEffect(() => {
    if (!openModal) return;
    applicationAPI
      .getConnectorCatalog()
      .then((res) => setConnectorCatalog(res.data?.data || []))
      .catch(() => setConnectorCatalog([]));
  }, [openModal]);

  const handleOpen = () => setOpenModal(true);
  const handleClose = () => {
    if (submitting) return;
    setOpenModal(false);
    setFormData(buildInitialFormState());
    setConnectionTestMessage(null);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (
      name.startsWith('ad') ||
      name === 'connectorType' ||
      name.startsWith('ldap') ||
      name.startsWith('jdbc') ||
      name.startsWith('rest') ||
      name.startsWith('scim') ||
      name.startsWith('aws') ||
      name.startsWith('graph') ||
      name.startsWith('file')
    ) {
      setConnectionTestMessage(null);
    }
  };

  const handleTestAd = async () => {
    if (!formData.adUrl?.trim() || !formData.adBindDn?.trim() || !formData.adBaseDn?.trim()) {
      alert('Enter LDAP URL, bind DN, and base DN before testing.');
      return;
    }
    if (!formData.adBindPassword) {
      alert('Enter the bind password to test the connection.');
      return;
    }
    setConnectionTesting(true);
    setConnectionTestMessage(null);
    try {
      const res = await applicationAPI.testAdConnection({
        url: formData.adUrl.trim(),
        bindDn: formData.adBindDn.trim(),
        bindPassword: formData.adBindPassword,
        baseDn: formData.adBaseDn.trim(),
        tlsInsecure: formData.adTlsInsecure,
        userSearchFilter: formData.adUserFilter?.trim() || undefined,
        deployment: isAzureActiveDirectoryConnector(formData.connectorType) ? 'cloud' : 'on_prem',
      });
      const d = res.data?.data;
      setConnectionTestMessage({
        ok: true,
        text: d?.sampleCount != null
          ? `Connected. Sample user objects visible under this search: ${d.sampleCount}.`
          : 'LDAP bind and search succeeded.',
      });
    } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Connection test failed.';
      setConnectionTestMessage({ ok: false, text: msg });
    } finally {
      setConnectionTesting(false);
    }
  };

  const handleTestUniversalConnector = async () => {
    if (!formData.connectorType || usesAdLdapConnector(formData.connectorType)) return;
    if (!connectorFamily || connectorFamily === 'stub' || connectorFamily === 'none') {
      alert('This connector cannot be tested from the API (unsupported family).');
      return;
    }
    const cfg = buildConnectionConfigFromForm(formData, connectorFamily);
    setConnectionTesting(true);
    setConnectionTestMessage(null);
    try {
      const res = await applicationAPI.testConnector({
        connectorType: uiConnectorToPayloadType(formData.connectorType),
        connectionConfig: cfg,
      });
      const d = res.data?.data;
      const hint = d?.hint ? ` ${d.hint}` : '';
      const count = d?.sampleCount != null ? ` Sample count: ${d.sampleCount}.` : '';
      setConnectionTestMessage(
        d?.ok === false
          ? { ok: false, text: 'Connection test returned unexpected result.' }
          : { ok: true, text: `Connection OK.${count}${hint}` }
      );
    } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Connection test failed.';
      setConnectionTestMessage({ ok: false, text: msg });
    } finally {
      setConnectionTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name) return alert("Application Name is required!");
    if (usesAdLdapConnector(formData.connectorType)) {
      if (!formData.adUrl?.trim() || !formData.adBindDn?.trim() || !formData.adBaseDn?.trim()) {
        return alert('LDAP URL, bind DN, and base DN are required for this directory connector.');
      }
      if (!formData.adBindPassword) {
        return alert('Bind password is required for directory connector registration.');
      }
    } else if (formData.connectorType && connectorFamily) {
      if (connectorFamily === 'ldap_generic') {
        if (!formData.ldapUrl?.trim() || !formData.ldapBindDn?.trim() || !formData.ldapBaseDn?.trim()) {
          return alert('LDAP URL, bind DN, and base DN are required for this connector.');
        }
        if (!formData.ldapBindPassword) return alert('LDAP bind password is required.');
      }
      if (connectorFamily === 'jdbc') {
        if (!formData.jdbcHost?.trim() || !formData.jdbcDatabase?.trim() || !formData.jdbcUser?.trim()) {
          return alert('JDBC host, database, and user are required.');
        }
        if (!formData.jdbcPassword) return alert('JDBC password is required.');
      }
      if (connectorFamily === 'rest_bearer') {
        if (!formData.restBaseUrl?.trim() || !formData.restToken) {
          return alert('REST base URL and bearer token are required.');
        }
      }
      if (connectorFamily === 'scim') {
        if (!formData.scimBaseUrl?.trim() || !formData.scimToken) {
          return alert('SCIM base URL and token are required.');
        }
      }
      if (connectorFamily === 'aws_iam') {
        if (!formData.awsAccessKeyId?.trim() || !formData.awsSecretAccessKey) {
          return alert('AWS access key ID and secret access key are required.');
        }
      }
      if (connectorFamily === 'microsoft_graph') {
        const hasTenant = formData.graphTenantId?.trim();
        const hasAuthority = formData.graphAuthority?.trim();
        if (!hasTenant && !hasAuthority) {
          return alert(
            'Microsoft Graph: provide directory (tenant) ID, or a custom authority URL (e.g. sovereign cloud).'
          );
        }
        if (!formData.graphClientId?.trim()) {
          return alert('Microsoft Graph: application (client) ID is required.');
        }
        if (!formData.graphClientSecret) {
          return alert('Client secret is required for Microsoft Graph (app registration).');
        }
      }
    }

    try {
      setSubmitting(true);
      const rawPayload = { ...formData };
      CONNECTOR_UI_FIELD_KEYS.forEach((k) => {
        delete rawPayload[k];
      });

      const syncAdOnCreate = formData.syncAdOnCreate;
      const { ...restBase } = rawPayload;

      const payload = { ...restBase, tenantId };

      if (usesAdLdapConnector(formData.connectorType)) {
        payload.integrationType = 'connector';
        payload.type = 'directory';
        payload.connectorType = isActiveDirectoryConnector(formData.connectorType)
          ? 'ACTIVE_DIRECTORY'
          : uiConnectorToPayloadType(formData.connectorType);
        payload.connectionConfig = {
          ad: {
            deployment: isAzureActiveDirectoryConnector(formData.connectorType) ? 'cloud' : 'on_prem',
            url: formData.adUrl.trim(),
            baseDn: formData.adBaseDn.trim(),
            bindDn: formData.adBindDn.trim(),
            bindPassword: formData.adBindPassword,
            tlsInsecure: formData.adTlsInsecure,
            userSearchFilter: formData.adUserFilter?.trim() || undefined,
          },
        };
      } else if (formData.connectorType) {
        payload.integrationType = 'connector';
        payload.connectorType = uiConnectorToPayloadType(formData.connectorType);
        payload.type = appTypeForConnectorFamily(connectorFamily);
        payload.connectionConfig = buildConnectionConfigFromForm(formData, connectorFamily);
      } else {
        payload.connectorType = undefined;
        payload.connectionConfig = undefined;
      }

      if (payload.type === 'custom' && payload.customType) {
        payload.description = `[Custom Type: ${payload.customType}] ${payload.description}`;
      }
      if (typeof payload.tags === 'string' && payload.tags.length > 0) {
        payload.tags = payload.tags.split(',').map(t => t.trim());
      }

      if (!payload.iconId) {
        payload.iconId = null;
        payload.color = payload.color || null;
      }

      const res = await applicationAPI.create(payload);
      const created = res.data?.data ?? res.data;

      if (syncAdOnCreate && created?._id) {
        try {
          if (usesAdLdapConnector(formData.connectorType)) {
            // Do NOT sync yet — open Map AD fields wizard first.
            // Sync starts only after the user saves the mapping (ApplicationSchemaTab).
            handleClose();
            fetchApplications();
            navigate(
              `/applications/${created._id || created.id}?tab=schema&onestep=connector`,
            );
            return;
          } else if (
            formData.connectorType &&
            connectorFamily &&
            connectorFamily !== 'stub' &&
            connectorFamily !== 'file_delimited'
          ) {
            await applicationAPI.syncConnector(created._id, {});
          }
        } catch (syncErr) {
          console.error('Connector sync after create failed:', syncErr);
          const msg = syncErr.response?.data?.message || syncErr.message || '';
          if (msg.includes('no primary key')) {
            handleClose();
            navigate(`/applications/${created._id || created.id}?tab=schema&onestep=connector`);
            return;
          }
          alert(
            `Application created, but importing users failed: ${msg}`
          );
          handleClose();
          fetchApplications();
          return;
        }
      }

      handleClose();
      fetchApplications();
    } catch (error) {
      console.error("Failed to create application:", error);
      alert(error.response?.data?.message || "Error creating application. Check console.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field) => {
    if (field.showIf && !field.showIf(formData)) return null;

    if (field.type === 'select') {
      return (
        <TextField
          select
          name={field.name}
          label={field.label}
          value={formData[field.name]}
          onChange={handleChange}
          fullWidth
          size="small"
          required={field.required}
          SelectProps={
            field.name === 'connectorType'
              ? { MenuProps: { PaperProps: { sx: { maxHeight: 320 } } } }
              : undefined
          }
        >
          {(field.name === 'connectorType' ? connectorSelectOptions : field.options).map((o) => (
            <MenuItem key={o || '__none__'} value={o}>
              {field.name === 'connectorType' ? (o === '' ? 'Select One …' : o) : (o === '' ? '—' : String(o).toUpperCase())}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    if (field.type === 'multiselect') {
      return (
        <FormControl fullWidth size="small" required={field.required}>
          <InputLabel>{field.label}</InputLabel>
          <Select multiple name={field.name} value={formData[field.name]} onChange={handleChange} input={<OutlinedInput label={field.label} />} renderValue={(selected) => selected.join(', ')}>
            {field.options.map((option) => (
              <MenuItem key={option} value={option}>
                <Checkbox checked={formData[field.name].indexOf(option) > -1} />
                <ListItemText primary={option} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <FormControlLabel
          sx={{ alignItems: 'flex-start', ml: 0, mr: 0 }}
          control={
            <Checkbox
              name={field.name}
              checked={!!formData[field.name]}
              onChange={handleChange}
              color="primary"
            />
          }
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {field.label}
              </Typography>
              {field.helperText ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, maxWidth: 560 }}>
                  {field.helperText}
                </Typography>
              ) : null}
            </Box>
          }
        />
      );
    }

    return (
      <TextField 
        name={field.name} 
        label={field.label} 
        type={field.type === 'email' ? 'email' : 'text'}
        value={formData[field.name]} 
        onChange={handleChange} 
        fullWidth 
        size="small" 
        required={field.required}
        multiline={field.type === 'textarea'}
        rows={field.type === 'textarea' ? 3 : 1}
      />
    );
  };

  const registryTableColumns = 7;

  const renderRegistryRow = (app, _section) => {
    const display = resolveDerivedApplicationDisplay(
      app,
      appsById.get(idStr(app.sourceApplicationId)),
    );
    return (
      <TableRow
        key={app._id}
        hover
        onClick={() => navigate(`/applications/${app._id || app.id}`)}
        sx={(theme) => ({
          cursor: 'pointer',
          transition: 'background-color 0.15s ease',
          '&:hover': {
            bgcolor: alpha(theme.palette.action.hover, 0.08),
          },
          '& td': { borderBottomColor: palette.border.light, py: 1.35 },
        })}
      >
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                border: `1px solid ${palette.border.default}`,
                bgcolor: app.icon ? '#fff' : (app.color || alpha(palette.brand.primary, 0.12)),
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 800,
                p: app.icon ? 0.4 : 0,
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
              }}
            >
              {app.icon ? (
                <Box
                  component="img"
                  src={resolveApplicationIconSrc(app.icon)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Box sx={{ color: app.color || palette.brand.primary }}>
                  {app.name?.charAt(0)?.toUpperCase() || '?'}
                </Box>
              )}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  color: palette.text.primary,
                  lineHeight: 1.25,
                  '&:hover': { color: palette.brand.primary },
                }}
              >
                {app.name}
              </Typography>
            </Box>
          </Box>
        </TableCell>
        <TableCell>
          <Chip
            label={display.type || '—'}
            size="small"
            variant="outlined"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              fontWeight: 600,
              textTransform: 'capitalize',
              bgcolor: palette.bg.input,
              color: palette.text.secondary,
              borderColor: palette.border.default,
            }}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2" sx={{ color: palette.text.secondary, fontWeight: 500 }}>
            {display.owner || '—'}
          </Typography>
        </TableCell>
        <TableCell>
          {(() => {
            const sourceApp = appsById.get(idStr(app.sourceApplicationId));
            const connectorType = display.connectorType;
            const isAd =
              isActiveDirectoryConnectorApp(app) ||
              (isDerivedAdApplication(app) && isActiveDirectoryConnectorApp(sourceApp));
            if (isAd) {
              return <Chip label="AD" size="small" color="primary" variant="outlined" sx={{ fontWeight: 600, height: 24 }} />;
            }
            const fmt = formatStoredConnectorForTable(connectorType);
            if (fmt) {
              return <Chip label={fmt.short} size="small" color={fmt.color} variant="outlined" sx={{ fontWeight: 600, height: 24 }} />;
            }
            return (
              <Typography variant="body2" color="text.disabled">—</Typography>
            );
          })()}
        </TableCell>
        <TableCell>
          {(() => {
            const hasBlueprint = Array.isArray(app.userMappings) && app.userMappings.length > 0;
            const hasImportedUsers = Number(app.totalUsers || 0) > 0;
            const hasProfileMapping = hasIdentityProfileAuthoritativeMapping(app, identityProfiles);
            if (hasImportedUsers) {
              return (
                <Chip
                  label={`${app.totalUsers || 0} accounts`}
                  size="small"
                  sx={{
                    fontWeight: 600,
                    height: 24,
                    borderColor: palette.border.default,
                    color: palette.text.secondary,
                    bgcolor: palette.bg.input,
                  }}
                  variant="outlined"
                />
              );
            }
            if (hasBlueprint) {
              return (
                <Chip
                  label="Schema ready"
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600, height: 24, borderColor: palette.border.default, color: palette.text.secondary, bgcolor: palette.bg.input }}
                />
              );
            }
            if (hasProfileMapping) {
              return (
                <Chip
                  label="Profile source"
                  size="small"
                  variant="outlined"
                  sx={{
                    fontWeight: 600,
                    height: 24,
                    borderColor: alpha(palette.brand.primary, 0.35),
                    color: palette.brand.primary,
                    bgcolor: palette.brand.primaryLight,
                  }}
                />
              );
            }
            return (
              <Chip
                label="Schema pending"
                size="small"
                variant="outlined"
                sx={{ fontWeight: 600, height: 24, borderColor: palette.border.default, color: palette.text.disabled, bgcolor: palette.bg.input }}
              />
            );
          })()}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <StatusChip status={display.status || app.status || 'unknown'} />
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1.5,
          mb: 1.5,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: palette.text.primary, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            App Registry
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25, color: palette.text.secondary }}>
            Authoritative identity feeds and target applications
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleOpen}
          sx={{ textTransform: 'none', fontWeight: 700, alignSelf: { xs: 'stretch', sm: 'center' }, px: 2 }}
        >
          Add Application
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}><CircularProgress /></Box>
      ) : !tenantId ? (
        <Paper elevation={0} sx={{ border: `1px solid ${palette.border.default}`, borderRadius: 2.5, p: 4, textAlign: 'center' }}>
          <Typography variant="body1" sx={{ fontWeight: 700, mb: 1 }}>No Tenant Associated</Typography>
          <Typography variant="body2" color="text.secondary">Your user account is not associated with any tenant.</Typography>
        </Paper>
      ) : applications.length === 0 ? (
        <Paper elevation={0} sx={{ border: `1px dashed ${palette.border.default}`, borderRadius: 2.5, p: 5, textAlign: 'center', bgcolor: palette.bg.elevated }}>
          <Apps sx={{ fontSize: 40, color: palette.text.disabled, mb: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>No applications yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Register your first application to start connecting identity sources and targets.
          </Typography>
          <Button variant="contained" startIcon={<Add />} onClick={handleOpen} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Add Application
          </Button>
        </Paper>
      ) : (
        <Stack spacing={1.75}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
            <RegistrySummaryStat
              icon={<Apps sx={{ fontSize: 18 }} />}
              label="Total applications"
              value={applications.length}
              accent={palette.brand.primary}
            />
            <RegistrySummaryStat
              icon={<VerifiedUser sx={{ fontSize: 18 }} />}
              label="Authoritative sources"
              value={authoritativeApps.length}
              accent={palette.status.success}
            />
            <RegistrySummaryStat
              icon={<HubOutlinedIcon sx={{ fontSize: 18 }} />}
              label="Target applications"
              value={standardApps.length}
              accent={palette.brand.secondary}
            />
            <RegistrySummaryStat
              icon={<PeopleAltOutlinedIcon sx={{ fontSize: 18 }} />}
              label="Linked accounts"
              value={totalLinkedAccounts.toLocaleString()}
              accent={palette.status.info}
            />
          </Stack>

          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${palette.border.default}`,
              borderRadius: 2.5,
              overflow: 'hidden',
              bgcolor: palette.bg.secondary,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1.5,
                bgcolor: palette.bg.elevated,
                borderBottom: `1px solid ${palette.border.default}`,
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <VerifiedUser sx={{ fontSize: 20, color: palette.text.secondary }} />
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: palette.text.primary, lineHeight: 1.25 }}>
                      Authoritative sources
                    </Typography>
                    <Typography variant="caption" sx={{ color: palette.text.secondary, fontWeight: 500 }}>
                      Trusted HR / directory feeds used for identity priority
                    </Typography>
                  </Box>
                </Stack>
                <Chip
                  label={`${authoritativeApps.length}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontWeight: 700,
                    minWidth: 36,
                    borderColor: palette.border.default,
                    color: palette.text.secondary,
                    bgcolor: palette.bg.secondary,
                  }}
                />
              </Stack>
            </Box>
            <TableContainer>
              <Table size="medium">
                <RegistryTableHead />
                <TableBody>
                  {authoritativeApps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={registryTableColumns} sx={{ py: 3.5, px: 2.5 }}>
                        <Alert severity="info" sx={{ textAlign: 'left', borderRadius: 2 }}>
                          No authoritative sources yet. Enable <strong>Authoritative Source</strong> when registering HR or master identity systems.
                        </Alert>
                      </TableCell>
                    </TableRow>
                  ) : (
                    authoritativeApps.map((app) => renderRegistryRow(app, 'authoritative'))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${palette.border.default}`,
              borderRadius: 2.5,
              overflow: 'hidden',
              bgcolor: palette.bg.secondary,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1.5,
                bgcolor: palette.bg.elevated,
                borderBottom: `1px solid ${palette.border.default}`,
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <Apps sx={{ fontSize: 20, color: palette.text.secondary }} />
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: palette.text.primary, lineHeight: 1.25 }}>
                      Target applications
                    </Typography>
                    <Typography variant="caption" sx={{ color: palette.text.secondary, fontWeight: 500 }}>
                      Downstream systems connected for accounts and entitlements
                    </Typography>
                  </Box>
                </Stack>
                <Chip
                  label={`${standardApps.length}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontWeight: 700,
                    minWidth: 36,
                    borderColor: palette.border.default,
                    color: palette.text.secondary,
                    bgcolor: palette.bg.secondary,
                  }}
                />
              </Stack>
            </Box>
            <TableContainer>
              <Table size="medium">
                <RegistryTableHead />
                <TableBody>
                  {standardApps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={registryTableColumns} sx={{ py: 3, px: 2.5, color: 'text.secondary' }}>
                        No target applications yet — all registered apps are authoritative.
                      </TableCell>
                    </TableRow>
                  ) : (
                    standardApps.map((app) => renderRegistryRow(app, 'standard'))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      )}

      <Dialog
        open={openModal}
        onClose={handleClose}
        fullWidth
        maxWidth={false}
        scroll="paper"
        sx={{
          '& .MuiDialog-container': {
            margin: 0,
            padding: 0,
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
          },
        }}
        PaperProps={{
          elevation: 8,
          sx: {
            position: 'fixed',
            left: { xs: 10, sm: LAYOUT_SIDEBAR_W },
            top: LAYOUT_TOPBAR_H,
            right: GAP_RIGHT,
            bottom: GAP_BOTTOM,
            m: 0,
            maxWidth: { xs: 'calc(100% - 20px)', sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            width: { xs: 'auto', sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            height: `calc(100vh - ${LAYOUT_TOPBAR_H}px - ${GAP_BOTTOM}px)`,
            maxHeight: 'none',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
              Register New Application
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Add an application to the registry and configure its connector.
            </Typography>
          </Box>
          <Button onClick={handleClose} color="inherit" size="small" disabled={submitting}>
            Cancel
          </Button>
        </DialogTitle>

        <DialogContent sx={{ flex: 1, overflow: 'auto', pt: 1, px: { xs: 2, sm: 3 } }}>
          {formBlueprint.map((section, idx) => (
            <React.Fragment key={section.sectionTitle}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: section.color }}>
                {section.icon} <Typography variant="subtitle2" fontWeight={700}>{section.sectionTitle}</Typography>
              </Box>
              <Grid container spacing={2} sx={{ mb: 4 }}>
                {section.fields.map((field) => {
                  const renderedComponent = renderField(field);
                  if (!renderedComponent) return null;
                  return (
                    <Grid item xs={12} sm={field.col} key={field.name}>
                      {renderedComponent}
                    </Grid>
                  );
                })}
                {section.sectionTitle === 'GENERAL INFORMATION' || section.sectionTitle?.includes('GENERAL') ? (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                      APPLICATION ICON
                    </Typography>
                    <ApplicationIconPicker
                      tenantId={tenantId}
                      compact
                      value={{
                        iconId: formData.iconId,
                        color: formData.color,
                      }}
                      onChange={(next) =>
                        setFormData((prev) => ({
                          ...prev,
                          iconId: next.iconId,
                          color: next.color || '',
                        }))
                      }
                    />
                  </Grid>
                ) : null}
              </Grid>
              {idx !== formBlueprint.length - 1 && <Divider sx={{ my: 3 }} />}
            </React.Fragment>
          ))}

          {usesAdLdapConnector(formData.connectorType) && (
            <>
              <Divider sx={{ my: 3 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: 'info.main' }}>
                {isAzureActiveDirectoryConnector(formData.connectorType) ? (
                  <Cloud fontSize="small" />
                ) : (
                  <Dns fontSize="small" />
                )}
                <Typography variant="subtitle2" fontWeight={700}>
                  {isAzureActiveDirectoryConnector(formData.connectorType)
                    ? 'AZURE / HYBRID DIRECTORY (LDAP)'
                    : 'ACTIVE DIRECTORY CONNECTOR'}
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {isAzureActiveDirectoryConnector(formData.connectorType) ? (
                  <>
                    LDAP/LDAPS to <strong>Azure AD Domain Services</strong> (managed AD), or to hybrid/on-prem domain
                    controllers. <strong>Microsoft Entra ID (cloud-only)</strong> does not expose classic LDAP — for that
                    you need <strong>Microsoft Graph</strong> (not this LDAP form).
                  </>
                ) : (
                  <>Uses LDAP/LDAPS against domain controllers in your datacenter or private network.</>
                )}
              </Typography>

              {isAzureActiveDirectoryConnector(formData.connectorType) ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>Cloud / hybrid scenarios</Typography>
                  <Typography variant="body2" component="div">
                    <Stack component="ol" sx={{ pl: 2, mb: 0 }} spacing={0.5}>
                      <li>
                        <strong>Azure AD Domain Services:</strong> use the managed domain LDAPS endpoint and bind to a
                        user in the AADDC Users OU (see Microsoft docs for the full LDAPS URL).
                      </li>
                      <li>
                        <strong>Hybrid:</strong> if users live on on-prem AD, expose DCs via VPN/ExpressRoute and use the
                        same LDAP settings as datacenter DCs.
                      </li>
                      <li>
                        Entra ID alone has no LDAP bind endpoint; use Graph API or another integration for pure cloud
                        directory data.
                      </li>
                    </Stack>
                  </Typography>
                </Alert>
              ) : (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>On-premises Active Directory</Typography>
                  <Typography variant="body2" component="div">
                    <Stack component="ol" sx={{ pl: 2, mb: 0 }} spacing={0.5}>
                      <li>
                        From your app or jump host, ensure TCP reachability to at least one domain controller on{' '}
                        <strong>389</strong> (LDAP) or <strong>636</strong> (LDAPS).
                      </li>
                      <li>
                        Use a <strong>service account</strong> for the bind DN (read rights on user objects in the search
                        base).
                      </li>
                      <li>
                        LDAPS is recommended in production; use the &quot;Allow self-signed / dev TLS&quot; option only in
                        labs.
                      </li>
                      <li>
                        Base DN is typically your domain partition, e.g. <code>DC=corp,DC=local</code>.
                      </li>
                    </Stack>
                  </Typography>
                </Alert>
              )}

              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="adUrl"
                    label="LDAP URL"
                    placeholder="ldaps://dc.corp.local:636"
                    value={formData.adUrl}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    required
                    helperText="ldap://host:389 or ldaps://host:636"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="adBaseDn"
                    label="Base DN"
                    placeholder="DC=corp,DC=local"
                    value={formData.adBaseDn}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="adBindDn"
                    label="Bind DN"
                    placeholder="CN=svc-iga,OU=Service Accounts,DC=corp,DC=local"
                    value={formData.adBindDn}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="adBindPassword"
                    label="Bind password"
                    type="password"
                    value={formData.adBindPassword}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    required
                    autoComplete="new-password"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    name="adUserFilter"
                    label="User search filter (LDAP)"
                    value={formData.adUserFilter}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    helperText="Default: users only. Adjust if you use a different object structure."
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        name="adTlsInsecure"
                        checked={formData.adTlsInsecure}
                        onChange={handleChange}
                        size="small"
                      />
                    }
                    label="Allow self-signed TLS (development only)"
                  />
                </Grid>
              </Grid>

              {connectionTestMessage && (
                <Alert severity={connectionTestMessage.ok ? 'success' : 'error'} sx={{ mb: 2 }}>
                  {connectionTestMessage.text}
                </Alert>
              )}

              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
                <Button
                  variant="outlined"
                  startIcon={<SettingsEthernet />}
                  onClick={handleTestAd}
                  disabled={connectionTesting}
                >
                  {connectionTesting
                    ? 'Testing…'
                    : isAzureActiveDirectoryConnector(formData.connectorType)
                      ? 'Test LDAP connection'
                      : 'Test AD connection'}
                </Button>
                <FormControlLabel
                  control={
                    <Checkbox
                      name="syncAdOnCreate"
                      checked={formData.syncAdOnCreate}
                      onChange={handleChange}
                      size="small"
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Sync fontSize="small" />
                      {isAzureActiveDirectoryConnector(formData.connectorType)
                        ? 'Import users from LDAP immediately after registration'
                        : 'Import users from AD immediately after registration'}
                    </Box>
                  }
                />
              </Stack>
            </>
          )}

          {formData.connectorType &&
            !usesAdLdapConnector(formData.connectorType) &&
            connectorFamily &&
            connectorFamily !== 'ldap_ad' && (
              <>
                <Divider sx={{ my: 3 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: 'info.main' }}>
                  <SettingsEthernet fontSize="small" />
                  <Typography variant="subtitle2" fontWeight={700}>
                    CONNECTOR CONNECTION ({connectorFamily})
                  </Typography>
                </Box>

                {connectorFamily === 'stub' && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    This connector is not wired to a network protocol on the server (mainframe / proprietary).
                    Register the application to record intent, or front it with REST, LDAP, JDBC, SCIM, or AWS IAM where your vendor supports those.
                  </Alert>
                )}

                {connectorFamily === 'ldap_generic' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="ldapUrl"
                        label="LDAP URL"
                        value={formData.ldapUrl}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        placeholder="ldap://host:389"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="ldapBaseDn"
                        label="Base DN"
                        value={formData.ldapBaseDn}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="ldapBindDn"
                        label="Bind DN"
                        value={formData.ldapBindDn}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="ldapBindPassword"
                        label="Bind password"
                        type="password"
                        value={formData.ldapBindPassword}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="ldapUserFilter"
                        label="User search filter"
                        value={formData.ldapUserFilter}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            name="ldapTlsInsecure"
                            checked={formData.ldapTlsInsecure}
                            onChange={handleChange}
                            size="small"
                          />
                        }
                        label="Allow self-signed TLS (development only)"
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'jdbc' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        select
                        name="jdbcDriver"
                        label="Driver"
                        value={formData.jdbcDriver}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                      >
                        <MenuItem value="postgres">PostgreSQL</MenuItem>
                        <MenuItem value="mysql">MySQL / MariaDB</MenuItem>
                        <MenuItem value="mssql">Microsoft SQL Server</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        name="jdbcHost"
                        label="Host"
                        value={formData.jdbcHost}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        name="jdbcPort"
                        label="Port"
                        value={formData.jdbcPort}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="jdbcDatabase"
                        label="Database name"
                        value={formData.jdbcDatabase}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="jdbcUser"
                        label="User"
                        value={formData.jdbcUser}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="jdbcPassword"
                        label="Password"
                        type="password"
                        value={formData.jdbcPassword}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="jdbcQuery"
                        label="Test SQL (e.g. SELECT 1)"
                        value={formData.jdbcQuery}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="jdbcUserQuery"
                        label="User import SQL (must return columns user_id, email, display_name or similar)"
                        value={formData.jdbcUserQuery}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        multiline
                        minRows={2}
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'rest_bearer' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12}>
                      <TextField
                        name="restBaseUrl"
                        label="Base URL (HTTPS)"
                        value={formData.restBaseUrl}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        placeholder="https://api.vendor.com"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="restUsersPath"
                        label="Users path"
                        value={formData.restUsersPath}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="/users"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="restJsonPath"
                        label="JSON path to array (optional)"
                        value={formData.restJsonPath}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="data.users"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="restToken"
                        label="Bearer token"
                        type="password"
                        value={formData.restToken}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'scim' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12}>
                      <TextField
                        name="scimBaseUrl"
                        label="SCIM base URL"
                        value={formData.scimBaseUrl}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        placeholder="https://api.example.com/scim/v2"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="scimUsersPath"
                        label="Users path"
                        value={formData.scimUsersPath}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="/Users"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="scimToken"
                        label="Bearer token"
                        type="password"
                        value={formData.scimToken}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'aws_iam' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="awsAccessKeyId"
                        label="Access key ID"
                        value={formData.awsAccessKeyId}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="awsSecretAccessKey"
                        label="Secret access key"
                        type="password"
                        value={formData.awsSecretAccessKey}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="awsRegion"
                        label="Region"
                        value={formData.awsRegion}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="us-east-1"
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'microsoft_graph' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12}>
                      <Alert severity="info" sx={{ mb: 0 }}>
                        <Typography variant="body2" component="div">
                          Register an app in Entra ID with <strong>Application</strong> permission{' '}
                          <code>User.Read.All</code>, then <strong>admin consent</strong>. Use client credentials
                          (client secret here). Users are read from{' '}
                          <code>GET https://graph.microsoft.com/v1.0/users</code> with pagination.
                        </Typography>
                      </Alert>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="graphTenantId"
                        label="Directory (tenant) ID"
                        value={formData.graphTenantId}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        helperText="Required unless you use custom authority below"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="graphClientId"
                        label="Application (client) ID"
                        value={formData.graphClientId}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        placeholder="App registration client ID"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        name="graphClientSecret"
                        label="Client secret"
                        type="password"
                        value={formData.graphClientSecret}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        required
                        autoComplete="new-password"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="graphScope"
                        label="Token scope"
                        value={formData.graphScope}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="https://graph.microsoft.com/.default"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        name="graphAuthority"
                        label="Authority (optional)"
                        value={formData.graphAuthority}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="https://login.microsoftonline.com/…"
                        helperText="Override for sovereign clouds; if set, tenant ID can be omitted when the host encodes the tenant"
                      />
                    </Grid>
                  </Grid>
                )}

                {connectorFamily === 'file_delimited' && (
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12}>
                      <TextField
                        name="filePath"
                        label="Server file path (batch / scheduled jobs)"
                        value={formData.filePath}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                        placeholder="/data/import/users.csv"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        select
                        name="fileFormat"
                        label="Format"
                        value={formData.fileFormat}
                        onChange={handleChange}
                        fullWidth
                        size="small"
                      >
                        <MenuItem value="csv">CSV</MenuItem>
                        <MenuItem value="ldif">LDIF</MenuItem>
                        <MenuItem value="xml">XML</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={12}>
                      <Alert severity="info">
                        Interactive CSV import for this app is still available via <strong>Upload CSV</strong> after
                        registration.
                      </Alert>
                    </Grid>
                  </Grid>
                )}

                {connectorFamily &&
                  connectorFamily !== 'stub' &&
                  connectorFamily !== 'ldap_ad' && (
                    <>
                      {connectionTestMessage &&
                        !usesAdLdapConnector(formData.connectorType) && (
                          <Alert
                            severity={connectionTestMessage.ok ? 'success' : 'error'}
                            sx={{ mb: 2 }}
                          >
                            {connectionTestMessage.text}
                          </Alert>
                        )}
                      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
                        <Button
                          variant="outlined"
                          startIcon={<SettingsEthernet />}
                          onClick={handleTestUniversalConnector}
                          disabled={
                            connectionTesting ||
                            connectorFamily === 'stub' ||
                            !connectorFamily
                          }
                        >
                          {connectionTesting ? 'Testing…' : 'Test connection'}
                        </Button>
                        <FormControlLabel
                          control={
                            <Checkbox
                              name="syncAdOnCreate"
                              checked={formData.syncAdOnCreate}
                              onChange={handleChange}
                              size="small"
                            />
                          }
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Sync fontSize="small" />
                              Import users immediately after registration
                            </Box>
                          }
                        />
                      </Stack>
                    </>
                  )}
              </>
            )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'flex-end' }}>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={submitting}
            sx={{ fontWeight: 600, px: 3 }}
          >
            {submitting ? 'Registering...' : 'Register Application'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}