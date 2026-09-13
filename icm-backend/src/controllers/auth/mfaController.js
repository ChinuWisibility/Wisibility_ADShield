import * as mfaService from '../services/mfaService.js';

export async function getMfaStatus(req, res, next) {
  try {
    const result = await mfaService.getMfaStatus(req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function enrollMfa(req, res, next) {
  try {
    const result = await mfaService.enrollMfa(req.user.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setupTotp(req, res, next) {
  try {
    const result = await mfaService.setupTotp(req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function verifyMfaToken(req, res, next) {
  try {
    const result = await mfaService.verifyMfaToken(req.user.id, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function disableMfa(req, res, next) {
  try {
    const result = await mfaService.disableMfa(req.user.id, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function generateBackupCodes(req, res, next) {
  try {
    const result = await mfaService.generateBackupCodes(req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}
