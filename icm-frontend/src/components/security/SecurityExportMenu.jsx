import { useState } from "react";
import { Button, Menu, MenuItem, CircularProgress } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { securityAPI } from "../../services/securityApi";
import { downloadFindingsCsv, downloadFindingsJson } from "../../utils/securityFindingsExport";

/**
 * Fetch current filtered findings (paged) and export CSV/JSON.
 */
export default function SecurityExportMenu({ applicationId, scanId, filters = {} }) {
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAll = async () => {
    const pageSize = 200;
    let page = 1;
    let all = [];
    let total = Infinity;
    while (all.length < total) {
      const res = await securityAPI.getFindings(applicationId, {
        page,
        limit: pageSize,
        scanId: scanId || undefined,
        feature: filters.feature || undefined,
        objectType: filters.objectType || undefined,
        search: filters.search || undefined,
      });
      const data = res.data?.data ?? res.data;
      const items = data?.items || [];
      total = data?.total ?? items.length;
      all = all.concat(items);
      if (!items.length) break;
      page += 1;
      if (page > 50) break;
    }
    return all;
  };

  const runExport = async (kind) => {
    if (!applicationId) return;
    setBusy(true);
    setAnchor(null);
    try {
      const rows = await loadAll();
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") downloadFindingsCsv(rows, `ad-security-findings-${stamp}.csv`);
      else downloadFindingsJson(rows, `ad-security-findings-${stamp}.json`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={busy ? <CircularProgress size={14} /> : <DownloadIcon />}
        disabled={!applicationId || busy}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ textTransform: "none" }}
      >
        Export
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => runExport("csv")}>Export CSV</MenuItem>
        <MenuItem onClick={() => runExport("json")}>Export JSON</MenuItem>
      </Menu>
    </>
  );
}
