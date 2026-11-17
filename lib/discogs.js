const { authorization } = require("./oauth1.js");

const UA = "VinylLibrary/1.0 (personal project)";

// Signed/authenticated Discogs fetch.
// - If an OAuth token+secret is provided, uses OAuth 1.0a signing.
// - Else if DISCOGS_TOKEN is set, uses the personal-access-token header (read-only).
// - Else unauthenticated.
function discogsFetch(method, url, { token, tokenSecret, body } = {}) {
  const headers = { "User-Agent": UA };
  if (token) {
    headers.Authorization = authorization(method, url, process.env.DISCOGS_CONSUMER_KEY || "", process.env.DISCOGS_CONSUMER_SECRET || "", { token, tokenSecret });
  } else if (process.env.DISCOGS_TOKEN) {
    headers.Authorization = `Discogs token=${process.env.DISCOGS_TOKEN}`;
  }
  const opts = { method, headers };
  if (body) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(body).toString();
  }
  return fetch(url, opts);
}

// Add a release to the user's Discogs collection (folder 1 = Uncategorized).
async function addToCollection(user, releaseId) {
  const url = `https://api.discogs.com/users/${encodeURIComponent(user.discogsUsername)}/collection/folders/1/releases/${encodeURIComponent(releaseId)}`;
  return discogsFetch("POST", url, { token: user.discogsToken, tokenSecret: user.discogsTokenSecret });
}

async function getIdentity(token, tokenSecret) {
  return discogsFetch("GET", "https://api.discogs.com/oauth/identity", { token, tokenSecret });
}

// Fetch a user's full collection (paginated). Pass { token, tokenSecret } for
// authenticated access (private collections + higher rate limit).
async function fetchCollection(username, { token, tokenSecret } = {}) {
  const releases = [];
  let page = 1;
  while (page <= 50) {
    const url = `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=100`;
    const r = await discogsFetch("GET", url, { token, tokenSecret });
    if (r.status === 429) throw new Error("Discogs rate limit reached — wait a minute and re-sync.");
    if (r.status === 404) throw new Error(`Discogs user "${username}" not found, or the collection is private.`);
    if (!r.ok) throw new Error(`Discogs collection fetch failed (${r.status}).`);
    const data = await r.json();
    const items = data.releases || [];
    releases.push(...items);
    const pages = data.pagination && data.pagination.pages;
    if (items.length === 0 || !pages || page >= pages) break;
    page++;
  }
  return releases;
}

module.exports = { discogsFetch, addToCollection, getIdentity, fetchCollection };
