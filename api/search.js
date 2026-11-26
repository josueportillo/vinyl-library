// Vercel serverless function: proxy Discogs release search.
// Supports two modes:
//   ?barcode=<digits>  -> barcode -> release search (for the "Scan" flow)
//   ?q=<free text>     -> full-text search by album / artist / label (for the
//                         "search Discogs" flow)
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

  const barcode = String(req.query.barcode || "").replace(/[^0-9]/g, "");
  const q = String(req.query.q || "").trim();

  let qs;
  if (barcode) {
    if (barcode.length < 8 || barcode.length > 14) {
      return res.status(400).json({ error: "Barcode must be 8-14 digits." });
    }
    qs = new URLSearchParams({ barcode, type: "release", per_page: "10", page: "1" });
  } else if (q) {
    // type=release biases the results toward records rather than artist/label
    // pages; q is Discogs' free-text search (matches title, artist, label, …).
    qs = new URLSearchParams({ q, type: "release", per_page: "25", page: "1" });
  } else {
    return res.status(400).json({ error: "Provide a barcode or a search query (q)." });
  }

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
      thumb: x.thumb || x.cover_image || "",
    }));
    return res.status(200).json({ barcode: barcode || "", query: q, count: results.length, results });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Discogs.", message: String(e && e.message) });
  }
};
