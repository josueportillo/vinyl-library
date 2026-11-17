// Vercel serverless function: proxy Discogs barcode -> release search.
// Hides the Discogs token (if set) server-side and avoids browser CORS issues.

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || "";
const UA = "VinylLibrary/1.0 (personal project)";

function dedupe(arr) {
  if (!Array.isArray(arr)) return arr ? [String(arr)] : [];
  return [...new Set(arr.filter(Boolean).map(String))];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const raw = String(req.query.barcode || "");
  const barcode = raw.replace(/[^0-9]/g, "");
  if (!barcode || barcode.length < 8 || barcode.length > 14) {
    return res.status(400).json({ error: "Barcode must be 8-14 digits." });
  }

  const qs = new URLSearchParams({ barcode, type: "release", per_page: "10", page: "1" });
  const headers = { "User-Agent": UA };
  if (DISCOGS_TOKEN) headers.Authorization = `Discogs token=${DISCOGS_TOKEN}`;

  try {
    const r = await fetch(`https://api.discogs.com/database/search?${qs}`, { headers });
    if (r.status === 429) {
      return res.status(429).json({ error: "Discogs rate limit reached. Wait a minute and try again." });
    }
    if (!r.ok) {
      return res.status(502).json({ error: `Discogs search failed (${r.status}).` });
    }
    const data = await r.json();
    const results = (data.results || []).map((x) => ({
      id: x.id,
      title: x.title || "",
      year: x.year || "",
      format: dedupe(x.format),
      label: dedupe(x.label),
      genre: dedupe(x.genre),
      style: dedupe(x.style),
      country: x.country || "",
      catno: x.catno || "",
      resource_url: x.resource_url || "",
    }));
    return res.status(200).json({ barcode, count: results.length, results });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Discogs.", message: String(e && e.message) });
  }
};
