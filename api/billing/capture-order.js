import { db } from "hatchable";
import { getTier } from "lib/billing.js";
import { getPayPalSettings, getPayPalAccessToken, paypalRequest } from "lib/paypal.js";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const orderId = String(req.body?.paypal_order_id || "").trim();
  if (!/^[A-Z0-9]{8,36}$/.test(orderId)) {
    return res.status(400).json({ error: "A valid PayPal order ID is required." });
  }

  const localResult = await db.query(
    "SELECT id, tier, amount::text AS amount, paypal_order_id, status, capture_id FROM billing_orders WHERE paypal_order_id = $1 AND user_id = $2 LIMIT 1",
    [orderId, req.user.id]
  );
  const local = localResult.rows[0];
  if (!local) return res.status(404).json({ error: "This checkout does not belong to your account." });

  const tier = getTier(local.tier);
  if (local.status === "COMPLETED") {
    return res.json({ ok: true, completed: true, tier: tier.id, tier_name: tier.name });
  }

  const settings = await getPayPalSettings();
  if (!settings) return res.status(503).json({ error: "PayPal is not connected." });

  try {
    const accessToken = await getPayPalAccessToken(settings);
    let providerOrder = await paypalRequest(
      settings, accessToken, "/v2/checkout/orders/" + encodeURIComponent(orderId), "GET"
    );

    if (providerOrder.status === "APPROVED") {
      providerOrder = await paypalRequest(
        settings, accessToken, "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", "POST", {}
      );
    }

    if (providerOrder.status !== "COMPLETED") {
      return res.status(202).json({
        ok: false,
        pending: true,
        message: "PayPal has not confirmed a completed capture yet. You can retry this page."
      });
    }

    const unit = (providerOrder.purchase_units || []).find((item) =>
      item.reference_id === tier.id && item.custom_id === req.user.id
    );
    const captures = unit?.payments?.captures || [];
    const capture = captures.find((item) => item.status === "COMPLETED");
    const amount = capture?.amount;

    if (!unit || !capture || amount?.currency_code !== "PHP" ||
        Number(amount.value).toFixed(2) !== Number(local.amount).toFixed(2) ||
        Number(local.amount).toFixed(2) !== tier.price.toFixed(2)) {
      return res.status(402).json({
        error: "The PayPal payment could not be verified against this account and tier. No access was granted."
      });
    }

    await db.query(
      "UPDATE billing_orders SET status = 'COMPLETED', capture_id = $1, captured_at = now() WHERE id = $2",
      [capture.id, local.id]
    );

    await db.query(
      "INSERT INTO user_entitlements (user_id, tier, tier_rank, status, order_id, purchased_at) VALUES ($1, $2, $3, 'active', $4, now()) ON CONFLICT (user_id) DO UPDATE SET tier = CASE WHEN EXCLUDED.tier_rank > user_entitlements.tier_rank THEN EXCLUDED.tier ELSE user_entitlements.tier END, tier_rank = GREATEST(user_entitlements.tier_rank, EXCLUDED.tier_rank), status = 'active', order_id = CASE WHEN EXCLUDED.tier_rank > user_entitlements.tier_rank THEN EXCLUDED.order_id ELSE user_entitlements.order_id END, purchased_at = CASE WHEN EXCLUDED.tier_rank > user_entitlements.tier_rank THEN EXCLUDED.purchased_at ELSE user_entitlements.purchased_at END, updated_at = now()",
      [req.user.id, tier.id, tier.rank, local.id]
    );

    return res.json({
      ok: true,
      completed: true,
      tier: tier.id,
      tier_name: tier.name,
      capture_id: capture.id
    });
  } catch (error) {
    console.error("PayPal capture verification failed:", error.message);
    return res.status(502).json({
      error: "PayPal could not confirm this payment right now. No new tier was granted; retry the confirmation."
    });
  }
}