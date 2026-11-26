# Changelog

All notable changes to the Vinyl Library app are documented in this file.

Every time a feature is added or changed, add a new entry under `[Unreleased]`, then move it into a dated release when it ships. Format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses date-based versioning.

---

## [Unreleased]

### Added
- (none yet)

### Changed
- (none yet)

---

## [1.3.0] — 2026-11-26 — Richer search results (year, label, country & vinyl color)

### Added
- **Vinyl color in search results** — each vinyl pressing now shows a small color swatch dot plus the color text (e.g. "Mint", "Crystal Clear", "Red / Blue Splatter") when the edition has a non-black vinyl color, so you can tell it's the right edition before opening it.
- **Year, label & country in search results** — search result rows now also show the release year, label, and country/region, alongside the existing artist/title/format, making it easier to identify the exact edition at a glance.

### Changed
- **Search endpoint enrichment** — the server-side Discogs search proxy now fetches each vinyl result's release detail (concurrency-limited and time-bounded) to extract the vinyl color from the format's free-text field, with word-boundary matching so words like "Remastered" (→ "red") and "White Label" (→ "white", a promo pressing) aren't misread as colors. Falls back to an empty color when Discogs rate-limits.

### Fixed
- Fixed vinyl color never appearing — the color was being read from Discogs' `descriptions` field (which holds "LP", "Album", etc.) instead of the `text` field where the actual color lives.

---

## [1.2.1] — 2026-11-26 — Mobile topbar fixes

### Changed
- **Mobile topbar** — on small screens the header now stacks into two rows: "Vinyl Library" (with record count) on the first line, and the nav buttons (Discogs, Friends, Share, Crate Digger, Scan) on the second line in a single horizontally scrollable strip, so they no longer wrap and spill under the title.
- **Log in / Log out pinned top-right** — the account control now sits in the top-right corner on the same line as the app title (instead of at the end of the scrollable nav strip), so it's always visible without scrolling.

### Fixed
- Topbar buttons no longer wrap out of place or overlap the "Vinyl Library" title on mobile.

---

## [1.2.0] — 2026-11-26 — Free-text search, photo browsing & Crate Digger

### Added
- **Free-text Discogs search** — add a record by searching album name, artist, or label (no barcode needed). The scan screen now offers a "search" box alongside barcode scanning; results flow through the same pressing-selection and preview screens.
- **Photo browsing before you add** — the pre-add preview now shows a browsable gallery of every photo in the release (front/back cover, labels, inner sleeve), so you can confirm it's the right edition before adding it — thumbnails plus a click-to-enlarge lightbox with swipe.
- **Crate Digger** — a new section that turns any barcode into an instant preview: a Spotify mini player for the album plus its Wikipedia write-up, without adding it to your library. Built for flipping through unknown crates at a record store.
- **Wikipedia description** on the album detail view — a short "About this album" paragraph pulled from the album's Wikipedia article (the intro extract, resolved server-side by searching artist + title), shown below the turntable animation and above the tracklist, with a "Source: Wikipedia" link for attribution.

### Changed
- **Release detail now returns the barcode** (from Discogs identifiers) so albums added by text search also record their barcode, and the preview shows the edition's real barcode.

---

## [1.1.0] — 2026-11-17 — Visual & interaction overhaul

### Added
- **Crate view** — a 3D record-crate carousel. Navigate with left/right arrow keys on desktop or a finger swipe on mobile; the focused album enlarges while its neighbors recede.
- **Turntable spin** animation on the album detail view.
- **Image gallery + lightbox** on album detail, with touch-swipe navigation.
- **Ambient warm background lighting**, a gradient brand logo, the `Bricolage Grotesque` display font, glow rings on focused inputs, and a styled scrollbar and text selection.
- **Vinyl reveal on hover** — the album sleeve slides aside to reveal a spinning record (with a rotating light-shine so the motion reads).

### Changed
- **Grid**: album cards are now straight (removed the resting micro-rotation and entrance tilt).
- **Crate**: covers stay straight (removed the tilt and spinning-disc reveal inside the crate).
- **Default sort** changed from "Recently added" to **Artist A–Z**.
- **Default view** changed from Grid to **Crate**.
- **Crate focus scaling** tuned over several iterations — final values: focused sleeve scales to **1.1**, side sleeves to **0.85** (side sleeves also dim to 50% opacity).

### Fixed
- Added `prefers-reduced-motion` support so all new animations respect the user's accessibility setting.
- Live search no longer triggers the card-stagger animation, keeping keystrokes instant and free of flicker.

---

## [1.0.0] — 2026-11-01 — Initial release

### Added
- **Barcode scanning** via the phone camera (`html5-qrcode` v2.3.8, vendored locally — no CDN dependency).
- **Manual EAN/UPC barcode entry** as a fallback.
- **Discogs lookup** through serverless proxies: barcode → release search, and full release detail (artist, title, year, label, catalog number, genre, style, country, cover art, tracklist, credits, band members, gallery images).
- **Pressing selection** when a barcode matches multiple releases (common with represses).
- **PWA** — manifest + generated icons, installable to a home screen.
- **Responsive dark theme** for mobile and desktop.
- **Username / password accounts** — scrypt-hashed passwords, timing-safe comparison, 30-day `HttpOnly` session cookies.
- **Google OAuth sign-in** — username derived from the part of the email before the `@`.
- **Cloud sync** — library moved from `localStorage` to a private Vercel Blob JSON store, so it's the same on every device.
- **Friends system** — add/remove friends and view their libraries.
- **Browse any user's library** by username.
- **Public share links** (`/u/<username>`) — read-only, no login required.
- **Discogs collection import** from a username or collection link — paginated and rate-limit aware, skipping records already in the library.
- **Re-sync + "forget link"** controls for the Discogs import.
- **Discogs OAuth 1.0a account connection** — from-scratch HMAC-SHA1 signing (`lib/oauth1.js`), auto-mirrors newly added records to the user's Discogs collection and enables private-collection imports.
- **"Listen on" links** — Spotify and YouTube Music search links on every album page.
- **Spotify mini player** — backend resolves an "artist + album" query to a Spotify album ID (client-credentials flow with token caching) and embeds an in-page player.

### Fixed
- Relaxed the username minimum from 3 to 2 characters so two-letter usernames (e.g. "jp") work.
