import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import { createCrudController } from '../../utils/crudFactory.js';
import EmailConfiguration from '../../models/notifications/EmailConfiguration.js';
import NotificationQueue from '../../models/notifications/NotificationQueue.js';
import NotificationDeliveryLog from '../../models/notifications/NotificationDeliveryLog.js';
import { encryptString } from '../../utils/crypto.js';
import { sendEmail } from '../../services/email/appEmailService.js';

const router = Router();
const ctrl = createCrudController(EmailConfiguration, { searchFields: ['provider', 'fromAddress', 'fromName', 'testStatus'] });
const queueCtrl = createCrudController(NotificationQueue, { searchFields: ['templateKey', 'channel', 'recipientEmail', 'status', 'errorMessage'] });

function encryptSecrets(req, _res, next) {
  const body = req.body || {};
  if (body.apiKey) {
    body.apiKeyEncrypted = encryptString(body.apiKey);
    delete body.apiKey;
  }
  if (body.username) {
    body.usernameEncrypted = encryptString(body.username);
    delete body.username;
  }
  if (body.password) {
    body.passwordEncrypted = encryptString(body.password);
    delete body.password;
  }
  req.body = body;
  next();
}

router.get('/config', authenticate, ctrl.list);
router.get('/config/:id', authenticate, ctrl.getById);
router.post('/config', authenticate, authorize(ROLES.ADMIN), encryptSecrets, ctrl.create);
router.put('/config/:id', authenticate, authorize(ROLES.ADMIN), encryptSecrets, ctrl.update);
router.delete('/config/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);

// ── Test email config ─────────────────────────────────────────────────────────
router.post('/test', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const to = req.body.to || req.user?.email;
    if (!to) return res.status(400).json({ success: false, message: 'Recipient email required' });

    await sendEmail({
      to,
      subject: 'ICM Platform — Email Configuration Test',
      html: `<p>This is a test email from your ICM Platform. If you received this, your email configuration is working correctly.</p>`,
    });

    // Update testStatus on the active config
    await EmailConfiguration.updateMany({ isActive: true }, { testStatus: 'PASS' });

    return res.json({ success: true, data: { message: `Test email sent to ${to}` } });
  } catch (err) {
    await EmailConfiguration.updateMany({ isActive: true }, { testStatus: 'FAIL' });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Email health ──────────────────────────────────────────────────────────────
router.get('/health', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const [total, sent, failed, bounced] = await Promise.all([
      NotificationDeliveryLog.countDocuments(),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'SENT' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'FAILED' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'BOUNCED' }),
    ]);
    const deliveryRate = total > 0 ? Math.round(((sent) / total) * 100) : null;
    const config = await EmailConfiguration.findOne({ isActive: true }).select('provider fromAddress testStatus').lean();
    return res.json({ success: true, data: { total, sent, failed, bounced, deliveryRate, config } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Notification queue ────────────────────────────────────────────────────────
router.get('/queue/stats', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const [queued, sending, sent, failed] = await Promise.all([
      NotificationQueue.countDocuments({ status: 'QUEUED' }),
      NotificationQueue.countDocuments({ status: 'SENDING' }),
      NotificationQueue.countDocuments({ status: 'SENT' }),
      NotificationQueue.countDocuments({ status: 'FAILED' }),
    ]);
    return res.json({ success: true, data: { queued, sending, sent, failed, total: queued + sending + sent + failed } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/queue', authenticate, queueCtrl.list);
router.get('/queue/:id', authenticate, queueCtrl.getById);
router.post('/queue', authenticate, authorize(ROLES.ADMIN), queueCtrl.create);
router.put('/queue/:id', authenticate, authorize(ROLES.ADMIN), queueCtrl.update);
router.delete('/queue/:id', authenticate, authorize(ROLES.ADMIN), queueCtrl.remove);

// ── Retry failed notification ─────────────────────────────────────────────────
router.post('/queue/:id/retry', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const notification = await NotificationQueue.findById(req.params.id);
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (notification.status !== 'FAILED') {
      return res.status(400).json({ success: false, message: 'Only FAILED notifications can be retried' });
    }
    notification.status = 'QUEUED';
    notification.retryCount = (notification.retryCount || 0) + 1;
    notification.errorMessage = undefined;
    if (req.user) notification.updatedBy = req.user.id;
    await notification.save();
    return res.json({ success: true, data: notification });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Clear entire queue ────────────────────────────────────────────────────────
router.delete('/queue', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const status = req.query.status;
    const filter = status ? { status } : { status: { $in: ['QUEUED', 'FAILED'] } };
    const result = await NotificationQueue.deleteMany(filter);
    return res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Delivery logs ─────────────────────────────────────────────────────────────
router.get('/deliveries', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const filter = status ? { deliveryStatus: status } : {};
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      NotificationDeliveryLog.find(filter)
        .sort({ deliveredAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('queueId', 'recipientEmail subject channel templateKey')
        .lean(),
      NotificationDeliveryLog.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { items, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/deliveries/stats', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const [total, sent, bounced, opened, clicked, failed] = await Promise.all([
      NotificationDeliveryLog.countDocuments(),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'SENT' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'BOUNCED' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'OPENED' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'CLICKED' }),
      NotificationDeliveryLog.countDocuments({ deliveryStatus: 'FAILED' }),
    ]);
    const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
    const clickRate = sent > 0 ? Math.round((clicked / sent) * 100) : 0;
    return res.json({ success: true, data: { total, sent, bounced, opened, clicked, failed, openRate, clickRate } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

