import { db } from "hatchable";
import { getTier } from "lib/billing.js";
import { getPayPalSettings, getPayPalAccessToken, paypalRequest } from "lib/paypal.js";

export const access = "user";
export const methods = ["POST"];

const RETURN_URL = "https://bedrock-structure-lznl.hatchable.site/billing-return.html";
const CANCEL_URL = "https://bedrock-structure-lznl.hatchable.site/upgrade.html?cancelled=1";

export default async function (req, res) {
  const tierId = req.body?.tier;
  const tier = getTier(tierId);
  if (!tierId || tier.id !== tierId || tier.id === "free") {
    return res.status(400).json({ error: "Choose a valid paid tier." });
  }

  const existing = await db.query(
    "SELECT tier, status FROM user_entitlements WHERE user_id = $1",
    [req.user.id]
  );
  const current = existing.rows[0];
  const currentTier = current?.status === "active" ? getTier(current.tier) : getTier("free");
  if (tier.rank <= currentTier.rank) {
    return res.status(409).json({ error: "Your account already has this tier or a higher one." });
  }

  const settings = await getPayPalSettings();
  if (!settings) {
    return res.status(503).json({
      error: "PayPal is not connected yet. The site owner must add the PayPal Client ID and Secret in Hatchable project Setup."
    });
  }

  const local = await db.query(
    "INSERT INTO billing_orders (user_id, tier, amount, currency, status) VALUES ($1, $2, $3, 'PHP', 'CREATING') RETURNING id",
    [req.user.id, tier.id, tier.price]
  );
  const localOrderId = local.rows[0].id;

  try {
    const accessToken = await getPayPalAccessToken(settings);
    const order = await paypalRequest(settings, accessToken, "/v2/checkout/orders", "POST", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: tier.id,
        custom_id: req.user.id,
        description: "Bedrock Voxel Builder " + tier.name + " lifetime access",
        amount: {
          currency_code: "PHP",
          value: tier.price.toFixed(2)
        }
      }],
      application_context: {
        brand_name: "Bedrock Voxel Builder",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: RETURN_URL,
        cancel_url: CANCEL_URL
      }
    });

    const approval = (order.links || []).find((link) =>
      link.rel === "approve" || link.rel === "payer-action"
    );
    if (!order.id || !approval?.href) throw new Error("PayPal did not return an approval link.");

    await db.query(
      "UPDATE billing_orders SET paypal_order_id = $1, status = 'CREATED' WHERE id = $2",
      [order.id, localOrderId]
    );

    return res.status(201).json({
      paypal_order_id: order.id,
      approval_url: approval.href,
      tier: tier.id
    });
  } catch (error) {
    await db.query(
      "UPDATE billing_orders SET status = 'FAILED' WHERE id = $1",
      [localOrderId]
    );
    console.error("PayPal order creation failed:", error.message);
    return res.status(502).json({
      error: "PayPal could not create the checkout. Check your PayPal app credentials and try again."
    });
  }
}