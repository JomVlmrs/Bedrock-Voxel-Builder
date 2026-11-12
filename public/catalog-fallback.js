(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    rows: $("#blockRows"),
    search: $("#blockSearch"),
    filter: $("#shapeFilter"),
    catalogCount: $("#catalogCount"),
    filteredCount: $("#filteredCount"),
    selectedName: $("#selectedName"),
    selectedShape: $("#selectedShape"),
    selectedLocation: $("#selectedLocation"),
    selectedThumb: $("#selectedThumb"),
    stateControls: $("#stateControls"),
    traitReferenceContent: $("#traitReferenceContent"),
    stateCount: $("#stateCount"),
    stateHint: $("#stateHint"),
    resetStates: $("#resetStates"),
    status: $("#statusText"),
    stateEditor: $("#stateEditor"),
    mobileTabs: [...document.querySelectorAll(".mobile-tab[data-view]")]
  };
  if (!ui.rows || !ui.search || !ui.filter) return;

  let entries = [];
  let stateData = { schemas: {}, exact: {}, rules: [], traits: {}, stateCatalog: [] };
  let selectedId = null;

  function modelType(id) {
    const name = id.toLowerCase();
    if (name === "air" || name.includes("structure_void") || name === "void_air" || name === "cave_air") return "empty";
    if (name === "shelf_mushroom") return "mushroom_shelf";
    if (name.endsWith("_shelf")) return "shelf";
    if (name === "straw_bed") return "straw_bed";
    if (/(^|_)(water|lava)$/.test(name) || name.startsWith("flowing_water") || name.startsWith("flowing_lava")) return "fluid";
    if (/(^|_)sapling$/.test(name) || name === "mangrove_propagule") return "sapling";
    if (/^(?:dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|cactus_flower|torchflower|sunflower|lilac|rose_bush|peony|open_eyeblossom|closed_eyeblossom|wildflowers|pink_petals|short_grass|tall_grass|short_dry_grass|tall_dry_grass|tallgrass|fern|large_fern|deadbush|brown_mushroom|red_mushroom|crimson_roots|warped_roots|nether_sprouts|crimson_fungus|warped_fungus|seagrass|tall_seagrass|kelp|sugar_cane|azalea|flowering_azalea|sweet_berry_bush|wheat|carrots|potatoes|beetroot|beetroots|nether_wart|pitcher_plant|pitcher_crop|torchflower_crop|melon_stem|pumpkin_stem|double_plant|red_flower|yellow_flower)$/.test(name)) return "plant";
    // Keep the original vanilla fallback coverage for non-crop vegetation and fungi.
    if (/(flower|tulip|orchid|allium|poppy|dandelion|cornflower|grass|fern|deadbush|bush|shrub|roots|sprouts|seagrass|kelp|vine|glow_lichen|spore_blossom|hanging_roots|azalea|wither_rose|wheat|carrots|potatoes|beetroots|sweet_berry_bush|crimson_roots|warped_roots|nether_sprouts|mushroom|chorus_flower|chorus_plant|reeds|sugar_cane|cocoa|fire|coral_fan|sea_pickle|dripleaf)/.test(name) || name === "cobweb") return "cross";
    if (/(^|_)(log|stem|hyphae)$/.test(name) || name.endsWith("_log")) return "log";
    if (name.includes("double_slab")) return "cube";
    if (name.includes("slab")) return "slab";
    if (name.includes("stairs")) return "stairs";
    if (name.includes("fence_gate")) return "gate";
    if (name.includes("fence")) return "fence";
    if (name.includes("wall")) return "wall";
    if (name.includes("pane") || name === "iron_bars") return "pane";
    if (name.includes("trapdoor")) return "trapdoor";
    if (name.endsWith("_door") || name === "wooden_door") return "door";
    if (name.includes("carpet") || name === "snow_layer" || name.includes("pressure_plate")) return "flat";
    if (name.includes("button")) return "button";
    if (name.includes("torch") || name.includes("end_rod") || name === "lever") return "torch";
    if (name.includes("rail") || name === "redstone_wire" || name === "tripwire") return "rail";
    if (name.includes("ladder")) return "ladder";
    if (name.includes("standing_sign") || name.includes("wall_sign") || name.includes("hanging_sign") || name === "sign") return "sign";
    if (name.includes("bed")) return "bed";
    if (name.includes("chain")) return "chain";
    if (name.includes("lantern")) return "lantern";
    if (name.includes("cactus")) return "cactus";
    if (name.includes("anvil")) return "anvil";
    if (name.includes("bell")) return "bell";
    if (name.includes("composter")) return "composter";
    if (name.includes("lectern")) return "lectern";
    if (name.includes("grindstone")) return "grindstone";
    if (name.includes("chest") || name.includes("barrel") || name.includes("shulker_box")) return "container";
    if (name.includes("hopper")) return "hopper";
    if (name.includes("head") || name.includes("skull")) return "head";
    if (name.includes("cake")) return "cake";
    if (name.includes("candle")) return "candle";
    if (name.includes("scaffolding")) return "scaffolding";
    if (name.includes("pointed_dripstone")) return "dripstone";
    if (name.includes("amethyst_cluster") || name.includes("amethyst_bud")) return "cluster";
    if (name.includes("turtle_egg") || name.includes("egg")) return "egg";
    if (name.includes("cobweb")) return "cross";
    return "cube";
  }

  function shapeClass(type) {
    if (type === "cube" || type === "log") return "solid";
    if (["slab", "stairs", "fence", "gate", "wall", "pane", "door", "trapdoor", "container", "hopper", "cactus", "anvil", "bell", "composter", "lectern", "grindstone", "head", "cake", "scaffolding", "dripstone", "cluster", "egg", "mushroom_shelf", "shelf", "straw_bed"].includes(type)) return "partial";
    return "non-solid";
  }

  function shapeLabel(type) {
    const labels = {
      cube: "Full cube", log: "Log", empty: "Empty", fluid: "Fluid", cross: "Cross", plant: "Plant", sapling: "Sapling", slab: "Slab",
      stairs: "Stairs", fence: "Fence", gate: "Gate", wall: "Wall", pane: "Pane",
      trapdoor: "Trapdoor", door: "Door", flat: "Flat", button: "Button", torch: "Post",
      rail: "Rail", ladder: "Ladder", sign: "Sign", bed: "Bed", chain: "Chain",
      lantern: "Lantern", cactus: "Cactus", anvil: "Anvil", bell: "Bell", composter: "Composter",
      lectern: "Lectern", grindstone: "Grindstone", container: "Container", hopper: "Hopper",
      head: "Head", cake: "Cake", candle: "Candle", scaffolding: "Scaffold", dripstone: "Dripstone",
      cluster: "Cluster", egg: "Egg", mushroom_shelf: "Mushroom shelf", shelf: "Shelf", straw_bed: "Straw bed"
    };
    return labels[type] || "Full cube";
  }

  function colorFor(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "hsl(" + ((hash >>> 0) % 360) + " 34% 43%)";
  }

  function schemaFor(id) {
    const exact = stateData.exact?.[id];
    if (exact && stateData.schemas?.[exact]) return stateData.schemas[exact];
    for (const rule of stateData.rules || []) {
      if (rule.ids?.includes(id) && stateData.schemas?.[rule.schema]) return stateData.schemas[rule.schema];
      if (rule.pattern) {
        try {
          if (new RegExp(rule.pattern).test(id) && stateData.schemas?.[rule.schema]) return stateData.schemas[rule.schema];
        } catch {}
      }
    }
    return null;
  }

  function setStatus(message) {
    if (ui.status) ui.status.textContent = message;
  }

  function setMobileView(view) {
    const next = ["blocks", "canvas", "export"].includes(view) ? view : "blocks";
    document.body.dataset.mobileView = next;
    for (const tab of ui.mobileTabs) {
      const active = tab.dataset.view === next;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
  }

  ui.mobileTabs.forEach((tab) => tab.addEventListener("click", () => setMobileView(tab.dataset.view)));
  // Keep the searchable block table prominent in desktop and mobile
  // fallback mode too. State controls remain user-expandable on demand.
  if (ui.stateEditor) ui.stateEditor.open = false;

  function renderTraitReference() {
    if (!ui.traitReferenceContent) return;
    ui.traitReferenceContent.replaceChildren();
    const traits = Object.values(stateData.traits || {}).filter((trait) =>
      trait && typeof trait === "object" && Array.isArray(trait.states)
    );
    for (const trait of traits) {
      const item = document.createElement("section");
      item.className = "trait-reference-item";
      const title = document.createElement("strong");
      title.textContent = trait.id || trait.title || "Custom block trait";
      const purpose = document.createElement("p");
      purpose.textContent = trait.purpose || "";
      const enabled = document.createElement("small");
      enabled.textContent = "enabled_states: " + (trait.enabledStates || []).join(", ");
      const values = document.createElement("small");
      values.textContent = trait.states.map((state) =>
        state.key + " · " + state.type + " · " + (state.values || []).map((option) => option.label ?? String(option.value)).join(", ")
      ).join(" | ");
      item.append(title, purpose, enabled, values);
      if (Array.isArray(trait.properties) && trait.properties.length) {
        const properties = document.createElement("small");
        properties.textContent = "Properties: " + trait.properties.join("; ");
        item.append(properties);
      }
      if (trait.requirements) {
        const requirement = document.createElement("small");
        requirement.textContent = "Requirement: " + trait.requirements;
        item.append(requirement);
      }
      if (trait.compatibilityNote) {
        const compatibility = document.createElement("small");
        compatibility.textContent = "Compatibility: " + trait.compatibilityNote;
        item.append(compatibility);
      }
      ui.traitReferenceContent.append(item);
    }
  }

  function renderStateControls(id, values = {}) {
    if (!ui.stateControls || !ui.stateCount || !ui.stateHint) return;
    ui.stateControls.replaceChildren();
    const schema = schemaFor(id);
    if (!schema) {
      ui.stateCount.textContent = "NOT MAPPED YET";
      ui.stateHint.textContent = "The block is valid. Its Microsoft Learn state mapping is not available yet.";
      if (ui.resetStates) ui.resetStates.disabled = true;
      const note = document.createElement("p");
      note.className = "state-empty";
      note.textContent = "This block can still be selected. No unsupported state values are guessed.";
      ui.stateControls.append(note);
      return;
    }

    ui.stateCount.textContent = schema.length + (schema.length === 1 ? " PROPERTY" : " PROPERTIES");
    ui.stateHint.textContent = "Fallback state panel: documented values are available while the 3D renderer is unavailable.";
    if (ui.resetStates) ui.resetStates.disabled = false;
    const fragment = document.createDocumentFragment();
    for (const state of schema) {
      const field = document.createElement("div");
      field.className = "state-field" + (state.deprecated ? " is-deprecated" : "");
      const label = document.createElement("label");
      label.textContent = state.label || state.key;
      const select = document.createElement("select");
      select.dataset.stateKey = state.key;
      select.setAttribute("aria-label", state.label || state.key);
      if (state.locked) {
        select.disabled = true;
        select.title = "This value is managed by block placement.";
      }
      for (const optionData of state.values || []) {
        const option = document.createElement("option");
        option.value = JSON.stringify(optionData.value);
        option.textContent = optionData.label ?? String(optionData.value);
        select.append(option);
      }
      const current = Object.prototype.hasOwnProperty.call(values, state.key) ? values[state.key] : state.default;
      select.value = JSON.stringify(current);
      const meta = document.createElement("small");
      meta.className = "state-meta";
      meta.textContent = state.key + " · " + (state.type || "State") +
        (state.deprecated ? " · DEPRECATED" : "") + (state.locked ? " · PLACEMENT-MANAGED" : "");
      const description = document.createElement("small");
      description.textContent = state.description || state.key;
      field.append(label, select, meta, description);
      fragment.append(field);
    }
    ui.stateControls.append(fragment);
  }

  function selectEntry(id) {
    selectedId = id;
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    ui.rows.querySelectorAll(".catalog-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.id === id));
    if (ui.selectedName) ui.selectedName.textContent = "minecraft:" + id;
    if (ui.selectedShape) ui.selectedShape.textContent = entry.shapeLabel + " · " + (entry.shapeClass === "solid" ? "Solid" : entry.shapeClass === "partial" ? "Partial" : "Non-solid");
    if (ui.selectedLocation) ui.selectedLocation.textContent = "3D block coordinates appear when the interactive renderer is available.";
    if (ui.selectedThumb) {
      ui.selectedThumb.style.backgroundImage = "none";
      ui.selectedThumb.style.backgroundColor = entry.color;
      ui.selectedThumb.classList.remove("has-image");
    }
    renderStateControls(id);
    setStatus("Selected minecraft:" + id + ". The catalogue is available; the 3D editor is still initializing.");
  }

  function renderRows() {
    if (!entries.length || window.__BEDROCK_FALLBACK_DISABLED__) return;
    const query = ui.search.value.trim().toLowerCase();
    const filter = ui.filter.value;
    const filtered = entries.filter((entry) =>
      (!query || entry.id.includes(query) || entry.name.includes(query) || entry.label.toLowerCase().includes(query)) &&
      (filter === "all" || entry.shapeClass === filter)
    );
    const fragment = document.createDocumentFragment();
    if (!filtered.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "no-results";
      cell.textContent = "No blocks match this search.";
      row.append(cell);
      fragment.append(row);
    } else {
      for (const entry of filtered) {
        const row = document.createElement("tr");
        row.className = "catalog-row" + (entry.id === selectedId ? " is-selected" : "");
        row.dataset.id = entry.id;
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", "Select " + entry.name + ", " + entry.shapeLabel);

        const textureCell = document.createElement("td");
        textureCell.className = "texture-cell";
        const texture = document.createElement("span");
        texture.className = "block-texture-fallback";
        texture.textContent = "▧";
        texture.style.background = entry.color;
        textureCell.append(texture);

        const nameCell = document.createElement("td");
        nameCell.className = "block-id";
        nameCell.textContent = entry.name;
        nameCell.title = entry.name;

        const shapeCell = document.createElement("td");
        const shape = document.createElement("span");
        shape.className = "shape-tag " + (entry.shapeClass === "solid" ? "" : entry.shapeClass);
        shape.textContent = entry.shapeLabel;
        shapeCell.append(shape);

        const countCell = document.createElement("td");
        countCell.className = "used-count";
        countCell.dataset.id = entry.id;
        countCell.textContent = "0";

        row.append(textureCell, nameCell, shapeCell, countCell);
        fragment.append(row);
      }
    }
    ui.rows.replaceChildren(fragment);
    if (ui.filteredCount) ui.filteredCount.textContent = filtered.length.toLocaleString() + " of " + entries.length.toLocaleString() + " blocks";
  }

  ui.search.addEventListener("input", renderRows);
  ui.filter.addEventListener("change", renderRows);
  ui.rows.addEventListener("click", (event) => {
    const row = event.target.closest(".catalog-row");
    if (row && !window.__BEDROCK_FALLBACK_DISABLED__) selectEntry(row.dataset.id);
  });
  ui.rows.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".catalog-row");
    if (!row || window.__BEDROCK_FALLBACK_DISABLED__) return;
    event.preventDefault();
    selectEntry(row.dataset.id);
  });
  if (ui.resetStates) {
    ui.resetStates.addEventListener("click", () => {
      if (selectedId) {
        renderStateControls(selectedId);
        setStatus("Initial editor state selections restored for minecraft:" + selectedId + ".");
      }
    });
  }
  if (ui.stateControls) {
    ui.stateControls.addEventListener("change", (event) => {
      if (!event.target.matches("select[data-state-key]") || window.__BEDROCK_FALLBACK_DISABLED__) return;
      const count = ui.stateControls.querySelectorAll("select[data-state-key]").length;
      setStatus("Updated " + count + " visible Bedrock state values for the selected block.");
    });
  }

  async function startFallback() {
    try {
      const [blocksResponse, statesResponse] = await Promise.all([
        fetch("./data/vanilla-blocks.json"),
        fetch("./data/block-states.json").catch(() => null)
      ]);
      if (!blocksResponse.ok) throw new Error("HTTP " + blocksResponse.status);
      const raw = await blocksResponse.json();
      if (!raw || typeof raw !== "object" || !Object.keys(raw).length) throw new Error("The block list is empty.");
      if (statesResponse?.ok) {
        try {
          const loaded = await statesResponse.json();
          stateData = {
            schemas: loaded.schemas || {},
            exact: loaded.exact || {},
            rules: Array.isArray(loaded.rules) ? loaded.rules : [],
            traits: loaded.traits || {},
            stateCatalog: Array.isArray(loaded.stateCatalog) ? loaded.stateCatalog : []
          };
          renderTraitReference();
        } catch {}
      }
      entries = Object.keys(raw).sort().map((id) => {
        const model = modelType(id);
        return {
          id,
          name: "minecraft:" + id,
          label: id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          model,
          shapeClass: shapeClass(model),
          shapeLabel: shapeLabel(model),
          color: colorFor(id)
        };
      });

      // Do not overwrite the full editor if its module finished first.
      if (window.__BEDROCK_FALLBACK_DISABLED__ || ui.rows.querySelector(".catalog-row")) return;
      if (ui.catalogCount) ui.catalogCount.textContent = entries.length.toLocaleString() + " BLOCKS";
      renderRows();
      selectEntry(entries.find((entry) => entry.id === "stone")?.id || entries[0].id);
      setStatus("Loaded " + entries.length.toLocaleString() + " block identifiers. 3D preview is starting.");
    } catch (error) {
      if (!ui.rows.querySelector(".catalog-row")) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.className = "no-results";
        cell.textContent = "Block catalogue unavailable: " + (error.message || "Unknown error.");
        row.append(cell);
        ui.rows.replaceChildren(row);
      }
      setStatus("Could not load the block catalogue: " + (error.message || "Unknown error."));
    }
  }

  startFallback();
})();