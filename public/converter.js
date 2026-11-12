let THREE = null;
let OrbitControls = null;
let threeLibraryPromise = null;

const $ = (selector) => document.querySelector(selector);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BLOCKS = 1_000_000;
const MAX_PREVIEW_BLOCKS = 80_000;
const DEFAULT_BLOCK_VERSION = 18168865;

const ui = {
  fileInput: $("#fileInput"),
  uploadButton: $("#uploadButton"),
  browseButton: $("#browseButton"),
  downloadButton: $("#downloadButton"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  paletteList: $("#paletteList"),
  blockCount: $("#blockCount"),
  dimensionBadge: $("#dimensionBadge"),
  viewport: $("#viewport"),
  emptyState: $("#emptyState"),
  resetCameraButton: $("#resetCameraButton"),
  includeAir: $("#includeAir"),
  keepStates: $("#keepStates"),
  useFill: $("#useFill"),
  keepWaterLayer: $("#keepWaterLayer"),
  coordinateMode: $("#coordinateMode"),
  originX: $("#originX"),
  originY: $("#originY"),
  originZ: $("#originZ"),
  coordinateControls: $("#coordinateControls"),
  statusText: $("#statusText"),
  summaryText: $("#summaryText")
};

let mode = "structure-to-function";
let loaded = null;
let currentFileName = "structure";
let nbtLibraryPromise = null;
let renderer = null;
let scene = null;
let camera = null;
let orbit = null;
let instancedMesh = null;
let gridHelper = null;
let animationStarted = false;
let resizeObserver = null;

function setStatus(message, kind = "normal") {
  ui.statusText.textContent = message;
  ui.statusText.classList.toggle("is-error", kind === "error");
  ui.statusText.classList.toggle("is-success", kind === "success");
}

function setSummary(message) {
  ui.summaryText.textContent = message;
}

function setMode(nextMode) {
  mode = nextMode;
  loaded = null;
  currentFileName = "structure";
  ui.modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const toFunction = mode === "structure-to-function";
  ui.fileInput.accept = toFunction ? ".mcstructure" : ".mcfunction,.txt";
  ui.downloadButton.disabled = true;
  ui.downloadButton.textContent = toFunction ? "Download .mcfunction ↓" : "Download .mcstructure ↓";
  ui.coordinateControls.classList.toggle("is-disabled", !toFunction);
  ui.coordinateControls.setAttribute("aria-disabled", String(!toFunction));
  ui.includeAir.disabled = false;
  ui.keepStates.disabled = false;
  ui.useFill.disabled = !toFunction;
  ui.keepWaterLayer.disabled = !toFunction;
  ui.paletteList.replaceChildren(makeEmptyPalette());
  ui.blockCount.textContent = "0 BLOCKS";
  ui.dimensionBadge.textContent = "NO STRUCTURE LOADED";
  ui.emptyState.hidden = false;
  clearPreviewMesh();
  setSummary("Waiting for a file");
  setStatus(toFunction ? "Choose a .mcstructure file to begin." : "Choose a .mcfunction file to begin.");
}

function makeEmptyPalette() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-list";
  const glyph = document.createElement("span");
  glyph.className = "empty-glyph";
  glyph.textContent = "▦";
  const title = document.createElement("p");
  title.textContent = "Block palette will appear here";
  const hint = document.createElement("small");
  hint.textContent = "Load a file to inspect its blocks.";
  wrapper.append(glyph, title, hint);
  return wrapper;
}

function tagValue(tag) {
  if (tag && typeof tag === "object" && Object.prototype.hasOwnProperty.call(tag, "value")) {
    return tag.value;
  }
  return tag;
}

function listValues(tag) {
  const value = tagValue(tag);
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.value)) return value.value;
  return [];
}

function compoundValue(tag) {
  const value = tagValue(tag);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function scalar(tag, fallback = undefined) {
  const value = tagValue(tag);
  return value === undefined || value === null ? fallback : value;
}

function normalizeStateTag(tag) {
  const value = scalar(tag);
  if (tag?.type === "byte") return Boolean(value);
  if (tag?.type === "short" || tag?.type === "int" || tag?.type === "long" ||
      tag?.type === "float" || tag?.type === "double") return Number(value);
  return value;
}

function blockSignature(block) {
  return JSON.stringify([block.name, block.states || {}]);
}

function hashColor(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  const saturation = 34 + ((hash >>> 9) % 23);
  const lightness = 43 + ((hash >>> 16) % 13);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function isAir(name) {
  return /(^|:)air$/.test(name) || name === "minecraft:cave_air" || name === "minecraft:void_air";
}

function isWater(name) {
  return /(^|:)(flowing_)?water$/.test(name) || /(^|:)bubble_column$/.test(name);
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

function validateDimensions(size) {
  if (!Array.isArray(size) || size.length !== 3) {
    throw new Error("The NBT size field must contain exactly three integers.");
  }
  const values = size.map((value) => Number(value));
  if (values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("The structure has invalid or empty dimensions.");
  }
  const volume = values[0] * values[1] * values[2];
  if (!Number.isSafeInteger(volume) || volume > MAX_BLOCKS) {
    throw new Error(`This structure contains ${volume.toLocaleString()} cells; the current browser limit is ${MAX_BLOCKS.toLocaleString()}.`);
  }
  return { size: values, volume };
}

async function parseMcstructure(arrayBuffer, fileName) {
  const nbt = await getNbtLibrary();
  const parsedResult = await nbt.parse(arrayBuffer, "little");
  const rootTag = parsedResult?.parsed || parsedResult;
  const root = compoundValue(rootTag);
  if (!root.format_version || !root.size || !root.structure || !root.structure_world_origin) {
    throw new Error("Missing required .mcstructure root fields. Expected format_version, size, structure and structure_world_origin.");
  }
  const formatVersion = Number(scalar(root.format_version, 0));
  if (formatVersion !== 1) {
    throw new Error(`Unsupported mcstructure format_version: ${formatVersion}. This converter expects version 1.`);
  }

  const { size, volume } = validateDimensions(listValues(root.size));
  const structure = compoundValue(root.structure);
  const layers = listValues(structure.block_indices);
  if (layers.length !== 2) {
    throw new Error(`structure.block_indices must contain exactly two layers; found ${layers.length}.`);
  }
  const primary = listValues(layers[0]).map(Number);
  const secondary = listValues(layers[1]).map(Number);
  if (primary.length !== volume || secondary.length !== volume) {
    throw new Error(`Block index count does not match size. Expected ${volume.toLocaleString()} entries in each layer; found ${primary.length.toLocaleString()} and ${secondary.length.toLocaleString()}.`);
  }

  const paletteRoot = compoundValue(structure.palette);
  const defaultPalette = compoundValue(paletteRoot.default);
  const rawPalette = listValues(defaultPalette.block_palette);
  if (!rawPalette.length) {
    throw new Error("The default palette is missing or contains no block permutations.");
  }

  const palette = rawPalette.map((rawEntry, index) => {
    const entry = compoundValue(rawEntry);
    const stateTags = compoundValue(entry.states);
    const states = {};
    for (const [key, value] of Object.entries(stateTags)) states[key] = normalizeStateTag(value);
    const name = String(scalar(entry.name, ""));
    if (!name) throw new Error(`Palette entry ${index} is missing its block name.`);
    return {
      name,
      states,
      version: Number(scalar(entry.version, DEFAULT_BLOCK_VERSION))
    };
  });

  const blocks = [];
  const counts = new Map();
  let invalidIndexes = 0;
  for (let index = 0; index < volume; index += 1) {
    const x = Math.floor(index / (size[1] * size[2]));
    const y = Math.floor((index % (size[1] * size[2])) / size[2]);
    const z = index % size[2];
    const primaryIndex = primary[index];
    const secondaryIndex = secondary[index];

    if (primaryIndex >= 0) {
      const block = palette[primaryIndex];
      if (block) {
        const record = { x, y, z, name: block.name, states: block.states, layer: 0 };
        blocks.push(record);
        incrementCount(counts, record);
      } else {
        invalidIndexes += 1;
        const record = { x, y, z, name: "minecraft:air", states: {}, layer: 0 };
        blocks.push(record);
        incrementCount(counts, record);
      }
    } else if (primaryIndex < -1) {
      invalidIndexes += 1;
      const record = { x, y, z, name: "minecraft:air", states: {}, layer: 0 };
      blocks.push(record);
      incrementCount(counts, record);
    }

    if (secondaryIndex >= 0) {
      const block = palette[secondaryIndex];
      if (block) {
        const record = { x, y, z, name: block.name, states: block.states, layer: 1 };
        blocks.push(record);
        incrementCount(counts, record);
      } else {
        invalidIndexes += 1;
        const record = { x, y, z, name: "minecraft:air", states: {}, layer: 1 };
        blocks.push(record);
        incrementCount(counts, record);
      }
    } else if (secondaryIndex < -1) {
      invalidIndexes += 1;
      const record = { x, y, z, name: "minecraft:air", states: {}, layer: 1 };
      blocks.push(record);
      incrementCount(counts, record);
    }
  }

  const entities = listValues(structure.entities);
  const blockPositionData = compoundValue(defaultPalette.block_position_data);
  const extraWarnings = [];
  if (entities.length) extraWarnings.push(`${entities.length} entity record(s) are not emitted to functions`);
  if (Object.keys(blockPositionData).length) extraWarnings.push("block-position data (for example chest contents) is not emitted to functions");
  if (invalidIndexes) extraWarnings.push(`${invalidIndexes} invalid palette index value(s) were treated as air`);

  return {
    kind: "structure",
    fileName,
    size,
    volume,
    primary,
    secondary,
    palette,
    blocks,
    counts,
    warnings: extraWarnings,
    origin: listValues(root.structure_world_origin).map(Number)
  };
}

function incrementCount(counts, block) {
  const key = blockSignature(block);
  const current = counts.get(key) || { name: block.name, states: block.states || {}, count: 0, primary: 0, secondary: 0 };
  current.count += 1;
  if (block.layer === 1) current.secondary += 1;
  else current.primary += 1;
  counts.set(key, current);
}

function splitOutsideQuotes(value, delimiter) {
  const parts = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote) {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
      continue;
    }
    if (char === delimiter && !quote) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function tokenizeCommand(line) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;
  let bracketDepth = 0;
  for (const char of line.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote) {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
      continue;
    }
    if (!quote && char === "[") bracketDepth += 1;
    if (!quote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (/\s/.test(char) && !quote && bracketDepth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }
  return trimmed;
}

function parseStateValue(raw) {
  const value = raw.trim();
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return unquote(value);
}

function parseStateArray(raw) {
  if (!raw || raw === "[]") return {};
  if (!raw.startsWith("[") || !raw.endsWith("]")) throw new Error("Block state data must use square brackets.");
  const states = {};
  const content = raw.slice(1, -1).trim();
  if (!content) return states;
  for (const pair of splitOutsideQuotes(content, ",")) {
    const index = pair.indexOf("=");
    if (index < 1) throw new Error(`Invalid block state pair: ${pair}`);
    const key = unquote(pair.slice(0, index));
    if (!key) throw new Error("A block state is missing its name.");
    states[key] = parseStateValue(pair.slice(index + 1));
  }
  return states;
}

function parseBlockToken(token, followingToken) {
  let name = token;
  let stateToken = "";
  const bracketIndex = token.indexOf("[");
  if (bracketIndex >= 0) {
    name = token.slice(0, bracketIndex);
    stateToken = token.slice(bracketIndex);
  }
  if (!stateToken && followingToken?.startsWith("[")) stateToken = followingToken;
  name = name.trim();
  if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/i.test(name)) {
    throw new Error(`Invalid block identifier: ${name}`);
  }
  if (!name.includes(":")) name = `minecraft:${name}`;
  return { name, states: stateToken ? parseStateArray(stateToken) : {} };
}

function parseCoordinate(token) {
  if (token.startsWith("^")) throw new Error("Local (^) coordinates cannot be converted without the command executor's rotation.");
  if (token.startsWith("~")) {
    const offset = token.slice(1);
    if (!offset) return 0;
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(offset)) throw new Error(`Invalid relative coordinate: ${token}`);
    return Math.floor(Number(offset));
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(token)) throw new Error(`Invalid coordinate: ${token}`);
  return Math.floor(Number(token));
}

function positionFromTokens(tokens, start) {
  return {
    x: parseCoordinate(tokens[start]),
    y: parseCoordinate(tokens[start + 1]),
    z: parseCoordinate(tokens[start + 2])
  };
}

function parseMcfunction(source, fileName) {
  const blocks = new Map();
  const warnings = [];
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let ignored = 0;
  let parsedCommands = 0;

  const put = (x, y, z, block) => {
    const key = `${x},${y},${z}`;
    blocks.set(key, { x, y, z, name: block.name, states: block.states, layer: 0 });
  };

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const trimmed = lines[lineNumber].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tokens = tokenizeCommand(trimmed);
    if (!tokens.length) continue;
    const command = tokens[0].replace(/^\//, "").toLowerCase();

    try {
      if (command === "setblock") {
        if (tokens.length < 5) throw new Error("setblock needs three coordinates and a block identifier.");
        const position = positionFromTokens(tokens, 1);
        const block = parseBlockToken(tokens[4], tokens[5]);
        const setblockHandling = (tokens[5]?.startsWith("[") ? tokens[6] : tokens[5])?.toLowerCase();
        if (setblockHandling && !["replace", "destroy"].includes(setblockHandling)) {
          throw new Error(`setblock mode "${setblockHandling}" depends on the target world and is not imported.`);
        }
        put(position.x, position.y, position.z, block);
        parsedCommands += 1;
      } else if (command === "fill") {
        if (tokens.length < 8) throw new Error("fill needs two positions and a block identifier.");
        const from = positionFromTokens(tokens, 1);
        const to = positionFromTokens(tokens, 4);
        const block = parseBlockToken(tokens[7], tokens[8]);
        const modeIndex = tokens[8]?.startsWith("[") ? 9 : 8;
        const fillHandling = tokens[modeIndex]?.toLowerCase();
        if (fillHandling && !["replace", "destroy"].includes(fillHandling)) {
          throw new Error(`fill mode "${fillHandling}" is context-dependent and is not imported.`);
        }
        if (fillHandling === "replace" && tokens[modeIndex + 1]) {
          throw new Error("Filtered fill replace commands are not imported because their target filter cannot be reconstructed.");
        }
        const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x);
        const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
        const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z);
        const fillVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (!Number.isSafeInteger(fillVolume) || fillVolume > MAX_BLOCKS || blocks.size + fillVolume > MAX_BLOCKS) {
          throw new Error(`fill volume exceeds the ${MAX_BLOCKS.toLocaleString()} block safety limit.`);
        }
        for (let x = minX; x <= maxX; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            for (let z = minZ; z <= maxZ; z += 1) put(x, y, z, block);
          }
        }
        parsedCommands += 1;
      } else {
        ignored += 1;
      }
    } catch (error) {
      warnings.push(`Line ${lineNumber + 1}: ${error.message}`);
    }
  }

  if (!blocks.size) {
    const detail = warnings[0] ? ` First issue: ${warnings[0]}` : "";
    throw new Error(`No supported setblock or fill commands were found.${detail}`);
  }

  const records = [...blocks.values()];
  const bounds = getBounds(records);
  const size = [
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
    bounds.maxZ - bounds.minZ + 1
  ];
  const volume = size[0] * size[1] * size[2];
  if (volume > MAX_BLOCKS) throw new Error(`The coordinate bounds span ${volume.toLocaleString()} cells; the current browser limit is ${MAX_BLOCKS.toLocaleString()}.`);

  const normalized = records.map((block) => ({
    ...block,
    x: block.x - bounds.minX,
    y: block.y - bounds.minY,
    z: block.z - bounds.minZ
  }));
  const counts = new Map();
  normalized.forEach((block) => incrementCount(counts, block));
  if (ignored) warnings.push(`${ignored} unsupported command line(s) were skipped`);
  if (warnings.length > 16) {
    const remaining = warnings.length - 16;
    warnings.splice(16, warnings.length, `and ${remaining} more warning(s)`);
  }

  return {
    kind: "function",
    fileName,
    blocks: normalized,
    counts,
    size,
    volume,
    bounds,
    parsedCommands,
    warnings
  };
}

function getBounds(blocks) {
  return blocks.reduce((bounds, block) => ({
    minX: Math.min(bounds.minX, block.x), minY: Math.min(bounds.minY, block.y), minZ: Math.min(bounds.minZ, block.z),
    maxX: Math.max(bounds.maxX, block.x), maxY: Math.max(bounds.maxY, block.y), maxZ: Math.max(bounds.maxZ, block.z)
  }), {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
  });
}

function renderPalette(counts) {
  ui.paletteList.replaceChildren();
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (!sorted.length) {
    ui.paletteList.append(makeEmptyPalette());
    ui.blockCount.textContent = "0 BLOCKS";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of sorted) {
    const row = document.createElement("div");
    row.className = "block-row";
    const swatch = document.createElement("span");
    swatch.className = "block-swatch";
    swatch.style.background = hashColor(entry.name);
    const name = document.createElement("span");
    name.className = "block-name";
    name.textContent = entry.name;
    name.title = entry.name;
    const count = document.createElement("span");
    count.className = "block-count";
    count.textContent = entry.count.toLocaleString();
    count.title = `${entry.primary || 0} primary · ${entry.secondary || 0} secondary`;
    row.append(swatch, name, count);
    fragment.append(row);
  }
  ui.paletteList.append(fragment);
  const total = sorted.reduce((sum, entry) => sum + entry.count, 0);
  ui.blockCount.textContent = `${total.toLocaleString()} BLOCKS · ${sorted.length} TYPES`;
}

function blockListForPreview(data) {
  if (data.kind === "function") return data.blocks;
  return data.blocks;
}

function clearPreviewMesh() {
  if (instancedMesh && scene) {
    scene.remove(instancedMesh);
    instancedMesh.geometry.dispose();
    instancedMesh.material.dispose();
    instancedMesh = null;
  }
  if (gridHelper && scene) {
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    gridHelper.material.dispose();
    gridHelper = null;
  }
}

async function ensureRenderer() {
  if (renderer) return;
  if (!threeLibraryPromise) {
    threeLibraryPromise = Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js")
    ]).then(([threeModule, controlsModule]) => {
      THREE = threeModule;
      OrbitControls = controlsModule.OrbitControls;
    });
  }
  await threeLibraryPromise;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(ui.viewport.clientWidth, ui.viewport.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x171d21, 0);
  renderer.domElement.setAttribute("aria-label", "Interactive 3D block structure preview");
  ui.viewport.append(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, Math.max(1, ui.viewport.clientWidth / ui.viewport.clientHeight), 0.1, 10000);
  camera.position.set(18, 16, 18);
  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x37423e, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
  keyLight.position.set(12, 24, 16);
  scene.add(keyLight);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.075;
  orbit.screenSpacePanning = true;
  orbit.minDistance = 2;
  orbit.maxDistance = 4000;

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera) return;
    const width = Math.max(1, ui.viewport.clientWidth);
    const height = Math.max(1, ui.viewport.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(ui.viewport);

  if (!animationStarted) {
    animationStarted = true;
    const animate = () => {
      requestAnimationFrame(animate);
      orbit?.update();
      renderer?.render(scene, camera);
    };
    animate();
  }
}

function renderPreview(data) {
  ensureRenderer().then(() => {
    clearPreviewMesh();
    const blocks = blockListForPreview(data).filter((block) => !isAir(block.name));
    if (!blocks.length) {
      ui.emptyState.hidden = false;
      ui.resetCameraButton.disabled = true;
      return;
    }

    const visibleBlocks = blocks.slice(0, MAX_PREVIEW_BLOCKS);
    const size = data.size;
    const center = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
    const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.02 });
    instancedMesh = new THREE.InstancedMesh(geometry, material, visibleBlocks.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    visibleBlocks.forEach((block, index) => {
      position.set(block.x + 0.5 - center.x, block.y + 0.5 - center.y, block.z + 0.5 - center.z);
      scale.setScalar(block.layer === 1 ? 0.84 : 1);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(index, matrix);
      if (isWater(block.name)) color.setHex(0x4b9bd0);
      else color.setStyle(hashColor(block.name));
      instancedMesh.setColorAt(index, color);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);

    const gridSize = Math.max(10, Math.ceil(Math.max(...size) / 2) * 2);
    gridHelper = new THREE.GridHelper(gridSize, Math.min(gridSize, 80), 0x536269, 0x344147);
    gridHelper.position.y = -center.y - 0.52;
    scene.add(gridHelper);

    const span = Math.max(...size);
    camera.position.set(center.x + span * 1.45, center.y + span * 1.15, center.z + span * 1.45);
    camera.near = 0.1;
    camera.far = Math.max(1000, span * 12);
    camera.updateProjectionMatrix();
    orbit.target.set(0, 0, 0);
    orbit.update();

    ui.emptyState.hidden = true;
    ui.resetCameraButton.disabled = false;
    if (blocks.length > MAX_PREVIEW_BLOCKS) {
      setStatus(`Preview limited to the first ${MAX_PREVIEW_BLOCKS.toLocaleString()} of ${blocks.length.toLocaleString()} blocks; conversion uses the full structure.`);
    }
  }).catch((error) => {
    setStatus(`3D preview unavailable: ${error.message}. Conversion is still available.`, "error");
  });
}

function refreshLoadedFile(data) {
  loaded = data;
  currentFileName = data.fileName.replace(/\.(mcstructure|mcfunction|txt)$/i, "") || "structure";
  renderPalette(data.counts);
  ui.dimensionBadge.textContent = `${data.size.join(" × ")} · ${data.blocks.length.toLocaleString()} BLOCK ENTRIES`;
  ui.downloadButton.disabled = false;
  ui.emptyState.hidden = false;
  clearPreviewMesh();
  renderPreview(data);

  const warningText = data.warnings?.length ? ` · ${data.warnings.length} note(s)` : "";
  const summary = `${data.size.join("×")} · ${data.blocks.length.toLocaleString()} blocks · ${data.counts.size} types${warningText}`;
  setSummary(summary);
  setStatus(`Loaded ${data.fileName}${data.warnings?.length ? " with conversion notes." : " successfully."}`, data.warnings?.length ? "normal" : "success");
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`File is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB upload limit.`, "error");
    return;
  }
  const expected = mode === "structure-to-function" ? ".mcstructure" : ".mcfunction";
  const lowerName = file.name.toLowerCase();
  if (mode === "structure-to-function" && !lowerName.endsWith(".mcstructure")) {
    setStatus("This mode expects a .mcstructure file. Switch conversion direction to load a .mcfunction.", "error");
    return;
  }
  if (mode === "function-to-structure" && !lowerName.endsWith(".mcfunction") && !lowerName.endsWith(".txt")) {
    setStatus("This mode expects a .mcfunction or plain-text function file.", "error");
    return;
  }

  ui.downloadButton.disabled = true;
  setStatus(`Reading ${file.name}…`);
  setSummary("Parsing file");
  try {
    let data;
    if (expected === ".mcstructure") {
      data = await parseMcstructure(await file.arrayBuffer(), file.name);
    } else {
      data = parseMcfunction(await file.text(), file.name);
    }
    refreshLoadedFile(data);
    if (data.kind === "function") {
      const original = data.bounds;
      setSummary(`${data.size.join("×")} · ${data.blocks.length.toLocaleString()} blocks · origin ${original.minX}, ${original.minY}, ${original.minZ}`);
      if (data.warnings.length) {
        setStatus(`Loaded with ${data.warnings.length} note(s). Unsupported commands and malformed lines were skipped.`);
      } else {
        setStatus(`Parsed ${data.parsedCommands.toLocaleString()} setblock/fill command(s).`, "success");
      }
    } else if (data.warnings.length) {
      setStatus(`Loaded with notes: ${data.warnings.join("; ")}.`);
    }
  } catch (error) {
    loaded = null;
    ui.downloadButton.disabled = true;
    ui.emptyState.hidden = false;
    ui.paletteList.replaceChildren(makeEmptyPalette());
    ui.blockCount.textContent = "0 BLOCKS";
    ui.dimensionBadge.textContent = "INVALID FILE";
    clearPreviewMesh();
    setSummary("No output generated");
    setStatus(error.message || "Unable to parse this file.", "error");
  }
}

function serializeStateArray(states) {
  const entries = Object.entries(states || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  const pairs = entries.map(([key, value]) => {
    const encoded = typeof value === "string" ? JSON.stringify(value) :
      typeof value === "boolean" ? (value ? "true" : "false") :
      Number.isFinite(Number(value)) ? String(value) : JSON.stringify(String(value));
    return `${JSON.stringify(key)}=${encoded}`;
  });
  return `[${pairs.join(",")}] `;
}

function outputCoordinate(value, axis) {
  const coordinateMode = ui.coordinateMode.value;
  if (coordinateMode === "relative") return value === 0 ? "~" : `~${value}`;
  const originInput = axis === 0 ? ui.originX : axis === 1 ? ui.originY : ui.originZ;
  const origin = Number.parseInt(originInput.value || "0", 10) || 0;
  return String(origin + value);
}

function blockCommand(block, options) {
  const x = outputCoordinate(block.x, 0);
  const y = outputCoordinate(block.y, 1);
  const z = outputCoordinate(block.z, 2);
  const states = options.keepStates ? serializeStateArray(block.states) : "";
  return `setblock ${x} ${y} ${z} ${block.name} ${states}`.trim();
}

function fillCommand(from, to, block, options) {
  const x1 = outputCoordinate(from.x, 0);
  const y1 = outputCoordinate(from.y, 1);
  const z1 = outputCoordinate(from.z, 2);
  const x2 = outputCoordinate(to.x, 0);
  const y2 = outputCoordinate(to.y, 1);
  const z2 = outputCoordinate(to.z, 2);
  const states = options.keepStates ? serializeStateArray(block.states) : "";
  return `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block.name} ${states}`.trim();
}

function createFunctionBlocks(data, options) {
  const output = [];
  const warnings = [...(data.warnings || [])];
  const primary = data.primary;
  const secondary = data.secondary;
  let secondarySkipped = 0;

  for (let index = 0; index < data.volume; index += 1) {
    const primaryIndex = primary[index];
    const secondaryIndex = secondary[index];
    const x = Math.floor(index / (data.size[1] * data.size[2]));
    const y = Math.floor((index % (data.size[1] * data.size[2])) / data.size[2]);
    const z = index % data.size[2];
    let block = primaryIndex >= 0 ? data.palette[primaryIndex] : null;
    const secondaryBlock = secondaryIndex >= 0 ? data.palette[secondaryIndex] : null;

    if (!block && secondaryBlock) {
      block = secondaryBlock;
    } else if (block && secondaryBlock && options.keepWaterLayer) {
      if (isWater(secondaryBlock.name)) {
        const states = { ...(block.states || {}) };
        const waterStateKey = Object.prototype.hasOwnProperty.call(states, "waterlogged_bit") ? "waterlogged_bit" :
          Object.prototype.hasOwnProperty.call(states, "minecraft:waterlogged_bit") ? "minecraft:waterlogged_bit" : null;
        if (waterStateKey) states[waterStateKey] = true;
        else secondarySkipped += 1;
        block = { ...block, states };
      } else {
        secondarySkipped += 1;
      }
    }
    if (!block) continue;
    if (isAir(block.name) && !options.includeAir) continue;
    output.push({ x, y, z, name: block.name, states: options.keepStates ? { ...(block.states || {}) } : {} });
  }

  if (secondarySkipped) {
    warnings.push(`${secondarySkipped.toLocaleString()} co-located secondary block(s) could not be represented by a single setblock/fill command and were omitted`);
  }
  return { blocks: output, warnings };
}

function generateMcfunction(data, options) {
  const { blocks, warnings } = createFunctionBlocks(data, options);
  const rows = new Map();
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
    let cursor = 0;
    while (cursor < row.length) {
      const start = row[cursor];
      const signature = blockSignature(start);
      let end = cursor;
      while (end + 1 < row.length &&
             row[end + 1].x === row[end].x + 1 &&
             blockSignature(row[end + 1]) === signature) end += 1;
      const runLength = end - cursor + 1;
      if (options.useFill && runLength >= 2) {
        commands.push(fillCommand(start, row[end], start, options));
      } else {
        for (let item = cursor; item <= end; item += 1) commands.push(blockCommand(row[item], options));
      }
      cursor = end + 1;
    }
  }

  if (!commands.length) throw new Error("The selected options produced no block commands.");
  const header = [
    "# Generated by Bedrock Structure Converter",
    `# Source: ${data.fileName}`,
    `# Size: ${data.size.join(" x ")}`,
    "# Coordinates are local to the structure origin unless absolute mode is selected.",
    ""
  ];
  if (warnings.length) {
    header.splice(4, 0, ...warnings.map((warning) => `# NOTE: ${warning}`));
  }
  return {
    text: header.concat(commands).join("\n") + "\n",
    blockCount: blocks.length,
    commandCount: commands.length,
    warnings
  };
}

function makeTag(type, value) {
  return { type, value };
}

function makeList(elementType, values) {
  return { type: "list", value: { type: elementType, value: values } };
}

function buildMcstructure(data, options) {
  const size = data.size;
  const volume = data.volume;
  const sourceBlocks = data.blocks
    .filter((block) => options.includeAir || !isAir(block.name))
    .map((block) => ({ ...block, states: options.keepStates ? (block.states || {}) : {} }));
  if (!sourceBlocks.length) throw new Error("The selected options removed every block.");
  const palette = [];
  const paletteLookup = new Map();
  const primary = new Array(volume).fill(-1);
  const secondary = new Array(volume).fill(-1);

  const paletteIndexFor = (block) => {
    const signature = blockSignature(block);
    if (paletteLookup.has(signature)) return paletteLookup.get(signature);
    const index = palette.length;
    paletteLookup.set(signature, index);
    palette.push({
      name: block.name,
      states: block.states || {},
      version: DEFAULT_BLOCK_VERSION
    });
    return index;
  };

  for (const block of sourceBlocks) {
    const x = block.x;
    const y = block.y;
    const z = block.z;
    const index = (x * size[1] + y) * size[2] + z;
    primary[index] = paletteIndexFor(block);
  }
  if (!palette.length) throw new Error("No blocks are available to write into the structure.");

  const paletteTags = palette.map((entry) => {
    const stateTags = {};
    for (const [key, value] of Object.entries(entry.states)) {
      if (typeof value === "boolean") stateTags[key] = makeTag("byte", value ? 1 : 0);
      else if (typeof value === "number") stateTags[key] = makeTag("int", Math.trunc(value));
      else stateTags[key] = makeTag("string", String(value));
    }
    return {
      name: makeTag("string", entry.name),
      states: makeTag("compound", stateTags),
      version: makeTag("int", entry.version)
    };
  });

  const root = {
    type: "compound",
    name: "",
    value: {
      format_version: makeTag("int", 1),
      size: makeList("int", size),
      structure: makeTag("compound", {
        block_indices: makeList("list", [
          { type: "int", value: primary },
          { type: "int", value: secondary }
        ]),
        entities: makeList("compound", []),
        palette: makeTag("compound", {
          default: makeTag("compound", {
            block_palette: makeList("compound", paletteTags),
            block_position_data: makeTag("compound", {})
          })
        })
      }),
      structure_world_origin: makeList("int", [0, 0, 0])
    }
  };
  return root;
}

async function downloadOutput() {
  if (!loaded) return;
  const options = {
    includeAir: ui.includeAir.checked,
    keepStates: ui.keepStates.checked,
    useFill: ui.useFill.checked,
    keepWaterLayer: ui.keepWaterLayer.checked
  };
  ui.downloadButton.disabled = true;
  setStatus("Converting…");
  try {
    let blob;
    let extension;
    let summary;
    if (mode === "structure-to-function") {
      const result = generateMcfunction(loaded, options);
      blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
      extension = ".mcfunction";
      summary = `${result.blockCount.toLocaleString()} blocks → ${result.commandCount.toLocaleString()} commands`;
      if (result.warnings.length) setStatus(`Converted with notes: ${result.warnings.join("; ")}.`);
      else setStatus("Conversion complete. Download is ready.", "success");
    } else {
      const root = buildMcstructure(loaded, options);
      const nbt = await getNbtLibrary();
      const bytes = nbt.writeUncompressed(root, "little");
      blob = new Blob([bytes], { type: "application/octet-stream" });
      extension = ".mcstructure";
      summary = `${loaded.blocks.length.toLocaleString()} blocks → ${loaded.size.join("×")} structure`;
      if (loaded.warnings.length) setStatus(`Structure generated with notes: ${loaded.warnings.join("; ")}.`);
      else setStatus("Structure generated. Download is ready.", "success");
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentFileName || "converted"}${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSummary(summary);
  } catch (error) {
    setStatus(error.message || "Conversion failed.", "error");
    setSummary("No output generated");
  } finally {
    ui.downloadButton.disabled = !loaded;
  }
}

function wireEvents() {
  ui.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  ui.uploadButton.addEventListener("click", () => ui.fileInput.click());
  ui.browseButton.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    handleFile(file);
    event.target.value = "";
  });
  ui.downloadButton.addEventListener("click", downloadOutput);
  ui.resetCameraButton.addEventListener("click", () => {
    if (!loaded || !camera || !orbit) return;
    const size = loaded.size;
    const center = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
    const span = Math.max(...size);
    camera.position.set(center.x + span * 1.45, center.y + span * 1.15, center.z + span * 1.45);
    orbit.target.set(0, 0, 0);
    orbit.update();
  });

  ui.coordinateMode.addEventListener("change", () => {
    const isAbsolute = ui.coordinateMode.value === "absolute";
    [ui.originX, ui.originY, ui.originZ].forEach((input) => {
      input.disabled = !isAbsolute;
    });
  });
  [ui.originX, ui.originY, ui.originZ].forEach((input) => {
    input.disabled = ui.coordinateMode.value !== "absolute";
  });

  ui.viewport.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("is-dragging");
  });
  ui.viewport.addEventListener("dragleave", (event) => {
    if (!ui.viewport.contains(event.relatedTarget)) document.body.classList.remove("is-dragging");
  });
  ui.viewport.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("is-dragging");
    const [file] = event.dataTransfer?.files || [];
    handleFile(file);
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());
}

wireEvents();
setMode(mode);