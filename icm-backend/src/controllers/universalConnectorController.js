import Application from '../models/application/Application.js';
import { getCatalog } from '../config/connectorCatalog.js';
import { dispatchTest, dispatchSync } from '../services/connectors/connectorDispatcher.js';
import { getDynamicUserModelForTenantId } from '../models/application/Users.js';
import { applicationIdInClause } from "../services/applicationUserIngestService.js";
import { ingestApplicationUsersWithReconciliation } from "../services/reconciliation/ingestWithReconciliation.js";
import { applyCsvImportMappingToRows } from "../services/delimitedApplicationUserSync.js";
import {
  isDelimitedFileHrmsApplication,
  materializeDelimitedImportToApplicationUsers,
} from '../services/delimitedApplicationUserSync.js';

function mergeConnectionConfig(stored = {}, incoming = {}) {
  return {
    ...stored,
    ...incoming,
    ad: { ...(stored.ad || {}), ...(incoming.ad || {}) },
    ldap: { ...(stored.ldap || {}), ...(incoming.ldap || {}) },
    jdbc: { ...(stored.jdbc || {}), ...(incoming.jdbc || {}) },
    rest: { ...(stored.rest || {}), ...(incoming.rest || {}) },
    scim: { ...(stored.scim || {}), ...(incoming.scim || {}) },
    aws: { ...(stored.aws || {}), ...(incoming.aws || {}) },
    file: { ...(stored.file || {}), ...(incoming.file || {}) },
    graph: { ...(stored.graph || {}), ...(incoming.graph || {}) },
  };
}

export async function getConnectorCatalog(_req, res) {
  res.json({ success: true, data: getCatalog() });
}

/**
 * POST /applications/connectors/test
 * Body: { connectorType, connectionConfig, applicationId? }
 */
export async function testUniversalConnection(req, res) {
  try {
    const { connectorType, connectionConfig: incoming, applicationId } = req.body || {};
    if (!connectorType) {
      return res.status(400).json({ success: false, message: 'connectorType is required.' });
    }

    let merged = incoming || {};
    let labelHint = '';
    if (applicationId) {
      const app = await Application.findById(applicationId);
      if (!app) {
        return res.status(404).json({ success: false, message: 'Application not found.' });
      }
      merged = mergeConnectionConfig(app.connectionConfig || {}, incoming || {});
      labelHint = app.name;
    }

    const result = await dispatchTest(connectorType, merged, labelHint);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || 'Connection test failed.' });
  }
}

/**
 * POST /applications/:id/connectors/sync
 * Optional body: { connectionConfig?, maxUsers?, ad? } — merges over saved application config.
 */
export async function syncUniversalConnector(req, res) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    if (isDelimitedFileHrmsApplication(application)) {
      const { liveRows, summary, needsCsvUpload } =
        await materializeDelimitedImportToApplicationUsers(application);
      if (needsCsvUpload) {
        return res.status(400).json({
          success: false,
          needsCsvUpload: true,
          message:
            'Delimited File sync requires a CSV upload. Use Sync CSV on Current accounts (or Map & import on Application schema). Existing accounts were not modified.',
          count: liveRows,
          summary,
        });
      }
      application.totalUsers = liveRows;
      application.lastUpload = new Date();
      await application.save();
      return res.json({
        success: true,
        message: `Imported ${liveRows} user(s) from uploaded CSV.`,
        count: liveRows,
        summary,
      });
    }

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);
    const localCount = await UsersModel.countDocuments({ applicationId: application._id });

    const connectorType = application.connectorType;

    /**
     * No remote connector: accounts may only come from Application schema / Upload Data / POST upload.
     * Refresh totals from the dynamic user store instead of failing with "no connectorType".
     */
    if (!connectorType) {
      if (
        Array.isArray(application.userMappings) &&
        application.userMappings.length > 0 &&
        localCount > 0
      ) {
        application.totalUsers = localCount;
        if (!application.lastUpload) application.lastUpload = new Date();
        await application.save();
        return res.json({
          success: true,
          message: `Refreshed ${localCount} account(s) from Application schema or Upload Data import.`,
          count: localCount,
          source: 'application_import',
        });
      }
      return res.status(400).json({
        success: false,
        message:
          localCount > 0
            ? 'Define user schema (Application schema tab) to manage imports, or configure a connector for remote sync.'
            : 'No connector configured. Import CSV from the Application schema tab or Upload Data, or set up a connector.',
      });
    }

    const merged = mergeConnectionConfig(application.connectionConfig || {}, req.body?.connectionConfig || {});
    const overrides = req.body || {};
    const maxUsers = overrides.maxUsers;

    let userDocs = await dispatchSync(connectorType, merged, application.name, { maxUsers });

    let docs = userDocs.map((u) => ({
      ...u,
      applicationId: application._id,
    }));

    let source = "connector_sync";
    let skippedPk = 0;

    // Apply dynamic Map & Import mappings if configured
    const mapped = applyCsvImportMappingToRows(docs.map(d => d.rawData || {}), application);
    if (mapped && mapped.documentsToInsert?.length > 0) {
      docs = mapped.documentsToInsert.map(d => ({ ...d, applicationId: application._id }));
      skippedPk = mapped.skippedMissingPk || 0;
      source = "connector_sync_mapped";
    }

    const { summary, reconciliation, runId } = await ingestApplicationUsersWithReconciliation(application, docs, {
      source,
      strictPkResolution: true,
      userMappingsForPk: source === "connector_sync_mapped" ? application.csvImportMapping?.mappings : undefined,
      initialSkippedMissingPk: skippedPk
    });

    res.json({
      success: true,
      message: `Imported ${summary.liveRows} user(s).`,
      count: summary.liveRows,
      summary: { ...summary, reconciliation, runId },
      reconciliation,
      runId,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Connector sync failed.' });
  }
}
