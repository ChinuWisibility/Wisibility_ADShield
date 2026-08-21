import { buildApplicationCertificationInsights } from "../services/application/applicationCatalogInsightsService.js";

function sendError(res, err, fallback) {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error("[applicationCatalogInsights]", err?.message || err);
  }
  return res.status(status).json({
    success: false,
    message: err.message || fallback,
  });
}

/** GET /applications/:id/certifications */
export async function getApplicationCertifications(req, res) {
  try {
    const data = await buildApplicationCertificationInsights(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, "Failed to load application certification insights");
  }
}
