const S = require("../../lib/store.js");

// Single dynamic-route function handling all /api/auth/* actions:
// signup, login, logout, me, google, google-callback

module.exports = async function handler(req, res) {
  const action = String(req.query.action || "").toLowerCase();

  if (action === "signup") {
    if (req.method !== "POST") return S.json(res, 405, { error: "Method not allowed" });
    const { username, password } = S.getBody(req);
    const u = String(username || "").trim().toLowerCase();
    if (!S.validUsername(u)) {
      return S.json(res, 400, { error: "Username must be 2-30 chars: letters, numbers, _ . -" });
    }
    if (!password || String(password).length < 6) {
      return S.json(res, 400, { error: "Password must be at least 6 characters." });
    }
    const existing = await S.getUser(u);
    if (existing) return S.json(res, 409, { error: "That username is already taken." });
    await S.writeJson(`users/${u}.json`, {
      username: u,
      email: "",
      provider: "local",
      passwordHash: S.hashPassword(password),
      createdAt: Date.now(),
    });
    await S.writeJson(`libraries/${u}.json`, []);
    await S.writeJson(`friends/${u}.json`, []);
    await S.createSession(res, u);
    return S.json(res, 200, { username: u, email: "", provider: "local" });
  }

  if (action === "login") {
    if (req.method !== "POST") return S.json(res, 405, { error: "Method not allowed" });
    const { username, password } = S.getBody(req);
    const u = String(username || "").trim().toLowerCase();
    const user = await S.getUser(u);
    if (!user || !user.passwordHash || !S.verifyPassword(password, user.passwordHash)) {
      return S.json(res, 401, { error: "Invalid username or password." });
    }
    await S.createSession(res, u);
    return S.json(res, 200, { username: u, email: user.email || "", provider: user.provider || "local" });
  }

  if (action === "logout") {
    const token = S.parseCookies(req)[S.SESSION_COOKIE];
    await S.destroySession(res, token);
    return S.json(res, 200, { ok: true });
  }

  if (action === "me") {
    const user = await S.getSessionUser(req);
    if (!user) return S.json(res, 401, { error: "Not authenticated" });
    return S.json(res, 200, user);
  }

  if (action === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return S.json(res, 501, { error: "Google sign-in is not configured yet." });
    }
    const redirectUri = `${S.baseUrl(req)}/api/auth/google-callback`;
    const state = S.newToken();
    res.setHeader(
      "Set-Cookie",
      `vinyl_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`
    );
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
      }).toString();
    res.setHeader("Location", url);
    return res.status(302).end();
  }

  if (action === "google-callback") {
    const { code, state, error } = req.query;
    if (error || !code) {
      res.setHeader("Location", "/");
      return res.status(302).end();
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return S.json(res, 501, { error: "Google sign-in is not configured yet." });
    }
    const cookies = S.parseCookies(req);
    if (!cookies.vinyl_oauth_state || cookies.vinyl_oauth_state !== state) {
      res.setHeader("Location", "/?auth=error");
      return res.status(302).end();
    }
    const redirectUri = `${S.baseUrl(req)}/api/auth/google-callback`;

    let tokenData;
    try {
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      tokenData = await tr.json();
    } catch (e) {
      res.setHeader("Location", "/?auth=error");
      return res.status(302).end();
    }
    if (!tokenData.access_token) {
      res.setHeader("Location", "/?auth=error");
      return res.status(302).end();
    }

    let info;
    try {
      const ir = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      info = await ir.json();
    } catch (e) {
      res.setHeader("Location", "/?auth=error");
      return res.status(302).end();
    }

    const email = String(info.email || "");
    const username = email.split("@")[0].toLowerCase();
    if (!S.validUsername(username)) {
      res.setHeader("Location", "/?auth=error");
      return res.status(302).end();
    }

    let user = await S.getUser(username);
    if (!user) {
      user = { username, email, provider: "google", createdAt: Date.now() };
      await S.writeJson(`users/${username}.json`, user);
      await S.writeJson(`libraries/${username}.json`, []);
      await S.writeJson(`friends/${username}.json`, []);
    } else if (!user.email) {
      user.email = email;
      await S.writeJson(`users/${username}.json`, user);
    }

    await S.createSession(res, username);
    res.setHeader("Location", "/");
    return res.status(302).end();
  }

  return S.json(res, 404, { error: "Unknown auth action" });
};
