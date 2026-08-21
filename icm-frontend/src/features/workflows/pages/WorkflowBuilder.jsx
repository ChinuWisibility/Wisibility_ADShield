import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from "@mui/material";
import ReactFlow, {
  Background,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
} from "reactflow";
import { workflowApi } from "../services/api";
import ComponentPalette, { readDragStep } from "../components/builder/ComponentPalette";
import InsertStepPicker from "../components/builder/InsertStepPicker";
import StepPickerModal from "../components/builder/StepPickerModal";
import DropPlaceholderNode from "../components/builder/DropPlaceholderNode";
import StepConfigPanel from "../components/builder/StepConfigPanel";
import WorkflowStepNode from "../components/builder/WorkflowStepNode";
import WorkflowCanvasEdge from "../components/builder/WorkflowCanvasEdge";
import EdgeContextMenu from "../components/builder/EdgeContextMenu";
import IscShell from "../components/isc/IscShell";
import WorkflowEditorHeader from "../components/isc/WorkflowEditorHeader";
import BuilderBottomBar from "../components/isc/BuilderBottomBar";
import TestWorkflowModal from "../components/isc/TestWorkflowModal";
import { definitionToFlow, flowToDefinition, autoLayout } from "../utils/workflowGraph";
import {
  validateConnection,
  buildEdgeFromConnection,
  isBranchingStep,
  normalizeFlowEdges,
  flowGraphHasCycle,
} from "../utils/workflowConstraints";
import { getDefaultConfig, validateAllNodeConfigs } from "../config/stepConfigCatalog";
import { countTriggerNodes, isTriggerStepType } from "../utils/workflowStepMeta";
import { getRemediationEventForDefinition } from "../config/remediationWorkflowCatalog";
import { isSupportedTriggerType } from "../config/workflowTriggerRegistry";
import { mergePaletteCatalog } from "../config/paletteCatalogExtras";
import { resolveBuildCoachState } from "../utils/workflowBuildCoach";
import {
  buildFullAutoFlow,
  buildNextAutoStep,
  canBuildFullAutoFlow,
  resolveConfigForManualAdd,
} from "../utils/workflowAutoBuild";
import { humanizeValidationErrors } from "../utils/workflowValidationMessages";
import useWorkflowHistory from "../hooks/useWorkflowHistory";
import AutoConnectToggle, {
  readAutoConnectPreference,
  writeAutoConnectPreference,
} from "../components/isc/AutoConnectToggle";
import {
  countDisconnectedEdges,
  buildEdgeBetween,
  createStepNode,
  disconnectHandle,
  findAutoConnectSource,
  findEdgeNearPoint,
  insertStepOnEdge,
  resolveAutoConnectPlacement,
} from "../utils/edgeOperations";
import {
  findTriggerNode,
  getPlacementBelowNode,
} from "../utils/workflowNodeVisuals";

const PLACEHOLDER_NODE_ID = "__drop_placeholder__";
const PLACEHOLDER_EDGE_ID = "__drop_placeholder_edge__";

const nodeTypes = {
  workflowStep: WorkflowStepNode,
  dropPlaceholder: DropPlaceholderNode,
};
const edgeTypes = { workflowEdge: WorkflowCanvasEdge };

function BuilderCanvas({
  definition,
  setDefinition,
  validation,
  setValidation,
  id,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedId, setSelectedId] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: "", severity: "info" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [canvasReady, setCanvasReady] = useState(false);
  const [validating, setValidating] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  const [insertPickerEdgeId, setInsertPickerEdgeId] = useState(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState(null);
  const [autoConnect, setAutoConnect] = useState(readAutoConnectPreference);
  const [paletteCatalog, setPaletteCatalog] = useState({});
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [stepPickerOpen, setStepPickerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const autoBuildRanRef = useRef(false);
  const { pushHistory, undo, redo, resetHistory, canUndo, canRedo } = useWorkflowHistory();

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  useOnViewportChange({
    onChange: (vp) => setZoomPct(Math.round((vp.zoom || 1) * 100)),
  });

  useLayoutEffect(() => {
    if (!definition?.id) return;
    setCanvasReady(false);
    const { nodes: n, edges: e } = definitionToFlow(definition);
    setNodes(n);
    setEdges(normalizeFlowEdges(n, e));
    resetHistory();
    setIsDirty(false);
    setHoveredEdgeId(null);
    const t = window.setTimeout(() => {
      fitView({ padding: 0.25, maxZoom: 1 });
      setCanvasReady(true);
    }, 50);
    return () => window.clearTimeout(t);
    // Remount via key={id} loads once per workflow; definition read on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.id, setNodes, setEdges, fitView, resetHistory]);

  const applySnapshot = useCallback(
    (snapshotNodes, snapshotEdges) => {
      setNodes(snapshotNodes);
      setEdges(normalizeFlowEdges(snapshotNodes, snapshotEdges));
      setSelectedId(null);
      setIsDirty(true);
    },
    [setNodes, setEdges],
  );

  const markDirty = useCallback(() => setIsDirty(true), []);

  const remediationEvent = useMemo(
    () => getRemediationEventForDefinition(definition),
    [definition],
  );

  const triggerType = remediationEvent?.triggerType || definition?.trigger?.type || "";
  const unsupportedTrigger = Boolean(triggerType && !isSupportedTriggerType(triggerType));
  const remediationAction = remediationEvent?.action;

  const deleteNode = useCallback(
    (nodeId) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (target && isTriggerStepType(target.data?.stepType)) {
        setSnack({
          open: true,
          message: "The trigger is fixed for this remediation event and cannot be removed.",
          severity: "warning",
        });
        return;
      }
      pushHistory(nodes, edges);
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedId === nodeId) setSelectedId(null);
      markDirty();
      setSnack({ open: true, message: "Step removed", severity: "info" });
    },
    [setNodes, setEdges, selectedId, pushHistory, nodes, edges, markDirty],
  );

  const deleteEdge = useCallback(
    (edgeId) => {
      pushHistory(nodes, edges);
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      markDirty();
      setSnack({ open: true, message: "Connection removed", severity: "info" });
    },
    [setEdges, pushHistory, nodes, edges, markDirty],
  );

  const disconnectHandleAt = useCallback(
    (nodeId, handleType, handleId) => {
      const removed = countDisconnectedEdges(nodeId, handleType, handleId, edges);
      if (removed === 0) return;
      pushHistory(nodes, edges);
      setEdges((eds) => disconnectHandle(nodeId, handleType, handleId, eds));
      markDirty();
      setSnack({
        open: true,
        message: removed === 1 ? "Connection removed" : `${removed} connections removed`,
        severity: "info",
      });
    },
    [edges, pushHistory, nodes, markDirty, setEdges],
  );

  const runInsertOnEdge = useCallback(
    (edgeId, item, dropPosition) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const presetConfig =
        definition?.trigger?.type && item.type
          ? resolveConfigForManualAdd(definition.trigger.type, item.type, nodes, item.label, {
              edges,
              remediationAction,
              connectAfterNode: sourceNode,
            })
          : null;
      const result = insertStepOnEdge({
        edge,
        item,
        nodes,
        edges,
        position: dropPosition,
        configOverride: presetConfig || undefined,
      });
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: "warning" });
        return;
      }
      pushHistory(nodes, edges);
      setNodes(result.nodes);
      setEdges(normalizeFlowEdges(result.nodes, result.edges));
      setSelectedId(result.newNode.id);
      markDirty();
      setSnack({
        open: true,
        message: result.disconnectedTargetId
          ? `End step "${result.newNode.data.label}" inserted; downstream step is no longer connected.`
          : `Inserted "${result.newNode.data.label}" on connection`,
        severity: "success",
      });
    },
    [edges, nodes, pushHistory, markDirty, setNodes, setEdges, definition?.trigger?.type, remediationAction],
  );

  const openInsertPicker = useCallback((edgeId) => {
    setInsertPickerEdgeId(edgeId);
  }, []);

  const openStepPicker = useCallback(() => {
    setStepPickerOpen(true);
  }, []);

  const connectSourceForPlaceholder = useMemo(() => {
    if (!autoConnect) return null;
    return findAutoConnectSource(nodes, edges);
  }, [nodes, edges, autoConnect]);

  const showCanvasPlaceholder = Boolean(connectSourceForPlaceholder?.node);

  const nodesForRender = useMemo(() => {
    const trigger = findTriggerNode(nodes);
    const nonTrigger = nodes.filter((n) => !isTriggerStepType(n.data?.stepType));
    const triggerHasOutgoing = trigger ? edges.some((e) => e.source === trigger.id) : false;

    const mapped = nodes.map((n) => ({
      ...n,
      selected: n.id === selectedId,
      data: {
        ...n.data,
        onDelete: isTriggerStepType(n.data?.stepType) ? undefined : deleteNode,
        onDisconnectHandle: disconnectHandleAt,
        awaitingConnection:
          autoConnect &&
          trigger &&
          n.id === trigger.id &&
          nonTrigger.length === 0 &&
          !triggerHasOutgoing,
      },
    }));

    if (showCanvasPlaceholder && connectSourceForPlaceholder?.node) {
      mapped.push({
        id: PLACEHOLDER_NODE_ID,
        type: "dropPlaceholder",
        position: getPlacementBelowNode(connectSourceForPlaceholder.node),
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: true,
        data: { onOpenPicker: openStepPicker },
      });
    }

    return mapped;
  }, [
    nodes,
    edges,
    selectedId,
    deleteNode,
    disconnectHandleAt,
    autoConnect,
    showCanvasPlaceholder,
    connectSourceForPlaceholder,
    openStepPicker,
  ]);

  const edgesForRender = useMemo(() => {
    const mapped = edges.map((e) => ({
      ...e,
      type: "workflowEdge",
      data: {
        ...e.data,
        isDropTarget: e.id === hoveredEdgeId,
        onInsertClick: () => openInsertPicker(e.id),
      },
    }));

    if (showCanvasPlaceholder && connectSourceForPlaceholder?.node) {
      mapped.push({
        id: PLACEHOLDER_EDGE_ID,
        source: connectSourceForPlaceholder.node.id,
        target: PLACEHOLDER_NODE_ID,
        sourceHandle: connectSourceForPlaceholder.sourceHandle,
        type: "workflowEdge",
        animated: true,
        data: { isPlaceholder: true },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 20, height: 20 },
        style: { stroke: "#94a3b8", strokeWidth: 2.5, strokeDasharray: "8 6" },
      });
    }

    return mapped;
  }, [edges, nodes, hoveredEdgeId, openInsertPicker, showCanvasPlaceholder, connectSourceForPlaceholder]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId],
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.selected) || null,
    [edges],
  );

  const addStepAt = useCallback(
    (item, position) => {
      let finalPosition = position;
      let connectSource = null;

      if (autoConnect && !position) {
        const resolved = resolveAutoConnectPlacement(nodes, edges);
        connectSource = resolved.source;
        if (resolved.position) finalPosition = resolved.position;
      }

      const presetConfig =
        definition?.trigger?.type && item.type
          ? resolveConfigForManualAdd(definition.trigger.type, item.type, nodes, item.label, {
              edges,
              remediationAction,
              connectAfterNode: connectSource?.node || null,
            })
          : null;

      const created = createStepNode(item, nodes, finalPosition, presetConfig || undefined);
      if (created.error) {
        setSnack({ open: true, message: created.error, severity: "warning" });
        return null;
      }

      pushHistory(nodes, edges);
      setNodes((nds) => [...nds, created.node]);

      let connected = false;
      if (autoConnect && connectSource?.node) {
        const connection = {
          source: connectSource.node.id,
          target: created.node.id,
          sourceHandle: connectSource.sourceHandle,
        };
        const check = validateConnection([...nodes, created.node], edges, connection);
        if (check.valid) {
          setEdges((eds) => [
            ...eds,
            buildEdgeBetween(connectSource.node.id, created.node.id, {
              stroke: "#2563eb",
              animated: true,
              sourceHandle: connectSource.sourceHandle,
            }),
          ]);
          connected = true;
        }
      }

      markDirty();
      setSelectedId(created.node.id);
      setSnack({
        open: true,
        message: connected
          ? presetConfig
            ? `Added "${created.node.data.label}" with recommended settings and connected`
            : `Added "${created.node.data.label}" and connected`
          : presetConfig
            ? `Added "${created.node.data.label}" with recommended settings`
            : `Added "${created.node.data.label}"`,
        severity: "success",
      });
      return created.node;
    },
    [nodes, edges, setNodes, setEdges, pushHistory, markDirty, autoConnect, definition?.trigger?.type, remediationAction],
  );

  const handleAutoConnectChange = useCallback((enabled) => {
    setAutoConnect(enabled);
    writeAutoConnectPreference(enabled);
  }, []);

  const onConnect = useCallback(
    (connection) => {
      const result = validateConnection(nodes, edges, connection);
      if (!result.valid) {
        setSnack({ open: true, message: result.message, severity: "warning" });
        return;
      }
      pushHistory(nodes, edges);
      const edge = buildEdgeFromConnection(connection, nodes);
      setEdges((eds) => addEdge(edge, eds));
      markDirty();
      setSnack({
        open: true,
        message: edge.label ? `Connected (${edge.label})` : "Connected",
        severity: "success",
      });
    },
    [nodes, edges, setEdges, pushHistory, markDirty],
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      setHoveredEdgeId(null);
      const item = readDragStep(e.dataTransfer);
      if (!item) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      if (hoveredEdgeId) {
        runInsertOnEdge(hoveredEdgeId, item, position);
        setHoveredEdgeId(null);
        return;
      }

      addStepAt(item, position);
    },
    [screenToFlowPosition, addStepAt, hoveredEdgeId, runInsertOnEdge],
  );

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
      if (!e.dataTransfer.types.includes("application/workflow-step")) {
        setHoveredEdgeId(null);
        return;
      }
      const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const near = findEdgeNearPoint(point, nodes, edges);
      setHoveredEdgeId(near?.id || null);
    },
    [screenToFlowPosition, nodes, edges],
  );

  const onDragLeaveCanvas = useCallback(() => {
    setIsDragOver(false);
    setHoveredEdgeId(null);
  }, []);

  const onUpdateNode = (updated) => {
    setNodes((nds) => nds.map((n) => (n.id === updated.id ? updated : n)));
    markDirty();
  };

  const buildDefinition = useCallback(
    () =>
      flowToDefinition(
        { ...definition, name: definition.name, description: definition.description },
        nodes,
        edges,
      ),
    [definition, nodes, edges],
  );

  const save = async () => {
    setSaving(true);
    try {
      const clientErrors = validateAllNodeConfigs(nodes);
      // Mirror client graph checks used in the bottom bar
      const triggerCount = countTriggerNodes(nodes);
      if (triggerCount === 0) clientErrors.push("Add a start step to the canvas");
      if (triggerCount > 1) clientErrors.push("Only one trigger allowed per workflow");
      if (flowGraphHasCycle(nodes, edges)) {
        clientErrors.push("Cycle detected in workflow graph — remove circular step connections");
      }

      if (clientErrors.length) {
        setValidation({ valid: false, errors: clientErrors });
        setSnack({
          open: true,
          message: "Save blocked — fix validation errors first",
          severity: "error",
        });
        return;
      }

      const def = buildDefinition();
      const tenantId =
        definition?.tenantId
        || new URLSearchParams(location.search).get("tenantId")
        || sessionStorage.getItem("iga_workflows_tenant_id")
        || undefined;
      const res = await workflowApi.update(id, def, tenantId ? { tenantId } : {});
      setDefinition(res.data.data);
      setValidation(res.data.validation || { valid: true, errors: [] });
      setIsDirty(false);
      resetHistory();
      setSnack({ open: true, message: "Workflow saved", severity: "success" });
    } catch (e) {
      if (e.response?.status === 422) {
        const serverValidation = e.response.data.validation || {
          valid: false,
          errors: e.response.data?.message
            ? [e.response.data.message]
            : ["Validation failed"],
        };
        setValidation(serverValidation);
        setSnack({
          open: true,
          message: "Save blocked — fix validation errors first",
          severity: "error",
        });
      } else {
        setSnack({
          open: true,
          message: e.response?.data?.message || e.response?.data?.error?.message || "Save failed",
          severity: "error",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const validateServer = async () => {
    setValidating(true);
    try {
      const clientErrors = validateAllNodeConfigs(nodes);
      const def = buildDefinition();
      const res = await workflowApi.validate(id, def);
      const serverValidation = res.data?.data || { valid: true, errors: [] };
      const mergedErrors = [
        ...clientErrors,
        ...(serverValidation.errors || []).filter((err) => !clientErrors.includes(err)),
      ];
      const valid = mergedErrors.length === 0 && serverValidation.valid !== false;
      setValidation({
        valid,
        errors: mergedErrors.length ? mergedErrors : serverValidation.errors || [],
      });
      setSnack({
        open: true,
        message: valid ? "Validation passed" : "Validation found issues",
        severity: valid ? "success" : "warning",
      });
    } catch (e) {
      if (e.response?.status === 422 && e.response?.data?.validation) {
        setValidation(e.response.data.validation);
        setSnack({
          open: true,
          message: "Validation found issues",
          severity: "warning",
        });
      } else {
        const clientErrors = validateAllNodeConfigs(nodes);
        const fallback = clientErrors.length
          ? clientErrors
          : [e.response?.data?.message || e.response?.data?.error?.message || "Validation failed"];
        setValidation({ valid: false, errors: fallback });
        setSnack({
          open: true,
          message: "Validation found issues",
          severity: "warning",
        });
      }
    } finally {
      setValidating(false);
    }
  };

  const layoutCanvas = () => {
    setNodes((nds) => autoLayout(nds, edges));
    markDirty();
    setTimeout(() => fitView({ padding: 0.2 }), 50);
    setSnack({ open: true, message: "Canvas auto-arranged", severity: "info" });
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === "z" && !e.shiftKey) {
        if (inField) return;
        e.preventDefault();
        if (undo(nodes, edges, applySnapshot)) {
          setSnack({ open: true, message: "Undo", severity: "info" });
        }
        return;
      }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        if (inField) return;
        e.preventDefault();
        if (redo(nodes, edges, applySnapshot)) {
          setSnack({ open: true, message: "Redo", severity: "info" });
        }
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (inField) return;
      if (selectedEdge) {
        deleteEdge(selectedEdge.id);
        return;
      }
      if (selectedId) deleteNode(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEdge, deleteNode, deleteEdge, undo, redo, nodes, edges, applySnapshot]);

  const validateClient = useMemo(() => {
    if (!canvasReady) return [];
    const errors = [...validateAllNodeConfigs(nodes)];
    const triggerCount = countTriggerNodes(nodes);
    if (triggerCount === 0) errors.push("Add a start step to the canvas");
    if (triggerCount > 1) errors.push("Only one trigger allowed per workflow");
    const hasMoreThanTrigger = nodes.some(
      (n) => n.data?.stepType && !isTriggerStepType(n.data.stepType),
    );
    if (
      hasMoreThanTrigger &&
      !nodes.some((n) => ["EndSuccess", "EndFailure"].includes(n.data?.stepType))
    ) {
      errors.push("Add End Success or End Failure step");
    }
    nodes.forEach((src) => {
      if (!isBranchingStep(src.data?.stepType)) return;
      const out = edges.filter((e) => e.source === src.id);
      const hasTrue = out.some((e) => e.sourceHandle === "true" || e.data?.branch === "true");
      const hasFalse = out.some((e) => e.sourceHandle === "false" || e.data?.branch === "false");
      if (!hasTrue || !hasFalse) {
        errors.push(`"${src.data.label}" needs Yes/No connections`);
      }
    });
    if (flowGraphHasCycle(nodes, edges)) {
      errors.push("Cycle detected in workflow graph — remove circular step connections");
    }
    return errors;
  }, [nodes, edges, canvasReady]);

  useEffect(() => {
    if (!remediationAction) return;
    workflowApi
      .catalog(remediationAction)
      .then((r) => setPaletteCatalog(mergePaletteCatalog(r.data.data || {})))
      .catch(() => setPaletteCatalog({}));
  }, [remediationAction]);

  const handleBuildAllFlow = useCallback(() => {
    if (!triggerType) return;
    setAutoBuilding(true);
    const result = buildFullAutoFlow(nodes, edges, triggerType);
    if (result.error) {
      setSnack({ open: true, message: result.error, severity: "warning" });
      setAutoBuilding(false);
      return;
    }
    pushHistory(nodes, edges);
    setNodes(result.nodes);
    setEdges(normalizeFlowEdges(result.nodes, result.edges));
    setSelectedId(null);
    markDirty();
    setAutoBuilding(false);
    setSnack({
      open: true,
      message: "Recommended flow added — review, Validate, then Save.",
      severity: "success",
    });
    window.setTimeout(() => fitView({ padding: 0.2 }), 80);
  }, [triggerType, nodes, edges, pushHistory, setNodes, setEdges, markDirty, fitView]);

  useEffect(() => {
    if (!location.state?.runAutoBuild || autoBuildRanRef.current) return;
    if (!triggerType || unsupportedTrigger) return;
    if (!canBuildFullAutoFlow(nodes, triggerType)) return;
    autoBuildRanRef.current = true;
    handleBuildAllFlow();
    navigate(location.pathname, { replace: true, state: {} });
  }, [
    location.state?.runAutoBuild,
    location.pathname,
    triggerType,
    unsupportedTrigger,
    nodes,
    handleBuildAllFlow,
    navigate,
  ]);

  const handleAddNextStep = useCallback(() => {
    if (!triggerType) return;
    setAutoBuilding(true);
    const result = buildNextAutoStep(nodes, edges, triggerType, paletteCatalog);
    if (result.error) {
      setSnack({ open: true, message: result.error, severity: "warning" });
      setAutoBuilding(false);
      return;
    }
    pushHistory(nodes, edges);
    setNodes(result.nodes);
    setEdges(normalizeFlowEdges(result.nodes, result.edges));
    setSelectedId(result.newNode?.id || null);
    markDirty();
    setAutoBuilding(false);
    setSnack({
      open: true,
      message: `Added "${result.newNode?.data?.label}" with recommended settings`,
      severity: "success",
    });
  }, [
    triggerType,
    nodes,
    edges,
    paletteCatalog,
    pushHistory,
    setNodes,
    setEdges,
    markDirty,
  ]);

  const coachPanelProps = {
    nodes,
    triggerType,
    remediationAction: remediationEvent?.action,
    selectedNodeId: selectedId,
    onBuildAll: handleBuildAllFlow,
    onAddNext: handleAddNextStep,
    building: autoBuilding,
  };

  const nonTriggerCount = useMemo(
    () => nodes.filter((n) => !isTriggerStepType(n.data?.stepType)).length,
    [nodes],
  );

  const canvasCoachHint = useMemo(() => {
    if (unsupportedTrigger) return null;
    if (!triggerType) return null;
    if (canBuildFullAutoFlow(nodes, triggerType)) {
      return "Drag a step, click + on canvas, or use Build entire recommended flow";
    }
    const coach = resolveBuildCoachState({
      nodes,
      remediationAction: remediationEvent?.action,
      triggerType,
    });
    if (coach?.isComplete) return "Flow complete — Validate and Save";
    if (coach?.nextPathStep) {
      return `Or click Add next: ${coach.nextPathStep.shortLabel}`;
    }
    return null;
  }, [nodes, triggerType, remediationEvent?.action, unsupportedTrigger]);

  const allErrors = useMemo(() => {
    const raw = [
      ...(canvasReady ? validateClient : []),
      ...((validation.errors || []).filter((err) => !(canvasReady && validateClient.includes(err)))),
    ];
    return humanizeValidationErrors(raw);
  }, [canvasReady, validateClient, validation.errors]);

  return (
    <div className={`isc-builder-board ${isFullscreen ? "is-fullscreen" : ""}`}>
      <WorkflowEditorHeader
        workflowName={definition.name}
        remediationBadge={remediationEvent?.badge}
        remediationAccent={remediationEvent?.accent}
        triggerLabel={remediationEvent?.triggerLabel}
        onBack={() => navigate("/governance/workflows")}
        onDetails={() => setDetailsOpen(true)}
        onGlobalRuleSet={() =>
          navigate("/org-admin/global-rule-set/remediation-workflow-rules")
        }
        onSave={save}
        onTest={() => setTestOpen(true)}
        saving={saving}
        isDirty={isDirty}
      />
      {unsupportedTrigger && (
        <Alert severity="warning" className="isc-unsupported-trigger-banner">
          Visual editor does not support this trigger type yet. Import or edit JSON, or recreate
          this workflow from a supported event.
        </Alert>
      )}
      <div className="isc-builder-workspace">
        <div className="isc-main">
          <ComponentPalette
            nodes={nodes}
            remediationAction={remediationEvent?.action}
            remediationEvent={remediationEvent}
            onAddStep={(item) => addStepAt(item)}
            onBrowseSteps={unsupportedTrigger ? undefined : () => setStepPickerOpen(true)}
            onBlockedAdd={(msg) => setSnack({ open: true, message: msg, severity: "warning" })}
          />
          <div className="isc-canvas-column">
          <div className="isc-canvas-chrome">
            <span className="isc-canvas-chrome__label">Workflow diagram</span>
            <div className="isc-canvas-chrome__actions">
              <AutoConnectToggle enabled={autoConnect} onChange={handleAutoConnectChange} />
              {canvasCoachHint ? (
                <span className="isc-canvas-chrome__hint isc-canvas-chrome__hint--coach">
                  {canvasCoachHint}
                </span>
              ) : nonTriggerCount === 0 ? (
                <span className="isc-canvas-chrome__hint">
                  Drag a step, click + on canvas, or use Build entire recommended flow
                </span>
              ) : null}
            </div>
          </div>
          <div
            className={`isc-canvas-wrap ${isDragOver ? "canvas-drop-active" : ""}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeaveCanvas}
          >
          <ReactFlow
            nodes={nodesForRender}
            edges={edgesForRender}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={() => setConnecting(true)}
            onConnectEnd={() => setConnecting(false)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
              const defaults = getDefaultConfig(n.data?.stepType);
              const cfg = n.data?.config || {};
              const empty =
                Object.keys(cfg).length === 0 ||
                Object.values(cfg).every((v) => v == null || v === "");
              if (empty && Object.keys(defaults).length > 0) {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === n.id
                      ? { ...node, data: { ...node.data, config: { ...defaults, ...cfg } } }
                      : node,
                  ),
                );
              }
            }}
            onEdgeClick={(_, e) => {
              setSelectedId(null);
              setEdges((eds) => eds.map((ed) => ({ ...ed, selected: ed.id === e.id })));
            }}
            onEdgeContextMenu={(e, edge) => {
              e.preventDefault();
              setEdgeContextMenu({ x: e.clientX, y: e.clientY, edgeId: edge.id });
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
            }}
            connectionLineType="smoothstep"
            connectionLineStyle={{ stroke: "#2563eb", strokeWidth: 2.5 }}
            defaultEdgeOptions={{
              type: "workflowEdge",
              style: { stroke: "#475569", strokeWidth: 2.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#475569", width: 20, height: 20 },
            }}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} color="#cbd5e1" />
            {nonTriggerCount > 0 && (
            <MiniMap
              position="bottom-right"
              style={{ bottom: 8, right: 8 }}
              nodeColor={(n) => {
                const t = n.data?.stepType;
                if (t === "CertificationSignedOff") return "#1a9080";
                if (t === "EndFailure") return "#d93025";
                if (t === "EndSuccess") return "#22a05a";
                return "#1e6bba";
              }}
              maskColor="rgba(240, 242, 246, 0.85)"
            />
            )}
          </ReactFlow>

          {connecting && (
            <div className="workflow-connect-hint">
              Double-click a connector to disconnect · Drop on a line to insert a step
            </div>
          )}

          {isDragOver && (
            <div className="workflow-drop-chip">
              <span>
                {hoveredEdgeId
                  ? "Drop to insert step on connection"
                  : "Drop on connection to insert step, or on canvas to add"}
              </span>
            </div>
          )}

          <div className="isc-canvas-toolbar isc-canvas-toolbar--left">
              <button
                type="button"
                title="Undo (Ctrl+Z)"
                disabled={!canUndo}
                onClick={() => {
                  if (undo(nodes, edges, applySnapshot)) {
                    setSnack({ open: true, message: "Undo", severity: "info" });
                  }
                }}
              >
                Undo
              </button>
              <button
                type="button"
                title="Redo (Ctrl+Y)"
                disabled={!canRedo}
                onClick={() => {
                  if (redo(nodes, edges, applySnapshot)) {
                    setSnack({ open: true, message: "Redo", severity: "info" });
                  }
                }}
              >
                Redo
              </button>
              {(selectedId || selectedEdge) && (
                <button
                  type="button"
                  title="Delete selected (Del)"
                  onClick={() => {
                    if (selectedEdge) deleteEdge(selectedEdge.id);
                    else if (selectedId) deleteNode(selectedId);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
          </div>
          <aside className="isc-right-panel">
            <div className="isc-panel-head isc-panel-head-compact">
              <h2 className="isc-panel-head-title">Configuration</h2>
              <p className="isc-panel-head-sub">Properties for the selected step</p>
            </div>
            <StepConfigPanel
              node={selectedNode}
              nodes={nodes}
              edges={edges}
              onUpdate={onUpdateNode}
              onDelete={selectedNode ? () => deleteNode(selectedNode.id) : undefined}
              triggerType={triggerType}
              triggerLabel={remediationEvent?.triggerLabel}
              remediationAction={remediationEvent?.action}
              coachPanelProps={coachPanelProps}
            />
          </aside>
        </div>
        <BuilderBottomBar
          errors={allErrors}
          isEmptyCanvas={nonTriggerCount === 0 && allErrors.length === 0}
          hasFixedTrigger={Boolean(remediationEvent?.triggerType)}
          unsupportedTrigger={unsupportedTrigger}
          zoomPercent={zoomPct}
          onZoomIn={() => zoomIn()}
          onZoomOut={() => zoomOut()}
          onFitView={() => fitView({ padding: 0.2 })}
          onLayout={layoutCanvas}
          onFullscreen={() => setIsFullscreen((v) => !v)}
          onValidate={validateServer}
          validating={validating}
        />
      </div>

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Workflow Details</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter a name and description for your workflow. These can be updated later.
          </Typography>
          <TextField
            fullWidth
            required
            label="Name"
            size="small"
            value={definition.name || ""}
            onChange={(e) => setDefinition({ ...definition, name: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Description"
            size="small"
            multiline
            minRows={3}
            value={definition.description || ""}
            onChange={(e) => setDefinition({ ...definition, description: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <button type="button" className="isc-btn isc-btn-outline" onClick={() => setDetailsOpen(false)}>
            Close
          </button>
        </DialogActions>
      </Dialog>

      <StepPickerModal
        open={stepPickerOpen}
        remediationAction={remediationEvent?.action}
        triggerType={triggerType}
        nodes={nodes}
        onClose={() => setStepPickerOpen(false)}
        onSelect={(item) => addStepAt(item)}
      />

      <InsertStepPicker
        open={Boolean(insertPickerEdgeId)}
        remediationAction={remediationEvent?.action}
        triggerType={triggerType}
        nodes={nodes}
        onClose={() => setInsertPickerEdgeId(null)}
        onSelect={(item) => {
          if (insertPickerEdgeId) runInsertOnEdge(insertPickerEdgeId, item);
        }}
      />

      <EdgeContextMenu
        anchor={edgeContextMenu}
        onClose={() => setEdgeContextMenu(null)}
        onInsertStep={() => {
          if (edgeContextMenu?.edgeId) openInsertPicker(edgeContextMenu.edgeId);
        }}
        onDeleteConnection={() => {
          if (edgeContextMenu?.edgeId) deleteEdge(edgeContextMenu.edgeId);
        }}
      />

      <TestWorkflowModal
        open={testOpen}
        workflowId={id}
        workflowName={definition.name}
        onClose={() => setTestOpen(false)}
        getDefinition={() => ({ ...buildDefinition(), id })}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack((s) => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

export default function WorkflowBuilder() {
  const { id } = useParams();
  const [definition, setDefinition] = useState(null);
  const [validation, setValidation] = useState({ valid: true, errors: [] });

  useEffect(() => {
    workflowApi.get(id).then((r) => {
      setDefinition(r.data.data);
      setValidation(r.data.validation || { valid: true, errors: [] });
    });
  }, [id]);

  if (!definition) {
    return (
      <IscShell>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography color="text.secondary">Loading workflow…</Typography>
        </div>
      </IscShell>
    );
  }

  return (
    <IscShell>
      <ReactFlowProvider>
        <BuilderCanvas
          key={id}
          definition={definition}
          setDefinition={setDefinition}
          validation={validation}
          setValidation={setValidation}
          id={id}
        />
      </ReactFlowProvider>
    </IscShell>
  );
}
