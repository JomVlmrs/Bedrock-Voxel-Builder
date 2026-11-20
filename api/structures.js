import { db } from "hatchable";
import { getTier } from "lib/billing.js";

export const access = "user";
export const methods = ["GET", "POST", "DELETE"];

const MAX_BLOCK_JSON_CHARS = 50_000_000;

function validDimension(value, tier) {
  return Number.isInteger(value) && value >= 1 && value <= tier.maxDimension;
}

function cleanBlocks(value, size, maxBlocks) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxBlocks) {
    throw new Error("A saved structure must contain between 1 and 32,768 blocks.");
  }
  const occupied = new Set();
  const clean = value.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error("The structure contains an invalid block record.");
    }
    const id = String(block.id || "").trim();
    const name = String(block.name || id).trim();
    const x = Number(block.x), y = Number(block.y), z = Number(block.z);
    if (!/^[a-z0-9_.-]+(?::[a-z0-9_./-]+)?$/i.test(id) || id.length > 128 ||
        !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
        x < 0 || y < 0 || z < 0 || x >= size.x || y >= size.y || z >= size.z) {
      throw new Error("A block has an invalid identifier or is outside the saved workspace.");
    }
    const key = x + "," + y + "," + z;
    if (occupied.has(key)) throw new Error("The structure contains two blocks in the same cell.");
    occupied.add(key);

    const sourceStates = block.states && typeof block.states === "object" && !Array.isArray(block.states)
      ? block.states : {};
    const states = {};
    for (const [stateKey, stateValue] of Object.entries(sourceStates).slice(0, 128)) {
      if (!/^[a-z0-9_.:-]{1,128}$/i.test(stateKey)) continue;
      if (typeof stateValue === "boolean" ||
          (typeof stateValue === "number" && Number.isFinite(stateValue)) ||
          (typeof stateValue === "string" && stateValue.length <= 256)) {
        states[stateKey] = stateValue;
      }
    }
    return { id, name: name.slice(0, 160), x, y, z, states };
  });
  if (JSON.stringify(clean).length > MAX_BLOCK_JSON_CHARS) {
    throw new Error("This structure is too large to store in the online library.");
  }
  return clean;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default async function (req, res) {
  try {
    if (req.method === "GET") {
      const id = req.query?.id;
      if (id !== undefined && id !== null && id !== "") {
        const parsedId = positiveId(id);
        if (!parsedId) return res.status(400).json({ error: "Invalid structure ID." });
        const result = await db.query(
          "SELECT id, name, size_x, size_y, size_z, blocks, coordinate_mode, origin_x, origin_y, origin_z, created_at, updated_at FROM saved_structures WHERE id = $1 LIMIT 1",
          [parsedId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Saved structure not found." });
        return res.json({ structure: result.rows[0] });
      }

      const result = await db.query(
        "SELECT id, name, size_x, size_y, size_z, jsonb_array_length(blocks) AS block_count, created_at, updated_at FROM saved_structures ORDER BY updated_at DESC LIMIT 100"
      );
      return res.json({ structures: result.rows });
    }

    if (req.method === "DELETE") {
      const id = positiveId(req.body?.id || req.query?.id);
      if (!id) return res.status(400).json({ error: "A valid structure ID is required." });
      const removed = await db.query(
        "DELETE FROM saved_structures WHERE id = $1 RETURNING id",
        [id]
      );
      if (!removed.rows.length) return res.status(404).json({ error: "Saved structure not found." });
      return res.json({ ok: true, id: removed.rows[0].id });
    }

    const profile = await db.query("SELECT display_name FROM account_profiles LIMIT 1");
    if (!profile.rows.length) {
      return res.status(409).json({ error: "Finish setting up your account name before saving structures." });
    }

    const entitlements = await db.query("SELECT tier FROM user_entitlements LIMIT 1");
    const tier = getTier(entitlements.rows[0]?.tier || "free");

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const sourceSize = req.body?.size || {};
    const size = {
      x: Number(sourceSize.x),
      y: Number(sourceSize.y),
      z: Number(sourceSize.z)
    };
    if (name.length < 1 || name.length > 80) {
      return res.status(400).json({ error: "Structure name is required (80 characters maximum)." });
    }
    if (!validDimension(size.x, tier) || !validDimension(size.y, tier) || !validDimension(size.z, tier) ||
        size.x * size.y * size.z > tier.maxVolume) {
      return res.status(400).json({ error: "The saved workspace exceeds your " + tier.name + " plan limits." });
    }

    const blocks = cleanBlocks(req.body?.blocks, size, tier.maxVolume);
    const coordinateMode = req.body?.coordinateMode === "absolute" ? "absolute" : "relative";
    const origin = Array.isArray(req.body?.origin) ? req.body.origin : [0, 0, 0];
    const ox = Number.isInteger(Number(origin[0])) ? Number(origin[0]) : 0;
    const oy = Number.isInteger(Number(origin[1])) ? Number(origin[1]) : 0;
    const oz = Number.isInteger(Number(origin[2])) ? Number(origin[2]) : 0;
    const id = req.body?.id ? positiveId(req.body.id) : null;
    if (req.body?.id && !id) return res.status(400).json({ error: "Invalid structure ID." });

    if (id) {
      const updated = await db.query(
        "UPDATE saved_structures SET name = $2, size_x = $3, size_y = $4, size_z = $5, blocks = $6::jsonb, coordinate_mode = $7, origin_x = $8, origin_y = $9, origin_z = $10, updated_at = now() WHERE id = $1 RETURNING id, name, updated_at",
        [id, name, size.x, size.y, size.z, JSON.stringify(blocks), coordinateMode, ox, oy, oz]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Saved structure not found." });
      return res.json({ structure: updated.rows[0] });
    }

    const created = await db.query(
      "INSERT INTO saved_structures (name, size_x, size_y, size_z, blocks, coordinate_mode, origin_x, origin_y, origin_z) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id, name, updated_at",
      [name, size.x, size.y, size.z, JSON.stringify(blocks), coordinateMode, ox, oy, oz]
    );
    return res.status(201).json({ structure: created.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The structure library request failed.";
    console.error("structures route failed", error);
    if (/must contain|invalid block|outside the saved|same cell|too large|identifier/i.test(message)) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: "The structure library could not be updated." });
  }
}