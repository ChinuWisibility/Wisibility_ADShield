import { getSchemaForApplication } from "../../services/transform/schemaService.js";

export async function getSchemaByAppId(req, res, next) {
  try {
    const { appId } = req.params;
    const data = await getSchemaForApplication(appId, { user: req.user });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
