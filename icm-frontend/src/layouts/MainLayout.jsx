import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Toolbar } from '@mui/material';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { palette } from '../theme/palette';
import PerformanceMonitor from '../components/PerformanceMonitor';

const DRAWER_WIDTH = 258;
const DRAWER_COLLAPSED = 68;
const isDev = import.meta.env.DEV;

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: palette.bg.primary }}>
      <TopBar
        drawerOpen={sidebarOpen}
        drawerWidth={DRAWER_WIDTH}
        drawerCollapsed={DRAWER_COLLAPSED}
        onToggle={() => setSidebarOpen((prev) => !prev)}
      />
      <Sidebar open={sidebarOpen} />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          transition: 'margin-left 0.2s ease',
        }}
      >
        <Toolbar /> {/* Spacer for fixed AppBar */}
        <Box sx={{ p: 3 }}>
          <Outlet />
        </Box>
      </Box>
      {isDev && <PerformanceMonitor />}
    </Box>
  );
}
