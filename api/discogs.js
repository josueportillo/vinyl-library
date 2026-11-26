const S = require("../lib/store.js");
const { fetchCollection } = require("../lib/discogs.js");
const { extractColors } = require("../lib/colors.js");

function dedupe(arr) {
  if (!Array.isArray(arr)) return arr ? [String(arr)] : [];
  return [...new Set(arr.filter(Boolean).map(String))];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Accepts a full Discogs collection URL or a bare username.
function parseDiscogsUsername(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const m = s.match(/discogs\.com\/user\/([a-zA-Z0-9_.-]+)/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_.-]{2,30}$/.test(s)) return s;
  return null;
}

function fromBasicInfo(bi) {
  const cover = bi.cover_image || bi.thumb || "";
  const descriptions = dedupe((bi.formats || []).flatMap((f) => f.descriptions || []));
  return {
    discogsId: bi.id,
    title: bi.title || "",
    artist: dedupe((bi.artists || []).map((a) => a.name)).join(", "),
    year: bi.year || "",
    format: (bi.formats || []).map((f) => [f.name, ...(f.descriptions || [])].filter(Boolean).join(", ")),
    color: extractColors(bi.formats),
    label: dedupe((bi.labels || []).map((l) => l.name)),
    catno: dedupe((bi.labels || []).map((l) => l.catno)).join(", "),
    genre: bi.genres || [],
    style: bi.styles || [],
    country: bi.country || "",
    cover,
    thumb: bi.thumb || cover,
    images: cover ? [{ resource_url: cover, type: "primary" }] : [],
    descriptions,
    formatNames: dedupe((bi.formats || []).map((f) => f.name)),
    tracklist: [],
    credits: [],
    members: [],
    discogsUrl: bi.id ? `https://www.discogs.com/release/${bi.id}` : "",
    addedAt: new Date().toISOString(),
  };
}

module.exports = async function handler(req, res) {
  const user = await S.getSessionUser(req);
  if (!user) return S.json(res, 401, { error: "Not authenticated" });
  const username = user.username;
  const userPath = `users/${username}.json`;

  if (req.method === "GET") {
    const u = await S.getUser(username);
    return S.json(res, 200, { discogsUsername: (u && u.discogsUsername) || null });
  }

  if (req.method === "DELETE") {
    const u = await S.getUser(username);
    if (u) {
      delete u.discogsUsername;
      await S.writeJson(userPath, u);
    }
    return S.json(res, 200, { discogsUsername: null });
  }

  if (req.method === "POST") {
    const body = S.getBody(req);
    const u = await S.getUser(username);
    // Use the pasted link/username, else the connected Discogs account's username.
    let discogsUser = parseDiscogsUsername(body.url || body.username);
    if (!discogsUser && u && u.discogsUsername) discogsUser = u.discogsUsername;
    if (!discogsUser) {
      return S.json(res, 400, { error: "Enter a Discogs username or link, or connect your Discogs account." });
    }

    let releases;
    try {
      releases = await fetchCollection(discogsUser, {
        token: u && u.discogsToken,
        tokenSecret: u && u.discogsTokenSecret,
      });
    } catch (e) {
      return S.json(res, 502, { error: e.message });
    }

    const imported = releases.map((r) => fromBasicInfo(r.basic_information)).filter((a) => a.discogsId);
    const lib = (await S.readJson(`libraries/${username}.json`)) || [];
    const existing = new Set(lib.map((a) => String(a.discogsId)));
    let added = 0;
    let skipped = 0;
    for (const album of imported) {
      const key = String(album.discogsId);
      if (existing.has(key)) { skipped++; continue; }
      album._id = uid();
      existing.add(key);
      lib.push(album);
      added++;
    }
    await S.writeJson(`libraries/${username}.json`, lib);

    const u2 = await S.getUser(username);
    u2.discogsUsername = discogsUser;
    await S.writeJson(userPath, u2);

    return S.json(res, 200, {
      discogsUsername: discogsUser,
      added,
      skipped,
      total: lib.length,
      collectionTotal: imported.length,
    });
  }

  return S.json(res, 405, { error: "Method not allowed" });
};
