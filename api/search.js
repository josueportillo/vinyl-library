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

// Color keywords used to surface a release's vinyl color from its format
// descriptions, so the user can identify the exact pressing in the search list.
const COLOR_KEYWORDS = [
  "black", "blue", "red", "green", "yellow", "orange", "purple", "pink",
  "white", "clear", "transparent", "translucent", "gold", "silver", "brown",
  "grey", "gray", "marbled", "marble", "splatter", "smoke", "swirl",
  "coke bottle", "half and half", "picture disc", "opaque", "multicolor",
  "multi-color", "multi-colour", "multicolour", "coloured", "colored",
  "turquoise", "teal", "magenta", "amber", "beige", "cream", "lavender",
  "burgundy", "crimson", "navy", "violet", "indigo", "ruby", "emerald", "neon",
  "mint", "olive", "aqua", "copper", "bronze", "tan", "charcoal", "bone",
  "rust", "coral", "peach", "champagne", "salmon"
];

// Word-boundary matchers so a color like "red" is not matched inside an
// unrelated word (e.g. "Remastered" ends in "red").
const COLOR_PATTERNS = COLOR_KEYWORDS.map((k) => {
  const safe = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${safe}\\b`, "i");
});

function extractColors(formats) {
  const out = [];
  const seen = new Set();
  for (const f of (formats || [])) {
    // The vinyl color lives in the format's free-text field (e.g. "Clear",
    // "Mint", "Purple / White") and occasionally in descriptions ("Picture
    // Disc"). Check both so we don't miss colored pressings.
    const candidates = [
      ...(f.descriptions || []),
      ...(f.text ? [f.text] : []),
    ];
    for (const raw of candidates) {
      const s = String(raw).trim();
      if (!s) continue;
      if (/white\s+label/i.test(s)) continue; // promo/test pressing, not a color
      if (COLOR_PATTERNS.some((re) => re.test(s)) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

// Enrich each Vinyl result with its color by fetching the release detail.
// Concurrency-limited and time-bounded so a slow / rate-limited Discogs call
// never hangs the search; any failure just leaves that result's color empty.
async function enrichVinylColors(results, headers) {
  const vinyl = results.filter((x) =>
    (x.format || []).some((f) => /vinyl/i.test(String(f)))
  );
  if (!vinyl.length) return results;
  const deadline = Date.now() + 6000;
  const CONCURRENCY = 5;
  const queue = [...vinyl];
  let rateLimited = false;
  const worker = async () => {
    while (queue.length && Date.now() < deadline && !rateLimited) {
      const x = queue.shift();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const rr = await fetch(`https://api.discogs.com/releases/${x.id}`, {
          headers,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (rr.status === 429) {
          rateLimited = true; // stop hammering; leave remaining colors empty
        } else if (rr.ok) {
          const d = await rr.json();
          x.color = extractColors(d.formats);
        }
      } catch (e) {
        /* leave color empty */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, vinyl.length) }, worker)
  );
  return results;
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
      color: [],
    }));
    await enrichVinylColors(results, headers);
    return res.status(200).json({ barcode: barcode || "", query: q, count: results.length, results });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Discogs.", message: String(e && e.message) });
  }
};
