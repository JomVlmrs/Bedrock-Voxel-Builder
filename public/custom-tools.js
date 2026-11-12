const $ = (selector) => document.querySelector(selector);
const dialog = $('#customToolsDialog');
const treeForm = $('#treeGeneratorForm');
const blockForm = $('#customBlockForm');
const libraryList = $('#customBlockLibrary');
const treeStatus = $('#treeStatus');
const importStatus = $('#importStatus');
const libraryStatus = $('#libraryStatus');
const importButton = $('#importCustomBlock');
const treeButton = $('#generateTree');
const customBlocksApi = window.BEDROCK_CUSTOM_BLOCKS_API ||
  (location.hostname.toLowerCase().endsWith('.github.io') ? null : '/api/custom-blocks');
let builder = null;

const treePresets = {
  oak: { log: 'oak_log', leaves: 'oak_leaves', style: 'round', label: 'Oak' },
  spruce: { log: 'spruce_log', leaves: 'spruce_leaves', style: 'conical', label: 'Spruce' },
  birch: { log: 'birch_log', leaves: 'birch_leaves', style: 'round', label: 'Birch' },
  jungle: { log: 'jungle_log', leaves: 'jungle_leaves', style: 'broad', label: 'Jungle' },
  acacia: { log: 'acacia_log', leaves: 'acacia_leaves', style: 'umbrella', label: 'Acacia' },
  dark_oak: { log: 'dark_oak_log', leaves: 'dark_oak_leaves', style: 'broad', label: 'Dark oak' },
  cherry: { log: 'cherry_log', leaves: 'cherry_leaves', style: 'round', label: 'Cherry' },
  mangrove: { log: 'mangrove_log', leaves: 'mangrove_leaves', style: 'broad', label: 'Mangrove' },
  pale_oak: { log: 'pale_oak_log', leaves: 'pale_oak_leaves', style: 'round', label: 'Pale oak' }
};

function setMessage(node, message, error = false) {
  node.textContent = message;
  node.classList.toggle('error', error);
}
function waitForBuilder() {
  if (window.BedrockBuilder?.ready) {
    builder = window.BedrockBuilder;
    return Promise.resolve(builder);
  }
  return new Promise((resolve) => {
    window.addEventListener('bv:builder-ready', () => {
      builder = window.BedrockBuilder;
      resolve(builder);
    }, { once: true });
  });
}
function openDialog() {
  if (!dialog.open) dialog.showModal();
  loadCustomLibrary();
}
function closeDialog() {
  if (dialog.open) dialog.close();
}
$('#openCustomTools').addEventListener('click', openDialog);
$('#closeCustomTools').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeDialog();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialog.open) closeDialog();
});

function updateRangeLabels() {
  document.querySelectorAll('[data-range-output]').forEach((output) => {
    const input = document.getElementById(output.dataset.rangeOutput);
    output.value = input.value;
    output.textContent = input.value;
  });
}
treeForm.querySelectorAll('input[type="range"]').forEach((input) => {
  input.addEventListener('input', updateRangeLabels);
});
updateRangeLabels();

function addCell(map, id, x, y, z, name, states = {}) {
  const key = x + ',' + y + ',' + z;
  if (!map.has(key)) map.set(key, { id, name: 'minecraft:' + id, x, y, z, states });
}
function makeTree(options, workspace) {
  const preset = treePresets[options.species];
  if (!preset) throw new Error('Choose a supported tree species.');
  const height = options.height;
  const radius = options.radius;
  const centerX = Math.floor((workspace.x - 1) / 2);
  const centerZ = Math.floor((workspace.z - 1) / 2);
  const canopyHeight = options.style === 'umbrella' ? 3 : options.style === 'conical' ? 5 : 4;
  const spread = radius + (options.branches ? 1 : 0);
  if (centerX - spread < 0 || centerX + spread >= workspace.x ||
      centerZ - spread < 0 || centerZ + spread >= workspace.z) {
    throw new Error('This tree is wider than the workspace. Increase X and Z or reduce canopy size.');
  }
  if (height + canopyHeight >= workspace.y) {
    throw new Error('This tree is taller than the workspace. Increase Y or reduce trunk height.');
  }

  const cells = new Map();
  const trunkWidth = options.trunkWidth;
  const offsets = trunkWidth === 2 ? [0, 1] : [0];
  for (let y = 0; y < height; y += 1) {
    for (const ox of offsets) for (const oz of offsets) {
      addCell(cells, preset.log, centerX + ox, y, centerZ + oz, preset.log, { pillar_axis: 'y' });
    }
  }

  const branchCount = options.branches;
  for (let index = 0; index < branchCount; index += 1) {
    const angle = (Math.PI * 2 * index) / Math.max(1, branchCount) + 0.22;
    const dx = Math.round(Math.cos(angle));
    const dz = Math.round(Math.sin(angle));
    const length = Math.max(1, Math.floor(radius * 0.72));
    const branchY = Math.max(2, height - 2 - (index % 2));
    for (let step = 1; step <= length; step += 1) {
      const x = centerX + Math.round(dx * step);
      const z = centerZ + Math.round(dz * step);
      const axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
      addCell(cells, preset.log, x, branchY + Math.floor(step / 3), z, preset.log, { pillar_axis: axis });
    }
  }

  if (options.species === 'mangrove') {
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      for (let step = 1; step <= 2; step += 1) {
        addCell(cells, preset.log, centerX + dx * step, 0, centerZ + dz * step, preset.log,
          { pillar_axis: dx ? 'x' : 'z' });
      }
    }
  }

  const canopyBase = height - 1;
  for (let layer = 0; layer < canopyHeight; layer += 1) {
    let rx = radius;
    let rz = radius;
    if (options.style === 'conical') {
      rx = rz = Math.max(1, radius * (1 - layer / canopyHeight));
    } else if (options.style === 'umbrella') {
      rx = radius;
      rz = Math.max(2, radius * 0.82);
    } else if (options.style === 'broad') {
      rx = radius * 1.08;
      rz = radius;
    } else {
      const vertical = (layer - (canopyHeight - 1) / 2) / (canopyHeight / 2);
      const scale = Math.sqrt(Math.max(0.18, 1 - vertical * vertical));
      rx = rz = radius * scale;
    }
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx += 1) {
      for (let dz = -Math.ceil(rz); dz <= Math.ceil(rz); dz += 1) {
        const distance = (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz);
        if (distance > 1.08) continue;
        if (options.style === 'umbrella' && layer === 0 && distance < 0.1) continue;
        const noise = ((Math.abs(dx * 17 + dz * 31 + layer * 13) * 7) % 100) / 100;
        if (noise > options.density) continue;
        const x = centerX + dx;
        const y = canopyBase + layer;
        const z = centerZ + dz;
        if (!cells.has(x + ',' + y + ',' + z)) {
          addCell(cells, preset.leaves, x, y, z, preset.leaves);
        }
      }
    }
  }

  const tree = [...cells.values()];
  if (tree.length > 1800) throw new Error('This tree is too dense. Reduce its canopy size or height.');
  return { tree, preset, centerX, centerZ };
}

treeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  treeButton.disabled = true;
  setMessage(treeStatus, 'Generating tree blocks…');
  try {
    await waitForBuilder();
    const options = {
      species: $('#treeSpecies').value,
      style: $('#treeStyle').value,
      height: Number($('#treeHeight').value),
      radius: Number($('#treeRadius').value),
      trunkWidth: Number($('#treeTrunkWidth').value),
      branches: Number($('#treeBranches').value),
      density: Number($('#treeDensity').value)
    };
    const workspace = builder.getWorkspace();
    const result = makeTree(options, workspace);
    const inserted = builder.addBlocks(result.tree);
    if (!inserted.ok) throw new Error(inserted.error || 'The tree could not be placed.');
    const logCount = result.tree.filter((block) => block.id === result.preset.log).length;
    const leafCount = result.tree.length - logCount;
    setMessage(treeStatus,
      result.preset.label + ' tree placed at X ' + result.centerX + ', Z ' + result.centerZ +
      ' · ' + result.tree.length + ' blocks (' + logCount + ' logs, ' + leafCount + ' leaves).'
    );
    closeDialog();
    if (window.matchMedia('(max-width: 900px)').matches) builder.setView('canvas');
  } catch (error) {
    setMessage(treeStatus, error.message || 'Tree generation failed.', true);
  } finally {
    treeButton.disabled = false;
  }
});
$('#treeSpecies').addEventListener('change', () => {
  const preset = treePresets[$('#treeSpecies').value];
  if (preset) $('#treeStyle').value = preset.style;
});

function validGeometry(model) {
  const geometry = model?.['minecraft:geometry']?.[0];
  if (!geometry || !Array.isArray(geometry.bones) || !geometry.bones.length) return false;
  if (!geometry.bones.every((bone) => bone.cubes === undefined || Array.isArray(bone.cubes))) return false;
  return geometry.bones.reduce((total, bone) => total + (bone.cubes || []).length, 0) > 0;
}
function validateBlockId(value) {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) && value.length <= 128;
}
function registerLibraryBlock(block) {
  builder.registerCustomBlock(block);
}
async function loadCustomLibrary() {
  await waitForBuilder();
  $('#treeDimensions').textContent = 'Workspace ' + Object.values(builder.getWorkspace()).join(' × ');
  if (!customBlocksApi) {
    renderLibrary([]);
    importButton.disabled = true;
    setMessage(libraryStatus, 'Custom block storage needs a backend. The static GitHub Pages editor supports building and exporting, but not custom block uploads or cloud sync.');
    return;
  }
  setMessage(libraryStatus, 'Loading your saved custom blocks…');
  try {
    const response = await fetch(customBlocksApi);
    if (response.status === 401 || response.status === 403) {
      throw new Error('Sign in as the project owner to sync custom blocks.');
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load the custom block library.');
    for (const block of payload.blocks || []) registerLibraryBlock(block);
    renderLibrary(payload.blocks || []);
    setMessage(libraryStatus, (payload.blocks || []).length + ' saved custom block(s) available.');
  } catch (error) {
    renderLibrary([]);
    setMessage(libraryStatus, error.message || 'Custom block library is unavailable.', true);
  }
}
function renderLibrary(blocks) {
  libraryList.replaceChildren();
  if (!blocks.length) {
    const empty = document.createElement('div');
    empty.className = 'custom-library-empty';
    empty.textContent = 'No custom blocks yet. Import a Bedrock geometry model and its textures above.';
    libraryList.append(empty);
    return;
  }
  for (const block of blocks) {
    const item = document.createElement('div');
    item.className = 'custom-library-item';
    const thumb = document.createElement('img');
    thumb.className = 'custom-library-thumb';
    thumb.alt = '';
    thumb.src = block.textureUrls?.['*'] || Object.values(block.textureUrls || {})[0] || '';
    const copy = document.createElement('div');
    copy.className = 'custom-library-copy';
    const title = document.createElement('strong');
    title.textContent = block.name;
    const id = document.createElement('small');
    id.textContent = block.id;
    copy.append(title, id);
    const use = document.createElement('button');
    use.type = 'button';
    use.textContent = 'Use block';
    use.addEventListener('click', () => {
      builder.selectBlock(block.id);
      closeDialog();
      if (window.matchMedia('(max-width: 900px)').matches) builder.setView('canvas');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'custom-delete';
    remove.textContent = 'Remove';
    const placed = builder.getPlacedCount(block.id);
    remove.disabled = placed > 0;
    remove.title = placed ? 'Remove placed instances from the workspace first.' : 'Delete this stored custom block';
    remove.addEventListener('click', async () => {
      if (!confirm('Delete ' + block.id + ' from the saved custom block library?')) return;
      remove.disabled = true;
      try {
        const response = await fetch(customBlocksApi + '?id=' + encodeURIComponent(block.id), { method: 'DELETE' });
        if (!response.ok) throw new Error('Could not remove this custom block.');
        builder.removeCustomBlock(block.id);
        loadCustomLibrary();
      } catch (error) {
        setMessage(libraryStatus, error.message, true);
        remove.disabled = false;
      }
    });
    item.append(thumb, copy, use, remove);
    libraryList.append(item);
  }
}
$('#refreshCustomLibrary').addEventListener('click', loadCustomLibrary);

blockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  importButton.disabled = true;
  setMessage(importStatus, 'Checking model and uploading assets…');
  try {
    await waitForBuilder();
    if (!customBlocksApi) throw new Error('Custom block uploads require the Hatchable backend; they are not supported on static GitHub Pages.');
    const blockId = $('#customBlockId').value.trim().toLowerCase();
    const blockName = $('#customBlockName').value.trim();
    const modelFile = $('#customBlockModel').files[0];
    const textureFiles = [...$('#customBlockTextures').files];
    const renderMode = $('#customBlockRenderMode').value;
    if (!validateBlockId(blockId)) throw new Error('Use a namespaced ID such as custom:ancient_oak.');
    if (!blockName || blockName.length > 80) throw new Error('Enter a block name up to 80 characters.');
    if (!modelFile || modelFile.size > 2 * 1024 * 1024) throw new Error('Choose one .geo.json model file (maximum 2 MB).');
    if (!textureFiles.length) throw new Error('Choose at least one PNG, JPG, or WebP texture.');
    if (textureFiles.length > 16) throw new Error('Upload up to 16 texture files per block.');
    const totalTextureBytes = textureFiles.reduce((total, file) => total + file.size, 0);
    if (textureFiles.some((file) => file.size > 5 * 1024 * 1024) || totalTextureBytes > 12 * 1024 * 1024) {
      throw new Error('Textures must be 5 MB each or less and 12 MB total or less.');
    }
    if (textureFiles.some((file) => !/\.(png|jpe?g|webp)$/i.test(file.name))) {
      throw new Error('Only PNG, JPG, and WebP textures are supported.');
    }
    let model;
    try { model = JSON.parse(await modelFile.text()); }
    catch { throw new Error('The model file is not valid JSON.'); }
    if (!validGeometry(model)) throw new Error('Model must contain minecraft:geometry with at least one valid cube.');
    if (model['minecraft:geometry'][0].bones.length > 128) throw new Error('The model has too many bones (128 maximum).');

    const formData = new FormData();
    formData.append('blockId', blockId);
    formData.append('blockName', blockName);
    formData.append('renderMode', renderMode);
    formData.append('model', modelFile, modelFile.name);
    for (const texture of textureFiles) formData.append('textures', texture, texture.name);
    const response = await fetch(customBlocksApi, { method: 'POST', body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The custom block upload failed.');
    registerLibraryBlock(payload.block);
    blockForm.reset();
    setMessage(importStatus, 'Saved ' + payload.block.id + ' to your custom block library.');
    await loadCustomLibrary();
  } catch (error) {
    setMessage(importStatus, error.message || 'The custom block import failed.', true);
  } finally {
    importButton.disabled = false;
  }
});

waitForBuilder().then(() => {
  loadCustomLibrary();
  $('#treeDimensions').textContent = 'Workspace ' + Object.values(builder.getWorkspace()).join(' × ');
}).catch(() => {});