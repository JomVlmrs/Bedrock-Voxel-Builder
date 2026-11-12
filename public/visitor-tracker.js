(() => {
  const activeNode = document.getElementById("activeVisitors");
  const totalNode = document.getElementById("totalVisits");
  const statusNode = document.getElementById("visitorTrackerStatus");
  const trackerNode = document.getElementById("visitorTracker");
  if (!activeNode || !totalNode || !statusNode || !trackerNode) return;

  const API_URL = location.hostname.endsWith(".github.io")
    ? "https://bedrock-structure-lznl.hatchable.site/api/visitors"
    : new URL("/api/visitors", location.origin).href;
  const SESSION_KEY = "bedrockVoxelVisitorSession";
  const HEARTBEAT_MS = 25000;
  let heartbeatTimer = null;

  function createSessionId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return [
      hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
      hex.slice(16, 20), hex.slice(20)
    ].join("-");
  }

  function getSessionId() {
    try {
      let value = sessionStorage.getItem(SESSION_KEY);
      if (!/^[0-9a-f-]{36}$/i.test(value || "")) {
        value = createSessionId();
        sessionStorage.setItem(SESSION_KEY, value);
      }
      return value;
    } catch {
      return createSessionId();
    }
  }

  const sessionId = getSessionId();

  function setConnection(isOnline) {
    const needsPublicHosting = location.hostname.endsWith(".github.io");
    trackerNode.classList.toggle("is-offline", !isOnline);
    statusNode.textContent = isOnline ? "LIVE" : needsPublicHosting ? "PUBLISH APP" : "UNAVAILABLE";
    statusNode.title = isOnline
      ? "Visitor statistics are updating."
      : needsPublicHosting
        ? "Set the Hatchable project visibility to Public in Settings so the public GitHub Pages website can reach the visitor tracker."
        : "The live statistics service could not be reached.";
  }

  function renderStats(data) {
    const active = Number(data.activeVisitors);
    const total = Number(data.totalVisits);
    activeNode.textContent = Number.isFinite(active) ? active.toLocaleString() : "—";
    totalNode.textContent = Number.isFinite(total) ? total.toLocaleString() : "—";
    setConnection(true);
  }

  async function update(action) {
    const response = await fetch(API_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action, sessionId }),
      keepalive: action === "visit"
    });
    if (!response.ok) throw new Error("Tracker request failed (" + response.status + ").");
    const data = await response.json();
    if (!Number.isFinite(Number(data.activeVisitors)) || !Number.isFinite(Number(data.totalVisits))) {
      throw new Error("The tracker returned invalid statistics.");
    }
    renderStats(data);
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        update("heartbeat").catch(() => setConnection(false));
      }
    }, HEARTBEAT_MS);
  }

  update("visit")
    .then(startHeartbeat)
    .catch(() => setConnection(false));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      update("heartbeat").catch(() => setConnection(false));
      startHeartbeat();
    }
  });
})();