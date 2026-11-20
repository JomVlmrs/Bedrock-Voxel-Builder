const FREE_LIMITS = {
  maxDimension: 32,
  maxVolume: 32768,
  maxSavedBlocks: 12
};

export async function loadBuilderEntitlements() {
  const badge = document.getElementById("planBadge");
  try {
    const response = await fetch("/api/billing/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.tier) throw new Error("Plan details are unavailable.");

    const tier = data.tier;
    const limits = {
      maxDimension: Number(tier.maxDimension) || FREE_LIMITS.maxDimension,
      maxVolume: Number(tier.maxVolume) || FREE_LIMITS.maxVolume,
      maxSavedBlocks: Number(tier.maxSavedBlocks) || FREE_LIMITS.maxSavedBlocks
    };
    if (badge) {
      badge.textContent = tier.name.toUpperCase() + " · " + (tier.rank > 0 ? "LIFETIME" : "UPGRADE");
      badge.title = tier.name + " tier · " + limits.maxDimension + " blocks per axis · " + limits.maxVolume.toLocaleString() + " cells";
      badge.classList.toggle("is-paid", tier.rank > 0);
    }
    window.BedrockBilling = { tier, limits, signedIn: Boolean(data.signed_in) };
    return { tier, limits, signedIn: Boolean(data.signed_in) };
  } catch {
    if (badge) {
      badge.textContent = "FREE · UPGRADE";
      badge.title = "Free tier · " + FREE_LIMITS.maxDimension + " blocks per axis";
      badge.classList.remove("is-paid");
    }
    const fallback = { tier: { id: "free", name: "Starter", rank: 0 }, limits: FREE_LIMITS, signedIn: false };
    window.BedrockBilling = fallback;
    return fallback;
  }
}

export function promptForUpgrade(message) {
  const text = message || "This action needs a higher workspace tier.";
  if (window.confirm(text + "\n\nView the available one-time lifetime upgrades?")) {
    window.location.assign("/upgrade.html");
  }
}