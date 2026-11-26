// Vercel serverless function: proxy Discogs release detail lookup.
// Returns normalized album data: artist, title, cover, all images, credits,
// members (band members / personnel), tracklist, format descriptions, etc.

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || "";
const UA = "VinylLibrary/1.0 (personal project)";
const { extractColors } = require("../lib/colors.js");

function dedupe(arr) {
  if (!Array.isArray(arr)) return arr ? [String(arr)] : [];
  return [...new Set(arr.filter(Boolean).map(String))];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const id = String(req.query.id || "").replace(/[^0-9]/g, "");
  if (!id) return res.status(400).json({ error: "Release id required." });

  const headers = { "User-Agent": UA };
  if (DISCOGS_TOKEN) headers.Authorization = `Discogs token=${DISCOGS_TOKEN}`;

  try {
    const r = await fetch(`https://api.discogs.com/releases/${id}`, { headers });
    if (r.status === 429) {
      return res.status(429).json({ error: "Discogs rate limit reached. Wait a minute and try again." });
    }
    if (!r.ok) {
      return res.status(502).json({ error: `Discogs release lookup failed (${r.status}).` });
    }
    const d = await r.json();

    const artist = dedupe((d.artists || []).map((a) => a.name)).join(", ");
    const artists = dedupe((d.artists || []).map((a) => a.name));
    const formats = (d.formats || []).map((f) =>
      [f.name, ...(f.descriptions || [])].filter(Boolean).join(", ")
    );
    const color = extractColors(d.formats);
    const descriptions = dedupe((d.formats || []).flatMap((f) => f.descriptions || []));
    const formatNames = dedupe((d.formats || []).map((f) => f.name));
    const label = dedupe((d.labels || []).map((l) => l.name));
    const catno = dedupe((d.labels || []).map((l) => l.catno)).join(", ");

    // The EAN/UPC barcode (when Discogs lists one) — lets text-searched albums
    // also record their barcode, and lets the preview show the edition's barcode.
    const barcode = ((d.identifiers || []).find((i) => /barcode/i.test(i.type || "")) || {}).value || "";

    // release-level credits (producers, engineers, featured artists, etc.)
    const credits = (d.extraartists || [])
      .filter((a) => a.name)
      .map((a) => ({ name: a.name, role: a.role || "", anv: a.anv || "" }));

    // everyone credited anywhere: main artists + release credits + track-level credits
    const memberSet = new Set();
    (d.artists || []).forEach((a) => a.name && memberSet.add(a.name));
    (d.extraartists || []).forEach((a) => a.name && memberSet.add(a.name));
    (d.tracklist || []).forEach((t) => {
      (t.artists || []).forEach((a) => a.name && memberSet.add(a.name));
      (t.extraartists || []).forEach((a) => a.name && memberSet.add(a.name));
    });
    const members = [...memberSet];

    const images = (d.images || []).map((im) => ({
      uri: im.uri || "",
      resource_url: im.resource_url || im.uri || "",
      uri150: im.uri150 || "",
      type: im.type || "",
      width: im.width || 0,
      height: im.height || 0,
    }));
    const cover = images.length ? images[0].resource_url || images[0].uri150 || "" : "";
    const thumb = images.length ? images[0].uri150 || images[0].resource_url || "" : "";

    const tracklist = (d.tracklist || []).map((t) => ({
      position: t.position || "",
      title: t.title || "",
      duration: t.duration || "",
    }));

    return res.status(200).json({
      id: d.id,
      title: d.title || "",
      artist,
      artists,
      year: d.year || "",
      released: d.released || "",
      genres: d.genres || [],
      styles: d.styles || [],
      label,
      catno,
      format: formats,
      descriptions,
      formatNames,
      color,
      country: d.country || "",
      barcode,
      cover,
      thumb,
      images,
      credits,
      members,
      tracklist,
      uri: d.uri || "",
      notes: d.notes || "",
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Discogs.", message: String(e && e.message) });
  }
};
