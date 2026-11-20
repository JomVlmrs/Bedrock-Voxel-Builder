import { config } from "hatchable";

async function optionalConfig(name, fallback = null) {
  try {
    const value = await config.get(name);
    return value == null || value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

export async function getPayPalSettings() {
  const [clientId, clientSecret, rawEnvironment] = await Promise.all([
    optionalConfig("PAYPAL_CLIENT_ID"),
    optionalConfig("PAYPAL_CLIENT_SECRET"),
    optionalConfig("paypal_environment", "sandbox")
  ]);
  if (!clientId || !clientSecret) return null;

  const environment = rawEnvironment === "live" ? "live" : "sandbox";
  return {
    clientId: String(clientId).trim(),
    clientSecret: String(clientSecret).trim(),
    environment,
    baseUrl: environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com"
  };
}

export async function getPayPalAccessToken(settings) {
  const authorization = btoa(settings.clientId + ":" + settings.clientSecret);
  const response = await fetch(settings.baseUrl + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + authorization,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error("PayPal authentication failed. Check the app credentials and environment.");
  }
  return data.access_token;
}

export async function paypalRequest(settings, accessToken, path, method = "GET", body = undefined) {
  const headers = {
    "Authorization": "Bearer " + accessToken,
    "Accept": "application/json"
  };
  const options = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Prefer"] = "return=representation";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(settings.baseUrl + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = data?.details?.[0]?.description || data?.message || "PayPal request failed.";
    throw new Error(String(issue).slice(0, 240));
  }
  return data;
}