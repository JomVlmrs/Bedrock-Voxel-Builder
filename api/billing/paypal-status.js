import { getPayPalSettings, getPayPalAccessToken } from "lib/paypal.js";

export const access = "admin";
export const methods = ["GET"];

// Owner-only diagnostic. It requests an OAuth token but never creates or captures an order.
export default async function (req, res) {
  const settings = await getPayPalSettings();
  if (!settings) {
    return res.json({
      configured: false,
      authenticated: false,
      error_code: "MISSING_CREDENTIALS",
      next_step: "Add the PayPal Client ID and Secret in Hatchable project Setup."
    });
  }

  const environments = ["sandbox", "live"];
  const checks = [];
  for (const environment of environments) {
    const candidate = {
      ...settings,
      environment,
      baseUrl: environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    };
    try {
      await getPayPalAccessToken(candidate);
      checks.push({ environment, authenticated: true, http_status: 200 });
    } catch (error) {
      checks.push({
        environment,
        authenticated: false,
        error_code: error.code || "PAYPAL_AUTH_FAILED",
        http_status: error.httpStatus || null,
        debug_id: error.debugId || null
      });
    }
  }

  const matched = checks.filter((item) => item.authenticated).map((item) => item.environment);
  const selectedWorks = matched.includes(settings.environment);
  return res.json({
    configured: true,
    selected_environment: settings.environment,
    authenticated: selectedWorks,
    credential_environment_match: matched.length === 1 ? matched[0] : (matched.length > 1 ? "both" : null),
    environment_checks: checks,
    next_step: selectedWorks
      ? "The selected environment accepts the saved credentials. No order or payment was created."
      : matched.length === 1
        ? "The saved credentials authenticate only in " + (matched[0] === "live" ? "Live" : "Sandbox") + ". Change the PayPal environment in Hatchable Setup to match; checkout will continue using the selected mode."
        : "Neither environment accepted the saved credentials. Copy the Client ID and Secret from the same REST app and the same environment tab in PayPal Developer Dashboard, then save both again."
  });
}
