import { createContext, useContext, useEffect, useState } from "react";
import { workflowApi } from "../services/api";
import { STEP_CONFIG_CATALOG } from "../config/stepConfigCatalog";

const CatalogContext = createContext({
  stepConfig: STEP_CONFIG_CATALOG,
  loaded: false,
});

export function CatalogProvider({ children }) {
  const [stepConfig, setStepConfig] = useState(STEP_CONFIG_CATALOG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    workflowApi
      .stepConfig()
      .then((r) => {
        const server = r.data.data || {};
        setStepConfig({ ...STEP_CONFIG_CATALOG, ...server });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <CatalogContext.Provider value={{ stepConfig, loaded }}>{children}</CatalogContext.Provider>
  );
}

export function useStepConfigCatalog() {
  return useContext(CatalogContext).stepConfig;
}
