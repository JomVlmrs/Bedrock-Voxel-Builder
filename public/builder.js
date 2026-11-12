import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { createVoxelBoxGeometry, createBedrockGeometryModel } from "./bedrock-models.js";

const $ = (selector) => document.querySelector(selector);
const RAW_ASSET_BASE = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/";
const MAX_STRUCTURE_VOLUME = 1_000_000;
const MAX_PLACED_BLOCKS = 20_000;
const BLOCK_PIXELS = 16;
const DEFAULT_BLOCK_VERSION = 18168865;
const SAVED_BLOCKS_STORAGE_KEY = "bedrock-voxel-builder-saved-palette-v1";

const ui = {
  sizeX: $("#sizeX"), sizeY: $("#sizeY"), sizeZ: $("#sizeZ"),
  sampleVersion: $("#sampleVersion"), catalogCount: $("#catalogCount"),
  blockSearch: $("#blockSearch"), shapeFilter: $("#shapeFilter"),
  selectedThumb: $("#selectedThumb"), selectedName: $("#selectedName"),
  selectedShape: $("#selectedShape"), selectedLocation: $("#selectedLocation"),
  stateEditor: $("#stateEditor"), mobileTabs: [...document.querySelectorAll(".mobile-tab[data-view]")],
  stateControls: $("#stateControls"), traitReferenceContent: $("#traitReferenceContent"),
  stateCount: $("#stateCount"), stateHint: $("#stateHint"),
  resetStates: $("#resetStates"), canvasMode: $("#canvasMode"), blockRows: $("#blockRows"),
  filteredCount: $("#filteredCount"), viewport: $("#viewport"),
  emptyState: $("#emptyState"), placedCount: $("#placedCount"),
  canvasDimensions: $("#canvasDimensions"), resetView: $("#resetView"),
  saveSelectedBlock: $("#saveSelectedBlock"), savedBlockList: $("#savedBlockList"),
  clearBuild: $("#clearBuild"), includeAir: $("#includeAir"), useFill: $("#useFill"),
  coordinateMode: $("#coordinateMode"), originX: $("#originX"),
  originY: $("#originY"), originZ: $("#originZ"),
  downloadFunction: $("#downloadFunction"), downloadStructure: $("#downloadStructure"),
  importStructure: $("#importStructure"), importStructureCatalog: $("#importStructureCatalog"),
  structureFile: $("#structureFile"), structureVoidLegend: $("#structureVoidLegend"),
  statusText: $("#statusText"), summaryText: $("#summaryText")
};

let rawBlockDefinitions = {};
let terrainTextureData = {};
let modelGeometryFiles = {};
let customBlockDefinitions = new Map();
let blockStateData = { schemas: {}, exact: {}, rules: [], traits: {}, stateCatalog: [] };
let catalog = [];
let selectedBlock = null;
let appliedStateOverrides = {};
let activePlacedBlockKey = null;
let highlightedPlacedKey = null;
let canvasMode = "build";
let placedBlocks = new Map();
let savedBlockPalette = loadSavedBlockPalette();
let currentSize = { x: 16, y: 16, z: 16 };

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let worldGroup = null;
let groundPlane = null;
let gridHelper = null;
let boundsLines = null;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let pointerStart = null;
let blockHitTargets = [];
let resizeObserver = null;
let nbtLibraryPromise = null;

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const tgaLoader = new TGALoader();
tgaLoader.setCrossOrigin("anonymous");
const textureCache = new Map();
const materialCache = new Map();
const customMaterialCache = new Map();
const geometryCache = new Map();
const hitMaterial = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, colorWrite: false,
  depthWrite: false, side: THREE.DoubleSide
});

function setStatus(message, kind = "normal") {
  ui.statusText.textContent = message;
  ui.statusText.classList.toggle("is-error", kind === "error");
  ui.statusText.classList.toggle("is-success", kind === "success");
}
function setSummary(message) { ui.summaryText.textContent = message; }
function currentSizeFromInputs() {
  return {
    x: Number.parseInt(ui.sizeX.value, 10),
    y: Number.parseInt(ui.sizeY.value, 10),
    z: Number.parseInt(ui.sizeZ.value, 10)
  };
}
function cellKey(x, y, z) { return `${x},${y},${z}`; }
function loadSavedBlockPalette() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_BLOCKS_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.map((item) => typeof item === "string"
      ? { id: item, states: {} }
      : item && typeof item.id === "string"
        ? { id: item.id, states: item.states && typeof item.states === "object" ? { ...item.states } : {} }
        : null
    ).filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 24);
  } catch {
    return [];
  }
}
function persistSavedBlockPalette() {
  try {
    localStorage.setItem(SAVED_BLOCKS_STORAGE_KEY, JSON.stringify(savedBlockPalette));
    return true;
  } catch {
    setStatus("The browser could not save the block palette locally. Check site storage permissions.", "error");
    return false;
  }
}
function renderSavedBlockPalette() {
  if (!ui.savedBlockList) return;
  const fragment = document.createDocumentFragment();
  savedBlockPalette = savedBlockPalette.filter((item) => catalog.some((entry) => entry.id === item.id));
  for (const saved of savedBlockPalette) {
    const entry = catalog.find((item) => item.id === saved.id);
    if (!entry) continue;
    const item = document.createElement("div");
    item.className = "saved-palette-item";
    item.setAttribute("role", "listitem");
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "saved-palette-choice";
    choice.dataset.savedBlockId = entry.id;
    choice.title = "Select " + entry.name + " without changing the current tab";
    choice.setAttribute("aria-label", "Select saved block " + entry.name);
    if (entry.textureUrl) {
      const image = document.createElement("img");
      image.src = entry.textureUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      choice.append(image);
    } else {
      const swatch = document.createElement("span");
      swatch.className = "saved-palette-swatch";
      swatch.style.background = entry.color || hashColor(entry.id);
      swatch.textContent = "▦";
      choice.append(swatch);
    }
    const label = document.createElement("span");
    label.textContent = entry.displayName || entry.label || entry.name;
    choice.append(label);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "saved-palette-remove";
    remove.dataset.removeSavedBlockId = entry.id;
    remove.title = "Remove " + entry.name + " from the saved palette";
    remove.setAttribute("aria-label", "Remove saved block " + entry.name);
    remove.textContent = "×";
    item.append(choice, remove);
    fragment.append(item);
  }
  if (!fragment.childNodes.length) {
    const empty = document.createElement("small");
    empty.className = "saved-palette-empty";
    empty.textContent = "Save blocks here to switch your brush without leaving Preview.";
    fragment.append(empty);
  }
  ui.savedBlockList.replaceChildren(fragment);
}
function saveCurrentBlockToPalette() {
  if (!selectedBlock) {
    setStatus("Select a block first, then save it to your palette.", "error");
    return;
  }
  const saved = {
    id: selectedBlock.id,
    states: { ...(activePlacedBlockKey
      ? (placedBlocks.get(activePlacedBlockKey)?.states || {})
      : appliedStateOverrides) }
  };
  const existing = savedBlockPalette.findIndex((item) => item.id === saved.id);
  if (existing >= 0) savedBlockPalette[existing] = saved;
  else if (savedBlockPalette.length < 24) savedBlockPalette.push(saved);
  else {
    setStatus("The saved block palette is full (24 blocks). Remove one before saving another.", "error");
    return;
  }
  if (!persistSavedBlockPalette()) return;
  renderSavedBlockPalette();
  setStatus("Saved " + selectedBlock.name + " to the Preview block palette.", "success");
}
function handleSavedPaletteClick(event) {
  const removeButton = event.target.closest("[data-remove-saved-block-id]");
  if (removeButton) {
    const id = removeButton.dataset.removeSavedBlockId;
    savedBlockPalette = savedBlockPalette.filter((item) => item.id !== id);
    persistSavedBlockPalette();
    renderSavedBlockPalette();
    setStatus("Removed " + id + " from the saved block palette.");
    return;
  }
  const choice = event.target.closest("[data-saved-block-id]");
  if (!choice) return;
  const saved = savedBlockPalette.find((item) => item.id === choice.dataset.savedBlockId);
  const entry = catalog.find((item) => item.id === choice.dataset.savedBlockId);
  if (!saved || !entry) return;
  selectBlock(entry, false);
  appliedStateOverrides = { ...(saved.states || {}) };
  renderBlockStateControls(entry.id, appliedStateOverrides, false);
  setStatus("Selected saved " + entry.name + ". Preview stays open; click the canvas to place it.", "success");
}
function isInsideWorkspace(x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 &&
    x < currentSize.x && y < currentSize.y && z < currentSize.z;
}
function hashColor(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  const saturation = 29 + ((hash >>> 9) % 24);
  const lightness = 39 + ((hash >>> 16) % 17);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function firstTextureValue(value) {
  if (Array.isArray(value)) return value.length ? firstTextureValue(value[0]) : null;
  if (value && typeof value === "object") return value.path || null;
  return typeof value === "string" ? value : null;
}
function normalizedVariant(value) {
  return String(value ?? "").toLowerCase().replace(/^minecraft:/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function chooseTextureArrayPath(paths, blockId, states = {}) {
  if (!Array.isArray(paths) || !paths.length) return firstTextureValue(paths);
  const candidates = paths.map((value, index) => ({ path: firstTextureValue(value), index }))
    .filter((entry) => entry.path);
  if (candidates.length < 2) return candidates[0]?.path || null;

  const growth = Number(states?.growth);
  if (Number.isFinite(growth)) {
    const stageEntries = candidates.map((entry) => {
      const match = entry.path.match(/(?:^|_)stage_(\d+)(?:$|_)/i);
      return match ? { ...entry, stage: Number(match[1]) } : null;
    }).filter(Boolean);
    if (stageEntries.length) {
      const maxStage = Math.max(...stageEntries.map((entry) => entry.stage));
      const requestedStage = Math.min(maxStage, Math.floor(
        Math.max(0, Math.min(7, growth)) * (maxStage + 1) / 8
      ));
      const stagedTexture = stageEntries.find((entry) => entry.stage === requestedStage);
      if (stagedTexture) return stagedTexture.path;
    }
  }

  const stateValues = Object.entries(states || {})
    .filter(([key]) => /(variant|type|color|wood|species|flower|stone|sand|dirt|coral|growth)/i.test(key))
    .map(([, value]) => normalizedVariant(value)).filter(Boolean);
  const synonyms = {
    dark_oak: ["dark_oak", "big_oak", "roofed_oak"],
    stone_brick: ["stone_brick", "stonebrick"],
    nether_brick: ["nether_brick"],
    smooth_stone: ["smooth_stone", "stone_smooth"],
    red_sand: ["red_sand", "redsand"]
  };
  for (const state of stateValues) {
    const tokens = synonyms[state] || [state];
    const match = candidates.find(({ path }) => tokens.some((token) => path.toLowerCase().includes(token)));
    if (match) return match.path;
  }

  const id = normalizedVariant(blockId);
  const idParts = id.split("_").filter((part) =>
    part.length > 2 && !["block", "slab", "double", "stairs", "wall", "fence", "pane", "leaves", "log", "wood", "planks", "door", "trapdoor"].includes(part)
  );
  if (idParts.length) {
    const match = candidates.find(({ path }) => idParts.some((part) => path.toLowerCase().includes(part)));
    if (match) return match.path;
  }
  // Legacy atlas arrays encode metadata variants. Use the canonical first
  // entry only when neither the block id nor an explicit state identifies one.
  return candidates[0]?.path || null;
}
const FOLIAGE_TGA_TEXTURES = new Set([
  "textures/blocks/leaves_oak", "textures/blocks/leaves_birch",
  "textures/blocks/leaves_spruce", "textures/blocks/leaves_jungle",
  "textures/blocks/leaves_acacia", "textures/blocks/leaves_big_oak",
  "textures/blocks/mangrove_leaves", "textures/blocks/pale_oak_leaves"
]);
function resolveTextureAlias(alias, blockId = "", states = {}) {
  if (!alias) return null;
  const entry = terrainTextureData[alias];
  if (!entry) return null;
  const path = chooseTextureArrayPath(entry.textures, blockId, states);
  if (!path) return null;
  const cleanPath = path.replace(/^\/+/, "").replace(/\.png$/i, "");
  const extension = FOLIAGE_TGA_TEXTURES.has(cleanPath) ? ".tga" : ".png";
  return RAW_ASSET_BASE + cleanPath + extension;
}
function foliageTintForTextureUrl(url) {
  const path = String(url || "").toLowerCase();
  if (path.endsWith("/leaves_birch.tga")) return "#80A755";
  if (path.endsWith("/leaves_spruce.tga")) return "#619961";
  if (["/leaves_oak.tga", "/leaves_jungle.tga", "/leaves_acacia.tga", "/leaves_big_oak.tga", "/mangrove_leaves.tga"].some((suffix) => path.endsWith(suffix))) return "#77AB2F";
  return null;
}
function thumbnailUrlFromTextureUrl(url) {
  return url && url.toLowerCase().endsWith(".tga") ? url.replace(/\.tga$/i, "_opaque.png") : url;
}
function textureAliasValue(value, blockId, states = {}) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return chooseTextureArrayPath(value, blockId, states) || firstTextureValue(value);
  if (value && typeof value === "object") return value.path || firstTextureValue(value.textures);
  return null;
}
function textureAliasForFace(blockId, face = "up", states = {}) {
  const textures = rawBlockDefinitions[blockId]?.textures;
  if (typeof textures === "string") return textures;
  if (Array.isArray(textures)) return chooseTextureArrayPath(textures, blockId, states) || firstTextureValue(textures);
  if (!textures || typeof textures !== "object") return null;

  const isSide = ["east", "west", "north", "south"].includes(face);
  const preferred = face === "up"
    ? ["up", "top", "*"]
    : face === "down"
      ? ["down", "bottom", "*"]
      : isSide
        ? [face, "side", "*"]
        : ["side", "*"];

  // Bedrock blocks.json defines exact faces first, then the shared side
  // texture, and finally '*' as the default for otherwise unspecified faces.
  for (const key of preferred) {
    const alias = textureAliasValue(textures[key], blockId, states);
    if (alias) return alias;
  }

  // Keep compatibility with older sample entries that use front/back labels.
  const legacy = {
    east: ["front", "north"], west: ["back", "south"],
    north: ["back", "up"], south: ["front", "up"],
    up: ["side"], down: ["side"]
  };
  for (const key of legacy[face] || []) {
    const alias = textureAliasValue(textures[key], blockId, states);
    if (alias) return alias;
  }
  return Object.values(textures)
    .map((value) => textureAliasValue(value, blockId, states))
    .find(Boolean) || null;
}
function textureUrlForFace(blockId, face = "up", states = {}) {
  return resolveTextureAlias(textureAliasForFace(blockId, face, states), blockId, states);
}
function thumbnailUrlForBlock(blockId) {
  if (blockId === "shelf_mushroom") return resolveTextureAlias("shelf_mushroom_small", blockId);
  if (blockId === "straw_bed") return resolveTextureAlias("straw_bed", blockId);
  if (modelTypeForBlock(blockId) === "door") {
    return doorTextureUrlForHalf(blockId, false) ||
      textureUrlForFace(blockId, "side");
  }
  return thumbnailUrlFromTextureUrl(
    textureUrlForFace(blockId, "up") ||
    textureUrlForFace(blockId, "side") ||
    textureUrlForFace(blockId, "north")
  );
}
function doorTextureUrlForHalf(blockId, upper, states = {}) {
  const textures = rawBlockDefinitions[blockId]?.textures;
  const alias = typeof textures === "object" && textures
    ? (upper ? textures.side : textures.down)
    : null;
  if (!alias) return textureUrlForFace(blockId, upper ? "south" : "down");

  // Mojang's legacy door_lower/door_upper aliases contain an array of
  // species-specific textures. Resolve the matching door instead of taking
  // the first (oak) entry for every door type.
  if (alias === "door_lower" || alias === "door_upper") {
    const variant = blockId.replace(/_door$/, "").replace(/^wooden$/, "wood");
    const suffix = upper ? "upper" : "lower";
    const candidates = terrainTextureData[alias]?.textures;
    if (Array.isArray(candidates)) {
      const match = candidates.map(firstTextureValue).find((path) =>
        path && path.toLowerCase().includes(`door_${variant}_${suffix}`)
      );
      if (match) {
        const cleanPath = match.replace(/^\/+/, "").replace(/\.png$/i, "");
        return RAW_ASSET_BASE + cleanPath + ".png";
      }
    }
  }
  return resolveTextureAlias(alias, blockId, states);
}
function displayName(blockId) {
  return blockId.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelTypeForBlock(id) {
  const name = id.toLowerCase();
  if (name === "air" || name.includes("structure_void") || name === "void_air" || name === "cave_air") return "empty";
  if (name === "shelf_mushroom") return "mushroom_shelf";
  if (name.endsWith("_shelf")) return "shelf";
  if (name === "straw_bed") return "straw_bed";
  if (/(^|_)(water|lava)$/.test(name) || name.startsWith("flowing_water") || name.startsWith("flowing_lava")) return "fluid";
  if (/(^|_)sapling$/.test(name) || name === "mangrove_propagule") return "sapling";
  if (/^(?:dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|cactus_flower|torchflower|sunflower|lilac|rose_bush|peony|open_eyeblossom|closed_eyeblossom|wildflowers|pink_petals|short_grass|tall_grass|short_dry_grass|tall_dry_grass|tallgrass|fern|large_fern|deadbush|brown_mushroom|red_mushroom|crimson_roots|warped_roots|nether_sprouts|crimson_fungus|warped_fungus|seagrass|tall_seagrass|kelp|sugar_cane|azalea|flowering_azalea|sweet_berry_bush|wheat|carrots|potatoes|beetroot|beetroots|nether_wart|pitcher_plant|pitcher_crop|torchflower_crop|melon_stem|pumpkin_stem|double_plant|red_flower|yellow_flower)$/.test(name)) return "plant";
  // Keep the original vanilla fallback coverage for non-crop vegetation and fungi.
  // Dedicated plant/sapling matches above remain separate and keep their full-size preview.
  if (/(flower|tulip|orchid|allium|poppy|dandelion|cornflower|lily_of_the_valley|grass|fern|deadbush|bush|shrub|roots|sprouts|seagrass|kelp|vine|glow_lichen|spore_blossom|hanging_roots|azalea|wither_rose|wheat|carrots|potatoes|beetroots|sweet_berry_bush|crimson_roots|warped_roots|nether_sprouts|mushroom|chorus_flower|chorus_plant|reeds|sugar_cane|cocoa|fire|coral_fan|sea_pickle|dripleaf)/.test(name) || name === "cobweb") return "cross";
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
  if (name.includes("amethyst_cluster") || name.includes("amethyst_bud")) return "cross";
  if (name.includes("turtle_egg") || name.includes("egg")) return "egg";
  if (name.includes("cobweb")) return "cross";
  return "cube";
}
function shapeClass(type) {
  if (type === "cube" || type === "log") return "solid";
  if (["slab","stairs","fence","gate","wall","pane","door","trapdoor","container","hopper","cactus","anvil","bell","composter","lectern","grindstone","head","cake","scaffolding","dripstone","egg","mushroom_shelf","shelf","straw_bed"].includes(type)) return "partial";
  return "non-solid";
}
function shapeLabel(type) {
  const labels = {
    cube:"Full cube", log:"Log", empty:"Empty", fluid:"Fluid", cross:"Cross", plant:"Plant", sapling:"Sapling", slab:"Slab",
    stairs:"Stairs", fence:"Fence", gate:"Gate", wall:"Wall", pane:"Pane",
    trapdoor:"Trapdoor", door:"Door", flat:"Flat", button:"Button", torch:"Post",
    rail:"Rail", ladder:"Ladder", sign:"Sign", bed:"Bed", chain:"Chain",
    lantern:"Lantern", cactus:"Cactus", anvil:"Anvil", bell:"Bell",
    composter:"Composter", lectern:"Lectern", grindstone:"Grindstone",
    container:"Container", hopper:"Hopper", head:"Head", cake:"Cake",
    candle:"Candle", scaffolding:"Scaffold", dripstone:"Dripstone",
    egg:"Egg", mushroom_shelf:"Mushroom shelf", shelf:"Shelf", straw_bed:"Straw bed"
  };
  return labels[type] || "Full cube";
}
function buildCatalog() {
  window.__BEDROCK_FALLBACK_DISABLED__ = true;
  catalog = Object.keys(rawBlockDefinitions).map((id) => {
    const model = modelTypeForBlock(id);
    return {
      id, name: `minecraft:${id}`, label: displayName(id), model,
      shapeClass: shapeClass(model), shapeLabel: shapeLabel(model),
      textureUrl: thumbnailUrlForBlock(id), color: hashColor(id),
      tint: foliageTintForTextureUrl(textureUrlForFace(id, "up") || textureUrlForFace(id, "side"))
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  ui.catalogCount.textContent = `${catalog.length.toLocaleString()} BLOCKS`;
  ui.sampleVersion.textContent = window.__BEDROCK_SAMPLE_VERSION__ || "VANILLA SAMPLES";
  renderCatalog();
  const starter = catalog.find((entry) => entry.id === "stone") || catalog[0];
  // Preselect a sensible starter without leaving the Blocks tab on compact screens.
  if (starter) selectBlock(starter, false);
  renderSavedBlockPalette();
  updateBuildSummary();
  setStatus(`Loaded ${catalog.length.toLocaleString()} vanilla block identifiers.`, "success");
}
function renderCatalog() {
  const query = ui.blockSearch.value.trim().toLowerCase();
  const filter = ui.shapeFilter.value;
  const filtered = catalog.filter((entry) => {
    const matchesQuery = !query || entry.id.includes(query) ||
      entry.name.includes(query) || entry.label.toLowerCase().includes(query);
    return matchesQuery && (filter === "all" || entry.shapeClass === filter);
  });
  const fragment = document.createDocumentFragment();
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4; cell.className = "no-results";
    cell.textContent = "No blocks match this search.";
    row.append(cell); fragment.append(row);
  } else {
    for (const entry of filtered) {
      const row = document.createElement("tr");
      row.className = "catalog-row" + (selectedBlock?.id === entry.id ? " is-selected" : "");
      row.dataset.id = entry.id; row.tabIndex = 0; row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Select ${entry.name}, ${entry.shapeLabel}`);
      const textureCell = document.createElement("td"); textureCell.className = "texture-cell";
      if (entry.textureUrl) {
        const image = document.createElement("img");
        image.className = "block-texture"; image.loading = "lazy"; image.decoding = "async";
        image.src = entry.textureUrl; image.alt = "";
        if (entry.tint) {
          textureCell.style.backgroundColor = entry.tint;
          image.style.mixBlendMode = "multiply";
        }
        image.addEventListener("error", () => {
          const fallback = document.createElement("span");
          fallback.className = "block-texture-fallback"; fallback.textContent = "▧";
          image.replaceWith(fallback);
        }, { once: true });
        textureCell.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "block-texture-fallback"; fallback.textContent = "▧";
        fallback.style.background = entry.color; textureCell.append(fallback);
      }
      const nameCell = document.createElement("td");
      nameCell.className = "block-id"; nameCell.textContent = entry.custom ? `${entry.displayName} · ${entry.name}` : entry.name; nameCell.title = entry.name;
      const shapeCell = document.createElement("td");
      const shape = document.createElement("span");
      shape.className = `shape-tag ${entry.shapeClass === "solid" ? "" : entry.shapeClass}`;
      shape.textContent = entry.shapeLabel; shape.title = `${entry.shapeLabel} · preview geometry category`;
      shapeCell.append(shape);
      const countCell = document.createElement("td");
      countCell.className = "used-count"; countCell.dataset.id = entry.id;
      countCell.textContent = String(countPlacedForBlock(entry.id));
      row.append(textureCell, nameCell, shapeCell, countCell); fragment.append(row);
    }
  }
  ui.blockRows.replaceChildren(fragment);
  ui.filteredCount.textContent = `${filtered.length.toLocaleString()} of ${catalog.length.toLocaleString()} blocks`;
}
function countPlacedForBlock(id) {
  let count = 0;
  for (const record of placedBlocks.values()) if (record.id === id) count += 1;
  return count;
}
function stateSchemaForBlock(blockId) {
  const exactSchema = blockStateData.exact?.[blockId];
  if (exactSchema && blockStateData.schemas?.[exactSchema]) {
    return { name: exactSchema, states: blockStateData.schemas[exactSchema] };
  }
  for (const rule of blockStateData.rules || []) {
    if (rule.ids?.includes(blockId)) {
      return blockStateData.schemas?.[rule.schema]
        ? { name: rule.schema, states: blockStateData.schemas[rule.schema] }
        : null;
    }
    if (rule.pattern && new RegExp(rule.pattern).test(blockId)) {
      return blockStateData.schemas?.[rule.schema]
        ? { name: rule.schema, states: blockStateData.schemas[rule.schema] }
        : null;
    }
  }
  return null;
}
function renderTraitReference() {
  if (!ui.traitReferenceContent) return;
  ui.traitReferenceContent.replaceChildren();
  const traits = Object.values(blockStateData.traits || {}).filter((trait) =>
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
function renderBlockStateControls(blockId, currentStates = {}, editingPlacedBlock = false) {
  ui.stateControls.replaceChildren();
  const schema = stateSchemaForBlock(blockId);
  ui.resetStates.disabled = !schema;
  if (!schema) {
    ui.stateCount.textContent = "NOT MAPPED YET";
    ui.stateHint.textContent = editingPlacedBlock
      ? "This placed block is valid, but its editable Microsoft state mapping is not available yet."
      : "This is a valid block. Its documented state mapping is not available yet.";
    const entries = Object.entries(currentStates || {});
    if (entries.length) {
      const fragment = document.createDocumentFragment();
      for (const [key, value] of entries) {
        const field = document.createElement("div");
        field.className = "state-field";
        const label = document.createElement("label");
        label.textContent = key;
        const valueText = document.createElement("small");
        valueText.textContent = "Current saved value: " + String(value);
        field.append(label, valueText);
        fragment.append(field);
      }
      ui.stateControls.append(fragment);
    } else {
      const message = document.createElement("p");
      message.className = "state-empty";
      message.textContent = "The block is valid and selectable. Its documented state properties have not been mapped to this block identifier yet; no guessed values are shown.";
      ui.stateControls.append(message);
    }
    return;
  }

  ui.stateCount.textContent = schema.states.length + " PROPERT" + (schema.states.length === 1 ? "Y" : "IES");
  ui.stateHint.textContent = editingPlacedBlock
    ? "Live edit: each change updates this placed block, its preview, and both exports."
    : "Live brush: each change updates the values used by new placements.";
  const fragment = document.createDocumentFragment();
  for (const state of schema.states) {
    const field = document.createElement("div");
    field.className = "state-field" + (state.deprecated ? " is-deprecated" : "");
    const label = document.createElement("label");
    label.textContent = state.label || state.key;
    const select = document.createElement("select");
    select.dataset.stateKey = state.key;
    select.setAttribute("aria-label", state.label || state.key + " (" + (state.type || "state") + ")");
    if (state.locked) {
      select.disabled = true;
      select.title = "This value is managed by the block placement rules.";
    }
    for (const optionData of state.values || []) {
      const option = document.createElement("option");
      option.value = JSON.stringify(optionData.value);
      option.textContent = optionData.label ?? String(optionData.value);
      select.append(option);
    }
    const currentValue = Object.prototype.hasOwnProperty.call(currentStates || {}, state.key)
      ? currentStates[state.key]
      : state.default;
    const serializedCurrent = JSON.stringify(currentValue);
    if (![...select.options].some((option) => option.value === serializedCurrent)) {
      const currentOption = document.createElement("option");
      currentOption.value = serializedCurrent;
      currentOption.textContent = "Saved value: " + String(currentValue);
      select.append(currentOption);
    }
    select.value = serializedCurrent;
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
function showStatePrompt(message) {
  ui.stateControls.replaceChildren();
  ui.stateCount.textContent = "SELECT BLOCK";
  ui.stateHint.textContent = message;
  ui.resetStates.disabled = true;
  const prompt = document.createElement("p");
  prompt.className = "state-empty";
  prompt.textContent = message;
  ui.stateControls.append(prompt);
}
function updateSelectedBlockDisplay(entry, placedRecord = null) {
  ui.selectedName.textContent = entry.displayName || entry.name;
  ui.selectedShape.textContent = entry.shapeLabel + " · " +
    (entry.shapeClass === "solid" ? "Solid" : entry.shapeClass === "partial" ? "Partial" : "Non-solid");
  if (ui.selectedLocation) {
    if (placedRecord) {
      const origin = blockbenchOriginForCell(placedRecord.x, placedRecord.y, placedRecord.z);
      ui.selectedLocation.textContent = "Blockbench origin · X " + origin.x + " · Y " + origin.y +
        " · Z " + origin.z + " px | Cell " + placedRecord.x + ", " + placedRecord.y + ", " + placedRecord.z;
    } else {
      ui.selectedLocation.textContent = "Blockbench origin · select a placed block to inspect its pixel coordinates.";
    }
  }
  if (entry.textureUrl) {
    ui.selectedThumb.style.backgroundImage = 'url("' + entry.textureUrl + '")';
    ui.selectedThumb.style.backgroundColor = entry.tint || "#303b3e";
    ui.selectedThumb.style.backgroundBlendMode = entry.tint ? "multiply" : "normal";
    ui.selectedThumb.classList.add("has-image");
  } else {
    ui.selectedThumb.style.backgroundImage = "none";
    ui.selectedThumb.style.backgroundColor = entry.color;
    ui.selectedThumb.classList.remove("has-image");
  }
  document.querySelectorAll(".catalog-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  ui.blockRows.querySelector('[data-id="' + CSS.escape(entry.id) + '"]')?.classList.add("is-selected");
}
function setMobileView(view) {
  const nextView = ["blocks", "canvas", "export"].includes(view) ? view : "blocks";
  document.body.dataset.mobileView = nextView;
  for (const tab of ui.mobileTabs) {
    const active = tab.dataset.view === nextView;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}
function syncResponsiveLayout(initial = false) {
  const compact = window.matchMedia("(max-width: 900px)").matches;
  if (!ui.stateEditor) return;
  // The block catalogue is the primary left-panel workspace. Keep state
  // controls collapsed by default on EVERY screen so they never consume
  // the catalogue's scroll area. Users can expand them when needed.
  if (initial) {
    ui.stateEditor.open = false;
    if (compact) setMobileView("blocks");
  }
}
function updateCanvasModeButton() {
  const current = canvasMode === "build" ? "Build" : "Select";
  const next = canvasMode === "build" ? "Select" : "Build";
  ui.canvasMode.textContent = "Mode: " + current;
  ui.canvasMode.setAttribute("aria-pressed", String(canvasMode === "select"));
  ui.canvasMode.setAttribute("aria-label", "Canvas mode " + current + ". Switch to " + next + " mode.");
  ui.canvasMode.title = "Current mode: " + current + ". Click to switch to " + next + " mode.";
}
function setCanvasMode(mode) {
  canvasMode = mode === "select" ? "select" : "build";
  if (canvasMode === "build") {
    activePlacedBlockKey = null;
    setPlacedSelectionHighlight(null);
    if (selectedBlock) {
      updateSelectedBlockDisplay(selectedBlock);
      renderBlockStateControls(selectedBlock.id, appliedStateOverrides, false);
    }
    else showStatePrompt("Choose a block from the catalog to set its placement states.");
    setStatus("Build mode: click an empty cell or a placed block face to place the selected block.");
  } else {
    activePlacedBlockKey = null;
    setPlacedSelectionHighlight(null);
    showStatePrompt("Tap a placed block in the 3D canvas to load and edit its current states.");
    setStatus("Select mode: tap a placed block to inspect and edit its Bedrock states.");
  }
  updateCanvasModeButton();
}
function selectPlacedBlock(record) {
  const entry = catalog.find((item) => item.id === record.id);
  if (!entry) return setStatus("The catalog entry for " + record.id + " could not be found.", "error");
  canvasMode = "select";
  activePlacedBlockKey = cellKey(record.x, record.y, record.z);
  selectedBlock = entry;
  updateCanvasModeButton();
  updateSelectedBlockDisplay(entry, record);
  renderBlockStateControls(record.id, record.states || {}, true);
  setPlacedSelectionHighlight(activePlacedBlockKey);
  setStatus("Selected placed " + record.name + " at " + record.x + ", " + record.y + ", " + record.z +
    ". Change a dropdown to update it instantly.", "success");
}
function readStateControls() {
  const parsed = {};
  const controls = [...ui.stateControls.querySelectorAll("select[data-state-key]")];
  if (!controls.length) throw new Error("This block has no documented editable Bedrock states.");
  for (const control of controls) parsed[control.dataset.stateKey] = JSON.parse(control.value);
  stateTagsFor(parsed);
  return { parsed, count: controls.length };
}
function applyStateControlChanges() {
  try {
    if (!selectedBlock) throw new Error("Select a block first.");
    const result = readStateControls();
    const parsed = result.parsed;
    const count = result.count;
    if (activePlacedBlockKey) {
      const record = placedBlocks.get(activePlacedBlockKey);
      if (!record) {
        activePlacedBlockKey = null;
        setPlacedSelectionHighlight(null);
        showStatePrompt("The selected block is no longer in the workspace. Select another placed block.");
        return;
      }
      record.states = { ...(record.states || {}), ...parsed };
      const rebuiltKeys = [activePlacedBlockKey];
      if (record.model === "door") {
        const isUpper = record.states?.upper_block_bit === true;
        const mateKey = cellKey(record.x, isUpper ? record.y - 1 : record.y + 1, record.z);
        const mate = placedBlocks.get(mateKey);
        if (mate?.id === record.id && mate.model === "door") {
          mate.states = { ...(mate.states || {}), ...parsed };
          rebuiltKeys.push(mateKey);
        }
      }
      for (const key of rebuiltKeys) rebuildPlacedBlock(key);
      const paired = rebuiltKeys.length > 1 ? " Both door halves were updated." : "";
      setStatus("Updated " + count + " state propert" + (count === 1 ? "y" : "ies") + " on " +
        record.name + " at " + record.x + ", " + record.y + ", " + record.z +
        ". Preview and exports are current." + paired, "success");
    } else {
      appliedStateOverrides = parsed;
      setStatus("Updated " + count + " placement state propert" + (count === 1 ? "y" : "ies") +
        " for new " + selectedBlock.name + " blocks.", "success");
    }
  } catch (error) {
    setStatus(error.message || "Invalid block-state selection.", "error");
  }
}
function resetBlockStateControls() {
  if (!selectedBlock) return;
  const schema = stateSchemaForBlock(selectedBlock.id);
  if (!schema) return;
  const defaults = Object.fromEntries(schema.states
    .filter((state) => !state.locked)
    .map((state) => [state.key, state.default]));
  if (activePlacedBlockKey) {
    const record = placedBlocks.get(activePlacedBlockKey);
    if (!record) return;
    record.states = { ...(record.states || {}), ...defaults };
    const rebuiltKeys = [activePlacedBlockKey];
    if (record.model === "door") {
      const isUpper = record.states?.upper_block_bit === true;
      const mateKey = cellKey(record.x, isUpper ? record.y - 1 : record.y + 1, record.z);
      const mate = placedBlocks.get(mateKey);
      if (mate?.id === record.id && mate.model === "door") {
        mate.states = { ...(mate.states || {}), ...defaults };
        rebuiltKeys.push(mateKey);
      }
    }
    for (const key of rebuiltKeys) rebuildPlacedBlock(key);
    renderBlockStateControls(record.id, record.states, true);
    setStatus("Restored the initial editor state selections on " + record.name + " at " +
      record.x + ", " + record.y + ", " + record.z + ".", "success");
  } else {
    appliedStateOverrides = {};
    renderBlockStateControls(selectedBlock.id, appliedStateOverrides, false);
    setStatus("Initial editor state selections restored for new " + selectedBlock.name + " placements.");
  }
}
function selectBlock(entry, switchToCanvas = true) {
  selectedBlock = entry;
  activePlacedBlockKey = null;
  setPlacedSelectionHighlight(null);
  appliedStateOverrides = {};
  canvasMode = "build";
  updateCanvasModeButton();
  renderBlockStateControls(entry.id, appliedStateOverrides, false);
  updateSelectedBlockDisplay(entry);
  setStatus("Selected " + entry.name + ". Click an empty grid cell or a placed block face to place it.");
  if (switchToCanvas && window.matchMedia("(max-width: 900px)").matches) {
    // Preserve the user's state-editor open/closed choice when switching
    // views; selecting a catalogue row must not unexpectedly collapse its list.
    setMobileView("canvas");
  }
}
function updateUsedCount(id) {
  const cell = ui.blockRows.querySelector(`.used-count[data-id="${CSS.escape(id)}"]`);
  if (cell) cell.textContent = String(countPlacedForBlock(id));
}
function updateBuildSummary() {
  const total = placedBlocks.size;
  ui.placedCount.textContent = `${total.toLocaleString()} BLOCKS PLACED`;
  ui.canvasDimensions.textContent = `${currentSize.x} × ${currentSize.y} × ${currentSize.z}`;
  ui.downloadFunction.disabled = total === 0;
  ui.downloadStructure.disabled = false;
  ui.emptyState.hidden = total > 0;
  const types = new Set([...placedBlocks.values()].map((block) => block.id)).size;
  const structureVoidCount = [...placedBlocks.values()].filter((block) => /(^|:)structure_void$/.test(block.name || block.id)).length;
  if (ui.structureVoidLegend) {
    ui.structureVoidLegend.hidden = structureVoidCount === 0;
    const label = ui.structureVoidLegend.querySelector("span");
    if (label) label.textContent = "STRUCTURE VOID · " + structureVoidCount.toLocaleString() + " PLACED · EDITOR MARKER ONLY";
  }
  setSummary(`${total.toLocaleString()} blocks · ${types.toLocaleString()} types · ${currentSize.x}×${currentSize.y}×${currentSize.z} workspace`);
}

function getTexture(url) {
  if (!url) return null;
  if (textureCache.has(url)) return textureCache.get(url);
  const loader = url.toLowerCase().endsWith(".tga") ? tgaLoader : textureLoader;
  const texture = loader.load(url, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.NearestFilter;
    loaded.minFilter = THREE.NearestFilter;
    loaded.generateMipmaps = false;
    loaded.needsUpdate = true;
  }, undefined, () => {});
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  textureCache.set(url, texture);
  return texture;
}
function renderMethodForBlock(blockId) {
  const name = blockId.toLowerCase();
  if (/powder_snow/.test(name)) return "double_sided";
  if (/(glass|water|lava|ice|beacon|honey|slime|portal|bubble_column)/.test(name)) return "blend";
  if (/leaves/.test(name)) return "alpha_test_to_opaque";
  if (/(bamboo|kelp|sugar_cane)/.test(name)) return "alpha_test_single_sided_to_opaque";
  if (/amethyst_(?:cluster|bud)/.test(name)) return "alpha_test_single_sided";
  if (["plant", "sapling"].includes(modelTypeForBlock(name))) return "alpha_test_single_sided";
  if (/(door|trapdoor|sapling|flower|tulip|orchid|allium|poppy|dandelion|cornflower|grass|fern|deadbush|bush|shrub|roots|sprouts|seagrass|vine|glow_lichen|spore_blossom|hanging_roots|azalea|wither_rose|wheat|carrots|potatoes|beetroots|sweet_berry_bush|mushroom|chorus|reeds|cocoa|fire|coral_fan|sea_pickle|dripleaf|cobweb|candle|rail|straw_bed)/.test(name)) {
    return "alpha_test_single_sided";
  }
  if (/(ladder|monster_spawner|spawner)/.test(name)) return "alpha_test";
  return "opaque";
}
function materialForTexture(url, blockId, materialName = "*") {
  const method = renderMethodForBlock(blockId);
  const alphaTest = method.startsWith("alpha_test") ? 0.5 : 0;
  const blended = method === "blend";
  const singleSidedCutout = method === "alpha_test_single_sided" || method === "alpha_test_single_sided_to_opaque";
  const doubleSided = method === "double_sided" || (method.startsWith("alpha_test") && !singleSidedCutout);
  const foliageTint = foliageTintForTextureUrl(url);
  return new THREE.MeshStandardMaterial({
    map: getTexture(url),
    color: url ? new THREE.Color(foliageTint || "#ffffff") : new THREE.Color(hashColor(blockId + materialName)),
    roughness: 0.88,
    metalness: 0.01,
    alphaTest,
    transparent: blended,
    opacity: 1,
    depthWrite: !blended,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
  });
}
function materialsForBlock(blockId, states = {}) {
  const cacheKey = blockId + "|" + JSON.stringify(states || {});
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);
  const materials = ["east","west","up","down","south","north"].map((face) => {
    const url = textureUrlForFace(blockId, face, states);
    return materialForTexture(url, blockId, face);
  });
  materialCache.set(cacheKey, materials);
  return materials;
}
function boxGeometry(width, height, depth) {
  const key = `${width.toFixed(4)},${height.toFixed(4)},${depth.toFixed(4)}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, createVoxelBoxGeometry(
      THREE, width * 16, height * 16, depth * 16
    ));
  }
  return geometryCache.get(key);
}
function addBox(group, materials, x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(boxGeometry(width, height, depth), materials);
  mesh.position.set(x + width / 2 - 0.5, y + height / 2 - 0.5, z + depth / 2 - 0.5);
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
}
let doorPanelGeometryCache = null;
function getDoorPanelGeometry() {
  if (doorPanelGeometryCache) return doorPanelGeometryCache;
  const thickness = 3 / 16;
  const geometry = new THREE.BoxGeometry(1, 1, thickness);
  const uv = geometry.attributes.uv;
  // BoxGeometry face order: east, west, top, bottom, south, north.
  // The large front/back faces sample the complete 16x16 half texture.
  // The 3-pixel-wide edge faces sample matching edge strips.
  for (let face = 0; face < 6; face += 1) {
    for (let corner = 0; corner < 4; corner += 1) {
      const vertex = face * 4 + corner;
      let u = uv.getX(vertex);
      let v = uv.getY(vertex);
      if (face === 0) u = 13 / 16 + u * (3 / 16);
      else if (face === 1) u *= 3 / 16;
      else if (face === 2) v = 13 / 16 + v * (3 / 16);
      else if (face === 3) v *= 3 / 16;
      uv.setXY(vertex, u, v);
    }
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  doorPanelGeometryCache = geometry;
  return geometry;
}
function addDoorPanel(group, record) {
  const states = record.states || {};
  const isUpper = states.upper_block_bit === true || states["minecraft:upper_block_bit"] === true;
  const textureUrl = doorTextureUrlForHalf(record.id, isUpper);
  // Bedrock doors use alpha_test_single_sided: cut out transparent pixels,
  // do not blend translucency, and cull back-facing polygons.
  const material = new THREE.MeshStandardMaterial({
    map: getTexture(textureUrl),
    color: textureUrl ? 0xffffff : new THREE.Color(hashColor(record.id)),
    roughness: 0.88,
    metalness: 0.01,
    alphaTest: 0.5,
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide
  });
  const mesh = new THREE.Mesh(getDoorPanelGeometry(), Array(6).fill(material));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const facingState = states["minecraft:cardinal_direction"] ?? states.direction ?? "south";
  const facing = typeof facingState === "number"
    ? ({ 0: "south", 1: "west", 2: "north", 3: "east" }[facingState] || "south")
    : String(facingState).toLowerCase();
  const yaw = ({ east: Math.PI / 2, south: 0, west: -Math.PI / 2, north: Math.PI })[facing] ?? 0;
  const oriented = new THREE.Group();
  oriented.rotation.y = yaw;
  group.add(oriented);

  const panelZ = -0.5 + (3 / 16) / 2;
  if (states.open_bit === true) {
    const hingeRight = states.door_hinge_bit === true;
    const hingeX = hingeRight ? -0.5 : 0.5;
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, panelZ);
    pivot.rotation.y = hingeRight ? -Math.PI / 2 : Math.PI / 2;
    mesh.position.set(-hingeX, 0, 0);
    pivot.add(mesh);
    oriented.add(pivot);
  } else {
    mesh.position.set(0, 0, panelZ);
    oriented.add(mesh);
  }
}
function addCross(group, materials, height = 1, width = 1) {
  const mat = materials[4] || materials[2] || materials[0];
  const geometry = new THREE.PlaneGeometry(width, height);
  const y = 0;
  // Block groups are centered in their cells, so the crossed planes span
  // the cell from -height/2 to +height/2. Bedrock's cross model is cutout
  // and backface-culled. Mirror each crossed
  // plane with reversed winding so the same two physical planes are visible
  // from both sides without enabling double-sided transparency.
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    for (const reverse of [false, true]) {
      const plane = new THREE.Mesh(geometry, mat);
      plane.position.set(0, y, 0);
      plane.rotation.y = angle + (reverse ? Math.PI : 0);
      group.add(plane);
    }
  }
}
function blockFacing(states = {}, fallback = "north") {
  const cardinal = states["minecraft:cardinal_direction"] ?? states.cardinal_direction;
  if (cardinal !== undefined && cardinal !== null) {
    const value = String(cardinal).toLowerCase();
    if (["north","south","east","west"].includes(value)) return value;
  }
  if (states.facing_direction !== undefined && states.facing_direction !== null) {
    const value = Number(states.facing_direction);
    return ({ 2: "north", 3: "south", 4: "west", 5: "east" })[value] || fallback;
  }
  if (states.weirdo_direction !== undefined && states.weirdo_direction !== null) {
    const value = Number(states.weirdo_direction);
    // Microsoft lists the valid 0–3 stair rotation range; retain the
    // renderer's established stair-specific rotation interpretation.
    return ({ 0: "east", 1: "west", 2: "south", 3: "north" })[value] || fallback;
  }
  const raw = states.direction;
  if (typeof raw === "number" || (raw !== undefined && /^-?\d+$/.test(String(raw)))) {
    return ({ 0: "south", 1: "west", 2: "north", 3: "east" })[Number(raw)] || fallback;
  }
  const value = String(raw ?? fallback).toLowerCase();
  return ["north","south","east","west"].includes(value) ? value : fallback;
}
function yawForFacing(facing) {
  return ({ north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 })[facing] ?? 0;
}
function createOrientedGroup(parent, states = {}, fallback = "north") {
  const oriented = new THREE.Group();
  oriented.rotation.y = yawForFacing(blockFacing(states, fallback));
  parent.add(oriented);
  return oriented;
}
// The shelf's authored geometry has its backboard on +Z and its open display
// side toward -Z (north). Keep this mapping local so changing shelf orientation
// cannot rotate doors, beds, mushroom shelves, or any other vanilla model.
function createShelfOrientedGroup(parent, states = {}) {
  const oriented = new THREE.Group();
  const facing = blockFacing(states, "south");
  const yawByFacing = {
    north: 0,
    east: -Math.PI / 2,
    south: Math.PI,
    west: Math.PI / 2
  };
  oriented.rotation.y = yawByFacing[facing] ?? Math.PI;
  parent.add(oriented);
  return oriented;
}
function blockAtOffset(record, dx, dy = 0, dz = 0) {
  return placedBlocks.get(cellKey(record.x + dx, record.y + dy, record.z + dz)) || null;
}
function neighborCanConnect(record, dx, dz, category) {
  const neighbor = blockAtOffset(record, dx, 0, dz);
  if (!neighbor || neighbor.id === "air" || neighbor.model === "empty") return false;
  const neighborType = neighbor.model || modelTypeForBlock(neighbor.id);
  if (category === "fence") return neighborType === "fence" || neighborType === "gate" || !["door","trapdoor","pane","cross","rail","fluid","empty"].includes(neighborType);
  if (category === "pane") return neighborType === "pane" || neighborType === "fence" || neighborType === "wall" || (!["door","trapdoor","cross","rail","fluid","empty"].includes(neighborType) && neighborType !== "button");
  return neighborType === "wall" || neighborType === "fence" || neighborType === "gate" || !["door","trapdoor","pane","cross","rail","fluid","empty"].includes(neighborType);
}
function modelMaterialForInstance(record, materialInstance, face) {
  let alias;
  if (record.model === "mushroom_shelf") {
    const growth = Number(record.states?.growth ?? 0);
    alias = growth > 0 ? "shelf_mushroom_large" : "shelf_mushroom_small";
  } else {
    alias = "straw_bed";
  }
  return materialForTexture(resolveTextureAlias(alias, record.id, record.states), record.id, materialInstance || face);
}
function addPublishedBlockGeometry(group, record, modelName) {
  const file = modelGeometryFiles[modelName];
  if (!file) return false;
  const modelGroup = new THREE.Group();
  const created = createBedrockGeometryModel(
    THREE, modelGroup, file,
    (materialInstance, face) => modelMaterialForInstance(record, materialInstance, face)
  );
  if (!created) return false;
  modelGroup.rotation.y = yawForFacing(blockFacing(record.states, "north"));
  group.add(modelGroup);
  return true;
}
function customMaterialForTexture(url, blockId, renderMode, materialName = "*") {
  const mode = renderMode || "cutout";
  const cacheKey = [blockId, mode, url || "", materialName].join("|");
  if (customMaterialCache.has(cacheKey)) return customMaterialCache.get(cacheKey);
  const transparent = mode === "transparent";
  const material = new THREE.MeshStandardMaterial({
    map: getTexture(url),
    color: url ? new THREE.Color("#ffffff") : new THREE.Color(hashColor(blockId + materialName)),
    roughness: 0.88,
    metalness: 0.01,
    alphaTest: mode === "cutout" ? 0.5 : 0,
    transparent,
    opacity: 1,
    depthWrite: !transparent,
    side: mode === "double-sided" || mode === "cutout" ? THREE.DoubleSide : THREE.FrontSide
  });
  customMaterialCache.set(cacheKey, material);
  return material;
}
function addCustomBlockGeometry(group, record) {
  const definition = customBlockDefinitions.get(record.customModelKey || record.id);
  if (!definition?.model) return false;
  const textureUrls = definition.textureUrls || {};
  const modelGroup = new THREE.Group();
  const created = createBedrockGeometryModel(
    THREE,
    modelGroup,
    definition.model,
    (materialInstance, face) => {
      const name = String(materialInstance || "*").replace(/^.*:/, "").toLowerCase();
      const url = textureUrls[materialInstance] ||
        textureUrls[name] ||
        textureUrls[face] ||
        textureUrls["*"] ||
        Object.values(textureUrls)[0] ||
        null;
      return customMaterialForTexture(url, record.id, definition.renderMode, materialInstance || face);
    }
  );
  if (!created) return false;
  modelGroup.rotation.y = yawForFacing(blockFacing(record.states, "north"));
  group.add(modelGroup);
  return true;
}
function addStructureVoidMarker(group) {
  // Use the actual Bedrock vanilla structure_void texture on all six faces.
  // This remains an editor-only preview: the saved palette cell is still -1.
  const textureMaterials = materialsForBlock("structure_void");
  for (const material of textureMaterials) {
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
  }
  addBox(group, textureMaterials, 0.025, 0.025, 0.025, 0.95, 0.95, 0.95);

  // Keep a fine edge so the textured marker is still easy to pick out against
  // similarly coloured blocks, without the previous oversized neon wireframe.
  const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.97, 0.97, 0.97));
  const outline = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: 0xc58bb9,
      transparent: true,
      opacity: 0.52,
      depthTest: true,
      depthWrite: false
    })
  );
  outline.renderOrder = 2;
  group.add(outline);
}

function createBlockModel(group, record) {
  const id = record.id;
  const states = record.states || {};
  if (record.customModelKey || customBlockDefinitions.has(id)) {
    if (!addCustomBlockGeometry(group, record)) {
      const fallback = customMaterialForTexture(null, id, "opaque", "fallback");
      addBox(group, [fallback, fallback, fallback, fallback, fallback, fallback], 0, 0, 0, 1, 1, 1);
    }
    return;
  }
  const type = modelTypeForBlock(id);
  if (type === "empty") {
    if (/(^|:)structure_void$/.test(id)) addStructureVoidMarker(group);
    return;
  }
  const mats = materialsForBlock(id, states); const thin = 1 / 16;
  switch (type) {
    case "log": {
      const axis = String(states.pillar_axis ?? states.axis ?? "y").toLowerCase();
      const oriented = new THREE.Group();
      if (axis === "x") oriented.rotation.z = Math.PI / 2;
      else if (axis === "z") oriented.rotation.x = Math.PI / 2;
      group.add(oriented);
      addBox(oriented, mats, 0, 0, 0, 1, 1, 1);
      return;
    }
    case "mushroom_shelf": {
      const large = Number(states.growth ?? 0) > 0;
      addPublishedBlockGeometry(group, record, large ? "shelf_mushroom_large" : "shelf_mushroom_small");
      return;
    }
    case "shelf": {
      // Bedrock uses four directional shelf voxel shapes. The visible model's
      // base orientation faces north; the shelf-only map mirrors east/west
      // correctly without changing any shared vanilla model rotations.
      const oriented = createShelfOrientedGroup(group, states);
      const wood = mats;
      // The vanilla shelf is a thin wall-mounted display with three side-by-side bays.
      // Keep the model inside the directional shelf voxel footprint.
      addBox(oriented, wood, 0.015, 0.25, 0.91, 0.97, 0.5, 0.09);
      addBox(oriented, wood, 0.015, 0.25, 0.78, 0.97, 0.09, 0.22);
      addBox(oriented, wood, 0.015, 0.66, 0.78, 0.97, 0.09, 0.22);
      addBox(oriented, wood, 0.015, 0.34, 0.78, 0.07, 0.32, 0.22);
      addBox(oriented, wood, 0.915, 0.34, 0.78, 0.07, 0.32, 0.22);
      addBox(oriented, wood, 0.333, 0.34, 0.82, 0.045, 0.32, 0.18);
      addBox(oriented, wood, 0.622, 0.34, 0.82, 0.045, 0.32, 0.18);
      return;
    }
    case "straw_bed": {
      const isHead = states.head_piece_bit === true || states.head_piece === true;
      addPublishedBlockGeometry(group, record, isHead ? "straw_bed_head" : "straw_bed_foot");
      return;
    }
    case "fluid": {
      const rawDepth = Number(states.liquid_depth ?? states.depth ?? 0);
      const liquidDepth = Number.isFinite(rawDepth) ? Math.max(0, Math.min(15, rawDepth)) : 0;
      const height = states.liquid_depth === undefined && states.depth === undefined ? 1 : Math.max(1 / 16, (16 - liquidDepth) / 16);
      addBox(group, mats, 0, 0, 0, 1, height, 1);
      return;
    }
    case "sapling":
    case "plant": {
      const plantGroup = new THREE.Group();
      if (id === "mangrove_propagule" && states.hanging === true) plantGroup.rotation.z = Math.PI;
      group.add(plantGroup);
      addCross(plantGroup, mats, 1, 1);
      return;
    }
    case "cross":
      if (/cobweb/.test(id)) addCross(group, mats, 0.92, 0.92);
      else if (/torch|end_rod/.test(id)) {
        addBox(group, mats, 0.43, 0.08, 0.43, 0.14, 0.72, 0.14);
        addBox(group, mats, 0.39, 0.69, 0.39, 0.22, 0.16, 0.22);
      } else {
        // Restore the original vanilla cross footprint. Plants and saplings use
        // their dedicated full-size branch above.
        addCross(group, mats, /tall|large|double_plant/.test(id) ? 1 : 0.92, 1);
      }
      return;
    case "slab": {
      const topSlab = states.top_slot_bit === true ||
        states["minecraft:vertical_half"] === "top" || states.upside_down_bit === true;
      addBox(group, mats, 0, topSlab ? 0.5 : 0, 0, 1, 0.5, 1);
      return;
    }
    case "stairs": {
      const topStair = states.upside_down_bit === true || states["minecraft:vertical_half"] === "top";
      const shape = normalizedVariant(states.stairs_shape ?? states.stair_shape ?? states.shape ?? "straight");
      const oriented = createOrientedGroup(group, states, "north");
      addBox(oriented, mats, 0, topStair ? 0.5 : 0, 0, 1, 0.5, 1);
      const stepY = topStair ? 0 : 0.5;
      if (shape.startsWith("outer")) {
        const left = shape.includes("left");
        addBox(oriented, mats, left ? 0 : 0.5, stepY, 0.5, 0.5, 0.5, 0.5);
      } else if (shape.startsWith("inner")) {
        const left = shape.includes("left");
        addBox(oriented, mats, 0, stepY, 0.5, 1, 0.5, 0.5);
        addBox(oriented, mats, left ? 0 : 0.5, stepY, 0, 0.5, 0.5, 0.5);
      } else {
        addBox(oriented, mats, 0, stepY, 0.5, 1, 0.5, 0.5);
      }
      return;
    }
    case "fence": {
      addBox(group, mats, 0.375, 0, 0.375, 0.25, 1, 0.25);
      const connections = [
        { dx: 0, dz: -1, x: 0.4375, z: 0, w: 0.125, d: 0.5 },
        { dx: 0, dz: 1, x: 0.4375, z: 0.5, w: 0.125, d: 0.5 },
        { dx: 1, dz: 0, x: 0.5, z: 0.4375, w: 0.5, d: 0.125 },
        { dx: -1, dz: 0, x: 0, z: 0.4375, w: 0.5, d: 0.125 }
      ];
      for (const connection of connections) {
        if (!neighborCanConnect(record, connection.dx, connection.dz, "fence")) continue;
        for (const y of [0.34, 0.68]) {
          addBox(group, mats, connection.x, y, connection.z, connection.w, 0.12, connection.d);
        }
      }
      return;
    }
    case "gate": {
      const gate = createOrientedGroup(group, states, "north");
      if (states.open_bit === true) gate.rotation.y += states.in_wall_bit === true ? -Math.PI / 2 : Math.PI / 2;
      const postHeight = states.in_wall_bit === true ? 0.82 : 1;
      addBox(gate, mats, 0.06, 0.08, 0.38, 0.12, postHeight, 0.24);
      addBox(gate, mats, 0.82, 0.08, 0.38, 0.12, postHeight, 0.24);
      addBox(gate, mats, 0.18, 0.3, 0.43, 0.64, 0.1, 0.14);
      addBox(gate, mats, 0.18, 0.68, 0.43, 0.64, 0.1, 0.14);
      return;
    }
    case "wall": {
      const directions = [
        { dx: 0, dz: -1, x: 0.375, z: 0, w: 0.25, d: 0.5 },
        { dx: 0, dz: 1, x: 0.375, z: 0.5, w: 0.25, d: 0.5 },
        { dx: 1, dz: 0, x: 0.5, z: 0.375, w: 0.5, d: 0.25 },
        { dx: -1, dz: 0, x: 0, z: 0.375, w: 0.5, d: 0.25 }
      ];
      const connections = directions.filter((entry) => neighborCanConnect(record, entry.dx, entry.dz, "wall"));
      const centerHeight = connections.length === 0 ? 1 : 0.875;
      addBox(group, mats, 0.375, 0, 0.375, 0.25, centerHeight, 0.25);
      for (const connection of connections) {
        addBox(group, mats, connection.x, 0.25, connection.z, connection.w, 0.75, connection.d);
      }
      return;
    }
    case "pane": {
      addBox(group, mats, 0.4375, 0, 0.4375, 0.125, 1, 0.125);
      const arms = [
        { dx: 0, dz: -1, x: 0.4375, z: 0, w: 0.125, d: 0.4375 },
        { dx: 0, dz: 1, x: 0.4375, z: 0.5625, w: 0.125, d: 0.4375 },
        { dx: 1, dz: 0, x: 0.5625, z: 0.4375, w: 0.4375, d: 0.125 },
        { dx: -1, dz: 0, x: 0, z: 0.4375, w: 0.4375, d: 0.125 }
      ];
      for (const arm of arms) {
        if (neighborCanConnect(record, arm.dx, arm.dz, "pane")) {
          addBox(group, mats, arm.x, 0, arm.z, arm.w, 1, arm.d);
        }
      }
      return;
    }
    case "door": addDoorPanel(group, record); return;
    case "trapdoor": {
      const topTrap = states.upside_down_bit === true || states["minecraft:vertical_half"] === "top";
      const open = states.open_bit === true;
      const oriented = createOrientedGroup(group, states, "north");
      if (open) {
        addBox(oriented, mats, 0, 0, topTrap ? 0.82 : 0, 1, 1, thin * 3);
      } else {
        addBox(oriented, mats, 0, topTrap ? 1 - thin * 3 : 0, 0, 1, thin * 3, 1);
      }
      return;
    }
    case "flat": {
      const rawLayers = Number(states.height ?? states.snow_layer_count ?? 1);
      const snowLayers = Number.isFinite(rawLayers) ? Math.max(1, Math.min(8, rawLayers)) : 1;
      const height = id.includes("snow") ? snowLayers / 8 :
        id.includes("pressure_plate") ? 0.0625 : 0.0625;
      addBox(group, mats, 0, 0, 0, 1, height, 1);
      return;
    }
    case "button": {
      const oriented = new THREE.Group();
      const face = Number(states.facing_direction ?? 0);
      if (face === 0) {
        // Attached to the underside; the button projects downward.
        oriented.rotation.x = -Math.PI / 2;
      } else if (face === 1) {
        // Attached to the top face; the button projects upward.
        oriented.rotation.x = Math.PI / 2;
      } else {
        // Side-mounted buttons use the four horizontal Bedrock directions.
        oriented.rotation.y = yawForFacing(blockFacing(states, "north"));
      }
      group.add(oriented);
      const pressed = states.button_pressed_bit === true;
      // Pressed buttons sit closer to their supporting face.
      addBox(oriented, mats, 0.35, 0.4, pressed ? 0.015 : 0, 0.3, 0.2, 0.12);
      return;
    }
    case "torch": {
      const facing = String(states.torch_facing_direction ?? "top").toLowerCase();
      const torchGroup = new THREE.Group();
      group.add(torchGroup);
      if (facing === "top" || facing === "unknown") {
        addBox(torchGroup, mats, 0.43, 0.08, 0.43, 0.14, 0.72, 0.14);
        addBox(torchGroup, mats, 0.39, 0.7, 0.39, 0.22, 0.16, 0.22);
      } else {
        const wallDirection = ({ north: "north", south: "south", east: "east", west: "west" })[facing] || "north";
        torchGroup.rotation.y = yawForFacing(wallDirection);
        addBox(torchGroup, mats, 0.43, 0.2, 0.38, 0.14, 0.62, 0.14);
        addBox(torchGroup, mats, 0.39, 0.68, 0.35, 0.22, 0.16, 0.22);
      }
      return;
    }
    case "rail": {
      const rail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats[2]);
      rail.rotation.x = -Math.PI / 2;
      const railDirection = Number(states.rail_direction ?? 0);
      rail.rotation.set(-Math.PI / 2, [1, 3, 5, 7, 9].includes(railDirection) ? Math.PI / 2 : 0, 0);
      rail.position.y = 0.035;
      group.add(rail);
      return;
    }
    case "ladder": {
      const oriented = createOrientedGroup(group, states, "north");
      const ladder = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1), mats[4] || mats[2]);
      ladder.position.set(0, 0, -0.47);
      ladder.castShadow = true;
      oriented.add(ladder);
      return;
    }
    case "sign": {
      const standing = id.includes("standing") || id === "sign" || id.includes("oak_sign");
      const sign = new THREE.Group();
      if (standing) {
        const rotation = Number(states.ground_sign_direction ?? states.ground_sign_rotation ?? 0);
        sign.rotation.y = (Number.isFinite(rotation) ? rotation : 0) * Math.PI / 8;
      } else {
        sign.rotation.y = yawForFacing(blockFacing(states, "north"));
      }
      group.add(sign);
      addBox(sign, mats, 0.06, 0.48, standing ? 0.08 : 0.42, 0.88, 0.42, 0.06);
      if (standing) addBox(sign, mats, 0.46, 0.02, 0.46, 0.08, 0.48, 0.08);
      return;
    }
    case "bed":
      addBox(group, mats, 0.05, 0.22, 0.05, 0.9, 0.32, 0.9);
      addBox(group, mats, 0.05, 0.52, 0.05, 0.9, 0.1, 0.9); return;
    case "chain": addBox(group, mats, 0.43, 0, 0.43, 0.14, 1, 0.14); return;
    case "lantern":
      addBox(group, mats, 0.18, 0.22, 0.18, 0.64, 0.58, 0.64);
      addBox(group, mats, 0.38, 0.82, 0.38, 0.24, 0.12, 0.24); return;
    case "cactus": addBox(group, mats, 0.07, 0, 0.07, 0.86, 0.94, 0.86); return;
    case "anvil":
      addBox(group, mats, 0.25, 0.02, 0.25, 0.5, 0.18, 0.5);
      addBox(group, mats, 0.38, 0.2, 0.38, 0.24, 0.42, 0.24);
      addBox(group, mats, 0.12, 0.62, 0.12, 0.76, 0.2, 0.76); return;
    case "bell":
      addBox(group, mats, 0.22, 0.24, 0.22, 0.56, 0.58, 0.56);
      addBox(group, mats, 0.1, 0.84, 0.1, 0.8, 0.1, 0.8); return;
    case "composter":
      addBox(group, mats, 0.06, 0, 0.06, 0.12, 0.85, 0.88);
      addBox(group, mats, 0.82, 0, 0.06, 0.12, 0.85, 0.88);
      addBox(group, mats, 0.18, 0, 0.06, 0.64, 0.85, 0.12);
      addBox(group, mats, 0.18, 0, 0.82, 0.64, 0.85, 0.12); return;
    case "lectern":
      addBox(group, mats, 0.12, 0, 0.12, 0.76, 0.16, 0.76);
      addBox(group, mats, 0.38, 0.16, 0.38, 0.24, 0.58, 0.24);
      addBox(group, mats, 0.08, 0.74, 0.08, 0.84, 0.16, 0.84); return;
    case "grindstone":
      addBox(group, mats, 0.12, 0.06, 0.4, 0.76, 0.12, 0.2);
      addBox(group, mats, 0.38, 0.18, 0.42, 0.24, 0.62, 0.16);
      addBox(group, mats, 0.28, 0.58, 0.22, 0.44, 0.12, 0.56); return;
    case "container": {
      const oriented = createOrientedGroup(group, states, "north");
      const isBarrel = id.includes("barrel");
      const isShulker = id.includes("shulker");
      if (isBarrel) {
        addBox(oriented, mats, 0.0625, 0.0625, 0.0625, 0.875, 0.8125, 0.875);
        addBox(oriented, mats, 0.0625, 0.875, 0.0625, 0.875, 0.0625, 0.875);
      } else if (isShulker) {
        addBox(oriented, mats, 0.0625, 0.0625, 0.0625, 0.875, 0.875, 0.875);
      } else {
        // Chest base, lid and front latch follow the 14×10×14 + 14×4×14
        // in-game proportions; each face keeps its own Mojang texture alias.
        addBox(oriented, mats, 0.0625, 0.0625, 0.0625, 0.875, 0.625, 0.875);
        addBox(oriented, mats, 0.0625, 0.6875, 0.0625, 0.875, 0.25, 0.875);
        addBox(oriented, mats, 0.4375, 0.625, 0.0, 0.125, 0.1875, 0.0625);
      }
      return;
    }
    case "hopper":
      addBox(group, mats, 0.08, 0.35, 0.08, 0.84, 0.18, 0.84);
      addBox(group, mats, 0.35, 0.08, 0.35, 0.3, 0.28, 0.3); return;
    case "head": addBox(group, mats, 0.2, 0.2, 0.2, 0.6, 0.6, 0.6); return;
    case "cake": addBox(group, mats, 0.06, 0, 0.06, 0.88, 0.5, 0.88); return;
    case "candle":
      addBox(group, mats, 0.43, 0.08, 0.43, 0.14, 0.72, 0.14);
      addBox(group, mats, 0.47, 0.8, 0.47, 0.06, 0.08, 0.06); return;
    case "scaffolding":
      addBox(group, mats, 0.08, 0.03, 0.08, 0.84, 0.08, 0.84);
      addBox(group, mats, 0.08, 0.88, 0.08, 0.84, 0.08, 0.84);
      addBox(group, mats, 0.12, 0.08, 0.12, 0.08, 0.8, 0.08);
      addBox(group, mats, 0.8, 0.08, 0.12, 0.08, 0.8, 0.08);
      addBox(group, mats, 0.12, 0.08, 0.8, 0.08, 0.8, 0.08);
      addBox(group, mats, 0.8, 0.08, 0.8, 0.08, 0.8, 0.08); return;
    case "dripstone":
      addBox(group, mats, 0.42, 0, 0.42, 0.16, 0.4, 0.16);
      addBox(group, mats, 0.36, 0.35, 0.36, 0.28, 0.36, 0.28);
      addBox(group, mats, 0.44, 0.68, 0.44, 0.12, 0.28, 0.12); return;
    case "cluster":
      addBox(group, mats, 0.32, 0.12, 0.32, 0.36, 0.76, 0.36);
      addBox(group, mats, 0.18, 0.25, 0.18, 0.18, 0.5, 0.18);
      addBox(group, mats, 0.64, 0.25, 0.64, 0.18, 0.5, 0.18); return;
    case "egg": addBox(group, mats, 0.22, 0.08, 0.22, 0.56, 0.4, 0.56); return;
    default: addBox(group, mats, 0, 0, 0, 1, 1, 1);
  }
}

function blockbenchOriginForCell(x, y, z) {
  // Bedrock Blockbench block coordinates: X/Z are centered on the block
  // footprint, while Y=0 is the bottom face of the base block.
  return {
    // Blockbench's Bedrock block origin is the bottom-centre of a 16px cell.
    x: (x - (currentSize.x - 1) / 2) * BLOCK_PIXELS,
    y: y * BLOCK_PIXELS,
    z: (z - (currentSize.z - 1) / 2) * BLOCK_PIXELS
  };
}
function positionBlockGroup(group, x, y, z) {
  const origin = blockbenchOriginForCell(x, y, z);
  group.scale.setScalar(BLOCK_PIXELS);
  group.position.set(origin.x, origin.y + BLOCK_PIXELS / 2, origin.z);
}
function createPlacedBlock(record) {
  const group = new THREE.Group();
  group.userData.cell = { x: record.x, y: record.y, z: record.z, key: cellKey(record.x, record.y, record.z) };
  positionBlockGroup(group, record.x, record.y, record.z);
  createBlockModel(group, record);
  const hitbox = new THREE.Mesh(boxGeometry(1, 1, 1), hitMaterial);
  hitbox.userData.isHitbox = true;
  hitbox.userData.cell = group.userData.cell;
  group.add(hitbox);
  worldGroup.add(group);
  record.group = group;
  record.hitbox = hitbox;
  blockHitTargets.push(hitbox);
}
function setPlacedSelectionHighlight(key) {
  const previous = placedBlocks.get(highlightedPlacedKey);
  if (previous?.selectionOutline) {
    previous.group?.remove(previous.selectionOutline);
    previous.selectionOutline.geometry.dispose();
    previous.selectionOutline.material.dispose();
    previous.selectionOutline = null;
  }
  highlightedPlacedKey = null;
  if (!key) return;
  const record = placedBlocks.get(key);
  if (!record?.group) return;
  const sourceGeometry = new THREE.BoxGeometry(1.035, 1.035, 1.035);
  const geometry = new THREE.EdgesGeometry(sourceGeometry);
  sourceGeometry.dispose();
  const material = new THREE.LineBasicMaterial({ color: 0xf0d37a, transparent: true, opacity: 0.95 });
  const outline = new THREE.LineSegments(geometry, material);
  outline.renderOrder = 10;
  record.group.add(outline);
  record.selectionOutline = outline;
  highlightedPlacedKey = key;
}
function rebuildPlacedBlock(key) {
  const record = placedBlocks.get(key);
  if (!record) return;
  if (record.selectionOutline) {
    record.selectionOutline.geometry.dispose();
    record.selectionOutline.material.dispose();
    record.selectionOutline = null;
  }
  if (highlightedPlacedKey === key) highlightedPlacedKey = null;
  if (record.group) worldGroup.remove(record.group);
  blockHitTargets = blockHitTargets.filter((target) => target !== record.hitbox);
  createPlacedBlock(record);
  if (activePlacedBlockKey === key) setPlacedSelectionHighlight(key);
}
function refreshConnectedModelsNear(x, y, z) {
  const offsets = [[0,0],[0,-1],[0,1],[-1,0],[1,0]];
  const rebuild = new Set();
  for (const [dx, dz] of offsets) {
    const key = cellKey(x + dx, y, z + dz);
    const record = placedBlocks.get(key);
    if (record && ["fence","pane","wall"].includes(record.model || modelTypeForBlock(record.id))) rebuild.add(key);
  }
  for (const key of rebuild) rebuildPlacedBlock(key);
}
function removePlacedBlock(key) {
  const record = placedBlocks.get(key);
  if (!record) return false;
  worldGroup.remove(record.group);
  blockHitTargets = blockHitTargets.filter((target) => target !== record.hitbox);
  if (record.selectionOutline) {
    record.selectionOutline.geometry.dispose();
    record.selectionOutline.material.dispose();
    record.selectionOutline = null;
  }
  if (highlightedPlacedKey === key) highlightedPlacedKey = null;
  placedBlocks.delete(key);
  if (!placedBlocks.size) resetCamera();
  if (activePlacedBlockKey === key) {
    activePlacedBlockKey = null;
    setPlacedSelectionHighlight(null);
    if (canvasMode === "select") showStatePrompt("The selected block was removed. Tap another placed block to edit its states.");
  } else if (highlightedPlacedKey === key) {
    setPlacedSelectionHighlight(null);
  }
  updateUsedCount(record.id);
  updateBuildSummary();
  return true;
}
function placeBlock(x, y, z) {
  if (!selectedBlock) return setStatus("Select a block from the table first.", "error");
  const isDoor = selectedBlock.model === "door";
  const cells = isDoor
    ? [{ x, y, z, upper: false }, { x, y: y + 1, z, upper: true }]
    : [{ x, y, z, upper: false }];

  for (const cell of cells) {
    if (!isInsideWorkspace(cell.x, cell.y, cell.z)) {
      return setStatus(isDoor
        ? "A door needs two free vertical cells. Move it down one block or increase workspace height."
        : `Position ${cell.x}, ${cell.y}, ${cell.z} is outside the workspace. Increase the workspace dimensions.`, "error");
    }
    const key = cellKey(cell.x, cell.y, cell.z);
    if (placedBlocks.has(key)) return setStatus(`Cell ${key} is occupied. Click another block face or right-click to remove it.`);
  }
  if (placedBlocks.size + cells.length > MAX_PLACED_BLOCKS) {
    return setStatus(`The editor limit is ${MAX_PLACED_BLOCKS.toLocaleString()} placed blocks.`, "error");
  }

  const baseStates = { ...appliedStateOverrides };
  delete baseStates["minecraft:upper_block_bit"];
  delete baseStates.upper_block_bit;
  const records = cells.map((cell) => {
    const states = { ...baseStates };
    if (isDoor) states.upper_block_bit = cell.upper;
    return {
      id: selectedBlock.id, name: selectedBlock.name,
      x: cell.x, y: cell.y, z: cell.z, states, model: selectedBlock.model,
      customModelKey: selectedBlock.customModelKey || null
    };
  });
  // Register all cells before creating geometry so connection-aware models can
  // see every newly placed neighbor in the same placement operation.
  for (const record of records) placedBlocks.set(cellKey(record.x, record.y, record.z), record);
  for (const record of records) {
    createPlacedBlock(record);
    updateUsedCount(record.id);
  }
  for (const record of records) refreshConnectedModelsNear(record.x, record.y, record.z);
  updateSelectedBlockDisplay(selectedBlock, records[0]);
  updateBuildSummary();
  if (placedBlocks.size === records.length) resetCamera();
  setStatus(isDoor
    ? `Placed the two-block ${selectedBlock.name} at ${x}, ${y}, ${z}.`
    : `Placed ${selectedBlock.name} at ${x}, ${y}, ${z}.`, "success");
}
function removeBlockAt(x, y, z) {
  const key = cellKey(x, y, z);
  const record = placedBlocks.get(key);
  if (!record) return;
  const keysToRemove = [key];
  if (record.model === "door") {
    const isUpper = record.states?.upper_block_bit === true;
    const mateY = isUpper ? y - 1 : y + 1;
    const mateKey = cellKey(x, mateY, z);
    const mate = placedBlocks.get(mateKey);
    if (mate?.id === record.id && mate.model === "door") keysToRemove.push(mateKey);
  }
  for (const removeKey of keysToRemove) removePlacedBlock(removeKey);
  if (keysToRemove.includes(activePlacedBlockKey)) {
    activePlacedBlockKey = null;
    setPlacedSelectionHighlight(null);
    if (selectedBlock) updateSelectedBlockDisplay(selectedBlock);
  }
  for (const removeKey of keysToRemove) {
    const [removedX, removedY, removedZ] = removeKey.split(",").map(Number);
    refreshConnectedModelsNear(removedX, removedY, removedZ);
  }
  setStatus(record.model === "door"
    ? `Removed the two-block ${record.name} at ${x}, ${y}, ${z}.`
    : `Removed ${record.name} at ${x}, ${y}, ${z}.`);
}
function eventToRay(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function targetCellFromIntersection(intersection) {
  const object = intersection.object;
  if (object.userData?.isHitbox) {
    const cell = object.userData.cell;
    // Transform a direction, not a normal matrix with inverse scale, because
    // each rendered block group is scaled from block units to 16px model units.
    const normal = intersection.face.normal.clone().transformDirection(object.matrixWorld);
    const step = { x: Math.round(normal.x), y: Math.round(normal.y), z: Math.round(normal.z) };
    return { x: cell.x + step.x, y: cell.y + step.y, z: cell.z + step.z };
  }
  const point = intersection.point;
  const x = Math.floor(point.x / BLOCK_PIXELS + currentSize.x / 2 + 1e-7);
  const z = Math.floor(point.z / BLOCK_PIXELS + currentSize.z / 2 + 1e-7);
  return {
    x: Math.max(0, Math.min(currentSize.x - 1, x)),
    y: 0,
    z: Math.max(0, Math.min(currentSize.z - 1, z))
  };
}
function handleCanvasAction(event, remove = false) {
  if (!renderer || !camera || !groundPlane) return;
  eventToRay(event);
  const intersections = raycaster.intersectObjects([...blockHitTargets, groundPlane], false);
  if (!intersections.length) return;
  const hit = intersections[0];
  if (remove) {
    if (hit.object.userData?.isHitbox) {
      const cell = hit.object.userData.cell;
      removeBlockAt(cell.x, cell.y, cell.z);
    }
    return;
  }
  if (canvasMode === "select") {
    if (hit.object.userData?.isHitbox) {
      const cell = hit.object.userData.cell;
      const record = placedBlocks.get(cell.key || cellKey(cell.x, cell.y, cell.z));
      if (record) selectPlacedBlock(record);
    } else {
      setStatus("Select mode: tap a placed block to inspect and edit its Bedrock states.");
    }
    return;
  }
  const target = targetCellFromIntersection(hit);
  placeBlock(target.x, target.y, target.z);
}
function buildWorkspaceHelpers() {
  if (groundPlane) { worldGroup.remove(groundPlane); groundPlane.geometry.dispose(); groundPlane.material.dispose(); }
  if (gridHelper) { worldGroup.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper.material.dispose(); }
  if (boundsLines) { worldGroup.remove(boundsLines); boundsLines.geometry.dispose(); boundsLines.material.dispose(); }
  const gridSize = Math.max(currentSize.x, currentSize.z);
  const groundY = -0.03;
  groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(currentSize.x * BLOCK_PIXELS, currentSize.z * BLOCK_PIXELS),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = groundY;
  worldGroup.add(groundPlane);
  // One grid division equals one 16px Minecraft block.
  gridHelper = new THREE.GridHelper(gridSize * BLOCK_PIXELS, Math.min(gridSize, 128), 0x627570, 0x38474a);
  gridHelper.position.y = 0.025;
  worldGroup.add(gridHelper);
  const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(
    currentSize.x * BLOCK_PIXELS,
    currentSize.y * BLOCK_PIXELS,
    currentSize.z * BLOCK_PIXELS
  ));
  boundsLines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x78918a, transparent: true, opacity: 0.28 }));
  boundsLines.position.y = currentSize.y * BLOCK_PIXELS / 2;
  worldGroup.add(boundsLines);
}
function updateBlockPositions() {
  for (const record of placedBlocks.values()) positionBlockGroup(record.group, record.x, record.y, record.z);
}
function resetCamera() {
  if (!camera || !controls) return;

  let target = new THREE.Vector3(0, currentSize.y * BLOCK_PIXELS / 2, 0);
  let fitSpan = Math.max(currentSize.x, currentSize.y, currentSize.z) * BLOCK_PIXELS;

  if (placedBlocks.size) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const record of placedBlocks.values()) {
      minX = Math.min(minX, record.x);
      minY = Math.min(minY, record.y);
      minZ = Math.min(minZ, record.z);
      maxX = Math.max(maxX, record.x);
      maxY = Math.max(maxY, record.y);
      maxZ = Math.max(maxZ, record.z);
    }

    target.set(
      ((minX + maxX) / 2 - (currentSize.x - 1) / 2) * BLOCK_PIXELS,
      (minY + maxY + 1) / 2 * BLOCK_PIXELS,
      ((minZ + maxZ) / 2 - (currentSize.z - 1) / 2) * BLOCK_PIXELS
    );

    fitSpan = Math.max(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1) * BLOCK_PIXELS;
  }

  const aspect = Math.max(0.35, camera.aspect || 1);
  const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const distance = Math.max(
    fitSpan / (2 * Math.tan(halfFov)) * Math.max(1, 1 / aspect) * 1.5,
    fitSpan * 1.4,
    BLOCK_PIXELS * 2.2
  );
  const direction = new THREE.Vector3(1, 0.78, 1).normalize();

  camera.position.copy(target).addScaledVector(direction, distance);
  controls.target.copy(target);
  camera.near = 0.1;
  camera.far = Math.max(4000, distance * 8);
  camera.updateProjectionMatrix();
  controls.update();
}
function updateDimensions() {
  const next = currentSizeFromInputs();
  if (Object.values(next).some((value) => !Number.isInteger(value) || value < 1 || value > 128)) {
    ui.sizeX.value = currentSize.x; ui.sizeY.value = currentSize.y; ui.sizeZ.value = currentSize.z;
    return setStatus("Workspace dimensions must be whole numbers from 1 to 128.", "error");
  }
  if (next.x * next.y * next.z > MAX_STRUCTURE_VOLUME) {
    ui.sizeX.value = currentSize.x; ui.sizeY.value = currentSize.y; ui.sizeZ.value = currentSize.z;
    return setStatus(`Workspace volume exceeds ${MAX_STRUCTURE_VOLUME.toLocaleString()} cells.`, "error");
  }
  currentSize = next;
  let removed = 0;
  for (const [key, record] of [...placedBlocks.entries()]) {
    if (!isInsideWorkspace(record.x, record.y, record.z)) {
      if (key === activePlacedBlockKey) {
        activePlacedBlockKey = null;
        setPlacedSelectionHighlight(null);
      }
      removePlacedBlock(key);
      removed += 1;
    }
  }
  buildWorkspaceHelpers();
  updateBlockPositions();
  if (selectedBlock) {
    const activeRecord = activePlacedBlockKey ? placedBlocks.get(activePlacedBlockKey) : null;
    updateSelectedBlockDisplay(selectedBlock, activeRecord || null);
  }
  resetCamera();
  updateBuildSummary();
  setStatus(removed ? `Workspace resized. ${removed} out-of-bounds block(s) were removed.` : "Workspace dimensions updated.", removed ? "normal" : "success");
}
function clearBuild() {
  if (!placedBlocks.size) return;
  const ids = new Set([...placedBlocks.values()].map((block) => block.id));
  setPlacedSelectionHighlight(null);
  activePlacedBlockKey = null;
  for (const record of placedBlocks.values()) worldGroup.remove(record.group);
  placedBlocks.clear(); blockHitTargets = [];
  resetCamera();
  if (selectedBlock) updateSelectedBlockDisplay(selectedBlock);
  if (canvasMode === "select") showStatePrompt("The workspace is empty. Switch to Build mode and place blocks first.");
  else if (selectedBlock) renderBlockStateControls(selectedBlock.id, appliedStateOverrides, false);
  ids.forEach(updateUsedCount);
  updateBuildSummary();
  setStatus("Structure cleared. Choose a block to start again.");
}
function initializeRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(ui.viewport.clientWidth, ui.viewport.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x182126, 0);
  renderer.domElement.setAttribute("aria-label", "Interactive Bedrock block building canvas");
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  ui.viewport.append(renderer.domElement);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x20292d, 35 * BLOCK_PIXELS, 100 * BLOCK_PIXELS);
  camera = new THREE.PerspectiveCamera(43, Math.max(1, ui.viewport.clientWidth / ui.viewport.clientHeight), 0.1, 20000);
  camera.position.set(22 * BLOCK_PIXELS, 18 * BLOCK_PIXELS, 22 * BLOCK_PIXELS);
  scene.add(new THREE.HemisphereLight(0xe5f2ff, 0x39413c, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(12 * BLOCK_PIXELS, 26 * BLOCK_PIXELS, 18 * BLOCK_PIXELS); scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8cdbd, 0.65); fill.position.set(-18 * BLOCK_PIXELS, 8 * BLOCK_PIXELS, -12 * BLOCK_PIXELS); scene.add(fill);
  worldGroup = new THREE.Group(); scene.add(worldGroup); buildWorkspaceHelpers();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.screenSpacePanning = true; controls.minDistance = BLOCK_PIXELS; controls.maxDistance = 12000;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || event.isPrimary) {
      pointerStart = {
        x: event.clientX, y: event.clientY, button: event.button,
        pointerId: event.pointerId, pointerType: event.pointerType,
        startedAt: performance.now()
      };
    }
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!pointerStart || pointerStart.pointerId !== event.pointerId || pointerStart.button !== event.button) return;
    const start = pointerStart;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const heldFor = performance.now() - start.startedAt;
    pointerStart = null;
    if (moved > 5) return;
    if (event.button === 2) handleCanvasAction(event, true);
    else if (event.button === 0 && start.pointerType === "touch" && heldFor >= 480) {
      handleCanvasAction(event, true);
    } else if (event.button === 0) {
      handleCanvasAction(event, false);
    }
  });
  renderer.domElement.addEventListener("pointercancel", () => { pointerStart = null; });
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera) return;
    const width = Math.max(1, ui.viewport.clientWidth);
    const height = Math.max(1, ui.viewport.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
  });
  resizeObserver.observe(ui.viewport);
  const animate = () => { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
  animate(); resetCamera();
}

function makeTag(type, value) { return { type, value }; }
function makeList(elementType, values) { return { type: "list", value: { type: elementType, value: values } }; }
function stateTagsFor(states) {
  const tags = {};
  for (const [key, value] of Object.entries(states || {})) {
    if (typeof value === "boolean") tags[key] = makeTag("byte", value ? 1 : 0);
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`Block state ${key} is not a finite number.`);
      tags[key] = makeTag(Number.isInteger(value) ? "int" : "float", value);
    } else if (typeof value === "string") tags[key] = makeTag("string", value);
    else throw new Error(`Block state ${key} must be a string, number, or boolean.`);
  }
  return tags;
}
function buildMcstructureNbt() {
  const size = [currentSize.x, currentSize.y, currentSize.z];
  const volume = size[0] * size[1] * size[2];
  if (volume > MAX_STRUCTURE_VOLUME) throw new Error("Structure dimensions exceed the supported cell limit.");
  const palette = []; const lookup = new Map();
  const addPaletteEntry = (record) => {
    const signature = JSON.stringify([record.name, record.states || {}]);
    if (lookup.has(signature)) return lookup.get(signature);
    const index = palette.length; lookup.set(signature, index);
    palette.push({ name: record.name, states: record.states || {}, version: DEFAULT_BLOCK_VERSION });
    return index;
  };
  const airIndex = addPaletteEntry({ name: "minecraft:air", states: {} });
  const primary = new Array(volume).fill(airIndex);
  for (const record of placedBlocks.values()) {
    const index = (record.x * size[1] + record.y) * size[2] + record.z;
    primary[index] = /(^|:)structure_void$/.test(record.name || record.id)
      ? -1
      : addPaletteEntry(record);
  }
  const paletteTags = palette.map((entry) => ({
    name: makeTag("string", entry.name),
    states: makeTag("compound", stateTagsFor(entry.states)),
    version: makeTag("int", entry.version)
  }));
  return {
    type: "compound", name: "",
    value: {
      format_version: makeTag("int", 2),
      size: makeList("int", size),
      structure: makeTag("compound", {
        block_indices: makeList("intArray", [primary]),
        entities: makeList("compound", []),
        palette: makeTag("compound", {
          default: makeTag("compound", {
            block_palette: makeList("compound", paletteTags),
            block_position_data: makeTag("compound", {})
          })
        })
      }),
      structure_world_origin: makeList("int", [
        Number.parseInt(ui.originX.value || "0", 10) || 0,
        Number.parseInt(ui.originY.value || "0", 10) || 0,
        Number.parseInt(ui.originZ.value || "0", 10) || 0
      ])
    }
  };
}
// Command exports preserve the states explicitly selected in the editor.
function encodeBlockStates(states) {
  const entries = Object.entries(states || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  return "[" + entries.map(([key, value]) => {
    const encoded = typeof value === "string" ? JSON.stringify(value) :
      typeof value === "boolean" ? (value ? "true" : "false") : String(value);
    return `${JSON.stringify(key)}=${encoded}`;
  }).join(", ") + "]";
}
function outputCoordinate(value, axis) {
  if (ui.coordinateMode.value === "absolute") {
    const input = axis === 0 ? ui.originX : axis === 1 ? ui.originY : ui.originZ;
    return String((Number.parseInt(input.value || "0", 10) || 0) + value);
  }
  return value === 0 ? "~" : `~${value}`;
}
function generateMcfunction() {
  const rows = new Map();
  const blocks = [...placedBlocks.values()].filter((block) => ui.includeAir.checked || block.id !== "air");
  if (!blocks.length) throw new Error("There are no placed blocks to export.");
  for (const block of blocks) {
    const key = `${block.y},${block.z}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(block);
  }
  const commands = [];
  const sortedRows = [...rows.entries()].sort((a, b) => {
    const [ay, az] = a[0].split(",").map(Number);
    const [by, bz] = b[0].split(",").map(Number);
    return ay - by || az - bz;
  });
  for (const [, row] of sortedRows) {
    row.sort((a, b) => a.x - b.x);
    let index = 0;
    while (index < row.length) {
      const start = row[index];
      const signature = JSON.stringify([start.name, start.states || {}]);
      let end = index;
      while (end + 1 < row.length && row[end + 1].x === row[end].x + 1 &&
        JSON.stringify([row[end + 1].name, row[end + 1].states || {}]) === signature) end += 1;
      if (ui.useFill.checked && end > index) {
        const last = row[end];
        commands.push(`fill ${outputCoordinate(start.x,0)} ${outputCoordinate(start.y,1)} ${outputCoordinate(start.z,2)} ${outputCoordinate(last.x,0)} ${outputCoordinate(last.y,1)} ${outputCoordinate(last.z,2)} ${start.name}${encodeBlockStates(start.states)}`);
      } else {
        for (let i = index; i <= end; i += 1) {
          const block = row[i];
          commands.push(`setblock ${outputCoordinate(block.x,0)} ${outputCoordinate(block.y,1)} ${outputCoordinate(block.z,2)} ${block.name}${encodeBlockStates(block.states)}`);
        }
      }
      index = end + 1;
    }
  }
  const origin = [ui.originX.value || 0, ui.originY.value || 0, ui.originZ.value || 0];
  return [
    "# Generated by Bedrock Voxel Builder",
    `# Workspace: ${currentSize.x} x ${currentSize.y} x ${currentSize.z}`,
    `# Origin: ${origin.join(", ")}`,
    "# Relative coordinates are anchored to the function execution position.",
    "", ...commands
  ].join("\n") + "\n";
}
function getNbtLibrary() {
  if (!nbtLibraryPromise) {
    nbtLibraryPromise = import("buffer")
      .then((bufferModule) => {
        const BufferPolyfill = bufferModule.Buffer || bufferModule.default?.Buffer;
        if (!BufferPolyfill) throw new Error("The browser Buffer compatibility module did not load.");
        if (!globalThis.Buffer) globalThis.Buffer = BufferPolyfill;
        return import("prismarine-nbt");
      })
      .then((module) => module.default || module);
  }
  return nbtLibraryPromise;
}
function importTagValue(tag) {
  if (tag && typeof tag === "object" && Object.prototype.hasOwnProperty.call(tag, "value")) return tag.value;
  return tag;
}
function importListValues(tag) {
  const value = importTagValue(tag);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value);
  if (value && (Array.isArray(value.value) || ArrayBuffer.isView(value.value))) return Array.from(value.value);
  if (value?.value && (Array.isArray(value.value.value) || ArrayBuffer.isView(value.value.value))) return Array.from(value.value.value);
  return [];
}
function importCompoundValue(tag) {
  const value = importTagValue(tag);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function importScalar(tag, fallback) {
  const value = importTagValue(tag);
  return value === undefined || value === null ? fallback : value;
}
function importStateTag(tag) {
  const value = importScalar(tag);
  if (tag?.type === "byte") return Boolean(value);
  if (["short", "int", "long", "float", "double"].includes(tag?.type)) return Number(value);
  return value;
}
function isOrdinaryAir(name) {
  return /(^|:)(air|cave_air|void_air)$/.test(String(name || "").toLowerCase());
}
function validateImportedSize(size) {
  if (!Array.isArray(size) || size.length !== 3) throw new Error("The imported structure has no valid three-axis size.");
  const values = size.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 128)) {
    throw new Error("Imported dimensions must be whole numbers from 1 to 128 on each axis.");
  }
  const volume = values[0] * values[1] * values[2];
  if (!Number.isSafeInteger(volume) || volume > MAX_STRUCTURE_VOLUME) {
    throw new Error("The imported structure exceeds the editor's 1,000,000-cell workspace limit.");
  }
  return values;
}
async function parseImportedMcstructure(arrayBuffer, fileName) {
  const nbt = await getNbtLibrary();
  const parsedResult = await nbt.parse(arrayBuffer, "little");
  const root = importCompoundValue(parsedResult?.parsed || parsedResult);
  if (!root.format_version || !root.size || !root.structure) {
    throw new Error("This .mcstructure is missing required format_version, size, or structure data.");
  }
  const version = Number(importScalar(root.format_version, 0));
  if (version !== 1 && version !== 2) throw new Error("Unsupported .mcstructure format version: " + version + ". Supported versions are 1 and 2.");
  const size = validateImportedSize(importListValues(root.size));
  const volume = size[0] * size[1] * size[2];
  const structure = importCompoundValue(root.structure);
  const layers = importListValues(structure.block_indices);
  if (!layers.length || layers.length > 2 || (version === 1 && layers.length !== 2)) {
    throw new Error("The .mcstructure must contain the required block-index layer data.");
  }
  const primary = importListValues(layers[0]).map(Number);
  const secondary = layers[1] === undefined ? new Array(volume).fill(-1) : importListValues(layers[1]).map(Number);
  if (primary.length !== volume || secondary.length !== volume) {
    throw new Error("The .mcstructure block-index data does not match its declared dimensions (primary " + primary.length + ", secondary " + secondary.length + ", expected " + volume + ", layers " + layers.length + ").");
  }
  const paletteRoot = importCompoundValue(structure.palette);
  const defaultPalette = importCompoundValue(paletteRoot.default);
  const rawPalette = importListValues(defaultPalette.block_palette);
  if (!rawPalette.length) throw new Error("The .mcstructure default block palette is empty.");
  const palette = rawPalette.map((rawEntry, index) => {
    const entry = importCompoundValue(rawEntry);
    const name = String(importScalar(entry.name, ""));
    if (!name) throw new Error("Block palette entry " + index + " has no block identifier.");
    const stateTags = importCompoundValue(entry.states);
    const states = {};
    for (const [key, value] of Object.entries(stateTags)) states[key] = importStateTag(value);
    return { name: name.includes(":") ? name : "minecraft:" + name, states };
  });
  const blocks = [];
  let secondaryConflicts = 0;
  for (let index = 0; index < volume; index += 1) {
    const primaryIndex = primary[index];
    const secondaryIndex = secondary[index];
    if (primaryIndex < -1 || primaryIndex >= palette.length || secondaryIndex < -1 || secondaryIndex >= palette.length) {
      throw new Error("The .mcstructure contains a block palette index outside the palette.");
    }
    const first = primaryIndex >= 0 ? palette[primaryIndex] : null;
    const second = secondaryIndex >= 0 ? palette[secondaryIndex] : null;
    let block = first;
    if ((!block || isOrdinaryAir(block.name)) && second && !isOrdinaryAir(second.name)) block = second;
    else if (block && !isOrdinaryAir(block.name) && second && !isOrdinaryAir(second.name)) secondaryConflicts += 1;
    if (!block && primaryIndex === -1 && secondaryIndex === -1) {
      block = { name: "minecraft:structure_void", states: {} };
    }
    if (!block || isOrdinaryAir(block.name)) continue;
    const x = Math.floor(index / (size[1] * size[2]));
    const y = Math.floor((index % (size[1] * size[2])) / size[2]);
    const z = index % size[2];
    blocks.push({ x, y, z, name: block.name, states: { ...(block.states || {}) } });
    if (blocks.length > MAX_PLACED_BLOCKS) {
      throw new Error("This file contains more than " + MAX_PLACED_BLOCKS.toLocaleString() + " non-air blocks. The editor import limit is " + MAX_PLACED_BLOCKS.toLocaleString() + ".");
    }
  }
  if (!blocks.length) throw new Error("This .mcstructure contains no visible or editable blocks to import.");
  const warnings = [];
  if (secondaryConflicts) warnings.push(secondaryConflicts.toLocaleString() + " cells contain two non-air block layers; only the primary layer was imported in those cells.");
  const entityCount = importListValues(structure.entities).length;
  const positionData = importCompoundValue(defaultPalette.block_position_data);
  if (entityCount) warnings.push(entityCount.toLocaleString() + " entity record(s) were not imported; this editor places blocks only.");
  if (Object.keys(positionData).length) warnings.push("Block-position data such as container contents was not imported.");
  const origin = importListValues(root.structure_world_origin).map((value) => Number(value) || 0);
  return { size, blocks, warnings, origin, coordinateMode: "relative", fileName, kind: "mcstructure" };
}
function splitImportStatePairs(value, delimiter) {
  const parts = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      current += character;
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
      continue;
    }
    if (character === delimiter && !quote) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
function tokenizeImportCommand(line) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;
  let bracketDepth = 0;
  for (const character of line.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      current += character;
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
      continue;
    }
    if (!quote && character === "[") bracketDepth += 1;
    if (!quote && character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (/\s/.test(character) && !quote && bracketDepth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}
function importUnquote(value) {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/\\'/g, "'");
  return text;
}
function parseImportStateValue(raw) {
  const value = raw.trim();
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return importUnquote(value);
}
function parseImportStateArray(raw) {
  if (!raw || raw === "[]") return {};
  if (!raw.startsWith("[") || !raw.endsWith("]")) throw new Error("Block states must use square brackets.");
  const states = {};
  for (const pair of splitImportStatePairs(raw.slice(1, -1), ",")) {
    const split = pair.indexOf("=");
    if (split < 1) throw new Error("Invalid block state pair: " + pair);
    const key = importUnquote(pair.slice(0, split));
    if (!key) throw new Error("A block state is missing its name.");
    states[key] = parseImportStateValue(pair.slice(split + 1));
  }
  return states;
}
function parseImportBlockToken(token, followingToken) {
  let name = token;
  let stateToken = "";
  const bracketIndex = token.indexOf("[");
  if (bracketIndex >= 0) {
    name = token.slice(0, bracketIndex);
    stateToken = token.slice(bracketIndex);
  }
  if (!stateToken && followingToken?.startsWith("[")) stateToken = followingToken;
  name = name.trim();
  if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/i.test(name)) throw new Error("Invalid block identifier: " + name);
  if (!name.includes(":")) name = "minecraft:" + name;
  return { name, states: stateToken ? parseImportStateArray(stateToken) : {} };
}
function parseImportCoordinate(token) {
  if (token.startsWith("^")) throw new Error("Local (^) coordinates cannot be imported without the command executor's rotation.");
  if (token.startsWith("~")) {
    const offset = token.slice(1);
    if (!offset) return { value: 0, relative: true };
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(offset)) throw new Error("Invalid relative coordinate: " + token);
    return { value: Math.floor(Number(offset)), relative: true };
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(token)) throw new Error("Invalid coordinate: " + token);
  return { value: Math.floor(Number(token)), relative: false };
}
function parseImportedMcfunction(source, fileName) {
  const placed = new Map();
  const warnings = [];
  let workspace = null;
  let origin = [0, 0, 0];
  let ignored = 0;
  let relativeCoordinates = 0;
  let absoluteCoordinates = 0;
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const trimmed = lines[lineIndex].trim();
    if (!trimmed) continue;
    const workspaceMatch = trimmed.match(/^#\s*Workspace:\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i);
    if (workspaceMatch) workspace = workspaceMatch.slice(1).map(Number);
    const originMatch = trimmed.match(/^#\s*Origin:\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i);
    if (originMatch) origin = originMatch.slice(1).map(Number);
    if (trimmed.startsWith("#")) continue;
    const tokens = tokenizeImportCommand(trimmed);
    if (!tokens.length) continue;
    const command = tokens[0].replace(/^\//, "").toLowerCase();
    const put = (x, y, z, block) => {
      const key = cellKey(x, y, z);
      if (isOrdinaryAir(block.name)) placed.delete(key);
      else placed.set(key, { x, y, z, name: block.name, states: { ...(block.states || {}) } });
      if (placed.size > MAX_PLACED_BLOCKS) throw new Error("The function exceeds the " + MAX_PLACED_BLOCKS.toLocaleString() + " placed-block import limit.");
    };
    try {
      if (command === "setblock") {
        if (tokens.length < 5) throw new Error("setblock needs three coordinates and a block identifier.");
        const coordinates = tokens.slice(1, 4).map(parseImportCoordinate);
        relativeCoordinates += coordinates.filter((item) => item.relative).length;
        absoluteCoordinates += coordinates.filter((item) => !item.relative).length;
        const block = parseImportBlockToken(tokens[4], tokens[5]);
        const modeIndex = tokens[5]?.startsWith("[") ? 6 : 5;
        const handling = tokens[modeIndex]?.toLowerCase();
        if (handling && !["replace", "destroy", "keep"].includes(handling)) throw new Error("Unsupported setblock mode: " + handling);
        put(coordinates[0].value, coordinates[1].value, coordinates[2].value, block);
      } else if (command === "fill") {
        if (tokens.length < 8) throw new Error("fill needs two positions and a block identifier.");
        const coordinates = tokens.slice(1, 7).map(parseImportCoordinate);
        relativeCoordinates += coordinates.filter((item) => item.relative).length;
        absoluteCoordinates += coordinates.filter((item) => !item.relative).length;
        const block = parseImportBlockToken(tokens[7], tokens[8]);
        const modeIndex = tokens[8]?.startsWith("[") ? 9 : 8;
        const handling = tokens[modeIndex]?.toLowerCase();
        if (handling && !["replace", "destroy", "keep", "hollow", "outline"].includes(handling)) {
          throw new Error("Unsupported fill mode: " + handling);
        }
        if (handling === "replace" && tokens[modeIndex + 1]) {
          throw new Error("Filtered fill replace commands cannot be reconstructed without the target block filter.");
        }
        const x1 = coordinates[0].value, y1 = coordinates[1].value, z1 = coordinates[2].value;
        const x2 = coordinates[3].value, y2 = coordinates[4].value, z2 = coordinates[5].value;
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
        const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (!Number.isSafeInteger(volume) || volume > MAX_PLACED_BLOCKS) {
          throw new Error("This fill command exceeds the " + MAX_PLACED_BLOCKS.toLocaleString() + " cell import limit.");
        }
        for (let x = minX; x <= maxX; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            for (let z = minZ; z <= maxZ; z += 1) {
              const boundary = x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ;
              if (handling === "hollow" && !boundary) put(x, y, z, { name: "minecraft:air", states: {} });
              else if (handling === "outline" && !boundary) continue;
              else put(x, y, z, block);
            }
          }
        }
      } else {
        ignored += 1;
      }
    } catch (error) {
      warnings.push("Line " + (lineIndex + 1) + ": " + error.message);
    }
  }
  if (!placed.size) {
    const detail = warnings.length ? " First issue: " + warnings[0] : "";
    throw new Error("No supported non-air setblock or fill commands were found." + detail);
  }
  const records = [...placed.values()];
  const bounds = records.reduce((value, block) => ({
    minX: Math.min(value.minX, block.x), minY: Math.min(value.minY, block.y), minZ: Math.min(value.minZ, block.z),
    maxX: Math.max(value.maxX, block.x), maxY: Math.max(value.maxY, block.y), maxZ: Math.max(value.maxZ, block.z)
  }), { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
  const hasRelative = relativeCoordinates > 0;
  const hasAbsolute = absoluteCoordinates > 0;
  let shift = [0, 0, 0];
  if (workspace && !hasRelative && hasAbsolute) shift = origin.slice();
  const shifted = records.map((block) => ({
    ...block, x: block.x - shift[0], y: block.y - shift[1], z: block.z - shift[2]
  }));
  const shiftedBounds = shifted.reduce((value, block) => ({
    minX: Math.min(value.minX, block.x), minY: Math.min(value.minY, block.y), minZ: Math.min(value.minZ, block.z),
    maxX: Math.max(value.maxX, block.x), maxY: Math.max(value.maxY, block.y), maxZ: Math.max(value.maxZ, block.z)
  }), { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
  let size;
  const metadataFits = workspace && workspace.length === 3 &&
    workspace.every((value) => Number.isInteger(value) && value >= 1 && value <= 128) &&
    shifted.every((block) => block.x >= 0 && block.y >= 0 && block.z >= 0 &&
      block.x < workspace[0] && block.y < workspace[1] && block.z < workspace[2]);
  if (metadataFits) {
    size = validateImportedSize(workspace);
  } else {
    const offset = [shiftedBounds.minX, shiftedBounds.minY, shiftedBounds.minZ];
    for (const block of shifted) {
      block.x -= offset[0];
      block.y -= offset[1];
      block.z -= offset[2];
    }
    size = validateImportedSize([
      shiftedBounds.maxX - shiftedBounds.minX + 1,
      shiftedBounds.maxY - shiftedBounds.minY + 1,
      shiftedBounds.maxZ - shiftedBounds.minZ + 1
    ]);
    if (workspace) warnings.push("The workspace header did not fit the imported coordinates; the function was normalized to its block bounds.");
    if (hasRelative && hasAbsolute) warnings.push("The function mixes relative and absolute coordinates; positions were normalized to the imported bounds.");
  }
  if (ignored) warnings.push(ignored.toLocaleString() + " unsupported command line(s) were skipped.");
  if (warnings.length > 12) warnings.splice(12, warnings.length - 12, "Additional import notes were omitted.");
  return {
    size, blocks: shifted, warnings, origin,
    coordinateMode: hasRelative ? "relative" : "absolute",
    fileName, kind: "mcfunction"
  };
}
function registerImportedBlock(name) {
  const canonical = String(name || "").includes(":") ? String(name) : "minecraft:" + name;
  const id = canonical.startsWith("minecraft:") ? canonical.slice("minecraft:".length) : canonical;
  let entry = catalog.find((item) => item.id === id || item.name === canonical);
  if (entry) return entry;
  const model = modelTypeForBlock(id);
  entry = {
    id, name: canonical, displayName: displayName(id), model,
    custom: !canonical.startsWith("minecraft:"),
    shapeClass: shapeClass(model), shapeLabel: shapeLabel(model),
    textureUrl: thumbnailUrlForBlock(id), color: hashColor(id)
  };
  catalog.push(entry);
  catalog.sort((a, b) => a.id.localeCompare(b.id));
  return entry;
}
async function importStructureFile(file) {
  if (!file) return;
  if (!renderer || !worldGroup) {
    setStatus("The 3D workspace is not ready yet. Try importing again after the canvas loads.", "error");
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    setStatus("The import file exceeds the 32 MB safety limit.", "error");
    return;
  }
  const name = file.name.toLowerCase();
  const isStructure = name.endsWith(".mcstructure");
  const isFunction = name.endsWith(".mcfunction") || name.endsWith(".txt");
  if (!isStructure && !isFunction) {
    setStatus("Choose a .mcstructure or .mcfunction file.", "error");
    return;
  }
  ui.importStructure.disabled = true;
  if (ui.importStructureCatalog) ui.importStructureCatalog.disabled = true;
  setStatus("Reading " + file.name + "…");
  try {
    const parsed = isStructure
      ? await parseImportedMcstructure(await file.arrayBuffer(), file.name)
      : parseImportedMcfunction(await file.text(), file.name);
    const size = validateImportedSize(parsed.size);
    if (!parsed.blocks.length) throw new Error("The selected file contains no blocks to place.");
    if (parsed.blocks.length > MAX_PLACED_BLOCKS) {
      throw new Error("The editor can place up to " + MAX_PLACED_BLOCKS.toLocaleString() + " blocks per workspace.");
    }
    const records = parsed.blocks.map((block) => {
      const x = Number(block.x), y = Number(block.y), z = Number(block.z);
      if (![x, y, z].every(Number.isInteger) || x < 0 || y < 0 || z < 0 ||
          x >= size[0] || y >= size[1] || z >= size[2]) {
        throw new Error("An imported block coordinate falls outside the declared workspace dimensions.");
      }
      const entry = registerImportedBlock(block.name);
      return {
        id: entry.id, name: entry.name, x, y, z,
        states: block.states && typeof block.states === "object" && !Array.isArray(block.states) ? { ...block.states } : {},
        model: entry.model, customModelKey: entry.customModelKey || null
      };
    });
    setPlacedSelectionHighlight(null);
    activePlacedBlockKey = null;
    for (const record of placedBlocks.values()) worldGroup.remove(record.group);
    placedBlocks.clear();
    blockHitTargets = [];
    currentSize = { x: size[0], y: size[1], z: size[2] };
    ui.sizeX.value = currentSize.x;
    ui.sizeY.value = currentSize.y;
    ui.sizeZ.value = currentSize.z;
    if (parsed.origin?.length === 3) {
      ui.originX.value = Number(parsed.origin[0]) || 0;
      ui.originY.value = Number(parsed.origin[1]) || 0;
      ui.originZ.value = Number(parsed.origin[2]) || 0;
    }
    ui.coordinateMode.value = parsed.coordinateMode === "absolute" ? "absolute" : "relative";
    [ui.originX, ui.originY, ui.originZ].forEach((input) => {
      input.disabled = ui.coordinateMode.value !== "absolute";
    });
    buildWorkspaceHelpers();
    for (const record of records) placedBlocks.set(cellKey(record.x, record.y, record.z), record);
    for (const record of records) {
      createPlacedBlock(record);
      updateUsedCount(record.id);
    }
    for (const record of records) refreshConnectedModelsNear(record.x, record.y, record.z);
    if (records.length) {
      const first = records[0];
      const entry = catalog.find((item) => item.id === first.id);
      if (entry) selectBlock(entry, false);
    }
    renderCatalog();
    setPlacedSelectionHighlight(null);
    resetCamera();
    updateBuildSummary();
    setMobileView("canvas");
    const note = parsed.warnings?.length ? " Notes: " + parsed.warnings.join(" ") : "";
    setStatus("Imported " + file.name + ": " + records.length.toLocaleString() +
      " blocks placed in a " + size.join(" × ") + " workspace." + note, parsed.warnings?.length ? "normal" : "success");
  } catch (error) {
    setStatus("Import failed: " + (error.message || "The file could not be read."), "error");
  } finally {
    ui.importStructure.disabled = false;
    if (ui.importStructureCatalog) ui.importStructureCatalog.disabled = false;
  }
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function downloadFunction() {
  if (!placedBlocks.size) return;
  ui.downloadFunction.disabled = true; setStatus("Generating .mcfunction…");
  try {
    const text = generateMcfunction();
    saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "bedrock-structure.mcfunction");
    setStatus("Function file generated and download started.", "success");
    setSummary(`${placedBlocks.size.toLocaleString()} blocks · .mcfunction ready`);
  } catch (error) { setStatus(error.message || "Could not generate the function file.", "error"); }
  finally { ui.downloadFunction.disabled = placedBlocks.size === 0; }
}
async function downloadStructure() {
  ui.downloadStructure.disabled = true; setStatus("Writing Bedrock structure NBT…");
  try {
    const nbt = await getNbtLibrary();
    const bytes = nbt.writeUncompressed(buildMcstructureNbt(), "little");
    saveBlob(new Blob([bytes], { type: "application/octet-stream" }), "bedrock-structure.mcstructure");
    setStatus("Structure file generated. Download started.", "success");
    setSummary(`${placedBlocks.size.toLocaleString()} placed blocks · ${currentSize.x}×${currentSize.y}×${currentSize.z} structure`);
  } catch (error) { setStatus(error.message || "Could not generate the structure file.", "error"); }
  finally { ui.downloadStructure.disabled = false; }
}
// Block-state dropdowns commit directly through applyStateControlChanges().
async function loadVanillaData() {
  setStatus("Loading Mojang vanilla block and texture data…");
  const [blocksResponse, texturesResponse, versionResponse, statesResponse] = await Promise.all([
    fetch("./data/vanilla-blocks.json"),
    fetch("./data/terrain_texture.json").catch(() => null),
    fetch("./data/sample-version.json").catch(() => null),
    fetch("./data/block-states.json").catch(() => null)
  ]);
  if (!blocksResponse.ok) {
    throw new Error("The Mojang vanilla block catalogue could not be loaded (HTTP " + blocksResponse.status + ").");
  }
  rawBlockDefinitions = await blocksResponse.json();
  if (!rawBlockDefinitions || typeof rawBlockDefinitions !== "object" || !Object.keys(rawBlockDefinitions).length) {
    throw new Error("The vanilla block catalogue is empty or has an invalid format.");
  }

  // The catalogue is the essential dataset. Textures, version metadata and
  // state schemas are optional enhancements and must never blank the table.
  terrainTextureData = {};
  if (texturesResponse?.ok) {
    try {
      const textureText = await texturesResponse.text();
      const terrainRoot = JSON.parse(textureText.replace(/^\s*\/\/.*$/gm, ""));
      terrainTextureData = terrainRoot.texture_data || terrainRoot;
    } catch (error) {
      console.warn("Texture aliases could not be loaded; using block-colour fallbacks.", error);
    }
  }
  blockStateData = { schemas: {}, exact: {}, rules: [] };
  if (statesResponse?.ok) {
    try {
      const loadedStates = await statesResponse.json();
      if (loadedStates && typeof loadedStates === "object") {
        blockStateData = {
          schemas: loadedStates.schemas || {},
          exact: loadedStates.exact || {},
          rules: Array.isArray(loadedStates.rules) ? loadedStates.rules : [],
          traits: loadedStates.traits || {},
          stateCatalog: Array.isArray(loadedStates.stateCatalog) ? loadedStates.stateCatalog : []
        };
        renderTraitReference();
      }
    } catch (error) {
      console.warn("Bedrock state schemas could not be loaded; state editing is temporarily unavailable.", error);
    }
  }
  let versionData = {};
  if (versionResponse?.ok) {
    try { versionData = await versionResponse.json(); } catch {}
  }
  const latestVersion = versionData.latest?.version || "Vanilla samples";
  const latestDate = versionData.latest?.date || "";
  window.__BEDROCK_SAMPLE_VERSION__ = `SAMPLES ${latestVersion}${latestDate ? ` · ${latestDate}` : ""}`;
  const publishedModels = {
    shelf_mushroom_small: "./data/models/shelf_mushroom_small.geo.json",
    shelf_mushroom_large: "./data/models/shelf_mushroom_large.geo.json",
    straw_bed_foot: "./data/models/straw_bed_foot.geo.json",
    straw_bed_head: "./data/models/straw_bed_head.geo.json"
  };
  const modelResults = await Promise.all(Object.entries(publishedModels).map(async ([name, path]) => {
    try {
      const response = await fetch(path);
      return response.ok ? [name, await response.json()] : [name, null];
    } catch {
      return [name, null];
    }
  }));
  modelGeometryFiles = Object.fromEntries(modelResults.filter((entry) => entry[1]));
  buildCatalog();
  setStatus(`Loaded ${catalog.length.toLocaleString()} vanilla block identifiers, ${Object.keys(terrainTextureData).length.toLocaleString()} texture aliases, ${Object.keys(modelGeometryFiles).length} published block geometry models and ${Object.keys(blockStateData.schemas || {}).length} Bedrock state schemas.`, "success");
}
function wireEvents() {
  syncResponsiveLayout(true);
  ui.mobileTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setMobileView(tab.dataset.view));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 :
        event.key === "End" ? ui.mobileTabs.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + ui.mobileTabs.length) % ui.mobileTabs.length;
      const nextTab = ui.mobileTabs[nextIndex];
      setMobileView(nextTab.dataset.view);
      nextTab.focus();
    });
  });
  window.addEventListener("resize", () => syncResponsiveLayout(false), { passive: true });
  ui.blockSearch.addEventListener("input", renderCatalog);
  ui.shapeFilter.addEventListener("change", renderCatalog);
  ui.saveSelectedBlock?.addEventListener("click", saveCurrentBlockToPalette);
  ui.savedBlockList?.addEventListener("click", handleSavedPaletteClick);
  ui.blockRows.addEventListener("click", (event) => {
    const row = event.target.closest(".catalog-row");
    if (!row) return;
    const entry = catalog.find((item) => item.id === row.dataset.id);
    if (entry) selectBlock(entry);
  });
  ui.blockRows.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".catalog-row");
    if (!row) return;
    event.preventDefault();
    const entry = catalog.find((item) => item.id === row.dataset.id);
    if (entry) selectBlock(entry);
  });
  ui.canvasMode.addEventListener("click", () => setCanvasMode(canvasMode === "build" ? "select" : "build"));
  ui.stateControls.addEventListener("change", (event) => {
    if (event.target.matches("select[data-state-key]")) applyStateControlChanges();
  });
  ui.resetStates.addEventListener("click", resetBlockStateControls);
  updateCanvasModeButton();
  [ui.sizeX, ui.sizeY, ui.sizeZ].forEach((input) => input.addEventListener("change", updateDimensions));
  ui.resetView.addEventListener("click", resetCamera);
  ui.clearBuild.addEventListener("click", clearBuild);
  ui.downloadFunction.addEventListener("click", downloadFunction);
  ui.downloadStructure.addEventListener("click", downloadStructure);
  ui.importStructure.addEventListener("click", () => ui.structureFile.click());
  ui.importStructureCatalog?.addEventListener("click", () => ui.structureFile.click());
  ui.structureFile.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    importStructureFile(file);
    event.target.value = "";
  });
  ui.blockSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { ui.blockSearch.value = ""; renderCatalog(); }
  });
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); ui.blockSearch.focus();
    }
  });
}
async function initialize() {
  // Load the searchable block catalogue before starting WebGL. A renderer
  // failure must not prevent the block table or state editor from working.
  try {
    wireEvents();
    await loadVanillaData();
    updateBuildSummary();
  } catch (error) {
    if (!catalog.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "no-results";
      cell.textContent = "Could not load block catalogue: " + (error.message || "Unknown error.");
      row.append(cell);
      ui.blockRows.replaceChildren(row);
    }
    setStatus(error.message || "Could not load the vanilla block catalogue.", "error");
    return;
  }

  try {
    initializeRenderer();
  } catch (error) {
    ui.canvasMode.disabled = true;
    setStatus("The block catalogue and state editor are ready, but the 3D renderer could not start: " +
      (error.message || "WebGL is unavailable."), "error");
  }
}
window.BedrockBuilder = {
  ready: false,
  getWorkspace() {
    return { ...currentSize };
  },
  getPlacedCount(id) {
    return countPlacedForBlock(id);
  },
  setView(view) {
    setMobileView(view);
  },
  selectBlock(id) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) return false;
    selectBlock(entry);
    return true;
  },
  registerCustomBlock(block) {
    if (!block || typeof block.id !== "string" || !block.model || !block.textureUrls) return false;
    const id = block.id.trim().toLowerCase();
    const entry = {
      id,
      name: id,
      displayName: String(block.name || id),
      model: "custom",
      custom: true,
      customModelKey: id,
      shapeClass: "partial",
      shapeLabel: "Custom model",
      textureUrl: block.textureUrls["*"] || Object.values(block.textureUrls)[0] || null,
      textureUrls: block.textureUrls,
      renderMode: block.renderMode || "cutout",
      color: hashColor(id)
    };
    customBlockDefinitions.set(id, {
      model: block.model,
      textureUrls: block.textureUrls,
      renderMode: block.renderMode || "cutout"
    });
    catalog = catalog.filter((item) => item.id !== id);
    catalog.push(entry);
    catalog.sort((a, b) => a.id.localeCompare(b.id));
    ui.catalogCount.textContent = `${catalog.length.toLocaleString()} BLOCKS`;
    renderCatalog();
    renderSavedBlockPalette();
    for (const [key, record] of placedBlocks.entries()) {
      if (record.id === id || record.customModelKey === id) rebuildPlacedBlock(key);
    }
    if (selectedBlock?.id === id) selectBlock(entry, false);
    return true;
  },
  removeCustomBlock(id) {
    if (countPlacedForBlock(id) > 0) return false;
    customBlockDefinitions.delete(id);
    catalog = catalog.filter((item) => item.id !== id);
    if (selectedBlock?.id === id) {
      const fallback = catalog.find((item) => item.id === "stone") || catalog[0];
      if (fallback) selectBlock(fallback, false);
    }
    ui.catalogCount.textContent = `${catalog.length.toLocaleString()} BLOCKS`;
    renderCatalog();
    renderSavedBlockPalette();
    return true;
  },
  addBlocks(blocks) {
    if (!worldGroup || !renderer) return { ok: false, error: "The 3D renderer is not ready." };
    if (!Array.isArray(blocks) || !blocks.length) return { ok: false, error: "There are no blocks to add." };
    if (placedBlocks.size + blocks.length > MAX_PLACED_BLOCKS) {
      return { ok: false, error: `The editor limit is ${MAX_PLACED_BLOCKS.toLocaleString()} placed blocks.` };
    }
    const batchKeys = new Set();
    const records = [];
    for (const block of blocks) {
      const entry = catalog.find((item) => item.id === block.id);
      if (!entry) return { ok: false, error: "A generated block is not present in the catalogue: " + block.id };
      const { x, y, z } = block;
      if (![x, y, z].every(Number.isInteger) || !isInsideWorkspace(x, y, z)) {
        return { ok: false, error: "The generated structure extends outside the workspace. Increase its dimensions or reduce its size." };
      }
      const key = cellKey(x, y, z);
      if (placedBlocks.has(key) || batchKeys.has(key)) {
        return { ok: false, error: `The generated structure overlaps an occupied cell at ${key}. Clear or move the existing blocks first.` };
      }
      batchKeys.add(key);
      records.push({
        id: entry.id,
        name: entry.name,
        x, y, z,
        states: block.states && typeof block.states === "object" && !Array.isArray(block.states) ? { ...block.states } : {},
        model: entry.model,
        customModelKey: entry.customModelKey || null
      });
    }

    for (const record of records) placedBlocks.set(cellKey(record.x, record.y, record.z), record);
    try {
      for (const record of records) {
        createPlacedBlock(record);
        updateUsedCount(record.id);
      }
      for (const record of records) refreshConnectedModelsNear(record.x, record.y, record.z);
    } catch (error) {
      for (const record of records) removePlacedBlock(cellKey(record.x, record.y, record.z));
      return { ok: false, error: error.message || "The generated structure could not be rendered." };
    }
    updateBuildSummary();
    if (placedBlocks.size === records.length) resetCamera();
    setStatus(`Added ${records.length.toLocaleString()} generated blocks to the workspace.`, "success");
    return { ok: true, added: records.length };
  }
};

initialize().then(() => {
  window.BedrockBuilder.ready = true;
  window.dispatchEvent(new CustomEvent("bv:builder-ready"));
});