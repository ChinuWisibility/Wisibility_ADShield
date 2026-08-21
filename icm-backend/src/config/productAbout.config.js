/**
 * Product datasheet values surfaced by GET /api/system/about.
 * Deployment-wide (never per tenant); installer/operator may override via env.
 */
export const PRODUCT_ABOUT_DEFAULTS = {
  name: "Wisibility Identity Sphere",
  company: "Wisibility",
  servicePrefix: "ADSecurity",
  tagline: "Enterprise Identity Visibility, Governance & Security",
  description:
    "Wisibility Identity Sphere provides a unified view of identities, accounts, applications, entitlements, privileged access, identity posture and access risks across the enterprise.",
  edition: "Enterprise",
  version: "1.0.0",
  buildNumber: "2026.08.001",
  releaseDate: "August 2026",
  productType: "Identity Security & Governance Platform",
  deploymentModel: "SaaS / Private Cloud / On-Premises",
  licenseModel: "Subscription / Enterprise License",
};

/** First non-empty value, else null. */
export function firstValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export const PRODUCT_ABOUT_OVERRIDES = {
  get edition() {
    return firstValue(process.env.PRODUCT_EDITION);
  },
  get buildNumber() {
    return firstValue(process.env.PRODUCT_BUILD_NUMBER);
  },
  get releaseDate() {
    return firstValue(process.env.PRODUCT_RELEASE_DATE);
  },
  get deploymentModel() {
    return firstValue(process.env.PRODUCT_DEPLOYMENT_MODEL);
  },
  get licenseModel() {
    return firstValue(process.env.PRODUCT_LICENSE_MODEL);
  },
  get environment() {
    return firstValue(process.env.PRODUCT_ENVIRONMENT);
  },
};
