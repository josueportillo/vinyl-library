// Vercel serverless function: proxy a Wikipedia album-article lookup.
// Returns a short plain-text description of the album (the article intro)
// so the detail view can show an "About this album" paragraph pulled from
// Wikipedia, with a link back to the source article for attribution.

const UA = "VinylLibrary/1.0 (personal project)";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Cache-Control",
    "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
  );

  const title = String(req.query.title || "").trim();
  const artist = String(req.query.artist || "").trim();
  const q = [title, artist].filter(Boolean).join(" ").trim();
  if (!q) return res.status(400).json({ error: "Album title required." });

  // One request: search Wikipedia for the album, and return the intro extract
  // of the top result. "artist + title" biases the search toward the album
  // article over same-named songs or people.
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrlimit: "1",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    format: "json",
  });

  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `Wikipedia lookup failed (${r.status}).` });
    }
    const data = await r.json();
    const pages = (data && data.query && data.query.pages) || {};
    const page = Object.values(pages)[0] || {};
    const extract = String(page.extract || "").trim();
    const pageTitle = String(page.title || "").trim();

    if (!extract) {
      return res.status(200).json({ title: "", extract: "", url: "" });
    }

    const url = pageTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`
      : "";

    return res.status(200).json({ title: pageTitle, extract, url });
  } catch (e) {
    return res.status(502).json({
      error: "Could not reach Wikipedia.",
      message: String(e && e.message),
    });
  }
};
