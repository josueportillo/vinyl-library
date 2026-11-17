const S = require("../lib/store.js");

module.exports = async function handler(req, res) {
  const user = await S.getSessionUser(req);
  if (!user) return S.json(res, 401, { error: "Not authenticated" });
  const username = user.username;
  const path = `friends/${username}.json`;
  let friends = (await S.readJson(path)) || [];

  if (req.method === "GET") {
    return S.json(res, 200, { friends });
  }

  if (req.method === "POST") {
    const target = String((S.getBody(req).username) || "").trim().toLowerCase();
    if (!S.validUsername(target)) return S.json(res, 400, { error: "Invalid username" });
    if (target === username) return S.json(res, 400, { error: "You can't add yourself" });
    const tu = await S.getUser(target);
    if (!tu) return S.json(res, 404, { error: "User not found" });
    if (!friends.includes(target)) friends.push(target);
    await S.writeJson(path, friends);
    return S.json(res, 200, { friends });
  }

  if (req.method === "DELETE") {
    const target = String(req.query.username || "").trim().toLowerCase();
    friends = friends.filter((f) => f !== target);
    await S.writeJson(path, friends);
    return S.json(res, 200, { friends });
  }

  return S.json(res, 405, { error: "Method not allowed" });
};
