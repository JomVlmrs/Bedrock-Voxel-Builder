import { db } from "hatchable";

export const access = "user";
export const methods = ["GET", "POST"];

export default async function (req, res) {
  if (req.method === "GET") {
    const result = await db.query(
      "SELECT display_name, created_at, updated_at FROM account_profiles LIMIT 1"
    );
    return res.json({ profile: result.rows[0] || null });
  }

  const displayName = String(req.body?.displayName || "").trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 32) {
    return res.status(400).json({ error: "Choose a name between 2 and 32 characters." });
  }
  if (/[<>\u0000-\u001f]/.test(displayName)) {
    return res.status(400).json({ error: "That name contains unsupported characters." });
  }

  const saved = await db.query(
    "INSERT INTO account_profiles (display_name) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now() RETURNING display_name, created_at, updated_at",
    [displayName]
  );
  return res.json({ profile: saved.rows[0] });
}