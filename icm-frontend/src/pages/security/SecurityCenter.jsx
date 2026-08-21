import { Outlet, Navigate, useLocation } from "react-router-dom";
import { SecurityWorkspaceProvider } from "./SecurityWorkspaceContext";

export default function SecurityCenter() {
  const location = useLocation();
  if (location.pathname === "/security" || location.pathname === "/security/") {
    return <Navigate to="/security/dashboard" replace />;
  }

  return (
    <SecurityWorkspaceProvider>
      <Outlet />
    </SecurityWorkspaceProvider>
  );
}
