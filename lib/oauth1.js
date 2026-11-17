const crypto = require("crypto");

// OAuth 1.0a (HMAC-SHA1) signing helpers for the Discogs API.

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

// Build an OAuth 1.0a Authorization header.
// options: { token, tokenSecret, callback, verifier }
// URL query parameters are folded into the signature automatically.
function authorization(method, url, consumerKey, consumerSecret, options = {}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
  if (options.token) oauth.oauth_token = options.token;

  const sigParams = { ...oauth };
  if (options.callback) sigParams.oauth_callback = options.callback;
  if (options.verifier) sigParams.oauth_verifier = options.verifier;

  const qIndex = url.indexOf("?");
  const baseUrl = qIndex >= 0 ? url.slice(0, qIndex) : url;
  if (qIndex >= 0) {
    new URLSearchParams(url.slice(qIndex + 1)).forEach((v, k) => { sigParams[k] = v; });
  }

  const sorted = Object.keys(sigParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(sigParams[k])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(sorted)}`;
  const key = `${percentEncode(consumerSecret)}&${percentEncode(options.tokenSecret || "")}`;
  oauth.oauth_signature = crypto.createHmac("sha1", key).update(baseString).digest("base64");

  const headerParams = { ...oauth };
  if (options.callback) headerParams.oauth_callback = options.callback;
  if (options.verifier) headerParams.oauth_verifier = options.verifier;

  const header = Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

module.exports = { authorization, percentEncode };
