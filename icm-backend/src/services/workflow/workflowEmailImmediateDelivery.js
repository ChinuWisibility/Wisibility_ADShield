/**
 * Backward-compatible re-export — immediate SMTP delivery lives in email/deliverEmailJobNow.js
 */
export {
  deliverEmailJobNow,
  deliverEmailJobNow as deliverWorkflowEmailNow,
} from "../email/deliverEmailJobNow.js";
