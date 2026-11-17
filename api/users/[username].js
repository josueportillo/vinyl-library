const S = require("../../lib/store.js");

// Public, read-only: any visitor (logged in or not) can view a user's library.
module.exports = async function handler(req, res) {
  const username = String(req.query.username || "").toLowerCase();
  if (!S.validUsername(username)) {
    return S.json(res, 400, { error: "Invalid username" });
  }
  const user = await S.getUser(username);
  if (!user) return S.json(res, 404, { error: "User not found" });
  const library = (await S.readJson(`libraries/${username}.json`)) || [];
  return S.json(res, 200, { username, exists: true, library });
};
