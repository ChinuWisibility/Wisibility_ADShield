import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  MenuItem,
  TextField,
  LinearProgress,
  Alert,
  RadioGroup,
  FormControlLabel,
  Radio,
  Grid,
} from '@mui/material';
import { CloudUpload, CheckCircle, RocketLaunch } from '@mui/icons-material';
import { applicationAPI, hrmsIntegrationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';

/**
 * Delimited HRMS CSV is stored via integrations/hrms csv-upload (Application id or legacy HRMS id).
 * All other registry apps use application uploadData + schema blueprints.
 */
function isDelimitedHrmsCsvApp(app) {
  if (!app) return false;
  if (app.hrms?.connector === 'delimited_file') return true;
  const u = String(app.connectorType || '').trim().toUpperCase();
  return u === 'HRMS_DELIMITED_FILE' || (u.includes('HRMS') && u.includes('DELIMITED'));
}

export default function UploadData() {
  const fileInputRef = useRef(null);
  const [searchParams] = useSearchParams();

  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [applications, setApplications] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [dataType, setDataType] = useState('application_users');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const selectedApp = applications.find((a) => a._id === selectedAppId);
  const delimitedHrms = isDelimitedHrmsCsvApp(selectedApp);

  const loadApps = () => {
    if (!tenantId) {
      setApplications([]);
      return;
    }
    applicationAPI
      .list({ tenantId, limit: 500, page: 1 })
      .then((res) => setApplications(res.data?.data || []));
  };

  useEffect(() => {
    loadApps();
  }, [tenantId]);

  useEffect(() => {
    const appId = searchParams.get('applicationId');
    const legacyHrms = searchParams.get('hrmsSourceId');
    if (appId && applications.some((a) => a._id === appId)) {
      setSelectedAppId(appId);
      return;
    }
    if (legacyHrms && applications.length) {
      const byId = applications.find((a) => a._id === legacyHrms);
      const byMigrated = applications.find(
        (a) => a.hrms?.migratedFromHrmsId && String(a.hrms.migratedFromHrmsId) === legacyHrms
      );
      if (byId) setSelectedAppId(byId._id);
      else if (byMigrated) setSelectedAppId(byMigrated._id);
    }
  }, [searchParams, applications]);

  const handleAppChange = (e) => {
    setSelectedAppId(e.target.value);
    setSelectedFile(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedAppId || !selectedFile || !tenantId) return;

    setUploading(true);
    setResult(null);
    try {
      if (delimitedHrms) {
        const res = await hrmsIntegrationAPI.uploadDelimitedCsv(selectedAppId, selectedFile, { tenantId });
        const d = res.data?.data;
        setResult({
          type: 'success',
          message: `Loaded ${d?.rowCount ?? 0} row(s). Columns: ${(d?.headers || []).join(', ') || '—'}. Upload again anytime to refresh.`,
        });
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('dataType', dataType);
        const res = await applicationAPI.uploadData(selectedAppId, formData);
        setResult({
          type: 'success',
          message:
            res.data?.message ||
            `Import finished. You can run another upload anytime to replace data for this import type.`,
        });
      }
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadApps();
    } catch (error) {
      console.error('Upload error:', error);
      const msg =
        delimitedHrms
          ? error.response?.data?.message || error.response?.data?.error?.message || 'CSV upload failed.'
          : error.response?.data?.message || 'Upload failed.';
      setResult({ type: 'error', message: msg });
    } finally {
      setUploading(false);
    }
  };

  const browseDisabled = uploading || !selectedAppId;
  const primaryDisabled = !selectedAppId || !selectedFile || uploading || !tenantId;

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'primary.light', color: 'primary.main', display: 'flex' }}>
          <CloudUpload />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Data Importer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pick an application from the registry and upload CSV. Imports can be repeated whenever you need.
          </Typography>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Register applications in <strong>App Registry</strong>, configure schema in <strong>Schema Management</strong> where
        needed, then upload here. Delimited HRMS applications use the HR CSV path; other apps follow blueprint mappings.
      </Alert>

      <Card elevation={0} sx={{ border: `1px solid ${palette.border.default}` }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            Upload CSV
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select the target application by name, then attach your file.
          </Typography>

          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, color: 'primary.main' }}>
                1. Application
              </Typography>
              <TextField
                select
                fullWidth
                size="small"
                value={selectedAppId}
                onChange={handleAppChange}
                disabled={uploading || !tenantId}
              >
                <MenuItem value="">
                  <em>Select application</em>
                </MenuItem>
                {applications.map((app) => (
                  <MenuItem key={app._id} value={app._id}>
                    {app.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            {!delimitedHrms && selectedAppId && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, color: 'primary.main' }}>
                  2. Data model
                </Typography>
                <RadioGroup row value={dataType} onChange={(e) => setDataType(e.target.value)}>
                  <FormControlLabel
                    value="application_users"
                    control={<Radio size="small" />}
                    label="Application accounts"
                    disabled={uploading}
                  />
                  <FormControlLabel
                    value="entitlements"
                    control={<Radio size="small" />}
                    label="Entitlements"
                    disabled={uploading}
                  />
                </RadioGroup>
              </Grid>
            )}
          </Grid>

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, color: 'primary.main' }}>
            {delimitedHrms || !selectedAppId ? '2. ' : '3. '}File
          </Typography>
          <Box
            sx={{
              border: '2px dashed #cbd5e1',
              borderRadius: 2,
              p: 5,
              textAlign: 'center',
              backgroundColor: '#f8fafc',
              mb: 3,
              transition: 'all 0.2s ease-in-out',
              '&:hover': { borderColor: 'primary.main', backgroundColor: 'primary.50' },
            }}
          >
            <CloudUpload sx={{ fontSize: 48, color: '#94a3b8', mb: 1 }} />
            <Typography variant="body1" sx={{ fontWeight: 500, mb: 2, color: selectedFile ? 'success.main' : 'text.primary' }}>
              {selectedFile ? selectedFile.name : 'Select a CSV file'}
            </Typography>
            <input
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={browseDisabled}>
              Browse files
            </Button>
          </Box>

          {uploading && <LinearProgress sx={{ mb: 3 }} />}
          {result && (
            <Alert
              severity={result.type}
              icon={result.type === 'success' ? <CheckCircle /> : undefined}
              sx={{ mb: 3 }}
            >
              {result.message}
            </Alert>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', pt: 3 }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleUpload}
              disabled={primaryDisabled}
              startIcon={<RocketLaunch />}
              sx={{ px: 4, fontWeight: 600 }}
            >
              {uploading ? 'Importing…' : 'Run import'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
