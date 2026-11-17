# Vinyl Library

A web-based LP / vinyl record cataloger. Point your phone camera at a barcode on an album sleeve, and Vinyl Library looks the record up on Discogs, fills in the details, and files it in your personal cloud library — searchable, shareable, and styled like flipping through a real record crate.

Live demo: https://vinyl-library-kohl.vercel.app

Built as a 100% web app (no native build) with a responsive mobile + desktop UI. It runs as a multi-user service on Vercel serverless functions with Vercel Blob for storage.

---

## Features

### Adding records

- **Barcode scanning** — use your phone camera to read the barcode on an album sleeve (`html5-qrcode`, vendored locally so there is no CDN dependency). Works over HTTPS on mobile.
- **Manual barcode entry** — type an EAN/UPC when you don't have the sleeve handy.
- **Discogs lookup** — the barcode is resolved against the Discogs API, which auto-fills the artist, title, year, label, catalog number, genre, style, country, cover art, full tracklist, credits, band members, and gallery images.
- **Pressing selection** — when one barcode matches several releases (common with represses), you pick the exact pressing before adding it.

### Browsing the collection

- **Three views**:
  - **Grid** — a clean shelf of straight album covers.
  - **Crate** — a 3D record-crate carousel where the focused album enlarges while its neighbors recede. Navigate with left/right arrow keys on desktop or a finger swipe on mobile.
  - **By Artist** — grouped browsing.
- **Search** across artist, title, song, band member, or year.
- **Sort** by Artist A–Z (default), Title A–Z, Year (oldest or newest first), or Recently added.
- **Category filters** by genre/style.
- **Album detail** — full tracklist, credits, and an image gallery with a lightbox (swipe to change image on mobile) plus a spinning turntable animation.

### Discogs integration

- **Collection import** — paste a Discogs username or collection link to bulk-import a whole collection, skipping records already in your library. Paginated and rate-limit aware.
- **Re-sync / forget** — re-sync any time to pick up new additions, or forget the link and point at a different account.
- **Account connection (OAuth 1.0a)** — connect your Discogs account so newly added records are mirrored back to your Discogs collection automatically, and so private collections can be imported without pasting a link. The OAuth 1.0a HMAC-SHA1 signing is implemented from scratch in `lib/oauth1.js`.

### Streaming links

- **"Listen on" buttons** on every album page — Spotify and YouTube Music search links.
- **Spotify mini player** — when Spotify credentials are configured, the backend resolves an "artist + album" query to a real Spotify album ID (client-credentials flow with token caching) and embeds an in-page player so you can preview tracks without leaving the app.

### Accounts & sharing

- **Username / password** signup and login — passwords hashed with scrypt and compared with `crypto.timingSafeEqual`; sessions are 30-day signed cookies stored as blobs (`HttpOnly`, `Secure` in production).
- **Google sign-in** — username is derived from the part of the email before the `@`.
- **Public share links** — `/u/<username>` gives anyone a read-only view of your library (no login required; add/remove/scan controls are hidden).
- **Friends** — add friends by username, browse any user's library.

### Platform

- **PWA** — manifest + icons, installable to a home screen.
- **Responsive** — a single codebase serves mobile and desktop.
- **Dark, warm theme** — ambient background light, `Bricolage Grotesque` display font, gradient logo, depth and glow, with `prefers-reduced-motion` support.

---

## Architecture

- **Frontend** — vanilla HTML/CSS/JS single-page app (`index.html`, `style.css`, `app.js`). No framework, no build step.
- **Backend** — thin Vercel serverless functions under `api/` (Node 22).
- **Storage** — Vercel Blob with all blobs private. Each user's data lives in three JSON blobs: `users/<u>.json`, `libraries/<u>.json`, `friends/<u>.json`. Sessions are stored as `sessions/<token>.json`.
- **Auth** — scrypt password hashing + signed sessions; OAuth 1.0a (Discogs) and OAuth 2.0 (Google) implemented server-side.

### Project structure

```
vinyl-library/
├── index.html               # App shell (all views + modals)
├── style.css                # Full styling / theming / animations
├── app.js                   # Frontend SPA logic
├── manifest.json            # PWA manifest
├── vercel.json              # Vercel config (rewrites, headers, function duration)
├── package.json             # Node 22 engine + @vercel/blob
├── api/
│   ├── auth/[action].js     # signup, login, logout, me, google, google-callback
│   ├── library.js           # CRUD for the logged-in user's library
│   ├── users/[username].js  # Public read-only library view
│   ├── friends.js           # Friends list management
│   ├── discogs.js           # Discogs collection import / re-sync / forget
│   ├── discogs-oauth/[action].js  # Discogs OAuth connect flow
│   ├── search.js            # Discogs barcode → release search proxy
│   ├── release.js           # Discogs release detail proxy
│   ├── spotify.js           # Spotify album resolution (client-credentials)
│   └── config.js            # Which integrations are enabled
├── lib/
│   ├── store.js             # Blob JSON store, scrypt hashing, sessions, cookies
│   ├── discogs.js           # Signed Discogs fetch + collection helpers
│   └── oauth1.js            # OAuth 1.0a HMAC-SHA1 signing
├── vendor/
│   └── html5-qrcode.min.js  # Vendored barcode scanner (v2.3.8)
└── icons/                   # PWA + favicon icons
```

### API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/auth/google` | Start Google OAuth (302) |
| `GET` | `/api/auth/google-callback` | Google OAuth callback |
| `GET` | `/api/library` | Get own library |
| `POST` | `/api/library` | Add an album (dedupes by Discogs ID, mirrors to Discogs if connected) |
| `DELETE` | `/api/library?id=` | Remove an album |
| `GET` | `/api/users/:username` | Public read-only library |
| `GET` | `/api/friends` | List friends |
| `POST` | `/api/friends` | Add a friend |
| `DELETE` | `/api/friends?username=` | Remove a friend |
| `POST` | `/api/discogs` | Import a Discogs collection |
| `GET` | `/api/discogs` | Get connected Discogs username |
| `DELETE` | `/api/discogs` | Forget the Discogs link |
| `GET` | `/api/discogs-oauth/status` | OAuth connection status |
| `GET` | `/api/discogs-oauth/start` | Begin Discogs OAuth (302) |
| `GET` | `/api/discogs-oauth/callback` | Discogs OAuth callback |
| `POST` | `/api/discogs-oauth/disconnect` | Disconnect Discogs |
| `GET` | `/api/search?barcode=` | Discogs barcode → release search |
| `GET` | `/api/release?id=` | Discogs release detail (normalized) |
| `GET` | `/api/spotify?q=` | Spotify album resolution |
| `GET` | `/api/config` | Which integrations are enabled |

---

## Local development

Prerequisites: Node 22, and a Vercel Blob store with a read/write token.

```bash
git clone https://github.com/josueportillo/vinyl-library.git
cd vinyl-library
npm install

# Create your local env file
cp .env.example .env.local
# then fill in BLOB_READ_WRITE_TOKEN (and any optional integration keys)

# Run the dev server
vercel dev
```

`vercel dev` emulates the serverless functions locally. The app also works with a plain static server for the frontend, but the API functions need the Blob token.

---

## Deployment

The app is deployed on Vercel. From the project directory:

```bash
vercel --prod
```

Set the environment variables in `.env.example` under Vercel → Settings → Environment Variables (or `vercel env add`).

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob storage access |
| `DISCOGS_TOKEN` | No | Discogs personal access token (read-only fallback) |
| `DISCOGS_CONSUMER_KEY` | No | Discogs OAuth 1.0a (account connection) |
| `DISCOGS_CONSUMER_SECRET` | No | Discogs OAuth 1.0a (account connection) |
| `GOOGLE_CLIENT_ID` | No | Google sign-in |
| `GOOGLE_CLIENT_SECRET` | No | Google sign-in |
| `SPOTIFY_CLIENT_ID` | No | Spotify mini player + direct album links |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify mini player + direct album links |

---

## Security notes

- Passwords are hashed with scrypt (per-user random salt) and verified with `crypto.timingSafeEqual`.
- Sessions are random 256-bit tokens stored as blobs with a 30-day expiry and delivered via `HttpOnly` / `Secure` / `SameSite=Lax` cookies.
- Ownership is enforced server-side — the public `/api/users/:username` endpoint is read-only, and add/remove operations check the session user.
- Third-party API keys (Discogs, Google, Spotify) are read only from `process.env` server-side and never shipped to the client.
- `lib/oauth1.js` implements OAuth 1.0a signing locally so no OAuth library or token is exposed client-side.

---

## License

Personal project — no license specified yet.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Every feature addition or change is recorded there.
