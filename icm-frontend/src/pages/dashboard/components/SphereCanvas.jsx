import { useRef, useEffect, useCallback } from 'react';
import { Box, Typography } from '@mui/material';

/* ── Color palette for risk levels ── */
const RISK_COLORS = {
  critical: '#ff4444',
  high: '#ff8c00',
  medium: '#ffd700',
  low: '#4488ff',
  veryLow: '#00ccaa',
};

const IDENTITY_TYPES = ['employee', 'contractor', 'vendor', 'serviceAccount', 'bot'];

/* ── Generate random identity dots ── */
function generateDots(count = 450) {
  const dots = [];
  const riskLevels = Object.keys(RISK_COLORS);
  const clusters = [
    { name: 'Domain Admin\nIT - Infrastructure', x: -0.3, y: 0.7, z: 0.5, risk: 'critical' },
    { name: 'Cloud Admin\nIT - Cloud', x: -0.5, y: 0.5, z: 0.4, risk: 'critical' },
    { name: 'Finance Super User\nFinance', x: 0.3, y: 0.6, z: 0.3, risk: 'high' },
    { name: 'SAP Power User\nFinance', x: 0.6, y: 0.4, z: 0.2, risk: 'high' },
    { name: 'Privileged User\nHR', x: -0.4, y: 0.3, z: 0.2, risk: 'high' },
    { name: 'High Risk User\nMultiple Violations', x: 0.1, y: 0.3, z: 0.4, risk: 'critical' },
    { name: 'Standard Employee\nSales', x: -0.1, y: -0.1, z: -0.1, risk: 'low' },
    { name: 'Contractor\nThird Party', x: 0.5, y: 0.2, z: 0.1, risk: 'medium' },
    { name: 'Vendor Account\nExternal', x: 0.6, y: -0.1, z: -0.2, risk: 'medium' },
    { name: 'Dormant User\nInactive 90+ Days', x: -0.3, y: -0.3, z: -0.3, risk: 'medium' },
    { name: 'Service Account\nNon-Human', x: 0.0, y: -0.5, z: -0.4, risk: 'low' },
  ];

  // Generate clustered dots
  for (let i = 0; i < count; i++) {
    const cluster = clusters[Math.floor(Math.random() * clusters.length)];
    const risk = Math.random() < 0.4 ? cluster.risk : riskLevels[Math.floor(Math.random() * riskLevels.length)];
    const type = IDENTITY_TYPES[Math.floor(Math.random() * IDENTITY_TYPES.length)];
    const spread = 0.25;

    dots.push({
      x: cluster.x + (Math.random() - 0.5) * spread * 2,
      y: cluster.y + (Math.random() - 0.5) * spread * 2,
      z: cluster.z + (Math.random() - 0.5) * spread * 2,
      risk,
      type,
      size: type === 'serviceAccount' || type === 'bot' ? 3 : 5 + Math.random() * 3,
      opacity: 0.7 + Math.random() * 0.3,
      clusterName: Math.random() < 0.15 ? cluster.name : null,
    });
  }

  return { dots, clusters };
}

export default function SphereCanvas({ width = 600, height = 500 }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const dataRef = useRef(generateDots(450));
  const angleRef = useRef({ x: 0.3, y: 0 });
  const zoomRef = useRef(1);

  const project = useCallback((x, y, z, rotY, rotX, cx, cy, scale) => {
    // Rotate around Y axis
    let x1 = x * Math.cos(rotY) - z * Math.sin(rotY);
    let z1 = x * Math.sin(rotY) + z * Math.cos(rotY);
    // Rotate around X axis
    let y1 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
    let z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);
    // Perspective
    const perspective = 2.5;
    const fov = perspective / (perspective + z2);
    return {
      px: cx + x1 * scale * fov,
      py: cy - y1 * scale * fov,
      scale: fov,
      z: z2,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Force higher resolution for crisp rendering
    const dpr = (window.devicePixelRatio || 1) * 2;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const cx = width / 2;
    const cy = height / 2;
    const baseScale = Math.min(width, height) * 0.42;

    function getScale() {
      return baseScale * zoomRef.current;
    }

    function drawGrid(rotY, rotX) {
      const scale = getScale();
      // Darker grid lines for light theme visibility
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;

      // Draw sphere wireframe circles
      for (let ring = 0; ring < 5; ring++) {
        const r = (ring + 1) / 5;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2; a += 0.05) {
          const x = r * Math.cos(a);
          const z = r * Math.sin(a);
          const p = project(x, 0, z, rotY, rotX, cx, cy, scale);
          if (a === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
      }

      // Vertical rings
      for (let ring = 0; ring < 3; ring++) {
        const angleOffset = (Math.PI / 3) * ring;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2; a += 0.05) {
          const y = Math.cos(a);
          const z = Math.sin(a);
          
          // Rotate ring around Y axis
          const rotatedX = z * Math.sin(angleOffset);
          const rotatedZ = z * Math.cos(angleOffset);

          const p = project(rotatedX, y, rotatedZ, rotY, rotX, cx, cy, scale);
          if (a === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
      }
    }

    function drawAxes(rotY, rotX) {
      const scale = getScale();
      const axisLen = 1.2;

      // X axis
      const xStart = project(-axisLen, 0, 0, rotY, rotX, cx, cy, scale);
      const xEnd = project(axisLen, 0, 0, rotY, rotX, cx, cy, scale);
      ctx.strokeStyle = 'rgba(0,180,100,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xStart.px, xStart.py);
      ctx.lineTo(xEnd.px, xEnd.py);
      ctx.stroke();

      // Y axis
      const yStart = project(0, -axisLen, 0, rotY, rotX, cx, cy, scale);
      const yEnd = project(0, axisLen, 0, rotY, rotX, cx, cy, scale);
      ctx.strokeStyle = 'rgba(0,180,200,0.3)';
      ctx.beginPath();
      ctx.moveTo(yStart.px, yStart.py);
      ctx.lineTo(yEnd.px, yEnd.py);
      ctx.stroke();

      // Z axis
      const zStart = project(0, 0, -axisLen, rotY, rotX, cx, cy, scale);
      const zEnd = project(0, 0, axisLen, rotY, rotX, cx, cy, scale);
      ctx.strokeStyle = 'rgba(50,100,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(zStart.px, zStart.py);
      ctx.lineTo(zEnd.px, zEnd.py);
      ctx.stroke();
    }

    function drawDots(rotY, rotX) {
      const scale = getScale();
      const { dots } = dataRef.current;

      // Sort by z for proper depth ordering
      const projected = dots.map((dot) => {
        const p = project(dot.x, dot.y, dot.z, rotY, rotX, cx, cy, scale);
        return { ...dot, ...p };
      });
      projected.sort((a, b) => a.z - b.z);

      // Draw connecting lines for network effect
      ctx.lineWidth = 0.5;
      for (let i = 0; i < projected.length; i++) {
        const dot1 = projected[i];
        if (i % 3 !== 0) continue; 
        
        for (let j = i + 1; j < projected.length; j++) {
          const dot2 = projected[j];
          const dx = dot1.x - dot2.x;
          const dy = dot1.y - dot2.y;
          const dz = dot1.z - dot2.z;
          const distSq = dx*dx + dy*dy + dz*dz;
          
          if (distSq < 0.03) {
            ctx.beginPath();
            ctx.moveTo(dot1.px, dot1.py);
            ctx.lineTo(dot2.px, dot2.py);
            
            // Gradient line adapted for light theme
            const grad = ctx.createLinearGradient(dot1.px, dot1.py, dot2.px, dot2.py);
            grad.addColorStop(0, RISK_COLORS[dot1.risk] + '55');
            grad.addColorStop(1, RISK_COLORS[dot2.risk] + '55');
            
            ctx.strokeStyle = grad;
            ctx.stroke();
          }
        }
      }

      for (const dot of projected) {
        const color = RISK_COLORS[dot.risk];
        const size = dot.size * dot.scale;
        const alpha = dot.opacity;

        ctx.globalAlpha = alpha;

        // Solid clear dot for light theme
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dot.px, dot.py, size, 0, Math.PI * 2);
        ctx.fill();

        // Very subtle border
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = size * 0.15;
        ctx.stroke();
        
        ctx.globalAlpha = 1;

        // Cluster labels (dark text for light theme)
        if (dot.clusterName && dot.scale > 0.7) {
          ctx.fillStyle = 'rgba(17,24,39,0.85)'; // Dark text
          ctx.font = `600 ${9 * dot.scale}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'left';
          const lines = dot.clusterName.split('\n');
          lines.forEach((line, li) => {
            ctx.fillStyle = li === 0 ? 'rgba(17,24,39,0.95)' : 'rgba(75,85,99,0.8)';
            ctx.font = li === 0
              ? `700 ${9 * dot.scale}px Inter, system-ui, sans-serif`
              : `500 ${7.5 * dot.scale}px Inter, system-ui, sans-serif`;
            
            // Text shadow/outline for readability against network lines
            ctx.shadowColor = 'white';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillText(line, dot.px + size + 6, dot.py + li * 11 * dot.scale - 2);
            ctx.shadowBlur = 0; // reset
          });
        }
      }
    }

    function drawAxisLabels(rotY, rotX) {
      const scale = getScale();
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';

      // Axis labels adapted for light theme (darker greens/blues)
      ctx.fillStyle = 'rgba(0,150,80,0.8)';
      ctx.fillText('Low Context', cx - scale * 0.9, cy + scale * 0.15);
      ctx.fillText('High Context', cx + scale * 0.9, cy + scale * 0.15);

      ctx.fillStyle = 'rgba(20,100,200,0.8)';
      ctx.fillText('High Impact / High Risk', cx, cy - scale * 1.05);
      ctx.fillText('Low Impact / Low Risk', cx, cy + scale * 1.1);

      ctx.save();
      ctx.fillStyle = 'rgba(0,150,150,0.8)';
      ctx.fillText('Low Complexity', cx + scale * 1.0, cy + scale * 0.5);
      ctx.restore();
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);

      angleRef.current.y += 0.002;
      const rotY = angleRef.current.y;
      const rotX = angleRef.current.x;

      drawGrid(rotY, rotX);
      drawAxes(rotY, rotX);
      drawDots(rotY, rotX);
      drawAxisLabels(rotY, rotX);

      animRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [width, height, project]);

  // Handle zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      e.preventDefault();
      // Adjust zoom speed
      const zoomSensitivity = 0.001;
      let newZoom = zoomRef.current - e.deltaY * zoomSensitivity;
      // Clamp zoom
      newZoom = Math.max(0.3, Math.min(newZoom, 4));
      zoomRef.current = newZoom;
    };

    // Use raw DOM event for preventDefault to work properly (passive: false)
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <Box sx={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: 'block',
        }}
      />
      {/* Axis labels overlay (dark text) */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
        }}
      >
        <Typography
          sx={{
            color: '#2563eb', // Blue-600
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Z AXIS
        </Typography>
        <Typography
          sx={{
            color: '#4b5563', // Gray-600
            fontSize: '0.6rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
          }}
        >
          RISK & BUSINESS IMPACT
        </Typography>
      </Box>

      <Box
        sx={{
          position: 'absolute',
          bottom: 50,
          left: 20,
          textAlign: 'left',
        }}
      >
        <Typography
          sx={{
            color: '#059669', // Emerald-600
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
          }}
        >
          X AXIS
        </Typography>
        <Typography
          sx={{
            color: '#4b5563',
            fontSize: '0.55rem',
            fontWeight: 600,
          }}
        >
          IDENTITY CONTEXT
        </Typography>
      </Box>

      <Box
        sx={{
          position: 'absolute',
          bottom: 50,
          right: 20,
          textAlign: 'right',
        }}
      >
        <Typography
          sx={{
            color: '#0d9488', // Teal-600
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
          }}
        >
          Y AXIS
        </Typography>
        <Typography
          sx={{
            color: '#4b5563',
            fontSize: '0.55rem',
            fontWeight: 600,
          }}
        >
          ACCESS COMPLEXITY
        </Typography>
      </Box>
    </Box>
  );
}
