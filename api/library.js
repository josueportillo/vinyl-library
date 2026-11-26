const S = require("../lib/store.js");
const { addToCollection } = require("../lib/discogs.js");

module.exports = async function handler(req, res) {
  const user = await S.getSessionUser(req);
  if (!user) return S.json(res, 401, { error: "Not authenticated" });
  const username = user.username;
  const libPath = `libraries/${username}.json`;

  if (req.method === "GET") {
    const lib = (await S.readJson(libPath)) || [];
    return S.json(res, 200, { username, library: lib });
  }

  if (req.method === "POST") {
    const album = S.getBody(req);
    if (!album || !album.discogsId || !album.title) {
      return S.json(res, 400, { error: "Invalid album data" });
    }
    const lib = (await S.readJson(libPath)) || [];
    if (lib.some((a) => String(a.discogsId) === String(album.discogsId))) {
      return S.json(res, 409, { error: "Already in your library" });
    }
    album._id = album._id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    album.addedAt = album.addedAt || new Date().toISOString();
    lib.push(album);
    await S.writeJson(libPath, lib);

    // If the user connected their Discogs account, mirror the add to their
    // Discogs collection (best-effort — never fails the app-level add).
    let discogs = null;
    const u = await S.getUser(username);
    if (u && u.discogsToken && u.discogsUsername && album.discogsId) {
      try {
        const dr = await addToCollection(u, album.discogsId);
        discogs = { synced: dr.ok || dr.status === 409 || dr.status === 201 };
      } catch (e) {
        discogs = { synced: false };
      }
    }
    return S.json(res, 200, { username, library: lib, discogs });
  }

  if (req.method === "PATCH") {
    // Lightweight update for lazy enrichment (color, tracklist, credits, etc.).
    const body = S.getBody(req);
    const id = String(body && body.discogsId || "");
    if (!id) return S.json(res, 400, { error: "discogsId required" });
    const lib = (await S.readJson(libPath)) || [];
    const album = lib.find((a) => String(a.discogsId) === id);
    if (!album) return S.json(res, 404, { error: "Album not in library" });
    for (const k of ["color", "descriptions", "formatNames", "tracklist", "credits", "members", "images", "cover", "thumb", "label", "genre", "style", "catno"]) {
      if (body[k] !== undefined) album[k] = body[k];
    }
    await S.writeJson(libPath, lib);
    return S.json(res, 200, { username, library: lib });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    const lib = (await S.readJson(libPath)) || [];
    const next = lib.filter((a) => a._id !== id && String(a.discogsId) !== id);
    await S.writeJson(libPath, next);
    return S.json(res, 200, { username, library: next });
  }

  return S.json(res, 405, { error: "Method not allowed" });
};
