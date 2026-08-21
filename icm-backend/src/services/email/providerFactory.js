import SmtpProvider from "./providers/SmtpProvider.js";

const providers = {
  smtp: SmtpProvider,
  gmail: SmtpProvider, // alias — still env-driven SMTP, not Gmail-only
};

let cachedProvider = null;
let cachedKey = null;

/**
 * Resolve email provider from EMAIL_PROVIDER env (default: smtp).
 */
export function getEmailProvider() {
  const key = String(process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
  if (cachedProvider && cachedKey === key) return cachedProvider;

  const ProviderClass = providers[key];
  if (!ProviderClass) {
    throw new Error(
      `Unknown EMAIL_PROVIDER "${key}". Supported: ${Object.keys(providers).join(", ")}`,
    );
  }

  cachedKey = key;
  cachedProvider = new ProviderClass();
  return cachedProvider;
}

export function resetEmailProviderCache() {
  cachedProvider = null;
  cachedKey = null;
}
