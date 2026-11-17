const S = require("../../lib/store.js");
const { authorization } = require("../../lib/oauth1.js");
const { getIdentity } = require("../../lib/discogs.js");

const CONSUMER_KEY = process.env.DISCOGS_CONSUMER_KEY || "";
const CONSUMER_SECRET = process.env.DISCOGS_CONSUMER_SECRET || "";
const UA = "VinylLibrary/1.0 (personal project)";

function callbackUrl(req) {
  return `${S.baseUrl(req)}/api/discogs-oauth/callback`;
}

module.exports = async function handler(req, res) {
  const action = String(req.query.action || "").toLowerCase();

  if (action === "start") {
    const user = await S.getSessionUser(req);
    if (!user) return S.json(res, 401, { error: "Not authenticated" });
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
      return S.json(res, 501, { error: "Discogs OAuth is not configured." });
    }
    const cb = callbackUrl(req);
    const auth = authorization("POST", "https://api.discogs.com/oauth/request_token", CONSUMER_KEY, CONSUMER_SECRET, { callback: cb });
    let text;
    try {
      const r = await fetch("https://api.discogs.com/oauth/request_token", { method: "POST", headers: { Authorization: auth, "User-Agent": UA } });
      text = await r.text();
    } catch (e) {
      return S.json(res, 502, { error: "Could not reach Discogs." });
    }
    const params = new URLSearchParams(text);
    const oauthToken = params.get("oauth_token");
    const oauthTokenSecret = params.get("oauth_token_secret");
    if (!oauthToken) return S.json(res, 502, { error: "Discogs request token failed." });
    await S.writeJson(`discogs_oauth/${oauthToken}.json`, {
      username: user.username,
      tokenSecret: oauthTokenSecret,
      createdAt: Date.now(),
    });
    res.setHeader("Location", `https://www.discogs.com/oauth/authorize?oauth_token=${encodeURIComponent(oauthToken)}`);
    return res.status(302).end();
  }

  if (action === "callback") {
    const { oauth_token, oauth_verifier } = req.query;
    if (!oauth_token || !oauth_verifier) {
      res.setHeader("Location", "/?discogs=error");
      return res.status(302).end();
    }
    const temp = await S.readJson(`discogs_oauth/${oauth_token}.json`);
    if (!temp) {
      res.setHeader("Location", "/?discogs=error");
      return res.status(302).end();
    }
    await S.deleteBlob(`discogs_oauth/${oauth_token}.json`);

    const auth = authorization("POST", "https://api.discogs.com/oauth/access_token", CONSUMER_KEY, CONSUMER_SECRET, {
      token: oauth_token,
      tokenSecret: temp.tokenSecret,
      verifier: oauth_verifier,
    });
    let text;
    try {
      const r = await fetch("https://api.discogs.com/oauth/access_token", { method: "POST", headers: { Authorization: auth, "User-Agent": UA } });
      text = await r.text();
    } catch (e) {
      res.setHeader("Location", "/?discogs=error");
      return res.status(302).end();
    }
    const params = new URLSearchParams(text);
    const accessToken = params.get("oauth_token");
    const accessTokenSecret = params.get("oauth_token_secret");
    if (!accessToken) {
      res.setHeader("Location", "/?discogs=error");
      return res.status(302).end();
    }

    let discogsUsername = "";
    try {
      const idr = await getIdentity(accessToken, accessTokenSecret);
      if (idr.ok) {
        const idData = await idr.json();
        discogsUsername = idData.username || "";
      }
    } catch (e) { /* ignore */ }

    const u = await S.getUser(temp.username);
    if (u) {
      u.discogsToken = accessToken;
      u.discogsTokenSecret = accessTokenSecret;
      if (discogsUsername) u.discogsUsername = discogsUsername;
      await S.writeJson(`users/${temp.username}.json`, u);
    }
    res.setHeader("Location", "/?discogs=connected");
    return res.status(302).end();
  }

  if (action === "status") {
    const user = await S.getSessionUser(req);
    if (!user) return S.json(res, 401, { error: "Not authenticated" });
    const u = await S.getUser(user.username);
    return S.json(res, 200, {
      configured: !!(CONSUMER_KEY && CONSUMER_SECRET),
      connected: !!(u && u.discogsToken),
      discogsUsername: (u && u.discogsUsername) || null,
    });
  }

  if (action === "disconnect") {
    const user = await S.getSessionUser(req);
    if (!user) return S.json(res, 401, { error: "Not authenticated" });
    const u = await S.getUser(user.username);
    if (u) {
      delete u.discogsToken;
      delete u.discogsTokenSecret;
      delete u.discogsUsername;
      await S.writeJson(`users/${user.username}.json`, u);
    }
    return S.json(res, 200, { connected: false, discogsUsername: null });
  }

  return S.json(res, 404, { error: "Unknown action" });
};
