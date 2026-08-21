import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationAPI } from "../../services/api";
import { securityAPI, isTransientScanError, recoverLatestSecurityScan } from "../../services/securityApi";
import { useAuth } from "../../contexts/AuthContext";
import { buildSecuritySearch, securityPath } from "../../utils/securityNavigation";

const SecurityWorkspaceContext = createContext(null);

export { buildSecuritySearch, securityPath };

function resolveUserTenantId(user) {
  if (!user) return null;
  const tid = user.tenantId;
  if (typeof tid === "object" && tid?._id) return String(tid._id);
  if (tid) return String(tid);
  return null;
}

export function SecurityWorkspaceProvider({ children }) {
  const { user } = useAuth();
  const tenantId = resolveUserTenantId(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const applicationId = searchParams.get("applicationId") || "";
  const assessmentId = searchParams.get("assessmentId") || "";
  /** Optional: view an immutable Version snapshot (read-only). */
  const viewVersionId = searchParams.get("viewVersionId") || "";
  const scanId = searchParams.get("scanId") || "";
  const queryClient = useQueryClient();
  const [scanRunning, setScanRunning] = useState(false);

  const setApplicationId = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("applicationId", id);
      else next.delete("applicationId");
      next.delete("assessmentId");
      next.delete("viewVersionId");
      next.delete("versionId");
      next.delete("scanId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setAssessmentId = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("assessmentId", id);
      else next.delete("assessmentId");
      next.delete("viewVersionId");
      next.delete("versionId");
      next.delete("scanId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setViewVersionId = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("viewVersionId", id);
      else next.delete("viewVersionId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setScanId = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("scanId", id);
      else next.delete("scanId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const appsQuery = useQuery({
    queryKey: ["security", "applications", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const res = await applicationAPI.list({ limit: 500, page: 1, tenantId });
      const data = res.data?.data ?? res.data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.applications)) return data.applications;
      if (Array.isArray(data)) return data;
      return [];
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!applicationId || appsQuery.isLoading) return;
    const apps = appsQuery.data || [];
    if (apps.length && !apps.some((a) => String(a._id) === applicationId)) {
      setApplicationId("");
    }
  }, [applicationId, appsQuery.data, appsQuery.isLoading, setApplicationId]);

  const assessmentQuery = useQuery({
    queryKey: ["security", "assessment", applicationId, assessmentId],
    queryFn: async () => {
      try {
        await securityAPI.migrateLegacyVersions(applicationId, assessmentId);
      } catch {
        /* optional */
      }
      const res = await securityAPI.getAssessment(applicationId, assessmentId);
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && Boolean(assessmentId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!applicationId || !assessmentId) return;
    if (assessmentQuery.isLoading || assessmentQuery.isFetching) return;
    if (assessmentQuery.isError) {
      setAssessmentId("");
    }
  }, [
    applicationId,
    assessmentId,
    assessmentQuery.isLoading,
    assessmentQuery.isFetching,
    assessmentQuery.isError,
    setAssessmentId,
  ]);

  const viewVersionQuery = useQuery({
    queryKey: ["security", "view-version", applicationId, assessmentId, viewVersionId],
    queryFn: async () => {
      const res = await securityAPI.getAssessmentVersion(
        applicationId,
        assessmentId,
        viewVersionId,
      );
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && Boolean(assessmentId) && Boolean(viewVersionId),
    staleTime: 30_000,
  });

  const overviewQuery = useQuery({
    queryKey: ["security", "overview", applicationId, scanId],
    queryFn: async () => {
      const res = await securityAPI.getOverview(applicationId, {
        scanId: scanId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
    staleTime: 20_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchOnWindowFocus: true,
  });

  const recoverLatestScan = useCallback(
    () => recoverLatestSecurityScan(applicationId),
    [applicationId],
  );

  const [scanNotice, setScanNotice] = useState(null);

  useEffect(() => {
    if (!applicationId || overviewQuery.isLoading || overviewQuery.isError) return;
    if (scanId) return;
    if (assessmentId) return;
    const loadedScanId = overviewQuery.data?.scan?.scanId;
    if (loadedScanId) setScanId(loadedScanId);
  }, [
    applicationId,
    assessmentId,
    overviewQuery.data,
    overviewQuery.isLoading,
    overviewQuery.isError,
    scanId,
    setScanId,
  ]);

  const assessmentExecutionsQuery = useQuery({
    queryKey: ["security", "assessment-latest-execution", applicationId, assessmentId],
    queryFn: async () => {
      const res = await securityAPI.listScans(applicationId, {
        limit: 1,
        page: 1,
        assessmentId,
      });
      const scans = Array.isArray(res.data?.data) ? res.data.data : [];
      return scans[0] || null;
    },
    enabled: Boolean(applicationId) && Boolean(assessmentId) && !scanId,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!assessmentId || scanId) return;
    const latest = assessmentExecutionsQuery.data?.scanId;
    if (latest) setScanId(latest);
  }, [assessmentId, scanId, assessmentExecutionsQuery.data, setScanId]);

  const refreshWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["security"] });
  }, [queryClient]);

  const runScan = useCallback(
    async (options = {}) => {
      if (!applicationId) throw new Error("Select an application first");
      const effectiveAssessmentId =
        options.body?.assessmentId || options.assessmentId || assessmentId;
      if (!effectiveAssessmentId) {
        throw new Error("Select or create an Assessment before executing.");
      }
      setScanRunning(true);
      setScanNotice(null);
      try {
        const res = await securityAPI.runScan(applicationId, {
          skipMaterialize: options.skipMaterialize,
          replaceExisting: options.replaceExisting,
          ...(options.body || {}),
          assessmentId: effectiveAssessmentId,
        });
        const data = res.data?.data ?? res.data;
        if (data?.scanId) setScanId(data.scanId);
        const versionNote = data?.versionCreated
          ? ` Version ${data.versionNumber} created from Working Configuration.`
          : data?.versionNumber != null
            ? ` Reused Version ${data.versionNumber}.`
            : "";
        setScanNotice({
          type: "success",
          message: `Assessment execution completed.${versionNote}`,
          scanId: data?.scanId || null,
          showContinuation: true,
        });
        refreshWorkspace();
        return data;
      } catch (err) {
        const isTransient = isTransientScanError(err);
        if (isTransient) {
          try {
            const latest = await recoverLatestScan();
            if (latest?.scanId) {
              setScanId(latest.scanId);
              refreshWorkspace();
              setScanNotice({
                type: "warning",
                message:
                  "Connection dropped during scan, but a completed scan was found. Results have been loaded.",
              });
              return latest;
            }
          } catch {
            /* fall through */
          }
        }
        setScanNotice({
          type: "error",
          message: err?.response?.data?.message || err?.message || "Scan failed.",
        });
        throw err;
      } finally {
        setScanRunning(false);
      }
    },
    [applicationId, assessmentId, refreshWorkspace, setScanId, recoverLatestScan],
  );

  const buildPath = useCallback(
    (path, extras = {}) =>
      securityPath(path, searchParams, {
        applicationId: extras.applicationId !== undefined ? extras.applicationId : applicationId,
        assessmentId: extras.assessmentId !== undefined ? extras.assessmentId : assessmentId,
        viewVersionId:
          extras.viewVersionId !== undefined ? extras.viewVersionId : viewVersionId,
        scanId: extras.scanId !== undefined ? extras.scanId : scanId,
        ...extras,
      }),
    [searchParams, applicationId, assessmentId, viewVersionId, scanId],
  );

  const value = useMemo(
    () => ({
      applicationId,
      assessmentId,
      assessment: assessmentQuery.data || null,
      assessmentLoading: assessmentQuery.isLoading,
      viewVersionId,
      viewVersion: viewVersionQuery.data || null,
      viewVersionLoading: viewVersionQuery.isLoading,
      isViewingVersion: Boolean(viewVersionId),
      scanId,
      setApplicationId,
      setAssessmentId,
      setViewVersionId,
      setScanId,
      applications: appsQuery.data || [],
      applicationsLoading: appsQuery.isLoading,
      tenantId,
      overview: overviewQuery.data,
      overviewLoading: overviewQuery.isLoading,
      overviewError: overviewQuery.error,
      refreshWorkspace,
      runScan,
      scanRunning,
      scanNotice,
      setScanNotice,
      buildPath,
    }),
    [
      applicationId,
      assessmentId,
      assessmentQuery.data,
      assessmentQuery.isLoading,
      viewVersionId,
      viewVersionQuery.data,
      viewVersionQuery.isLoading,
      scanId,
      setApplicationId,
      setAssessmentId,
      setViewVersionId,
      setScanId,
      appsQuery.data,
      appsQuery.isLoading,
      tenantId,
      overviewQuery.data,
      overviewQuery.isLoading,
      overviewQuery.error,
      refreshWorkspace,
      runScan,
      scanRunning,
      scanNotice,
      buildPath,
    ],
  );

  return (
    <SecurityWorkspaceContext.Provider value={value}>
      {children}
    </SecurityWorkspaceContext.Provider>
  );
}

export function useSecurityWorkspace() {
  const ctx = useContext(SecurityWorkspaceContext);
  if (!ctx) {
    throw new Error("useSecurityWorkspace must be used within SecurityWorkspaceProvider");
  }
  return ctx;
}
