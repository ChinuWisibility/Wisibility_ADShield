import { useState, useCallback, memo, useEffect } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, TextField, Button, Switch,
  Alert, CircularProgress, Divider, IconButton, Tooltip,
  Select, MenuItem, FormControl, InputLabel, alpha,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Slider, Checkbox, FormControlLabel,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import {
  Save, RestartAlt, Delete, Star, StarBorder, CloudUpload,
  Palette as PaletteIcon, Image as ImageIcon, Person, Dashboard,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brandingAPI, logoAPI, preferenceAPI, dashboardWidgetAPI, resolveServerBaseUrl } from '../../services/api';
import { useBranding } from '../../contexts/BrandingContext';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';

const imgUrl = (fileUrl) => {
  if (!fileUrl) return null;
  if (fileUrl.startsWith('http')) return fileUrl;
  return `${resolveServerBaseUrl()}${fileUrl}`;
};

/** Checkerboard behind logo previews so transparent PNG/WebP reads clearly (opaque white/black fills are obvious). */
const LOGO_PREVIEW_SURFACE = {
  backgroundColor: '#f3f3f3',
  backgroundImage: `linear-gradient(45deg, #d4d4d4 25%, transparent 25%),
    linear-gradient(-45deg, #d4d4d4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d4d4d4 75%),
    linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)`,
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
};

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function rgbDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbaToHex(r, g, b) {
  const to2 = (x) => x.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

async function fileToImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Failed to load image'));
  });
  return img;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

function sampleBackgroundColor(imageData) {
  const { data, width, height } = imageData;
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
  ];
  const colors = points.map(([x, y]) => {
    const idx = (y * width + x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
  });
  // Average
  const avg = colors.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
    .map((v) => Math.round(v / colors.length));
  return avg;
}

function computeContentBounds(imageData, alphaThreshold = 12) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

async function processLogoFile(file, options) {
  const {
    removeBackground,
    backgroundRgb,
    tolerance,
    autoCrop,
    padding,
    maxSize,
  } = options;

  const img = await fileToImage(file);
  const scaleDown = maxSize ? Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scaleDown));
  const h = Math.max(1, Math.round(img.naturalHeight * scaleDown));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas not supported');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const bg = backgroundRgb || sampleBackgroundColor(imageData);
  const tol = clamp(Number(tolerance || 0), 0, 120);

  if (removeBackground) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      const dist = rgbDistance([d[i], d[i + 1], d[i + 2]], bg);
      if (dist <= tol) d[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  if (!autoCrop) {
    const blob = await canvasToPngBlob(canvas);
    if (!blob) throw new Error('Failed to encode PNG');
    return blob;
  }

  const bounds = computeContentBounds(ctx.getImageData(0, 0, w, h));
  if (!bounds) {
    const blob = await canvasToPngBlob(canvas);
    if (!blob) throw new Error('Failed to encode PNG');
    return blob;
  }

  const pad = clamp(Number(padding || 0), 0, 80);
  const cropX = clamp(bounds.minX - pad, 0, w - 1);
  const cropY = clamp(bounds.minY - pad, 0, h - 1);
  const cropW = clamp(bounds.maxX - bounds.minX + 1 + pad * 2, 1, w - cropX);
  const cropH = clamp(bounds.maxY - bounds.minY + 1 + pad * 2, 1, h - cropY);

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas not supported');
  octx.clearRect(0, 0, cropW, cropH);
  octx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const outBlob = await canvasToPngBlob(out);
  if (!outBlob) throw new Error('Failed to encode PNG');
  return outBlob;
}

const TabPanel = memo(function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ py: 3 }}>{children}</Box> : null;
});

/* Layout color fields — grouped by surface area */
const LAYOUT_FIELDS = [
  { key: 'sidebarBg', label: 'Sidebar Background', group: 'Sidebar' },
  { key: 'sidebarAccent', label: 'Sidebar Active Color', group: 'Sidebar' },
  { key: 'sidebarText', label: 'Sidebar Text', group: 'Sidebar' },
  { key: 'topbarBg', label: 'Topbar Background', group: 'Topbar & Auth' },
  { key: 'topbarText', label: 'Topbar Text', group: 'Topbar & Auth' },
  { key: 'authPanelBg', label: 'Auth Left Panel', group: 'Topbar & Auth' },
  { key: 'pageBg', label: 'Page Background', group: 'Layout & Accent' },
  { key: 'accentPrimary', label: 'Accent Primary', group: 'Layout & Accent' },
  { key: 'accentSecondary', label: 'Accent Secondary', group: 'Layout & Accent' },
];
const LC_GROUPS = [...new Set(LAYOUT_FIELDS.map((f) => f.group))];

const DEFAULT_LC = {
  sidebarBg: '#ffffff', sidebarAccent: '#2563eb', sidebarText: '#0f172a',
  topbarBg: '#ffffff', topbarText: '#0f172a',
  authPanelBg: '#1e3a8a', pageBg: '#f8fafc',
  accentPrimary: '#2563eb', accentSecondary: '#7c3aed',
};

// Logo sizing is intentionally fixed to reduce maintenance complexity.

/* ─── Memoized atomic swatch for brand colors ─── */
const BrandColorSwatch = memo(function BrandColorSwatch({ label, value, onChange }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5,
      border: `1px solid ${palette.border.default}`, borderRadius: '10px',
      background: palette.bg.primary,
    }}>
      <Box
        component="input" type="color"
        value={value}
        onChange={onChange}
        style={{ width: 38, height: 38, border: 'none', borderRadius: 8, cursor: 'pointer', padding: 0, background: 'none' }}
      />
      <Box>
        <Typography variant="body2" fontWeight={600}>{label}</Typography>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: palette.text.secondary }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
});

/* ─── Memoized atomic swatch for layout colors ─── */
const LayoutColorCard = memo(function LayoutColorCard({ colorKey, label, value, onChange }) {
  return (
    <Box
      component="label"
      htmlFor={`lc-${colorKey}`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5,
        border: '1px solid #e2e8f0', borderRadius: '10px',
        background: '#fff', cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: '#94a3b8', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
      }}
    >
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '8px', background: value, border: '1.5px solid rgba(0,0,0,0.12)' }} />
        <Box
          id={`lc-${colorKey}`}
          component="input" type="color"
          value={value}
          onChange={onChange}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
        />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem', color: '#1e293b', lineHeight: 1.3 }}>{label}</Typography>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.68rem' }}>{value}</Typography>
      </Box>
    </Box>
  );
});

/* ─── Tab 1: Branding ─── */
const BrandingTab = memo(function BrandingTab() {
  const { enqueueSnackbar } = useSnackbar();
  const { refreshBranding, updateBranding } = useBranding();
  const qc = useQueryClient();

  // TanStack query: fetch branding data once, cache for 30s
  const { data: serverBranding, isLoading } = useQuery({
    queryKey: ['branding'],
    queryFn: async () => {
      const res = await brandingAPI.get();
      return res.data.data;
    },
  });

  // Local draft — only used for live editing.
  const [draft, setDraft] = useState(null);

  // Sync draft whenever server data changes (initial load OR after invalidation from a save/reset)
  useEffect(() => {
    if (serverBranding) {
      setDraft({
        ...serverBranding,
        layoutColors: { ...DEFAULT_LC, ...(serverBranding.layoutColors || {}) },
      });
    }
  }, [serverBranding]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data) => brandingAPI.update(data),
    onSuccess: (_, data) => {
      updateBranding({
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        companyName: data.companyName,
        layoutColors: data.layoutColors,
      });
      refreshBranding();
      qc.invalidateQueries({ queryKey: ['branding'] });
      enqueueSnackbar('Branding updated successfully', { variant: 'success' });
    },
    onError: () => enqueueSnackbar('Failed to update branding', { variant: 'error' }),
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: () => brandingAPI.reset(),
    onSuccess: (res) => {
      const data = res.data.data;
      const normalized = { ...data, layoutColors: { ...DEFAULT_LC, ...(data?.layoutColors || {}) } };
      setDraft(normalized);
      refreshBranding();
      qc.invalidateQueries({ queryKey: ['branding'] });
      enqueueSnackbar('Branding reset to defaults', { variant: 'success' });
    },
    onError: () => enqueueSnackbar('Failed to reset', { variant: 'error' }),
  });

  // Draft field updater — only touches local state, never the context
  const update = useCallback((field) => (e) =>
    setDraft((prev) => ({ ...prev, [field]: e.target.value })), []);

  // Layout color updater — only touches local state
  const updateLayout = useCallback((key) => (e) => {
    const val = e.target.value;
    setDraft((prev) => ({
      ...prev,
      layoutColors: { ...(prev?.layoutColors || DEFAULT_LC), [key]: val },
    }));
  }, []);


  if (isLoading || !draft) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const lc = draft.layoutColors || DEFAULT_LC;

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 3, mb: 2.5 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>Brand Identity</Typography>
          <Divider sx={{ mb: 2.5 }} />
          <TextField
            fullWidth label="Company Name" value={draft.companyName || ''}
            onChange={update('companyName')} sx={{ mb: 2.5 }}
            helperText={`Platform default: ${BRANDING.name}`}
          />
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Brand Colors</Typography>
          <Grid container spacing={2}>
            {[
              { field: 'primaryColor', label: 'Primary Color', def: '#2563eb' },
              { field: 'secondaryColor', label: 'Secondary Color', def: '#7c3aed' },
            ].map(({ field, label, def }) => (
              <Grid key={field} size={{ xs: 12, sm: 6 }}>
                <BrandColorSwatch label={label} value={draft[field] || def} onChange={update(field)} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 8 }}>
        <Paper variant="outlined" sx={{ p: 3, mb: 2.5 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>Layout Colors</Typography>
          <Divider sx={{ mb: 2.5 }} />
          {LC_GROUPS.map((group) => (
            <Box key={group} sx={{ mb: 2.5 }}>
              <Typography variant="overline" sx={{ color: '#64748b', fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.68rem' }}>
                {group}
              </Typography>
              <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                {LAYOUT_FIELDS.filter((f) => f.group === group).map(({ key, label }) => (
                  <Grid key={key} size={{ xs: 12, sm: 6, md: 4 }}>
                    <LayoutColorCard colorKey={key} label={label} value={lc[key] || '#ffffff'} onChange={updateLayout(key)} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </Paper>

      </Grid>

      <Grid size={12}>
        <Paper variant="outlined" sx={{ p: 3, mb: 2.5 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>Custom CSS</Typography>
          <Divider sx={{ mb: 2.5 }} />
          <TextField
            fullWidth label="Custom CSS Overrides" multiline rows={5}
            value={draft.customCss || ''} onChange={update('customCss')}
            placeholder="/* e.g. .MuiCard-root { border-radius: 20px; } */"
            sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          />
        </Paper>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="contained" startIcon={saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <Save />}
            onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
            Save Changes
          </Button>
          <Button
            variant="outlined" color="warning" startIcon={<RestartAlt />}
            onClick={() => { if (window.confirm('Reset branding to defaults?')) resetMutation.mutate(); }}
            disabled={resetMutation.isPending}>
            Reset to Defaults
          </Button>
        </Box>
      </Grid>
    </Grid>
  );
});

/* ─── Tab 2: Logos ─── */
const LogosTab = memo(function LogosTab() {
  const { enqueueSnackbar } = useSnackbar();
  const { refreshBranding, updateBranding } = useBranding();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState({});
  const [dragOver, setDragOver] = useState(null);
  const [processDialog, setProcessDialog] = useState({
    open: false, file: null, filePreviewUrl: '', logoType: null, label: '',
  });
  const [processOpts, setProcessOpts] = useState({
    removeBackground: true,
    tolerance: 22,
    autoCrop: true,
    padding: 8,
    maxSize: 512,
    bgHex: '',
  });
  const [processing, setProcessing] = useState(false);
  const [processedPreviewUrl, setProcessedPreviewUrl] = useState('');

  const { data: logos = [], isLoading: logosLoading } = useQuery({
    queryKey: ['logos'],
    queryFn: async () => { const res = await logoAPI.list(); return res.data.data; },
  });

  const { data: branding, isLoading: brandingLoading } = useQuery({
    queryKey: ['branding'],
    queryFn: async () => { const res = await brandingAPI.get(); return res.data.data; },
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['logos'] });
    qc.invalidateQueries({ queryKey: ['branding'] });
  }, [qc]);

  const doUpload = useCallback(async (file, logoType) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { enqueueSnackbar('Please select a valid image file', { variant: 'warning' }); return; }
    // Open the processor dialog first. This lets admins remove baked-in backgrounds and auto-crop.
    const label = logoType === 'PLATFORM' ? 'Platform Logo' : logoType === 'FAVICON' ? 'Favicon' : 'Application Logo';
    setProcessedPreviewUrl('');
    const filePreviewUrl = URL.createObjectURL(file);
    setProcessDialog({ open: true, file, filePreviewUrl, logoType, label });
  }, [enqueueSnackbar, invalidate]);

  const handleDrop = useCallback((e, logoType) => {
    e.preventDefault(); setDragOver(null); doUpload(e.dataTransfer.files[0], logoType);
  }, [doUpload]);

  useEffect(() => {
    return () => {
      if (processedPreviewUrl) URL.revokeObjectURL(processedPreviewUrl);
    };
  }, [processedPreviewUrl]);

  const closeProcess = useCallback(() => {
    if (processedPreviewUrl) URL.revokeObjectURL(processedPreviewUrl);
    if (processDialog.filePreviewUrl) URL.revokeObjectURL(processDialog.filePreviewUrl);
    setProcessedPreviewUrl('');
    setProcessing(false);
    setProcessDialog({
      open: false, file: null, filePreviewUrl: '', logoType: null, label: '',
    });
  }, [processedPreviewUrl, processDialog.filePreviewUrl]);

  const uploadOriginal = useCallback(async () => {
    const { file, logoType } = processDialog;
    if (!file || !logoType) return;
    setUploading((p) => ({ ...p, [logoType]: true }));
    try {
      await logoAPI.upload(file, logoType);
      enqueueSnackbar(`${logoType} logo uploaded`, { variant: 'success' });
      invalidate();
      closeProcess();
    } catch (err) {
      const backendMsg = err?.response?.data?.error?.message;
      enqueueSnackbar(backendMsg || 'Upload failed', { variant: 'error' });
    } finally {
      setUploading((p) => ({ ...p, [logoType]: false }));
    }
  }, [processDialog, enqueueSnackbar, invalidate, closeProcess]);

  const applyProcessingPreview = useCallback(async () => {
    const { file } = processDialog;
    if (!file) return;
    setProcessing(true);
    try {
      const blob = await processLogoFile(file, {
        removeBackground: Boolean(processOpts.removeBackground),
        tolerance: Number(processOpts.tolerance),
        autoCrop: Boolean(processOpts.autoCrop),
        padding: Number(processOpts.padding),
        maxSize: Number(processOpts.maxSize),
        backgroundRgb: processOpts.bgHex ? null : null,
      });
      const url = URL.createObjectURL(blob);
      if (processedPreviewUrl) URL.revokeObjectURL(processedPreviewUrl);
      setProcessedPreviewUrl(url);
      enqueueSnackbar('Preview updated', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e?.message || 'Failed to process image', { variant: 'error' });
    } finally {
      setProcessing(false);
    }
  }, [processDialog, processOpts, processedPreviewUrl, enqueueSnackbar]);

  const uploadProcessed = useCallback(async () => {
    const { file, logoType } = processDialog;
    if (!file || !logoType) return;
    setUploading((p) => ({ ...p, [logoType]: true }));
    setProcessing(true);
    try {
      const blob = await processLogoFile(file, {
        removeBackground: Boolean(processOpts.removeBackground),
        tolerance: Number(processOpts.tolerance),
        autoCrop: Boolean(processOpts.autoCrop),
        padding: Number(processOpts.padding),
        maxSize: Number(processOpts.maxSize),
        backgroundRgb: null,
      });
      const outFile = new File([blob], file.name.replace(/\.[^.]+$/, '') + '-processed.png', { type: 'image/png' });
      await logoAPI.upload(outFile, logoType);
      enqueueSnackbar(`${logoType} logo uploaded (processed)`, { variant: 'success' });
      invalidate();
      closeProcess();
    } catch (err) {
      const backendMsg = err?.response?.data?.error?.message;
      enqueueSnackbar(backendMsg || err?.message || 'Upload failed', { variant: 'error' });
    } finally {
      setProcessing(false);
      setUploading((p) => ({ ...p, [logoType]: false }));
    }
  }, [processDialog, processOpts, enqueueSnackbar, invalidate, closeProcess]);

  const deleteMutation = useMutation({
    mutationFn: (id) => logoAPI.delete(id),
    onSuccess: () => { enqueueSnackbar('Logo deleted', { variant: 'success' }); refreshBranding(); invalidate(); },
    onError: () => enqueueSnackbar('Delete failed', { variant: 'error' }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ id, target }) => logoAPI.setDefault(id, { target }),
    onSuccess: (_, { target }) => {
      enqueueSnackbar(`Set as ${target === 'favicon' ? 'favicon' : 'platform logo'}`, { variant: 'success' });
      refreshBranding(); invalidate();
    },
    onError: () => enqueueSnackbar('Failed to set default', { variant: 'error' }),
  });


  if (logosLoading || brandingLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const currentLogoId = String(branding?.logoId?._id || branding?.logoId || '');
  const currentFaviconId = String(branding?.faviconId?._id || branding?.faviconId || '');
  const activeForType = {
    PLATFORM: logos.find((l) => String(l._id) === currentLogoId),
    FAVICON: logos.find((l) => String(l._id) === currentFaviconId),
    APPLICATION: undefined,
  };
  const cardDefs = [
    { type: 'PLATFORM', label: 'Platform Logo', desc: 'Sidebar and top bar' },
    { type: 'FAVICON', label: 'Favicon', desc: 'Browser tab icon (auto-rounded, 32x32 recommended)' },
    { type: 'APPLICATION', label: 'Application Logo', desc: 'Specific app branding' },
  ];

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }} icon={false}>
        <Typography variant="body2" fontWeight={600} gutterBottom>Transparent logo (not a full rectangle)</Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          Use <strong>PNG</strong> or <strong>WebP</strong> with a <strong>transparent background</strong> (alpha channel).
          <strong> JPEG/JPG cannot be transparent</strong>—any white or black box around your mark is part of the file.
          In Figma, Illustrator, or Photoshop: remove or hide the background layer, then export as PNG-24 / PNG with transparency.
          Previews below use a checkerboard pattern so you can see real transparency vs a solid fill.
        </Typography>
      </Alert>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cardDefs.map(({ type, label, desc }) => {
          const active = activeForType[type];
          const isDragging = dragOver === type;
          const isUploading = uploading[type];
          const isFaviconType = type === 'FAVICON';
          const isPlatformType = type === 'PLATFORM';
          return (
            <Grid key={type} size={{ xs: 12, sm: 4 }}>
              <Paper
                variant="outlined"
                onDragOver={(e) => { e.preventDefault(); setDragOver(type); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => handleDrop(e, type)}
                onClick={() => !isUploading && document.getElementById(`upload-${type}`).click()}
                sx={{
                  p: 2.5, textAlign: 'center', cursor: 'pointer', border: '2px dashed',
                  borderColor: isDragging ? palette.brand.primary : palette.border.default,
                  bgcolor: isDragging ? alpha(palette.brand.primary, 0.04) : 'transparent',
                  transition: 'all 0.15s ease',
                  '&:hover': { borderColor: palette.brand.primary, bgcolor: alpha(palette.brand.primary, 0.03) },
                }}
              >
                <Box sx={{
                  width: 80,
                  height: 80,
                  mx: 'auto',
                  mb: 1.5,
                  borderRadius: isFaviconType ? '50%' : 2,
                  border: `1px solid ${palette.border.default}`,
                  ...LOGO_PREVIEW_SURFACE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
                >
                  {isUploading ? <CircularProgress size={28} /> : active ? (
                    <Box component="img" src={imgUrl(active.fileUrl)} alt={label} sx={{ width: isFaviconType ? '100%' : 'auto', height: isFaviconType ? '100%' : 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: isFaviconType ? 'cover' : 'contain', borderRadius: isFaviconType ? '50%' : 0 }} onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : <CloudUpload sx={{ fontSize: 34, color: palette.text.disabled }} />}
                </Box>
                <Typography variant="body2" fontWeight={600}>{label}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{active ? active.fileName : desc}</Typography>
                <Typography variant="caption" sx={{ color: isDragging ? palette.brand.primary : palette.text.disabled, fontWeight: isDragging ? 600 : 400 }}>
                  {isDragging ? 'Drop to upload' : active ? 'Click or drag to replace' : 'Click or drag image here'}
                </Typography>
                <input
                  id={`upload-${type}`}
                  type="file"
                  hidden
                  accept="image/png,image/webp,image/svg+xml,image/gif,image/jpeg,image/*"
                  onClick={(e) => { e.target.value = ''; }}
                  onChange={(e) => doUpload(e.target.files[0], type)}
                />
              </Paper>
            </Grid>
          );
        })}
      </Grid>
      <Paper variant="outlined">
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${palette.border.default}` }}>
          <Typography variant="subtitle2">Uploaded Logos ({logos.length})</Typography>
        </Box>
        {logos.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><Typography variant="body2" color="text.secondary">No logos uploaded yet</Typography></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={72}>Preview</TableCell>
                  <TableCell>File Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell width={140}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logos.map((logo) => {
                  const isLogo = String(logo._id) === currentLogoId;
                  const isFavicon = String(logo._id) === currentFaviconId;
                  const isFaviconLogoType = logo.logoType === 'FAVICON';
                  const isPlatformLogoType = logo.logoType === 'PLATFORM';
                  return (
                    <TableRow key={logo._id} hover>
                      <TableCell>
                        <Box sx={{
                          width: 48,
                          height: 48,
                          borderRadius: (isFavicon || isFaviconLogoType) ? '50%' : 1,
                          overflow: 'hidden',
                          border: `1px solid ${palette.border.default}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          ...LOGO_PREVIEW_SURFACE,
                        }}
                        >
                          <Box component="img" src={imgUrl(logo.fileUrl)} alt={logo.fileName} sx={{ width: (isFavicon || isFaviconLogoType) ? '100%' : 'auto', height: (isFavicon || isFaviconLogoType) ? '100%' : 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: (isFavicon || isFaviconLogoType) ? 'cover' : 'contain', borderRadius: (isFavicon || isFaviconLogoType) ? '50%' : 0 }} onError={(e) => { e.target.style.display = 'none'; }} />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{logo.fileName}</Typography>
                        <Typography variant="caption" color="text.secondary">{logo.mimeType}</Typography>
                      </TableCell>
                      <TableCell><Chip label={logo.logoType} size="small" variant="outlined" /></TableCell>
                      <TableCell>
                        {isLogo && <Chip label="Platform Logo" size="small" color="primary" />}
                        {isFavicon && <Chip label="Favicon" size="small" color="secondary" sx={{ ml: isLogo ? 0.5 : 0 }} />}
                        {!isLogo && !isFavicon && <Typography variant="caption" color="text.secondary">Unused</Typography>}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title={isLogo ? 'Active platform logo' : 'Set as platform logo'}>
                            <IconButton size="small" onClick={() => setDefaultMutation.mutate({ id: logo._id, target: 'logo' })} sx={{ color: isLogo ? palette.brand.primary : palette.text.secondary }}>
                              <Star fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={isFavicon ? 'Active favicon' : 'Set as favicon'}>
                            <IconButton size="small" onClick={() => setDefaultMutation.mutate({ id: logo._id, target: 'favicon' })} sx={{ color: isFavicon ? palette.brand.secondary : palette.text.secondary }}>
                              <StarBorder fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => { if (window.confirm('Delete this logo?')) deleteMutation.mutate(logo._id); }} sx={{ color: palette.status.error }}>
                              <Delete fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>


      <Dialog open={processDialog.open} onClose={closeProcess} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          Upload {processDialog.label}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ flex: '1 1 220px' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Original</Typography>
              <Box sx={{ width: '100%', height: 180, borderRadius: 2, border: `1px solid ${palette.border.default}`, ...LOGO_PREVIEW_SURFACE, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {processDialog.file ? (
                  <Box component="img" src={processDialog.filePreviewUrl} alt="Original" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : null}
              </Box>
            </Box>

            <Box sx={{ flex: '1 1 220px' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Processed preview</Typography>
              <Box sx={{ width: '100%', height: 180, borderRadius: 2, border: `1px solid ${palette.border.default}`, ...LOGO_PREVIEW_SURFACE, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {processedPreviewUrl ? (
                  <Box component="img" src={processedPreviewUrl} alt="Processed" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" color="text.secondary">Click “Update preview”</Typography>
                )}
              </Box>
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          <FormControlLabel
            control={<Checkbox checked={processOpts.removeBackground} onChange={(e) => setProcessOpts((p) => ({ ...p, removeBackground: e.target.checked }))} />}
            label={<Typography variant="body2" fontWeight={600}>Remove solid background color</Typography>}
          />
          <Box sx={{ pl: 1.5, pb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Works best when the image has a mostly-uniform background (white/black). For complex photo backgrounds, use a design tool to cut it out first.
            </Typography>
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: palette.text.secondary }}>
                Tolerance ({processOpts.tolerance})
              </Typography>
              <Slider
                size="small"
                value={processOpts.tolerance}
                min={0}
                max={80}
                step={1}
                onChange={(_, v) => setProcessOpts((p) => ({ ...p, tolerance: v }))}
                disabled={!processOpts.removeBackground}
              />
            </Box>
          </Box>

          <FormControlLabel
            control={<Checkbox checked={processOpts.autoCrop} onChange={(e) => setProcessOpts((p) => ({ ...p, autoCrop: e.target.checked }))} />}
            label={<Typography variant="body2" fontWeight={600}>Auto-crop to the visible logo</Typography>}
          />
          <Box sx={{ pl: 1.5 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: palette.text.secondary }}>
              Padding ({processOpts.padding}px)
            </Typography>
            <Slider
              size="small"
              value={processOpts.padding}
              min={0}
              max={40}
              step={1}
              onChange={(_, v) => setProcessOpts((p) => ({ ...p, padding: v }))}
              disabled={!processOpts.autoCrop}
            />
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, mt: 1, color: palette.text.secondary }}>
              Max size ({processOpts.maxSize}px)
            </Typography>
            <Slider
              size="small"
              value={processOpts.maxSize}
              min={128}
              max={1024}
              step={16}
              onChange={(_, v) => setProcessOpts((p) => ({ ...p, maxSize: v }))}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeProcess} variant="outlined">Cancel</Button>
          <Button onClick={uploadOriginal} disabled={processing} variant="outlined">
            Upload original
          </Button>
          <Button onClick={applyProcessingPreview} disabled={processing} variant="outlined">
            Update preview
          </Button>
          <Button onClick={uploadProcessed} disabled={processing} variant="contained">
            Process & upload (PNG)
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

/* ─── Tab 3: User Preferences ─── */
const PreferencesTab = memo(function PreferencesTab() {
  const { enqueueSnackbar } = useSnackbar();
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => { const res = await preferenceAPI.get(); return res.data.data; },
  });

  const [draft, setDraft] = useState(null);
  if (prefs && !draft) setDraft(prefs);

  const saveMutation = useMutation({
    mutationFn: (data) => preferenceAPI.update(data),
    onSuccess: (res) => { setDraft(res.data.data); qc.invalidateQueries({ queryKey: ['preferences'] }); enqueueSnackbar('Preferences saved', { variant: 'success' }); },
    onError: () => enqueueSnackbar('Failed to save', { variant: 'error' }),
  });

  const resetMutation = useMutation({
    mutationFn: () => preferenceAPI.reset(),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['preferences'] }); enqueueSnackbar('Preferences reset', { variant: 'success' }); },
    onError: () => enqueueSnackbar('Failed to reset', { variant: 'error' }),
  });

  if (isLoading || !draft) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const update = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setDraft((prev) => ({ ...prev, [field]: val }));
  };

  const timezones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'];
  const dateFormats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MMM-YYYY'];

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>Regional Settings</Typography>
          <Divider sx={{ mb: 2.5 }} />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Timezone</InputLabel>
            <Select value={draft.timezone || 'UTC'} label="Timezone" onChange={update('timezone')}>
              {timezones.map((tz) => <MenuItem key={tz} value={tz}>{tz}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Language</InputLabel>
            <Select value={draft.language || 'en'} label="Language" onChange={update('language')}>
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="es">Español</MenuItem>
              <MenuItem value="de">Deutsch</MenuItem>
              <MenuItem value="fr">Français</MenuItem>
              <MenuItem value="ja">日本語</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Date Format</InputLabel>
            <Select value={draft.dateFormat || 'YYYY-MM-DD'} label="Date Format" onChange={update('dateFormat')}>
              {dateFormats.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </Select>
          </FormControl>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>Notifications</Typography>
          <Divider sx={{ mb: 2.5 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: `1px solid ${palette.border.light}` }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>Email Notifications</Typography>
                <Typography variant="caption" color="text.secondary">Receive alerts via email</Typography>
              </Box>
              <Switch checked={draft.notificationEmail !== false} onChange={update('notificationEmail')} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>In-App Notifications</Typography>
                <Typography variant="caption" color="text.secondary">Show notifications in the platform</Typography>
              </Box>
              <Switch checked={draft.notificationInApp !== false} onChange={update('notificationInApp')} />
            </Box>
          </Box>
        </Paper>
      </Grid>
      <Grid size={12}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" startIcon={<Save />} onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>Save Preferences</Button>
          <Button variant="outlined" color="warning" startIcon={<RestartAlt />} onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>Reset to Defaults</Button>
        </Box>
      </Grid>
    </Grid>
  );
});

/* ─── Tab 4: Dashboard Widgets ─── */
const WidgetsTab = memo(function WidgetsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const qc = useQueryClient();

  const { data: serverWidgets, isLoading } = useQuery({
    queryKey: ['widgets'],
    queryFn: async () => { const res = await dashboardWidgetAPI.get(); return res.data.data; },
  });

  const [draft, setDraft] = useState(null);
  if (serverWidgets && !draft) setDraft(serverWidgets);

  const saveMutation = useMutation({
    mutationFn: (widgets) => dashboardWidgetAPI.save({ widgets }),
    onSuccess: (res) => { setDraft(res.data.data); qc.invalidateQueries({ queryKey: ['widgets'] }); enqueueSnackbar('Dashboard layout saved', { variant: 'success' }); },
    onError: () => enqueueSnackbar('Failed to save layout', { variant: 'error' }),
  });

  const resetMutation = useMutation({
    mutationFn: () => dashboardWidgetAPI.reset(),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['widgets'] }); enqueueSnackbar('Dashboard reset to defaults', { variant: 'success' }); },
    onError: () => enqueueSnackbar('Failed to reset', { variant: 'error' }),
  });

  const handleToggle = useCallback((idx) => () => {
    setDraft((prev) => prev.map((w, i) => i === idx ? { ...w, isVisible: !w.isVisible } : w));
  }, []);

  const widgetLabels = {
    SOD_SUMMARY: { label: 'SoD Summary', desc: 'Separation of Duties violation overview', color: palette.status.error },
    CERT_PROGRESS: { label: 'Certification Progress', desc: 'Access certification campaign status', color: palette.status.info },
    RISK_SCORE: { label: 'Risk Score', desc: 'Aggregated identity risk scoring', color: palette.status.warning },
    ORPHAN_COUNT: { label: 'Orphan Accounts', desc: 'Unlinked account detection count', color: palette.brand.secondary },
  };

  if (isLoading || !draft) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>Dashboard Widgets</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Toggle which widgets appear on your {BRANDING.name} dashboard
        </Typography>
        <Grid container spacing={2}>
          {draft.map((w, idx) => {
            const meta = widgetLabels[w.widgetType] || { label: w.widgetType, desc: '', color: palette.text.secondary };
            return (
              <Grid key={w.widgetType || idx} size={{ xs: 12, sm: 6 }}>
                <Paper variant="outlined" sx={{
                  p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderLeft: `3px solid ${w.isVisible !== false ? meta.color : palette.border.default}`,
                  opacity: w.isVisible !== false ? 1 : 0.5, transition: 'all 0.2s',
                }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{meta.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{meta.desc}</Typography>
                  </Box>
                  <Switch checked={w.isVisible !== false} onChange={handleToggle(idx)} />
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </Paper>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" startIcon={<Save />} onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>Save Layout</Button>
        <Button variant="outlined" color="warning" startIcon={<RestartAlt />} onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>Reset to Defaults</Button>
      </Box>
    </Box>
  );
});

/* ─── Main Page ─── */
function BrandingSettings() {
  const [tab, setTab] = useState(0);
  const handleTabChange = useCallback((_, v) => setTab(v), []);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Branding &amp; UI</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {BRANDING.name} {BRANDING.product} &mdash; Tenant branding, logos, user preferences, and dashboard widget configuration
      </Typography>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={handleTabChange}
          sx={{ borderBottom: `1px solid ${palette.border.default}`, px: 2 }}
          variant="scrollable" scrollButtons="auto">
          <Tab label="Branding" icon={<PaletteIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
          <Tab label="Logos" icon={<ImageIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
          <Tab label="Preferences" icon={<Person sx={{ fontSize: 18 }} />} iconPosition="start" />
          <Tab label="Dashboard" icon={<Dashboard sx={{ fontSize: 18 }} />} iconPosition="start" />
        </Tabs>
        <Box sx={{ p: 3 }}>
          <TabPanel value={tab} index={0}><BrandingTab /></TabPanel>
          <TabPanel value={tab} index={1}><LogosTab /></TabPanel>
          <TabPanel value={tab} index={2}><PreferencesTab /></TabPanel>
          <TabPanel value={tab} index={3}><WidgetsTab /></TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}

export default memo(BrandingSettings);
