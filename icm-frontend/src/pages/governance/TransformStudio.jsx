import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  Autocomplete,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Chip,
  Tooltip,
  Menu,
  MenuItem,
  Dialog,
  IconButton,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  LightbulbOutlined as HintIcon,
  Save as SaveIcon,
  MenuBook as TemplateIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { ensureMonacoConfigured, monaco } from '../../utils/monacoSetup';
import { applicationAPI, transformAPI, schemaAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { TRANSFORM_TEMPLATES } from './transformTemplates';

const DEFAULT_SAMPLE = `{
  "fn": "Jane",
  "ln": "Doe",
  "email": "JANE@EXAMPLE.COM",
  "departmentCode": "IT"
}`;

const INITIAL_JSON = JSON.stringify(
  TRANSFORM_TEMPLATES[0]?.json || {
    type: 'concat',
    attributes: { values: ['fn', '.', 'ln'] },
  },
  null,
  2,
);

function useDebounced(fn, delay) {
  const t = useRef(null);
  return useCallback(
    (...args) => {
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => {
        fn(...args);
      }, delay);
    },
    [fn, delay],
  );
}

export default function TransformStudio() {
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [name, setName] = useState('Untitled transform');
  const [description, setDescription] = useState('');
  const [editorValue, setEditorValue] = useState(INITIAL_JSON);
  const [sampleDataStr, setSampleDataStr] = useState(DEFAULT_SAMPLE);
  const [app, setApp] = useState(null);
  const [apps, setApps] = useState([]);
  /** When set, Save updates this document; otherwise creates a new transform. */
  const [editingTransformId, setEditingTransformId] = useState(null);
  const [savedTransforms, setSavedTransforms] = useState([]);
  const [schemaFields, setSchemaFields] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const fullscreenEditorRef = useRef(null);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const schemaFieldsRef = useRef([]);
  const completionDisposable = useRef(null);

  useEffect(() => {
    ensureMonacoConfigured();
  }, []);

  useEffect(() => {
    schemaFieldsRef.current = schemaFields;
  }, [schemaFields]);

  const loadSavedTransforms = useCallback(async () => {
    try {
      const params = { limit: 100, page: 1 };
      if (tenantId) params.tenantId = tenantId;
      const res = await transformAPI.list(params);
      const rows = res.data?.data;
      setSavedTransforms(Array.isArray(rows) ? rows : []);
    } catch {
      setSavedTransforms([]);
      enqueueSnackbar('Could not load saved transforms', { variant: 'warning' });
    }
  }, [tenantId, enqueueSnackbar]);

  useEffect(() => {
    void loadSavedTransforms();
  }, [loadSavedTransforms]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = { limit: 500, page: 1 };
        if (tenantId) params.tenantId = tenantId;
        const res = await applicationAPI.list(params);
        const rows = res.data?.data;
        if (!cancelled && Array.isArray(rows)) setApps(rows);
      } catch {
        if (!cancelled) enqueueSnackbar('Could not load applications', { variant: 'warning' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enqueueSnackbar, tenantId]);

  /** After apps load, replace stub `{ _id, name }` from saved transform with the full Application row from this tenant’s list. */
  useEffect(() => {
    if (!app?._id || !apps.length) return;
    const match = apps.find((a) => String(a._id) === String(app._id));
    if (match && !apps.includes(app)) setApp(match);
  }, [app, apps]);

  useEffect(() => {
    if (!app?._id) {
      setSchemaFields([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await schemaAPI.getByAppId(app._id);
        const attrs = res.data?.data?.attributes ?? [];
        if (!cancelled) setSchemaFields(Array.isArray(attrs) ? attrs.map((a) => a.name).filter(Boolean) : []);
      } catch {
        if (!cancelled) {
          setSchemaFields([]);
          enqueueSnackbar('Could not load schema for application', { variant: 'warning' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, enqueueSnackbar]);

  useEffect(() => {
    completionDisposable.current?.dispose();
    completionDisposable.current = monaco.languages.registerCompletionItemProvider('json', {
      triggerCharacters: ['"', '.'],
      provideCompletionItems(model, position) {
        const fields = schemaFieldsRef.current;
        if (!fields.length) return { suggestions: [] };
        const line = model.getLineContent(position.lineNumber);
        const ch = position.column;
        const before = line.slice(0, ch - 1);
        const inString = (before.match(/"/g) || []).length % 2 === 1;
        if (!inString) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: fields.map((f) => ({
            label: f,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: f,
            range,
          })),
        };
      },
    });
    return () => completionDisposable.current?.dispose();
  }, [schemaFields.length]);

  const parseEditorJson = useCallback(() => {
    try {
      return { ok: true, value: JSON.parse(editorValue) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }, [editorValue]);

  const applyMarkers = useCallback(
    (errors) => {
      const ed = editorFullscreen ? fullscreenEditorRef.current : editorRef.current;
      const model = ed?.getModel?.();
      if (!model || !monaco) return;
      const markers = (errors || []).map((e) => {
        const line = e.line || 1;
        const col = e.column || 1;
        let msg = e.message || 'Error';
        if (e.suggestions?.length) {
          msg += ` — Did you mean: ${e.suggestions.join(', ')}?`;
        }
        return {
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 40,
          message: msg,
        };
      });
      monaco.editor.setModelMarkers(model, 'transform', markers);
    },
    [editorFullscreen],
  );

  const runExecute = useCallback(async () => {
    setPreviewError(null);
    setPreviewResult(null);
    let sampleData = {};
    try {
      sampleData = JSON.parse(sampleDataStr || '{}');
    } catch {
      setPreviewError('Sample data is not valid JSON');
      return;
    }
    const parsed = parseEditorJson();
    if (!parsed.ok) {
      setPreviewError('Fix JSON syntax before running');
      return;
    }
    try {
      const res = await transformAPI.execute({
        transformJson: parsed.value,
        sampleData,
      });
      if (res.data?.success === false) {
        setPreviewError(res.data?.message || 'Execution failed');
        return;
      }
      const r = res.data?.data?.result ?? res.data?.result;
      setPreviewResult(r);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message ||
        'Execute failed';
      setPreviewError(msg);
    }
  }, [sampleDataStr, parseEditorJson]);

  const runValidate = useCallback(async () => {
    const parsed = parseEditorJson();
    if (!parsed.ok) {
      const syn = {
        code: 'SYNTAX',
        message: parsed.error?.message || 'Invalid JSON',
        line: 1,
        column: 1,
      };
      setValidationErrors([syn]);
      applyMarkers([syn]);
      return;
    }
    try {
      const res = await transformAPI.validate({
        transformJson: parsed.value,
        appId: app?._id || undefined,
      });
      const payload = res.data?.data;
      const errs = payload?.errors ?? [];
      setValidationErrors(errs);
      applyMarkers(errs);
      if (!errs.length) {
        await runExecute();
      }
    } catch (err) {
      enqueueSnackbar(err.response?.data?.error?.message || 'Validation request failed', {
        variant: 'error',
      });
    }
  }, [app, parseEditorJson, enqueueSnackbar, runExecute, applyMarkers]);

  const debouncedValidate = useDebounced(runValidate, 380);

  useEffect(() => {
    debouncedValidate();
  }, [editorValue, app, debouncedValidate]);

  const handleSave = async () => {
    const parsed = parseEditorJson();
    if (!parsed.ok) {
      enqueueSnackbar('Fix JSON before saving', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || 'Untitled transform',
        description,
        transformJson: parsed.value,
        linkedAppId: app?._id || null,
      };
      if (editingTransformId) {
        await transformAPI.update(editingTransformId, payload);
        enqueueSnackbar('Transform updated', { variant: 'success' });
      } else {
        const res = await transformAPI.create(payload);
        const created = res.data?.data;
        if (created?._id) setEditingTransformId(String(created._id));
        enqueueSnackbar('Transform saved', { variant: 'success' });
      }
      await loadSavedTransforms();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.error?.message || err.response?.data?.message || 'Save failed', {
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const startNewTransform = () => {
    setEditingTransformId(null);
    setName('Untitled transform');
    setDescription('');
    setEditorValue(INITIAL_JSON);
    setApp(null);
    setPreviewResult(null);
    setPreviewError(null);
  };

  const applySavedTransformDoc = (doc) => {
    if (!doc) return;
    setEditingTransformId(doc._id != null ? String(doc._id) : null);
    setName(doc.name || 'Untitled transform');
    setDescription(doc.description != null ? String(doc.description) : '');
    try {
      setEditorValue(JSON.stringify(doc.transformJson ?? {}, null, 2));
    } catch {
      setEditorValue('{}');
    }
    const linked = doc.linkedAppId;
    if (linked && typeof linked === 'object' && linked._id) {
      const found = apps.find((a) => String(a._id) === String(linked._id));
      setApp(found || { _id: linked._id, name: linked.name || String(linked._id) });
    } else if (linked) {
      const id = String(linked);
      const found = apps.find((a) => String(a._id) === id);
      setApp(found || null);
    } else {
      setApp(null);
    }
    setPreviewResult(null);
    setPreviewError(null);
  };

  const [tplAnchor, setTplAnchor] = useState(null);
  const applyTemplate = (tpl) => {
    setEditingTransformId(null);
    setEditorValue(JSON.stringify(tpl.json, null, 2));
    setTplAnchor(null);
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (editorFullscreen) {
        fullscreenEditorRef.current?.layout?.();
      } else {
        editorRef.current?.layout?.();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [editorFullscreen]);

  const onMountInline = useCallback((ed) => {
    editorRef.current = ed;
  }, []);
  const onMountFullscreen = useCallback((ed) => {
    fullscreenEditorRef.current = ed;
  }, []);

  const editorOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      tabSize: 2,
    }),
    [],
  );

  const renderMonacoEditor = useCallback(
    (which) => (
      <Editor
        height="100%"
        defaultLanguage="json"
        theme="vs-dark"
        value={editorValue}
        onChange={(v) => setEditorValue(v ?? '')}
        onMount={which === 'inline' ? onMountInline : onMountFullscreen}
        options={editorOptions}
      />
    ),
    [editorValue, editorOptions, onMountInline, onMountFullscreen],
  );

  const errorPanel = useMemo(
    () => (
      <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 200, overflow: 'auto' }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Validation
        </Typography>
        {!validationErrors.length ? (
          <Typography variant="body2" color="success.main">
            No blocking errors
          </Typography>
        ) : (
          <List dense disablePadding>
            {validationErrors.map((e, i) => (
              <ListItem key={i} alignItems="flex-start" sx={{ py: 0.5 }}>
                <ListItemText
                  primary={e.message}
                  secondary={
                    e.suggestions?.length ? (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
                        <HintIcon fontSize="small" color="action" />
                        <span>{e.suggestions.join(', ')}</span>
                      </Stack>
                    ) : null
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    ),
    [validationErrors],
  );

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Transform Studio
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Schema-aware JSON transforms with live validation and preview
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          <Tooltip title="Load a saved transform (this tenant) or a starter template">
            <Button
              variant="outlined"
              startIcon={<TemplateIcon />}
              onClick={(ev) => setTplAnchor(ev.currentTarget)}
            >
              Load
            </Button>
          </Tooltip>
          <Menu
            anchorEl={tplAnchor}
            open={Boolean(tplAnchor)}
            onClose={() => setTplAnchor(null)}
            PaperProps={{ sx: { maxHeight: 420, minWidth: 280 } }}
          >
            {savedTransforms.length > 0 ? (
              <ListSubheader disableSticky sx={{ lineHeight: 2.25, fontWeight: 700 }}>
                Saved transforms (this tenant)
              </ListSubheader>
            ) : (
              <ListSubheader disableSticky sx={{ lineHeight: 2.25, fontWeight: 600, color: 'text.secondary' }}>
                No saved transforms yet — use Save to create one
              </ListSubheader>
            )}
            {savedTransforms.map((doc) => (
              <MenuItem
                key={String(doc._id)}
                onClick={() => {
                  applySavedTransformDoc(doc);
                  setTplAnchor(null);
                }}
              >
                <ListItemText
                  primary={doc.name || 'Untitled'}
                  secondary={doc.description ? String(doc.description).slice(0, 80) : undefined}
                />
              </MenuItem>
            ))}
            <Divider sx={{ my: 0.5 }} />
            <ListSubheader disableSticky sx={{ lineHeight: 2.25, fontWeight: 700 }}>
              Starter templates
            </ListSubheader>
            {TRANSFORM_TEMPLATES.map((t) => (
              <MenuItem
                key={t.id}
                onClick={() => {
                  applyTemplate(t);
                  setTplAnchor(null);
                }}
              >
                <ListItemText primary={t.label} secondary={t.description} />
              </MenuItem>
            ))}
          </Menu>
          <Button variant="outlined" size="small" onClick={startNewTransform}>
            New
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={saving} onClick={handleSave}>
            {editingTransformId ? 'Update' : 'Save'}
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label="Name"
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <TextField
          label="Description"
          size="small"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <Autocomplete
          sx={{ minWidth: 280 }}
          size="small"
          options={apps}
          getOptionLabel={(o) => (o?.name ? `${o.name}` : '')}
          isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
          value={app}
          onChange={(_e, v) => setApp(v)}
          noOptionsText={tenantId ? 'No applications for this tenant' : 'Sign in with a tenant to list applications'}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Application (optional)"
              placeholder={tenantId ? 'Bind schema for validation' : 'Tenant required'}
            />
          )}
        />
      </Stack>

      {app && (
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          <Typography variant="caption" color="text.secondary">
            Schema fields:
          </Typography>
          {schemaFields.slice(0, 24).map((f) => (
            <Chip key={f} size="small" label={f} variant="outlined" />
          ))}
          {schemaFields.length > 24 && (
            <Chip size="small" label={`+${schemaFields.length - 24} more`} variant="outlined" />
          )}
        </Stack>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gridTemplateRows: { xs: 'auto', lg: 'minmax(360px, 55vh) auto' },
          gap: 2,
          flex: 1,
          minHeight: 0,
        }}
      >
        {!editorFullscreen ? (
          <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 360 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, py: 0.5 }}>
              <Typography variant="subtitle2">Transform JSON</Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Tooltip title="Expand editor to full screen">
                  <IconButton
                    size="small"
                    aria-label="Open transform editor full screen"
                    onClick={() => setEditorFullscreen(true)}
                  >
                    <FullscreenIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Button size="small" startIcon={<RunIcon />} onClick={runValidate}>
                  Validate
                </Button>
              </Stack>
            </Stack>
            <Divider />
            <Box sx={{ flex: 1, minHeight: 320 }}>{renderMonacoEditor('inline')}</Box>
          </Paper>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 360,
              px: 2,
              py: 3,
              bgcolor: 'action.hover',
              borderStyle: 'dashed',
            }}
          >
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mb: 1 }}>
              Transform JSON is open in full screen. Press Esc or use the exit control to return.
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FullscreenExitIcon />}
              onClick={() => setEditorFullscreen(false)}
            >
              Exit full screen
            </Button>
          </Paper>
        )}

        <Dialog
          fullScreen
          open={editorFullscreen}
          onClose={() => setEditorFullscreen(false)}
          aria-labelledby="transform-editor-fullscreen-title"
        >
          <Paper
            square
            elevation={0}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              bgcolor: 'background.default',
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}
            >
              <Typography id="transform-editor-fullscreen-title" variant="subtitle1" fontWeight={600}>
                Transform JSON
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Button size="small" startIcon={<RunIcon />} onClick={runValidate}>
                  Validate
                </Button>
                <Tooltip title="Exit full screen">
                  <IconButton
                    size="small"
                    aria-label="Close full screen editor"
                    onClick={() => setEditorFullscreen(false)}
                  >
                    <FullscreenExitIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
            <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
              {editorFullscreen ? renderMonacoEditor('fullscreen') : null}
            </Box>
          </Paper>
        </Dialog>

        <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 360 }}>
          <Typography variant="subtitle2" sx={{ px: 1, py: 1 }}>
            Output preview
          </Typography>
          <Divider />
          <Box sx={{ p: 2, flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
            {previewError && (
              <Typography color="error" sx={{ mb: 1 }}>
                {previewError}
              </Typography>
            )}
            {previewResult !== null && previewResult !== undefined && (
              <Typography component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
                {typeof previewResult === 'string'
                  ? previewResult
                  : JSON.stringify(previewResult, null, 2)}
              </Typography>
            )}
            {!previewError && previewResult === null && (
              <Typography color="text.secondary">Run executes when JSON is valid…</Typography>
            )}
          </Box>
          <Divider />
          <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
            Sample data (context)
          </Typography>
          <TextField
            multiline
            minRows={6}
            fullWidth
            value={sampleDataStr}
            onChange={(e) => setSampleDataStr(e.target.value)}
            sx={{ px: 1, pb: 1 }}
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Stack direction="row" sx={{ px: 1, pb: 1 }} spacing={1}>
            <Button size="small" variant="outlined" onClick={runExecute}>
              Run now
            </Button>
          </Stack>
        </Paper>

        <Box sx={{ gridColumn: { xs: '1', lg: '1 / -1' } }}>{errorPanel}</Box>
      </Box>
    </Box>
  );
}
