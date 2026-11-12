import { db, storage } from 'hatchable';
import crypto from 'node:crypto';

export const access = 'admin';
export const methods = ['GET', 'POST', 'DELETE'];

const MAX_MODEL_BYTES = 2 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_TEXTURE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

function textureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

async function clientBlock(row) {
  const keys = textureObject(row.texture_keys);
  const textureUrls = {};
  await Promise.all(Object.entries(keys).map(async ([name, key]) => {
    textureUrls[name] = await storage.url(key);
  }));
  return {
    id: row.block_id,
    name: row.block_name,
    model: row.model_json,
    textureUrls,
    renderMode: row.render_mode,
    updatedAt: row.updated_at
  };
}

function safeTextureName(filename) {
  const base = String(filename || 'texture.png').split(/[\\/]/).pop();
  return base.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 48) || 'texture';
}

function imageMatchesExtension(bytes, extension) {
  if (!bytes || bytes.length < 12) return false;
  if (extension === 'png') {
    return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
      bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  }
  if (extension === 'jpg' || extension === 'jpeg') {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (extension === 'webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

export default async function (req, res) {
  try {
    if (req.method === 'GET') {
      const result = await db.query(
        'SELECT block_id, block_name, model_json, texture_keys, render_mode, updated_at FROM custom_blocks ORDER BY updated_at DESC LIMIT 200'
      );
      const blocks = await Promise.all(result.rows.map(clientBlock));
      return res.json({ blocks });
    }

    if (req.method === 'DELETE') {
      const blockId = String(req.body?.blockId || req.query?.id || '').trim();
      if (!blockId) return res.status(400).json({ error: 'A block ID is required.' });
      const found = await db.query('SELECT texture_keys FROM custom_blocks WHERE block_id = $1', [blockId]);
      if (!found.rows.length) return res.status(404).json({ error: 'Custom block not found.' });
      await db.query('DELETE FROM custom_blocks WHERE block_id = $1', [blockId]);
      const keys = [...new Set(Object.values(textureObject(found.rows[0].texture_keys)))];
      await Promise.all(keys.map((key) => storage.del(key).catch(() => null)));
      return res.status(204).send('');
    }

    const blockId = String(req.body?.blockId || '').trim().toLowerCase();
    const blockName = String(req.body?.blockName || '').trim();
    const renderMode = String(req.body?.renderMode || 'cutout');
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(blockId) || blockId.length > 128) {
      return res.status(400).json({ error: 'Use a namespaced block ID, for example custom:ancient_oak.' });
    }
    if (!blockName || blockName.length > 80) {
      return res.status(400).json({ error: 'Block name is required and must be 80 characters or fewer.' });
    }
    if (!['opaque', 'cutout', 'transparent', 'double-sided'].includes(renderMode)) {
      return res.status(400).json({ error: 'Choose a valid render mode.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const modelFile = files.find((file) => file.field === 'model');
    const textureFiles = files.filter((file) => file.field === 'textures');
    if (!modelFile || !modelFile.buffer?.length) return res.status(400).json({ error: 'Upload one Bedrock .geo.json model file.' });
    if (modelFile.buffer.length > MAX_MODEL_BYTES) {
      return res.status(413).json({ error: 'Model file is too large (2 MB maximum).' });
    }
    if (!textureFiles.length) return res.status(400).json({ error: 'Upload at least one PNG, JPG, or WebP texture.' });
    if (textureFiles.length > 16) return res.status(400).json({ error: 'Upload up to 16 texture files per block.' });
    const textureBytes = textureFiles.reduce((sum, file) => sum + (file.buffer?.length || 0), 0);
    if (textureBytes > MAX_TOTAL_TEXTURE_BYTES || textureFiles.some((file) => file.buffer.length > MAX_TEXTURE_BYTES)) {
      return res.status(413).json({ error: 'Textures must be 5 MB each or less and 12 MB total or less.' });
    }
    const textureLabels = textureFiles.map((file) => safeTextureName(file.filename));
    if (new Set(textureLabels).size !== textureLabels.length) {
      return res.status(400).json({ error: 'Texture filenames must have unique names so model materials can be matched.' });
    }
    for (const file of textureFiles) {
      const extension = String(file.filename || '').split('.').pop().toLowerCase();
      if (!IMAGE_TYPES[extension] || !imageMatchesExtension(file.buffer, extension)) {
        return res.status(415).json({ error: 'Texture file contents must match a PNG, JPG, or WebP filename.' });
      }
    }

    let modelJson;
    try {
      modelJson = JSON.parse(new TextDecoder().decode(modelFile.buffer));
    } catch {
      return res.status(400).json({ error: 'The model file is not valid JSON.' });
    }
    const geometry = modelJson?.['minecraft:geometry']?.[0];
    if (!geometry || !Array.isArray(geometry.bones) || !geometry.bones.length) {
      return res.status(400).json({ error: 'The model must contain minecraft:geometry with at least one bone.' });
    }
    if (geometry.bones.length > 128) {
      return res.status(400).json({ error: 'The model has too many bones (128 maximum).' });
    }
    if (geometry.bones.some((bone) => bone.cubes !== undefined && !Array.isArray(bone.cubes))) {
      return res.status(400).json({ error: 'Every geometry bone must use a valid cubes array.' });
    }
    const cubes = geometry.bones.flatMap((bone) => bone.cubes || []);
    if (!cubes.length || cubes.length > 2048 || cubes.some((cube) =>
      !Array.isArray(cube.origin) || cube.origin.length !== 3 ||
      !Array.isArray(cube.size) || cube.size.length !== 3 ||
      [...cube.origin, ...cube.size].some((value) => !Number.isFinite(value)) ||
      cube.size.some((value) => value <= 0)
    )) {
      return res.status(400).json({ error: 'The model must contain 1–2,048 valid cubes with finite positions and positive dimensions.' });
    }

    const old = await db.query('SELECT texture_keys FROM custom_blocks WHERE block_id = $1', [blockId]);
    const textureKeys = {};
    const uploadedKeys = [];
    try {
      for (let index = 0; index < textureFiles.length; index += 1) {
        const file = textureFiles[index];
        const extension = String(file.filename).split('.').pop().toLowerCase();
        const contentType = IMAGE_TYPES[extension];
        const label = safeTextureName(file.filename);
        const key = 'custom-blocks/' + crypto.randomUUID() + '.' + extension;
        await storage.put(key, file.buffer, contentType);
        uploadedKeys.push(key);
        if (!textureKeys[label]) textureKeys[label] = key;
        if (!textureKeys['*']) textureKeys['*'] = key;
      }

      const saved = await db.query(
        'INSERT INTO custom_blocks (block_id, block_name, model_json, texture_keys, render_mode, updated_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, now()) ON CONFLICT (block_id) DO UPDATE SET block_name = EXCLUDED.block_name, model_json = EXCLUDED.model_json, texture_keys = EXCLUDED.texture_keys, render_mode = EXCLUDED.render_mode, updated_at = now() RETURNING block_id, block_name, model_json, texture_keys, render_mode, updated_at',
        [blockId, blockName, JSON.stringify(modelJson), JSON.stringify(textureKeys), renderMode]
      );
      if (old.rows.length) {
        const oldKeys = [...new Set(Object.values(textureObject(old.rows[0].texture_keys)))];
        await Promise.all(oldKeys.map((key) => storage.del(key).catch(() => null)));
      }
      return res.status(201).json({ block: await clientBlock(saved.rows[0]) });
    } catch (error) {
      await Promise.all(uploadedKeys.map((key) => storage.del(key).catch(() => null)));
      throw error;
    }
  } catch (error) {
    console.error('custom-blocks route failed', error);
    return res.status(500).json({ error: 'The custom block library could not be updated.' });
  }
}