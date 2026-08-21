import { toTenantObjectId } from "../../utils/applicationDynamicCollections.js";

import { incrementalGraphUpdateFromDb } from "./graphIncrementalUpdateService.js";



/**

 * Materialize identity graph edges for one application.

 * Delegates to incremental DB update (no full delete unless replaceExisting).

 *

 * @param {object} application - Application document

 * @param {object} [options]

 * @param {boolean} [options.replaceExisting=false] - when true, wipe edges first then diff upsert

 */

export async function materializeApplicationGraph(application, options = {}) {

  const tenantId = toTenantObjectId(application.tenantId);

  const applicationId = application._id;

  if (!tenantId || !applicationId) {

    throw new Error("application tenantId and _id are required for graph materialization");

  }



  const result = await incrementalGraphUpdateFromDb(application, {

    fullRebuild: options.replaceExisting === true,

    source: "scan_materialize",

  });



  return {

    edgeCount: result.edgeCount,

    groupNodes: result.groupNodes,

    privilegedGroups: result.privilegedGroups,

    entitlementsScanned: result.entitlementsScanned,

    mode: result.mode,

    timings: result.timings,

  };

}

