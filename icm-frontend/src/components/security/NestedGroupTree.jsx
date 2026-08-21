import { useMemo, useState } from "react";
import {
  Box,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { featureLabel } from "../../pages/security/securityFeatureMeta";

/**
 * Simple expandable hierarchy from nested-group / escalation findings (not full graph).
 */
export default function NestedGroupTree({ findings = [], maxRoots = 40 }) {
  const roots = useMemo(() => buildTreeFromFindings(findings), [findings]);
  const [open, setOpen] = useState({});

  if (!roots.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No nested group findings in the current scan.
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {roots.slice(0, maxRoots).map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          open={open}
          setOpen={setOpen}
        />
      ))}
    </List>
  );
}

function TreeNode({ node, depth, open, setOpen }) {
  const hasChildren = node.children?.length > 0;
  const isOpen = open[node.id];

  return (
    <>
      <ListItemButton
        sx={{ pl: 1 + depth * 2 }}
        onClick={() => hasChildren && setOpen((o) => ({ ...o, [node.id]: !isOpen }))}
      >
        {hasChildren ? (
          <IconButton size="small" edge="start" tabIndex={-1}>
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 32 }} />
        )}
        <ListItemText
          primary={node.label}
          secondary={node.subtitle}
          primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
          secondaryTypographyProps={{ variant: "caption" }}
        />
      </ListItemButton>
      {hasChildren && (
        <Collapse in={isOpen} timeout="auto" unmountOnExit>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              open={open}
              setOpen={setOpen}
            />
          ))}
        </Collapse>
      )}
    </>
  );
}

function buildTreeFromFindings(findings) {
  const nodes = [];
  for (const f of findings) {
    const rels = f.relationships || [];
    if (rels.length) {
      const children = rels.map((r, i) => ({
        id: `${f.id}-rel-${i}`,
        label: shortLabel(r.to),
        subtitle: r.type,
        children: [],
      }));
      nodes.push({
        id: f.id,
        label: f.objectName || f.dn,
        subtitle: `${featureLabel(f.feature)} · depth ${f.metadata?.maxDepth ?? "—"}`,
        children,
      });
    } else {
      nodes.push({
        id: f.id,
        label: f.objectName || f.dn,
        subtitle: featureLabel(f.feature),
        children: [],
      });
    }
  }
  return nodes;
}

function shortLabel(id) {
  const s = String(id || "");
  const parts = s.split(":");
  return parts[parts.length - 1] || s;
}
