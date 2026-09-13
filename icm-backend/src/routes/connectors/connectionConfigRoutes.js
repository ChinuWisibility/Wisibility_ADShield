import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import ApplicationConnectionConfig from '../models/application/ApplicationConnectionConfig.js';
import { createCrudController } from '../utils/crudFactory.js';
import { encryptString } from '../utils/crypto.js';

const router = Router();
const ctrl = createCrudController(ApplicationConnectionConfig, { searchFields: ['endpointUrl', 'authType', 'testStatus'] });

function encryptIncomingSecrets(req, _res, next) {
  const body = req.body || {};
  if (body.username) {
    body.usernameEncrypted = encryptString(body.username);
    delete body.username;
  }
  if (body.password) {
    body.passwordEncrypted = encryptString(body.password);
    delete body.password;
  }
  if (body.clientSecret) {
    body.clientSecretEncrypted = encryptString(body.clientSecret);
    delete body.clientSecret;
  }
  req.body = body;
  next();
}

router.get('/', authenticate, ctrl.list);
router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), encryptIncomingSecrets, ctrl.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), encryptIncomingSecrets, ctrl.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);

export default router;

