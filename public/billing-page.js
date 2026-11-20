(() => {
  const page = document.body.dataset.billingPage;
  const json = async (response) => response.json().catch(() => ({}));

  async function requireSession(nextPath) {
    const auth = window.hatchable && window.hatchable.auth;
    if (!auth) throw new Error("Account sign-in is unavailable. Refresh the page and try again.");
    const session = await auth.getSession();
    if (!session || !session.user) {
      location.replace("/login?next=" + encodeURIComponent(nextPath));
      return null;
    }
    return session.user;
  }

  async function initUpgrade() {
    const accountStatus = document.getElementById("accountStatus");
    const paypalStatus = document.getElementById("paypalStatus");
    const loginPrompt = document.getElementById("loginPrompt");
    const pageError = document.getElementById("pageError");
    const buttons = [...document.querySelectorAll("[data-tier]")];

    if (new URLSearchParams(location.search).get("cancelled") === "1") {
      document.getElementById("cancelNotice").hidden = false;
    }

    let user = null;
    try {
      user = await requireSession("/upgrade.html");
    } catch (error) {
      pageError.textContent = error.message || "Could not check your account.";
      return;
    }
    if (!user) {
      accountStatus.textContent = "Sign in with your email to connect purchases to your builder account.";
      loginPrompt.hidden = false;
      buttons.forEach((button) => { button.disabled = true; button.textContent = "Sign in first"; });
      paypalStatus.textContent = "Your purchases are saved to your signed-in account.";
      return;
    }

    accountStatus.textContent = "Signed in as " + (user.email || "your account") + ". Checking your current tier…";

    try {
      const response = await fetch("/api/billing/me", { cache: "no-store", credentials: "same-origin" });
      const data = await json(response);
      if (!response.ok) throw new Error(data.error || "Could not load your plan.");
      const current = data.tier || { id: "free", name: "Starter", rank: 0 };
      accountStatus.textContent = "Signed in as " + (data.email || user.email || "your account") + " · Current tier: " + current.name + ".";
      if (data.paypal_configured) {
        paypalStatus.textContent = data.paypal_environment === "live"
          ? "PayPal Live is connected. Payments will be real transactions."
          : "PayPal Sandbox is connected. Use sandbox buyer accounts for test payments; no live payment is taken.";
      } else {
        paypalStatus.textContent = "PayPal is not connected yet. The site owner must add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Hatchable project Setup.";
      }

      const ranks = { builder_plus: 1, pro: 2, studio: 3 };
      buttons.forEach((button) => {
        const rank = ranks[button.dataset.tier] || 99;
        if (rank <= current.rank) {
          button.disabled = true;
          button.textContent = button.dataset.tier === current.id ? "Your current tier" : "Already included";
        } else {
          button.disabled = !data.paypal_configured;
          button.textContent = "Buy " + (button.dataset.tier === "builder_plus" ? "Builder+" : button.dataset.tier.charAt(0).toUpperCase() + button.dataset.tier.slice(1));
        }
      });
    } catch (error) {
      pageError.textContent = error.message || "Could not load billing information.";
      buttons.forEach((button) => { button.disabled = true; });
      return;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const original = button.textContent;
        button.disabled = true;
        button.textContent = "Opening PayPal…";
        pageError.textContent = "";
        try {
          const response = await fetch("/api/billing/create-order", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier: button.dataset.tier })
          });
          const data = await json(response);
          if (!response.ok || !data.approval_url) throw new Error(data.error || "Could not start PayPal checkout.");
          location.assign(data.approval_url);
        } catch (error) {
          pageError.textContent = error.message || "Could not start checkout.";
          button.disabled = false;
          button.textContent = original;
        }
      });
    });
  }

  async function initReturn() {
    const title = document.getElementById("returnTitle");
    const message = document.getElementById("returnMessage");
    const details = document.getElementById("returnDetails");
    const retry = document.getElementById("retryCapture");
    const home = document.getElementById("returnHome");
    const plans = document.getElementById("returnPlans");
    const token = new URLSearchParams(location.search).get("token");

    const showRetry = (text) => {
      title.textContent = "Payment not confirmed yet";
      message.textContent = text;
      details.textContent = "No new tier has been granted. You can retry the verification.";
      retry.hidden = false;
      plans.hidden = false;
    };

    if (!token) {
      title.textContent = "No PayPal order found";
      message.textContent = "This page needs the order token returned by PayPal.";
      details.textContent = "Return to the plans page to start a new checkout.";
      plans.hidden = false;
      return;
    }

    try {
      const user = await requireSession("/billing-return.html?token=" + encodeURIComponent(token));
      if (!user) return;
    } catch (error) {
      showRetry(error.message || "Sign-in could not be checked.");
      return;
    }

    async function capture() {
      retry.hidden = true;
      title.textContent = "Confirming your payment…";
      message.textContent = "Checking the completed PayPal capture against your account and selected tier.";
      details.textContent = "Verifying…";
      try {
        const response = await fetch("/api/billing/capture-order", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paypal_order_id: token })
        });
        const data = await json(response);
        if (response.status === 202 || data.pending) {
          showRetry(data.message || "PayPal has not finished confirming the capture.");
          return;
        }
        if (!response.ok || !data.ok) {
          showRetry(data.error || "PayPal could not confirm the payment.");
          return;
        }
        title.textContent = "Your " + data.tier_name + " tier is unlocked";
        message.textContent = "Payment verified. Your new workspace limits are now attached to this account.";
        details.textContent = "Lifetime access is active. Return to the builder and refresh the page to apply the new limits.";
        home.hidden = false;
        plans.hidden = true;
      } catch (error) {
        showRetry(error.message || "A network error interrupted verification.");
      }
    }

    retry.addEventListener("click", capture);
    await capture();
  }

  if (page === "upgrade") initUpgrade();
  if (page === "return") initReturn();
})();