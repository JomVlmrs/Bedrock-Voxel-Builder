(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const dialog = $("#structureLibraryDialog");
  const accountButton = $("#accountButton");
  const structuresButton = $("#structuresButton");
  const saveForm = $("#saveStructureForm");
  const nameInput = $("#structureSaveName");
  const saveButton = $("#saveStructureButton");
  const list = $("#savedStructuresList");
  const status = $("#structureLibraryStatus");
  const accountLabel = $("#structureLibraryAccount");
  const closeButton = $("#closeStructureLibrary");

  let signedIn = false;
  let displayName = "";
  let loading = false;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(error));
  }

  function login() {
    const next = location.pathname + location.search + location.hash;
    location.assign("/login?next=" + encodeURIComponent(next || "/"));
  }

  async function requestJSON(url, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { ...options, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Request failed (" + response.status + ").");
    return result;
  }

  async function syncAccount() {
    const auth = window.hatchable && window.hatchable.auth;
    if (!auth) {
      accountButton.textContent = "SIGN IN";
      accountButton.title = "Sign in to save structures to your account";
      return;
    }

    let session;
    try {
      session = await auth.getSession();
    } catch {
      accountButton.textContent = "SIGN IN";
      return;
    }

    if (!session || !session.user) {
      signedIn = false;
      displayName = "";
      accountButton.textContent = "SIGN IN";
      accountButton.title = "Sign in to save structures to your account";
      return;
    }

    try {
      const result = await requestJSON("/api/account/profile");
      if (!result.profile || !result.profile.display_name) {
        login();
        return;
      }
      signedIn = true;
      displayName = result.profile.display_name;
      accountButton.textContent = displayName;
      accountButton.title = "Signed in as " + displayName + ". Click to sign out.";
      accountLabel.textContent = "Signed in as " + displayName + " · Your structures are private to this account";
    } catch (error) {
      if (/401|sign in|unauthorized/i.test(error.message)) login();
      else {
        accountButton.textContent = "ACCOUNT";
        accountButton.title = error.message;
      }
    }
  }

  function renderStructures(items) {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "saved-structures-empty";
      empty.textContent = "No saved structures yet. Build something, give it a name, then save it here.";
      list.append(empty);
      return;
    }

    for (const structure of items) {
      const row = document.createElement("article");
      row.className = "saved-structure-card";

      const info = document.createElement("div");
      info.className = "saved-structure-info";
      const title = document.createElement("strong");
      title.textContent = structure.name;
      const meta = document.createElement("small");
      const dimensions = [structure.size_x, structure.size_y, structure.size_z].join(" × ");
      const changed = structure.updated_at ? new Date(structure.updated_at) : null;
      const when = changed && !Number.isNaN(changed.getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(changed)
        : "Saved";
      meta.textContent = dimensions + " · " + Number(structure.block_count || 0).toLocaleString() + " blocks · " + when;
      info.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "saved-structure-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "saved-structure-open";
      open.textContent = "OPEN";
      open.addEventListener("click", () => loadStructure(structure.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "saved-structure-delete";
      remove.textContent = "DELETE";
      remove.addEventListener("click", () => deleteStructure(structure.id, structure.name));
      actions.append(open, remove);
      row.append(info, actions);
      list.append(row);
    }
  }

  async function refreshStructures() {
    if (loading) return;
    loading = true;
    setStatus("Loading your saved structures…");
    try {
      const result = await requestJSON("/api/structures");
      renderStructures(Array.isArray(result.structures) ? result.structures : []);
      setStatus((result.structures || []).length + " saved structure(s) in your account.");
    } catch (error) {
      setStatus(error.message || "Could not load your saved structures.", true);
    } finally {
      loading = false;
    }
  }

  async function loadStructure(id) {
    try {
      setStatus("Loading structure…");
      const result = await requestJSON("/api/structures?id=" + encodeURIComponent(id));
      const saved = result.structure;
      if (!saved) throw new Error("Saved structure not found.");
      if (!window.BedrockBuilder || !window.BedrockBuilder.ready) {
        await new Promise((resolve) => window.addEventListener("bv:builder-ready", resolve, { once: true }));
      }
      const current = window.BedrockBuilder.getSaveData();
      if (current.blocks.length && !window.confirm("Opening this structure will replace the current unsaved build. Continue?")) {
        setStatus("Opening cancelled. Your current build is unchanged.");
        return;
      }
      const loaded = window.BedrockBuilder.loadSaveData({
        size: { x: saved.size_x, y: saved.size_y, z: saved.size_z },
        coordinateMode: saved.coordinate_mode,
        origin: [saved.origin_x, saved.origin_y, saved.origin_z],
        blocks: saved.blocks
      });
      if (!loaded.ok) throw new Error(loaded.error || "The saved structure could not be opened.");
      dialog.close();
      setStatus("Opened " + saved.name + " with " + loaded.added.toLocaleString() + " blocks.");
    } catch (error) {
      setStatus(error.message || "Could not open this structure.", true);
    }
  }

  async function deleteStructure(id, name) {
    if (!window.confirm("Delete the saved structure “" + name + "”? This cannot be undone.")) return;
    try {
      await requestJSON("/api/structures", {
        method: "DELETE",
        body: JSON.stringify({ id })
      });
      setStatus("Deleted " + name + ".");
      await refreshStructures();
    } catch (error) {
      setStatus(error.message || "Could not delete this structure.", true);
    }
  }

  saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!signedIn) {
      login();
      return;
    }
    const name = nameInput.value.trim().replace(/\s+/g, " ");
    if (!name || name.length > 80) {
      setStatus("Enter a structure name (80 characters maximum).", true);
      nameInput.focus();
      return;
    }
    if (!window.BedrockBuilder || !window.BedrockBuilder.ready) {
      setStatus("The builder is still loading. Try again in a moment.", true);
      return;
    }
    const data = window.BedrockBuilder.getSaveData();
    if (!data.blocks.length) {
      setStatus("Place at least one block before saving a structure.", true);
      return;
    }

    saveButton.disabled = true;
    setStatus("Saving your structure to your account…");
    try {
      const result = await requestJSON("/api/structures", {
        method: "POST",
        body: JSON.stringify({ name, ...data })
      });
      nameInput.value = "";
      await refreshStructures();
      setStatus("Saved " + result.structure.name + " to your account.");
    } catch (error) {
      setStatus(error.message || "Could not save this structure.", true);
    } finally {
      saveButton.disabled = false;
    }
  });

  structuresButton.addEventListener("click", async () => {
    if (!signedIn) {
      login();
      return;
    }
    if (!dialog.open) dialog.showModal();
    await refreshStructures();
  });

  accountButton.addEventListener("click", async () => {
    if (!signedIn) {
      login();
      return;
    }
    const auth = window.hatchable && window.hatchable.auth;
    if (!auth) return;
    if (!window.confirm("Sign out of " + displayName + "?")) return;
    try {
      await auth.signOut();
      signedIn = false;
      displayName = "";
      accountButton.textContent = "SIGN IN";
      accountButton.title = "Sign in to save structures to your account";
      accountLabel.textContent = "Sign in to access your private structure library";
      setStatus("You have signed out.");
    } catch (error) {
      setStatus(error.message || "Could not sign out.", true);
    }
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  syncAccount();
})();