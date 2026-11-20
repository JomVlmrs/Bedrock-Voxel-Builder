import { auth, db } from "hatchable";
import { getTier, publicTier } from "lib/billing.js";
import { getPayPalSettings } from "lib/paypal.js";

export const access = "user";
export const methods = ["GET"];

export default async function (req, res) {
  const user = req.user || await auth.getUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view your plan." });
  const result = await db.query(
    "SELECT tier, status FROM user_entitlements WHERE user_id = $1",
    [user.id]
  );

  let tier = getTier("free");
  const row = result.rows[0];
  if (row && row.status === "active") tier = getTier(row.tier);

  let paypalSettings = null;
  try {
    paypalSettings = await getPayPalSettings();
  } catch {
    paypalSettings = null;
  }

  return res.json({
    signed_in: true,
    email: user.email || null,
    tier: publicTier(tier),
    paypal_configured: Boolean(paypalSettings),
    paypal_environment: paypalSettings?.environment || "sandbox"
  });
}