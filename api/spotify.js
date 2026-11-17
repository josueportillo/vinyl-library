const S = require("../lib/store.js");

// Resolves a Spotify album (id + direct URL) for an "artist album" query,
// using the Spotify Web API client-credentials flow. Caches the access token.

async function getToken() {
  const cached = await S.readJson("spotify_token.json");
  if (cached && cached.token && cached.expiresAt > Date.now() + 60000) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  let data;
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: "grant_type=client_credentials",
    });
    data = await r.json();
  } catch (e) {
    return null;
  }
  if (!data.access_token) return null;
  await S.writeJson("spotify_token.json", {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}

module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  if (!q) return S.json(res, 400, { error: "Missing query" });

  const token = await getToken();
  if (!token) return S.json(res, 501, { error: "Spotify is not configured." });

  let data;
  try {
    const r = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return S.json(res, 502, { error: `Spotify search failed (${r.status}).` });
    data = await r.json();
  } catch (e) {
    return S.json(res, 502, { error: "Could not reach Spotify." });
  }

  const album = data.albums && data.albums.items && data.albums.items[0];
  if (!album) return S.json(res, 404, { error: "No Spotify match" });

  return S.json(res, 200, {
    id: album.id,
    name: album.name,
    artist: (album.artists || []).map((a) => a.name).join(", "),
    url: album.external_urls && album.external_urls.spotify,
    image: album.images && album.images[0] && album.images[0].url,
  });
};
