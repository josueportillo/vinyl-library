"use strict";

// ---------- State ----------
let currentUser = null;      // { username, email, provider } | null
let viewingUsername = null;  // set when viewing another user's library (share/browse)
let library = [];
let scanResults = [];
let scanBarcode = "";
let scanQuery = "";
let currentPreview = null;
let scanner = null;
let scanLock = false;
let diggerScanner = null;
let diggerLock = false;
let authMode = "login";      // "login" | "signup"
let googleEnabled = false;
let spotifyEnabled = false;
let viewMode = "crate";
let crateIndex = 0;
let filtersOpen = false;
let activeFilters = { genre: new Set(), style: new Set(), country: new Set(), edition: new Set() };

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtList(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.filter(Boolean).join(", ");
}

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = "toast"), 3200);
}

function showView(id) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
  window.scrollTo(0, 0);
}

// Attach a horizontal swipe gesture. onLeft fires on a leftward swipe
// (flick to the right → previous), onRight on a rightward swipe. Ignores
// vertical scrolls and taps below the threshold.
function addSwipe(el, onLeft, onRight) {
  if (!el) return;
  let startX = null, startY = null;
  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = null; startY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // tap or vertical scroll
    if (dx < 0) onLeft();
    else onRight();
  }, { passive: true });
}

function canEditMode() {
  return !!currentUser && !viewingUsername;
}

async function api(path, method = "GET", body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let data = null;
  try {
    const res = await fetch(path, opts);
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: "Network error" } };
  }
}

// ---------- Edition / search helpers ----------
function classifyEdition(descriptions) {
  const d = (descriptions || []).map((s) => String(s).toLowerCase());
  const tags = [];
  if (d.includes("reissue")) tags.push("Reissue");
  if (d.includes("remastered") || d.includes("remaster")) tags.push("Remastered");
  if (d.includes("repress")) tags.push("Repress");
  if (d.includes("compilation")) tags.push("Compilation");
  if (d.includes("live")) tags.push("Live");
  if (d.includes("picture disc")) tags.push("Picture Disc");
  if (tags.length === 0) tags.push("Original");
  return tags;
}

function buildSearchText(a) {
  const flat = [];
  const walk = (x) => {
    if (x == null) return;
    if (Array.isArray(x)) x.forEach(walk);
    else flat.push(String(x));
  };
  walk([
    a.artist, a.title, a.year, a.released, a.label, a.catno, a.barcode, a.country,
    a.genre, a.style, a.format, a.descriptions, a.formatNames, a.edition, a.members,
  ]);
  if (Array.isArray(a.credits)) a.credits.forEach((c) => walk([c.name, c.role]));
  if (Array.isArray(a.tracklist)) a.tracklist.forEach((t) => walk([t.title, t.position]));
  return flat.join(" ").toLowerCase();
}

function normalizeAlbum(a) {
  if (!Array.isArray(a.genre)) a.genre = [];
  if (!Array.isArray(a.style)) a.style = [];
  if (!Array.isArray(a.format)) a.format = [];
  if (!Array.isArray(a.label)) a.label = [];
  if (!Array.isArray(a.descriptions)) a.descriptions = [];
  if (!Array.isArray(a.formatNames)) a.formatNames = [];
  if (!Array.isArray(a.images)) a.images = a.cover ? [{ resource_url: a.cover, type: "primary" }] : [];
  if (!Array.isArray(a.credits)) a.credits = [];
  if (!Array.isArray(a.members)) a.members = [];
  if (!Array.isArray(a.tracklist)) a.tracklist = [];
  if (!Array.isArray(a.edition)) a.edition = classifyEdition(a.descriptions.length ? a.descriptions : a.format);
  a.searchText = buildSearchText(a);
  return a;
}

// ---------- Auth ----------
async function loadOwnLibrary() {
  const r = await api("/api/library");
  library = r.ok ? (r.data.library || []).map(normalizeAlbum) : [];
  updateCount();
}

async function loadPublicLibrary(username) {
  const r = await api(`/api/users/${encodeURIComponent(username)}`);
  if (!r.ok) return false;
  viewingUsername = r.data.username;
  library = (r.data.library || []).map(normalizeAlbum);
  updateCount();
  return true;
}

async function doLogin(username, password) {
  const r = await api("/api/auth/login", "POST", { username, password });
  if (!r.ok) return r.data?.error || "Login failed";
  currentUser = r.data;
  viewingUsername = null;
  await loadOwnLibrary();
  renderTopbar();
  renderPublicBanner();
  renderLibrary();
  showView("viewLibrary");
  history.replaceState(null, "", "/");
  return null;
}

async function doSignup(username, password) {
  const r = await api("/api/auth/signup", "POST", { username, password });
  if (!r.ok) return r.data?.error || "Signup failed";
  currentUser = r.data;
  viewingUsername = null;
  await loadOwnLibrary();
  renderTopbar();
  renderPublicBanner();
  renderLibrary();
  showView("viewLibrary");
  history.replaceState(null, "", "/");
  return null;
}

async function doLogout() {
  await api("/api/auth/logout", "POST");
  currentUser = null;
  viewingUsername = null;
  library = [];
  renderTopbar();
  renderPublicBanner();
  showView("viewAuth");
}

function setAuthMode(mode) {
  authMode = mode;
  $("#tabLogin").classList.toggle("active", mode === "login");
  $("#tabSignup").classList.toggle("active", mode === "signup");
  $("#authTitle").textContent = mode === "signup" ? "Create your account" : "Log in";
  $("#authSubmit").textContent = mode === "signup" ? "Sign up" : "Log in";
  $("#authPassword").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#authError").textContent = "";
}

async function submitAuth() {
  const username = $("#authUsername").value.trim();
  const password = $("#authPassword").value;
  const err = $("#authError");
  err.textContent = "";
  if (!username || !password) { err.textContent = "Enter a username and password."; return; }
  const msg = authMode === "signup" ? await doSignup(username, password) : await doLogin(username, password);
  if (msg) err.textContent = msg;
}

function renderTopbar() {
  const area = $("#authArea");
  const corner = $("#authCorner");
  if (viewingUsername) {
    area.innerHTML = currentUser
      ? `<button class="btn btn-ghost" data-action="back">← My library</button>`
      : ``;
    corner.innerHTML = currentUser
      ? `<span class="user-chip">${esc(currentUser.username)}</span>
         <button class="btn btn-ghost" data-action="logout">Log out</button>`
      : `<button class="btn btn-ghost" data-action="login">Log in</button>`;
    return;
  }
  if (currentUser) {
    area.innerHTML = `
      <button class="btn btn-ghost" data-action="discogs">Discogs</button>
      <button class="btn btn-ghost" data-action="friends">Friends</button>
      <button class="btn btn-ghost" data-action="share">Share</button>
      <button class="btn btn-ghost" data-action="digger">Crate Digger</button>
      <button class="btn btn-primary" data-action="scan">Scan</button>`;
    corner.innerHTML = `<span class="user-chip">${esc(currentUser.username)}</span><button class="btn btn-ghost" data-action="logout" title="Log out">Log out</button>`;
  } else {
    area.innerHTML = ``;
    corner.innerHTML = `<button class="btn btn-primary" data-action="login">Log in</button>`;
  }
}

function renderPublicBanner() {
  const banner = $("#publicBanner");
  if (viewingUsername) {
    banner.classList.remove("hidden");
    banner.innerHTML = `Viewing <b>${esc(viewingUsername)}</b>'s library — ${library.length} record${library.length === 1 ? "" : "s"}`;
  } else {
    banner.classList.add("hidden");
    banner.innerHTML = "";
  }
}

function updateCount() {
  $("#countLabel").textContent = `${library.length} record${library.length === 1 ? "" : "s"}`;
}

// ---------- Filtering ----------
function fieldValues(a, key) {
  if (key === "edition") return a.edition || [];
  if (key === "country") return a.country ? [a.country] : [];
  return a[key] || [];
}

function matchesFilters(a) {
  for (const cat of ["genre", "style", "country", "edition"]) {
    const active = activeFilters[cat];
    if (!active.size) continue;
    const vals = fieldValues(a, cat).map((v) => String(v).toLowerCase());
    if (![...active].some((f) => vals.includes(f))) return false;
  }
  return true;
}

function getFilteredAndSorted() {
  const q = ($("#libSearch").value || "").trim().toLowerCase();
  const sort = $("#libSort").value;
  let items = library.filter(matchesFilters);
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    items = items.filter((a) => {
      const t = a.searchText || buildSearchText(a);
      return tokens.every((tok) => t.includes(tok));
    });
  }
  items.sort((a, b) => {
    switch (sort) {
      case "artist_asc": return (a.artist || "").localeCompare(b.artist || "");
      case "title_asc": return (a.title || "").localeCompare(b.title || "");
      case "year_asc": return (Number(a.year) || 0) - (Number(b.year) || 0);
      case "year_desc": return (Number(b.year) || 0) - (Number(a.year) || 0);
      default: return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
    }
  });
  return items;
}

function distinctValues(key) {
  const set = new Set();
  library.forEach((a) => fieldValues(a, key).forEach((v) => { if (v) set.add(String(v).trim()); }));
  return [...set].sort((x, y) => x.localeCompare(y));
}

function countFor(key, v) {
  return library.filter((a) =>
    fieldValues(a, key).some((x) => String(x).trim().toLowerCase() === v.toLowerCase())
  ).length;
}

function renderCategoryChips() {
  const wrap = $("#filterPanel");
  wrap.innerHTML = "";
  const cats = [
    { key: "genre", label: "Genre" },
    { key: "style", label: "Style" },
    { key: "country", label: "Country" },
    { key: "edition", label: "Release" },
  ];
  for (const cat of cats) {
    const values = distinctValues(cat.key);
    if (!values.length) continue;
    const sec = document.createElement("div");
    sec.className = "filter-group";
    sec.innerHTML = `<div class="filter-label">${cat.label}</div><div class="filter-chips"></div>`;
    const chips = sec.querySelector(".filter-chips");
    values.forEach((v) => {
      const chip = document.createElement("button");
      const active = activeFilters[cat.key].has(v.toLowerCase());
      chip.className = "chip" + (active ? " active" : "");
      chip.textContent = `${v} · ${countFor(cat.key, v)}`;
      chip.addEventListener("click", () => toggleFilter(cat.key, v));
      chips.appendChild(chip);
    });
    wrap.appendChild(sec);
  }
  updateFilterSummary();
}

function toggleFilter(key, v) {
  const k = v.toLowerCase();
  if (activeFilters[key].has(k)) activeFilters[key].delete(k);
  else activeFilters[key].add(k);
  renderLibrary();
}

function clearFilters() {
  activeFilters = { genre: new Set(), style: new Set(), country: new Set(), edition: new Set() };
  renderLibrary();
}

function updateFilterSummary() {
  const total = Object.values(activeFilters).reduce((n, s) => n + s.size, 0);
  $("#filterCount").textContent = total ? `${total}` : "";
  $("#btnClearFilters").classList.toggle("hidden", total === 0);
}

// ---------- Library rendering ----------
function renderLibrary(animate = true) {
  renderCategoryChips();
  const items = getFilteredAndSorted();
  const grid = $("#libraryGrid");
  grid.innerHTML = "";
  const canEdit = canEditMode();

  if (library.length === 0) {
    $("#emptyState").classList.remove("hidden");
    $("#emptyTitle").textContent = canEdit ? "Your shelves are empty" : "No records yet";
    $("#emptyText").textContent = canEdit
      ? "Scan the barcode on an album sleeve to add your first record. Discogs fills in the details automatically."
      : `${viewingUsername || "This user"} hasn't added any records yet.`;
    $("#btnScanEmpty").classList.toggle("hidden", !canEdit);
  } else {
    $("#emptyState").classList.add("hidden");
  }

  if (library.length > 0 && items.length === 0) {
    grid.className = "grid";
    grid.innerHTML = `<p class="no-results">No records match your search or filters.</p>`;
    return;
  }

  if (viewMode === "artists") {
    grid.className = "artists-view";
    renderByArtist(items, grid, animate);
  } else if (viewMode === "crate") {
    renderCrate(items, grid, animate);
  } else {
    grid.className = "grid";
    items.forEach((a, i) => {
      const card = albumCard(a);
      if (animate) card.style.setProperty("--i", Math.min(i, 22));
      grid.appendChild(card);
    });
  }
  grid.classList.toggle("settle", animate && viewMode !== "crate");
}

function albumCard(a) {
  const card = document.createElement("div");
  card.className = "album-card";
  const cover = a.cover
    ? `<img src="${esc(a.cover)}" alt="${esc(a.title)}" loading="lazy">`
    : `<div class="cover-placeholder">♪</div>`;
  card.innerHTML = `
    <div class="cover">${cover}</div>
    <div class="meta">
      <div class="artist">${esc(a.artist || "Unknown artist")}</div>
      <div class="title">${esc(a.title)}</div>
      <div class="sub">${esc(a.year || "")}${a.edition && a.edition.length ? " · " + esc(a.edition.join(" · ")) : ""}</div>
    </div>`;
  card.addEventListener("click", () => openDetail(a._id));
  // 3D tilt toward the cursor — makes each sleeve feel like a physical object.
  card.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty("--rx", ((0.5 - py) * -12).toFixed(2) + "deg");
    card.style.setProperty("--ry", ((px - 0.5) * 14).toFixed(2) + "deg");
    card.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
    card.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
    card.classList.add("tilting");
  });
  card.addEventListener("pointerleave", () => card.classList.remove("tilting"));
  return card;
}

function sortKeyArtist(name) {
  return String(name || "").replace(/^(the|a|an)\s+/i, "").trim().toLowerCase();
}

function renderByArtist(items, container, animate) {
  const groups = new Map();
  items.forEach((a) => {
    const key = (a.artist || "Unknown artist").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });
  const sorted = [...groups.entries()].sort(([ka], [kb]) => sortKeyArtist(ka).localeCompare(sortKeyArtist(kb)));
  let gi = 0;
  for (const [artist, albums] of sorted) {
    const sec = document.createElement("div");
    sec.className = "artist-section";
    sec.innerHTML = `<div class="artist-heading">${esc(artist)} <span class="artist-count">${albums.length}</span></div>
      <div class="artist-albums"></div>`;
    const wrap = sec.querySelector(".artist-albums");
    albums.forEach((a) => {
      const card = albumCard(a);
      if (animate) card.style.setProperty("--i", Math.min(gi, 22));
      gi++;
      wrap.appendChild(card);
    });
    container.appendChild(sec);
  }
}

// ---------- Crate view (flip through your records like a bin) ----------
const CRATE_SPREAD = 3;

function crateItems() {
  return getFilteredAndSorted();
}

function renderCrate(items, container, animate) {
  container.className = "crate-view";
  container.innerHTML = "";
  const n = items.length;
  if (n === 0) return;
  if (crateIndex >= n) crateIndex = 0;
  for (let d = -CRATE_SPREAD; d <= CRATE_SPREAD; d++) {
    const idx = (crateIndex + d + n) % n;
    container.appendChild(crateSleeve(items[idx], idx));
  }
  const count = document.createElement("div");
  count.className = "crate-count";
  container.appendChild(count);
  const hint = document.createElement("div");
  hint.className = "crate-hint";
  container.appendChild(hint);
  syncCrate(container, items, animate);
  if (animate) container.classList.add("crate-anim");
}

function crateSleeve(a, globalIdx) {
  const sleeve = document.createElement("div");
  sleeve.className = "crate-sleeve";
  sleeve.dataset.index = globalIdx;
  sleeve._albumId = a._id;
  const cover = a.cover
    ? `<img src="${esc(a.cover)}" alt="${esc(a.title)}" loading="lazy">`
    : `<div class="cover-placeholder">♪</div>`;
  sleeve.innerHTML = `
    <div class="crate-sleeve-inner">
      <div class="crate-cover">${cover}</div>
      <div class="crate-meta">
        <div class="crate-artist">${esc(a.artist || "Unknown artist")}</div>
        <div class="crate-title">${esc(a.title)}</div>
      </div>
    </div>`;
  return sleeve;
}

// Reconcile the fan of sleeves around the current crateIndex without a full
// rebuild, so arrow-key flips animate smoothly.
function syncCrate(container, items, stagger) {
  const n = items.length;
  if (!n) return;
  const existing = new Map();
  container.querySelectorAll(".crate-sleeve").forEach((s) => existing.set(Number(s.dataset.index), s));
  const wanted = new Set();
  for (let d = -CRATE_SPREAD; d <= CRATE_SPREAD; d++) {
    const idx = (crateIndex + d + n) % n;
    wanted.add(idx);
    let s = existing.get(idx);
    if (!s) {
      s = crateSleeve(items[idx], idx);
      container.insertBefore(s, container.querySelector(".crate-count") || null);
    }
    applyCrateTransform(s, d, idx, stagger ? Math.abs(d) * 60 : 0);
  }
  existing.forEach((s, idx) => { if (!wanted.has(idx)) s.remove(); });
  updateCrateMeta(container, items);
}

function applyCrateTransform(sleeve, d, idx, delayMs) {
  sleeve.classList.toggle("front", d === 0);
  sleeve.style.setProperty("--dx", d);
  sleeve.style.setProperty("--dry", d);
  sleeve.style.setProperty("--dz", Math.abs(d));
  sleeve.style.setProperty("--sc", d === 0 ? 1.5 : 0.85);
  sleeve.style.setProperty("--op", d === 0 ? 1 : 0.5);
  sleeve.style.setProperty("--z", 100 - Math.abs(d));
  sleeve.style.setProperty("--delay", delayMs + "ms");
  sleeve.onclick = () => {
    if (d === 0) { openDetail(sleeve._albumId); return; }
    crateIndex = idx;
    syncCrate($("#libraryGrid"), crateItems(), false);
  };
}

function updateCrateMeta(container, items) {
  const count = container.querySelector(".crate-count");
  if (count) count.textContent = `${crateIndex + 1} / ${items.length}`;
  const hint = container.querySelector(".crate-hint");
  if (hint) hint.textContent = items.length === 1 ? "Click the sleeve to open" : "Use ← → to flip · click a sleeve to open";
}

function navigateCrate(delta) {
  const items = crateItems();
  if (!items.length) return;
  crateIndex = (crateIndex + delta + items.length) % items.length;
  syncCrate($("#libraryGrid"), items, false);
}

// ---------- Scanning ----------
async function startScan() {
  if (!canEditMode()) return;
  showView("viewScan");
  scanLock = false;
  const status = $("#scanStatus");
  status.classList.remove("error");
  status.textContent = "Starting camera…";

  if (!window.Html5Qrcode) {
    status.textContent = "Barcode library failed to load — use manual entry below.";
    status.classList.add("error");
    return;
  }

  await stopScanner();
  scanner = new Html5Qrcode("qrReader");
  const formats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.ITF,
  ];
  try {
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        formatsToSupport: formats,
        qrbox: (vw, vh) => ({ width: Math.min(vw * 0.82, 320), height: Math.min(vh * 0.5, 130) }),
      },
      (decodedText) => {
        if (scanLock) return;
        scanLock = true;
        const barcode = String(decodedText).replace(/[^0-9]/g, "");
        stopScanner();
        lookupBarcode(barcode);
      },
      () => {}
    );
    status.textContent = "Camera active — align the barcode inside the box.";
  } catch (err) {
    status.textContent = "Couldn't access the camera: " + (err && err.message ? err.message : err);
    status.classList.add("error");
  }
}

async function stopScanner() {
  if (scanner) {
    const s = scanner;
    scanner = null;
    try { await s.stop(); } catch (e) {}
    try { s.clear(); } catch (e) {}
  }
}

function manualLookup() {
  const v = ($("#manualBarcode").value || "").replace(/[^0-9]/g, "");
  if (!v) { toast("Enter a barcode first.", true); return; }
  stopScanner();
  lookupBarcode(v);
}

// ---------- Discogs lookup ----------
async function runDiscogsSearch(qs, loadingSummary) {
  showView("viewResults");
  $("#resultsSummary").textContent = loadingSummary;
  $("#resultsList").innerHTML = `<div class="loading">Searching…</div>`;
  try {
    const r = await api(`/api/search?${qs}`);
    if (!r.ok) throw new Error(r.data?.error || "Search failed");
    if (r.data.barcode) scanBarcode = r.data.barcode;
    if (r.data.query) scanQuery = r.data.query;
    scanResults = r.data.results || [];
    if (scanResults.length === 0) {
      $("#resultsSummary").textContent = "";
      $("#resultsList").innerHTML = noMatchHtml(scanQuery
        ? `No Discogs release found for “${esc(scanQuery)}”.`
        : `No Discogs release found for barcode ${esc(scanBarcode)}.`);
      bindInlineActions();
      return;
    }
    if (scanResults.length === 1) { selectRelease(scanResults[0].id); return; }
    renderResults();
  } catch (e) {
    $("#resultsSummary").textContent = "";
    $("#resultsList").innerHTML = noMatchHtml(esc(e.message || "Something went wrong."));
    bindInlineActions();
  }
}

function lookupBarcode(barcode) {
  scanQuery = "";
  scanBarcode = barcode;
  return runDiscogsSearch(`barcode=${encodeURIComponent(barcode)}`, `Barcode ${barcode} — searching Discogs…`);
}

function lookupText(q) {
  scanBarcode = "";
  scanQuery = q;
  return runDiscogsSearch(`q=${encodeURIComponent(q)}`, `Searching Discogs for “${q}”…`);
}

function textSearch() {
  const v = ($("#textSearch").value || "").trim();
  if (!v) { toast("Enter an album, artist, or label to search.", true); return; }
  stopScanner();
  lookupText(v);
}

function noMatchHtml(msg) {
  return `<div class="empty-inline"><p>${msg}</p>
    <button class="btn btn-primary" id="btnScanAgain">Scan again</button>
    <button class="btn btn-ghost" id="btnBackAgain">← Library</button></div>`;
}

function bindInlineActions() {
  document.getElementById("btnScanAgain")?.addEventListener("click", () => startScan());
  document.getElementById("btnBackAgain")?.addEventListener("click", () => showView("viewLibrary"));
}

function renderResults() {
  $("#resultsSummary").textContent = scanQuery
    ? `${scanResults.length} releases matched “${esc(scanQuery)}”. Pick yours:`
    : `${scanResults.length} pressings matched barcode ${esc(scanBarcode)}. Pick yours:`;
  const list = $("#resultsList");
  list.innerHTML = "";
  scanResults.forEach((x) => {
    const row = document.createElement("button");
    row.className = "result-row";
    const labels = (x.label || []).slice(0, 2).join(", ") || "—";
    row.innerHTML = `
      <div class="result-main">
        <div class="result-title">${esc(x.title || "Untitled")}</div>
        <div class="result-sub">${esc(fmtList(x.format))} · ${esc(x.year || "?")} · ${esc(labels)}</div>
        <div class="result-sub">${esc(x.country || "")}${x.catno ? " · " + esc(x.catno) : ""}</div>
      </div>
      <div class="result-arrow">›</div>`;
    row.addEventListener("click", () => selectRelease(x.id));
    list.appendChild(row);
  });
}

async function selectRelease(id) {
  showView("viewPreview");
  $("#previewBox").innerHTML = `<div class="loading">Loading release details…</div>`;
  try {
    const r = await api(`/api/release?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(r.data?.error || "Lookup failed");
    currentPreview = r.data;
    renderPreview(r.data);
  } catch (e) {
    $("#previewBox").innerHTML = `<div class="error-inline"><p>${esc(e.message)}</p>
      <button class="btn btn-ghost" id="btnBackResults">← Back</button></div>`;
    document.getElementById("btnBackResults")?.addEventListener("click", () => showView("viewResults"));
  }
}

// ---------- Shared display helpers ----------
function badgesHtml(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return items.map((t) => `<span class="badge">${esc(t)}</span>`).join("");
}

function tracklistHtml(tl, open) {
  if (!Array.isArray(tl) || !tl.length) return "";
  const rows = tl.map((t) => `
    <div class="track"><span class="pos">${esc(t.position || "")}</span><span class="tt">${esc(t.title)}</span><span class="dur">${esc(t.duration || "")}</span></div>`).join("");
  return `<details class="tracklist" ${open ? "open" : ""}><summary>Tracklist (${tl.length})</summary>${rows}</details>`;
}

function creditsHtml(credits) {
  if (!Array.isArray(credits) || !credits.length) return "";
  const rows = credits.map((c) => `
    <div class="credit"><span class="c-role">${esc(c.role || "—")}</span><span class="c-name">${esc(c.name)}</span></div>`).join("");
  return `<details class="credits"><summary>Credits (${credits.length})</summary>${rows}</details>`;
}

function galleryHtml(images) {
  if (!Array.isArray(images) || !images.length) return "";
  const thumbs = images.map((im, i) =>
    `<button class="thumb ${i === 0 ? "active" : ""}" data-i="${i}" aria-label="Image ${i + 1}"
       style="background-image:url('${esc(im.resource_url || im.uri150 || "")}')"></button>`).join("");
  return `<div class="gallery">
    <div class="gallery-main"></div>
    <div class="gallery-thumbs">${thumbs}</div>
  </div>`;
}

function setupGallery(container, images) {
  if (!Array.isArray(images) || images.length < 1) return;
  const main = container.querySelector(".gallery-main");
  const thumbs = container.querySelectorAll(".thumb");
  let current = 0;
  const show = (i) => {
    current = i;
    main.innerHTML = `<img src="${esc(images[i].resource_url || images[i].uri150 || "")}" alt="Image ${i + 1}">`;
    container.querySelectorAll(".thumb").forEach((t, idx) => t.classList.toggle("active", idx === i));
  };
  show(0);
  thumbs.forEach((t, idx) => t.addEventListener("click", () => show(idx)));
  if (images.length > 1) {
    main.addEventListener("click", () => openLightbox(images, current));
    addSwipe(main, () => show((current + 1) % images.length), () => show((current - 1 + images.length) % images.length));
  }
}

function openLightbox(images, start) {
  let i = start;
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<button class="lb-close" aria-label="Close">✕</button>
    <button class="lb-nav lb-prev" aria-label="Previous">‹</button>
    <div class="lb-img"></div>
    <button class="lb-nav lb-next" aria-label="Next">›</button>
    <div class="lb-count"></div>`;
  const imgBox = lb.querySelector(".lb-img");
  const show = (n) => {
    i = (n + images.length) % images.length;
    imgBox.innerHTML = `<img src="${esc(images[i].resource_url || images[i].uri150 || "")}" alt="Image ${i + 1}">`;
    lb.querySelector(".lb-count").textContent = `${i + 1} / ${images.length}`;
  };
  show(start);
  lb.querySelector(".lb-prev").addEventListener("click", (e) => { e.stopPropagation(); show(i - 1); });
  lb.querySelector(".lb-next").addEventListener("click", (e) => { e.stopPropagation(); show(i + 1); });
  lb.querySelector(".lb-close").addEventListener("click", () => lb.remove());
  lb.addEventListener("click", (e) => { if (e.target === lb) lb.remove(); });
  addSwipe(lb, () => show(i + 1), () => show(i - 1));
  document.addEventListener("keydown", function esc(ev) {
    if (ev.key === "Escape") { lb.remove(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(lb);
}

// ---------- Preview + add ----------
function renderPreview(d) {
  const already = library.some((a) => String(a.discogsId) === String(d.id));
  const edition = classifyEdition(d.descriptions || []);
  const box = $("#previewBox");
  box.innerHTML = `
    <div class="preview-layout">
      <div class="preview-media">
        ${(d.images || []).length
          ? galleryHtml(d.images)
          : `<div class="preview-cover">${d.cover ? `<img src="${esc(d.cover)}" alt="${esc(d.title)}">` : `<div class="cover-placeholder lg">♪</div>`}</div>`}
        <div class="media-note">${(d.images || []).length} image${(d.images || []).length === 1 ? "" : "s"} — tap a thumbnail to browse, click to enlarge</div>
      </div>
      <div class="preview-info">
        <div class="preview-artist">${esc(d.artist || "Unknown artist")}</div>
        <h2 class="preview-title">${esc(d.title)}</h2>
        <div class="preview-meta">
          <span>${esc(d.year || "?")}</span>
          ${d.format && d.format.length ? `<span>${esc(fmtList(d.format))}</span>` : ""}
          ${d.country ? `<span>${esc(d.country)}</span>` : ""}
        </div>
        <div class="badge-row">${badgesHtml(edition)}</div>
        ${d.label && d.label.length ? `<div class="preview-line"><b>Label:</b> ${esc(d.label.join(", "))}</div>` : ""}
        ${d.catno ? `<div class="preview-line"><b>Cat#:</b> ${esc(d.catno)}</div>` : ""}
        ${d.genres && d.genres.length ? `<div class="preview-line"><b>Genre:</b> ${esc(d.genres.join(", "))}</div>` : ""}
        ${d.styles && d.styles.length ? `<div class="preview-line"><b>Style:</b> ${esc(d.styles.join(", "))}</div>` : ""}
        <div class="preview-line muted"><b>Barcode:</b> ${esc(d.barcode || scanBarcode || "—")}</div>
        ${tracklistHtml(d.tracklist, true)}
        ${creditsHtml(d.credits)}
      </div>
    </div>
    <div class="preview-actions">
      ${already
        ? `<div class="already">✓ Already in your library</div>
           <button class="btn btn-ghost" id="btnBackResults">← Back to results</button>`
        : `<button class="btn btn-primary" id="btnAdd">Add to library</button>
           <button class="btn btn-ghost" id="btnBackResults">← Back to results</button>`}
    </div>`;
  setupGallery(box, d.images);
  if (!already) document.getElementById("btnAdd").addEventListener("click", () => addToLibrary(d));
  document.getElementById("btnBackResults")?.addEventListener("click", () => {
    if (scanResults.length > 1) showView("viewResults");
    else showView("viewLibrary");
  });
}

async function addToLibrary(d) {
  const album = {
    _id: uid(),
    discogsId: d.id,
    barcode: d.barcode || scanBarcode || "",
    artist: d.artist || "",
    title: d.title || "",
    year: d.year || "",
    released: d.released || "",
    format: d.format || [],
    label: d.label || [],
    catno: d.catno || "",
    genre: d.genres || [],
    style: d.styles || [],
    country: d.country || "",
    cover: d.cover || "",
    thumb: d.thumb || "",
    images: d.images || [],
    credits: d.credits || [],
    members: d.members || [],
    descriptions: d.descriptions || [],
    formatNames: d.formatNames || [],
    edition: classifyEdition(d.descriptions || []),
    tracklist: d.tracklist || [],
    discogsUrl: d.uri ? d.uri.replace("api.discogs.com", "www.discogs.com").replace("/releases/", "/release/") : "",
    addedAt: new Date().toISOString(),
  };
  album.searchText = buildSearchText(album);
  const r = await api("/api/library", "POST", album);
  if (!r.ok) {
    toast(r.data?.error || "Could not add album", true);
    return;
  }
  library = (r.data.library || []).map(normalizeAlbum);
  updateCount();
  if (r.data.discogs && r.data.discogs.synced) {
    toast(`Added “${d.title}” — and added it to your Discogs collection`);
  } else {
    toast(`Added “${d.title}” to your library`);
  }
  resetScanState();
  renderLibrary();
  showView("viewLibrary");
}

function resetScanState() {
  scanBarcode = "";
  scanQuery = "";
  scanResults = [];
  currentPreview = null;
}

// ---------- Crate Digger (scan -> instant Spotify + Wikipedia preview) ----------
async function startDigger() {
  showView("viewCrateDigger");
  diggerLock = false;
  $("#diggerResult").innerHTML = "";
  const status = $("#diggerStatus");
  status.classList.remove("error");
  status.textContent = "Starting camera…";

  if (!window.Html5Qrcode) {
    status.textContent = "Barcode library failed to load — use manual entry below.";
    status.classList.add("error");
    return;
  }

  await stopDiggerScanner();
  diggerScanner = new Html5Qrcode("diggerReader");
  const formats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.ITF,
  ];
  try {
    await diggerScanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        formatsToSupport: formats,
        qrbox: (vw, vh) => ({ width: Math.min(vw * 0.82, 320), height: Math.min(vh * 0.5, 130) }),
      },
      (decodedText) => {
        if (diggerLock) return;
        diggerLock = true;
        const barcode = String(decodedText).replace(/[^0-9]/g, "");
        stopDiggerScanner();
        diggerLookup(barcode);
      },
      () => {}
    );
    status.textContent = "Camera active — align the barcode inside the box.";
  } catch (err) {
    status.textContent = "Couldn't access the camera: " + (err && err.message ? err.message : err);
    status.classList.add("error");
  }
}

async function stopDiggerScanner() {
  if (diggerScanner) {
    const s = diggerScanner;
    diggerScanner = null;
    try { await s.stop(); } catch (e) {}
    try { s.clear(); } catch (e) {}
  }
}

function diggerManualLookup() {
  const v = ($("#diggerBarcode").value || "").replace(/[^0-9]/g, "");
  if (!v) { toast("Enter a barcode first.", true); return; }
  stopDiggerScanner();
  diggerLookup(v);
}

async function diggerLookup(barcode) {
  const box = $("#diggerResult");
  box.innerHTML = `<div class="loading">Looking up barcode ${esc(barcode)}…</div>`;
  try {
    const sr = await api(`/api/search?barcode=${encodeURIComponent(barcode)}`);
    if (!sr.ok) throw new Error(sr.data?.error || "Lookup failed");
    const results = sr.data.results || [];
    if (!results.length) throw new Error(`No Discogs release found for barcode ${barcode}.`);

    const rel = await api(`/api/release?id=${encodeURIComponent(results[0].id)}`);
    if (!rel.ok || !rel.data) throw new Error(rel.data?.error || "Could not load release details.");
    const d = rel.data;
    const q = [d.artist, d.title].filter(Boolean).join(" ").trim() || d.title;

    const [spot, wiki] = await Promise.all([
      api(`/api/spotify?q=${encodeURIComponent(q)}`),
      api(`/api/wikipedia?title=${encodeURIComponent(d.title || "")}&artist=${encodeURIComponent(d.artist || "")}`),
    ]);

    renderDiggerResult(box, d, q, spot, wiki);
  } catch (e) {
    box.innerHTML = `<div class="error-inline"><p>${esc(e.message || "Something went wrong.")}</p>
      <button class="btn btn-ghost" id="btnDiggerAgain">Scan again</button></div>`;
    document.getElementById("btnDiggerAgain")?.addEventListener("click", () => startDigger());
  }
}

function renderDiggerResult(box, d, q, spot, wiki) {
  const spotId = spot.ok && spot.data && spot.data.id ? spot.data.id : null;
  const spotUrl = spotId
    ? spot.data.url
    : `https://open.spotify.com/search/${encodeURIComponent(q)}`;
  const spotFallback = spot.status === 501
    ? `<div class="muted" style="padding:12px">Spotify isn't configured — use the search link above.</div>`
    : `<div class="muted" style="padding:12px">No Spotify match found — use the search link above.</div>`;
  const wikiHtml = (wiki.ok && wiki.data && wiki.data.extract)
    ? `<div class="wiki-blurb">
        <div class="wiki-label">About this album</div>
        <p class="wiki-text">${esc(wiki.data.extract)}</p>
        ${wiki.data.url ? `<a class="wiki-source" href="${esc(wiki.data.url)}" target="_blank" rel="noopener">Source: Wikipedia ↗</a>` : ""}
      </div>`
    : "";
  box.innerHTML = `
    <div class="digger-card">
      <div class="digger-head">
        ${d.cover ? `<img class="digger-cover" src="${esc(d.cover)}" alt="${esc(d.title)}">` : `<div class="digger-cover placeholder">♪</div>`}
        <div class="digger-info">
          <div class="preview-artist">${esc(d.artist || "Unknown artist")}</div>
          <h2 class="preview-title">${esc(d.title)}</h2>
          <div class="preview-meta">
            ${d.year ? `<span>${esc(d.year)}</span>` : ""}
            ${d.country ? `<span>${esc(d.country)}</span>` : ""}
            ${d.label && d.label.length ? `<span>${esc(d.label.join(", "))}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="streaming">
        <div class="streaming-title">Listen now</div>
        <div class="streaming-links">
          <a class="streaming-btn spotify" href="${esc(spotUrl)}" target="_blank" rel="noopener">Open in Spotify</a>
        </div>
        <div id="diggerEmbed" class="spotify-embed">${spotId ? spotifyIframe(spotId) : spotFallback}</div>
      </div>
      ${wikiHtml}
    </div>`;
}

// ---------- Streaming links + Spotify preview ----------
function streamingLinks(a) {
  const q = [a.artist, a.title].filter(Boolean).join(" ").trim() || a.title;
  const enc = encodeURIComponent(q);
  return {
    spotifyUrl: a.spotifyUrl || `https://open.spotify.com/search/${enc}`,
    youtubeMusicUrl: `https://music.youtube.com/search?q=${enc}`,
  };
}

async function enrichSpotify(a) {
  const embed = document.getElementById("spotifyEmbed");
  if (!embed) return;
  if (a.spotifyId) {
    embed.innerHTML = spotifyIframe(a.spotifyId);
    return;
  }
  if (!spotifyEnabled) return;
  const q = [a.artist, a.title].filter(Boolean).join(" ").trim() || a.title;
  const r = await api(`/api/spotify?q=${encodeURIComponent(q)}`);
  if (r.ok && r.data.id) {
    a.spotifyId = r.data.id;
    a.spotifyUrl = r.data.url;
    embed.innerHTML = spotifyIframe(r.data.id);
    const link = document.querySelector(".streaming-btn.spotify");
    if (link) link.href = r.data.url;
  }
}

function spotifyIframe(id) {
  return `<iframe src="https://open.spotify.com/embed/album/${esc(id)}" width="100%" height="352" frameborder="0" allowtransparency="true" allow="encrypted-media" loading="lazy" title="Spotify preview"></iframe>`;
}

// ---------- Turntable (detail view) ----------
function turntableHtml(a) {
  const art = a.cover || "";
  const labelStyle = art ? `style="background-image:url('${esc(art)}')"` : "";
  const labelText = art ? "" : `<span>${esc(a.title || "♪")}</span>`;
  return `
    <div class="turntable" aria-label="Turntable: ${esc(a.title || "album")}">
      <div class="tt-base"></div>
      <div class="tt-platter"></div>
      <div class="tt-record spinning">
        <div class="tt-label ${art ? "has-art" : ""}" ${labelStyle}>${labelText}</div>
        <div class="tt-spindle"></div>
      </div>
      <div class="tt-tonearm"></div>
      <div class="tt-rpm">33⅓ RPM</div>
      <button class="tt-toggle" aria-label="Pause turntable">⏸</button>
    </div>`;
}

function turntableThumbsHtml(images) {
  if (!Array.isArray(images) || images.length < 2) return "";
  const thumbs = images.map((im, i) =>
    `<button class="thumb" data-i="${i}" aria-label="Image ${i + 1}" style="background-image:url('${esc(im.resource_url || im.uri150 || "")}')"></button>`).join("");
  return `<div class="gallery-thumbs tt-thumbs">${thumbs}</div>`;
}

function setupTurntable(box, a) {
  const rec = box.querySelector(".tt-record");
  const btn = box.querySelector(".tt-toggle");
  if (btn && rec) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const spinning = rec.classList.toggle("spinning");
      btn.textContent = spinning ? "⏸" : "▶";
      btn.setAttribute("aria-label", spinning ? "Pause turntable" : "Play turntable");
    });
  }
  box.querySelectorAll(".tt-thumbs .thumb").forEach((t) => {
    t.addEventListener("click", () => openLightbox(a.images, Number(t.dataset.i)));
  });
}

// ---------- Detail ----------
async function openDetail(_id) {
  const a = library.find((x) => x._id === _id);
  if (!a) return;
  showView("viewDetail");

  // Lazy enrichment: albums imported from a Discogs collection have basic info
  // only (cover/title/artist), so fetch full release details on first open.
  if ((!a.tracklist || !a.tracklist.length) && a.discogsId) {
    $("#detailBox").innerHTML = `<div class="loading">Loading full details…</div>`;
    const r = await api(`/api/release?id=${encodeURIComponent(a.discogsId)}`);
    if (r.ok) {
      const d = r.data;
      a.images = (d.images && d.images.length) ? d.images : a.images;
      a.tracklist = (d.tracklist && d.tracklist.length) ? d.tracklist : a.tracklist;
      a.credits = (d.credits && d.credits.length) ? d.credits : a.credits;
      a.members = (d.members && d.members.length) ? d.members : a.members;
      a.descriptions = (d.descriptions && d.descriptions.length) ? d.descriptions : a.descriptions;
      a.formatNames = (d.formatNames && d.formatNames.length) ? d.formatNames : a.formatNames;
      a.cover = a.cover || d.cover;
      a.thumb = a.thumb || d.thumb;
      if (!a.label || !a.label.length) a.label = d.label || a.label;
      if (!a.genre || !a.genre.length) a.genre = d.genres || a.genre;
      if (!a.style || !a.style.length) a.style = d.styles || a.style;
      if (!a.catno) a.catno = d.catno;
      a.edition = classifyEdition((a.descriptions && a.descriptions.length) ? a.descriptions : a.format);
      a.searchText = buildSearchText(a);
    }
  }

  renderDetail(a);
}

function renderDetail(a) {
  const box = $("#detailBox");
  const canEdit = canEditMode();

  box.innerHTML = `
    <div class="preview-layout">
      <div class="preview-media detail-media">
        ${turntableHtml(a)}
        ${turntableThumbsHtml(a.images)}
        <div class="media-note">${(a.images || []).length} image${(a.images || []).length === 1 ? "" : "s"} in this release</div>
      </div>
      <div class="preview-info">
        <div class="preview-artist">${esc(a.artist || "Unknown artist")}</div>
        <h2 class="preview-title">${esc(a.title)}</h2>
        <div class="preview-meta">
          <span>${esc(a.year || "?")}</span>
          ${a.format && a.format.length ? `<span>${esc(fmtList(a.format))}</span>` : ""}
          ${a.country ? `<span>${esc(a.country)}</span>` : ""}
        </div>
        <div class="badge-row">${badgesHtml(a.edition)}</div>
        ${a.label && a.label.length ? `<div class="preview-line"><b>Label:</b> ${esc(a.label.join(", "))}</div>` : ""}
        ${a.catno ? `<div class="preview-line"><b>Cat#:</b> ${esc(a.catno)}</div>` : ""}
        ${a.genre && a.genre.length ? `<div class="preview-line"><b>Genre:</b> ${esc(a.genre.join(", "))}</div>` : ""}
        ${a.style && a.style.length ? `<div class="preview-line"><b>Style:</b> ${esc(a.style.join(", "))}</div>` : ""}
        <div class="preview-line muted"><b>Barcode:</b> ${esc(a.barcode || "—")}</div>
        <div class="preview-line muted"><b>Added:</b> ${esc(new Date(a.addedAt).toLocaleDateString())}</div>
        <div id="wikiBlurb" class="wiki-blurb hidden"></div>
        ${tracklistHtml(a.tracklist, true)}
        ${creditsHtml(a.credits)}
        <div class="streaming">
          <div class="streaming-title">Listen on</div>
          <div class="streaming-links">
            <a class="streaming-btn spotify" href="${esc(streamingLinks(a).spotifyUrl)}" target="_blank" rel="noopener">Spotify</a>
            <a class="streaming-btn ytm" href="${esc(streamingLinks(a).youtubeMusicUrl)}" target="_blank" rel="noopener">YouTube Music</a>
          </div>
          <div id="spotifyEmbed" class="spotify-embed"></div>
        </div>
        ${a.discogsUrl ? `<a class="discogs-link" href="${esc(a.discogsUrl)}" target="_blank" rel="noopener">View on Discogs ↗</a>` : ""}
      </div>
    </div>
    ${canEdit ? `<div class="preview-actions">
      <button class="btn btn-danger" id="btnRemove">Remove from library</button>
    </div>` : ""}`;

  setupTurntable(box, a);
  if (canEdit) {
    document.getElementById("btnRemove").addEventListener("click", () => removeAlbum(a._id));
  }
  enrichSpotify(a);
  loadWikipedia(a);
}

// ---------- Wikipedia description (detail view) ----------
function renderWiki(box, wiki) {
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="wiki-label">About this album</div>
    <p class="wiki-text">${esc(wiki.extract)}</p>
    ${wiki.url ? `<a class="wiki-source" href="${esc(wiki.url)}" target="_blank" rel="noopener">Source: Wikipedia ↗</a>` : ""}`;
}

async function loadWikipedia(a) {
  const box = document.getElementById("wikiBlurb");
  if (!box) return;
  if (a.wiki) {
    renderWiki(box, a.wiki);
    return;
  }
  const q = [a.artist, a.title].filter(Boolean).join(" ").trim();
  if (!q) return; // nothing to search with — leave the block hidden
  box.classList.remove("hidden");
  box.innerHTML = `<div class="wiki-loading">Loading description…</div>`;
  const r = await api(
    `/api/wikipedia?title=${encodeURIComponent(a.title || "")}&artist=${encodeURIComponent(a.artist || "")}`
  );
  // If the user opened another album while this request was in flight, the
  // placeholder element has been replaced — don't paint stale content.
  if (document.getElementById("wikiBlurb") !== box) return;
  if (r.ok && r.data && r.data.extract) {
    a.wiki = { title: r.data.title, extract: r.data.extract, url: r.data.url };
    renderWiki(box, a.wiki);
  } else {
    box.classList.add("hidden");
  }
}

async function removeAlbum(_id) {
  const a = library.find((x) => x._id === _id);
  const r = await api(`/api/library?id=${encodeURIComponent(_id)}`, "DELETE");
  if (r.ok) {
    library = (r.data.library || []).map(normalizeAlbum);
    updateCount();
    toast(`Removed “${a ? a.title : "album"}”`);
  } else {
    toast(r.data?.error || "Could not remove", true);
  }
  renderLibrary();
  showView("viewLibrary");
}

// ---------- Friends ----------
async function openFriends() {
  $("#friendsModal").classList.remove("hidden");
  await refreshFriends();
}

async function refreshFriends() {
  const r = await api("/api/friends");
  const friends = (r.ok && r.data.friends) || [];
  const list = $("#friendsList");
  if (!friends.length) {
    list.innerHTML = `<div class="muted friend-empty">No friends yet. Add a friend by username above.</div>`;
    return;
  }
  list.innerHTML = "";
  friends.forEach((f) => {
    const row = document.createElement("div");
    row.className = "friend-item";
    row.innerHTML = `<span class="friend-name">@${esc(f)}</span>
      <span class="friend-actions">
        <button class="btn btn-ghost btn-sm" data-view="${esc(f)}">View</button>
        <button class="btn btn-ghost btn-sm" data-remove="${esc(f)}" title="Remove friend">✕</button>
      </span>`;
    row.querySelector("[data-view]").addEventListener("click", () => (window.location.href = `/u/${encodeURIComponent(f)}`));
    row.querySelector("[data-remove]").addEventListener("click", () => removeFriend(f));
    list.appendChild(row);
  });
}

async function removeFriend(username) {
  const r = await api(`/api/friends?username=${encodeURIComponent(username)}`, "DELETE");
  if (r.ok) refreshFriends();
  else toast(r.data?.error || "Could not remove friend", true);
}

async function addFriend() {
  const v = $("#friendInput").value.trim();
  if (!v) return;
  const r = await api("/api/friends", "POST", { username: v });
  if (r.ok) { $("#friendInput").value = ""; refreshFriends(); }
  else toast(r.data?.error || "Could not add friend", true);
}

function browseUser() {
  const v = $("#browseInput").value.trim().toLowerCase();
  if (!v) return;
  window.location.href = `/u/${encodeURIComponent(v)}`;
}

// ---------- Discogs import ----------
async function openDiscogs() {
  $("#discogsModal").classList.remove("hidden");
  $("#discogsResult").textContent = "";
  const [r, oa] = await Promise.all([api("/api/discogs"), api("/api/discogs-oauth/status")]);
  renderDiscogsState((r.ok && r.data.discogsUsername) || null);
  renderOauthState(oa.ok ? oa.data : { configured: false, connected: false, discogsUsername: null });
}

function renderOauthState(s) {
  const connected = !!(s && s.connected);
  const configured = !!(s && s.configured);
  $("#discogsOauthStatus").textContent = connected
    ? `Connected as ${(s && s.discogsUsername) || "your Discogs account"}`
    : (configured ? "Not connected." : "Discogs OAuth is not configured yet.");
  $("#btnDiscogsConnect").classList.toggle("hidden", connected || !configured);
  $("#btnDiscogsDisconnect").classList.toggle("hidden", !connected);
}

function discogsConnect() {
  window.location.href = "/api/discogs-oauth/start";
}

async function discogsDisconnect() {
  const r = await api("/api/discogs-oauth/disconnect", "POST");
  if (r.ok) {
    renderOauthState({ configured: true, connected: false, discogsUsername: null });
    renderDiscogsState(null);
    toast("Disconnected from Discogs.");
  } else {
    toast(r.data?.error || "Could not disconnect", true);
  }
}

function renderDiscogsState(du) {
  $("#discogsStatus").textContent = du
    ? `Linked to Discogs user: ${du}`
    : "Not linked yet. Paste your Discogs collection link (or username) below to import.";
  $("#discogsInput").value = du || "";
  $("#btnDiscogsImport").classList.toggle("hidden", !!du);
  $("#btnDiscogsResync").classList.toggle("hidden", !du);
  $("#btnDiscogsForget").classList.toggle("hidden", !du);
}

async function discogsImport() {
  const url = $("#discogsInput").value.trim();
  if (!url) { toast("Enter a Discogs link or username.", true); return; }
  const btn = $("#btnDiscogsResync").classList.contains("hidden") ? $("#btnDiscogsImport") : $("#btnDiscogsResync");
  const old = btn.textContent;
  btn.textContent = "Working…";
  btn.disabled = true;
  $("#discogsResult").textContent = "Fetching your Discogs collection…";
  const r = await api("/api/discogs", "POST", { url });
  btn.textContent = old;
  btn.disabled = false;
  if (!r.ok) { $("#discogsResult").textContent = r.data?.error || "Import failed."; return; }
  const { added, skipped, total, discogsUsername } = r.data;
  $("#discogsResult").textContent = `Done — added ${added}, skipped ${skipped} (already in your library). Library now has ${total} records.`;
  renderDiscogsState(discogsUsername);
  await loadOwnLibrary();
  renderLibrary();
  updateCount();
  toast(`Imported ${added} record${added === 1 ? "" : "s"}`);
}

async function discogsForget() {
  const r = await api("/api/discogs", "DELETE");
  if (r.ok) {
    toast("Forgot the Discogs link.");
    renderDiscogsState(null);
    $("#discogsResult").textContent = "";
  } else {
    toast(r.data?.error || "Could not forget link", true);
  }
}

// ---------- Share ----------
function openShare() {
  if (!currentUser) return;
  $("#shareUrl").value = `${window.location.origin}/u/${currentUser.username}`;
  $("#shareModal").classList.remove("hidden");
}

async function copyShare() {
  const url = $("#shareUrl").value;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied to clipboard");
  } catch (e) {
    $("#shareUrl").select();
    try { document.execCommand("copy"); toast("Link copied"); } catch (e2) { toast("Copy failed — select the link manually", true); }
  }
}

// ---------- View mode ----------
function setViewMode(mode) {
  viewMode = mode;
  $$(".view-toggle .vt").forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  renderLibrary();
}

function toggleFilters() {
  filtersOpen = !filtersOpen;
  $("#filterPanel").classList.toggle("hidden", !filtersOpen);
}

// ---------- Events ----------
function bindEvents() {
  // auth area + corner (delegated)
  const onAuthAction = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === "scan") startScan();
    else if (a === "digger") startDigger();
    else if (a === "discogs") openDiscogs();
    else if (a === "friends") openFriends();
    else if (a === "share") openShare();
    else if (a === "logout") doLogout();
    else if (a === "login") showView("viewAuth");
    else if (a === "back") window.location.href = "/";
  };
  $("#authArea").addEventListener("click", onAuthAction);
  $("#authCorner").addEventListener("click", onAuthAction);

  // auth view
  $("#tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("#tabSignup").addEventListener("click", () => setAuthMode("signup"));
  $("#authSubmit").addEventListener("click", submitAuth);
  $("#authGoogle").addEventListener("click", () => {
    if (googleEnabled) window.location.href = "/api/auth/google";
    else toast("Google sign-in isn't configured yet — Google OAuth credentials are needed.", true);
  });
  $("#authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
  $("#authUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });

  // scan / library nav
  $("#btnScanEmpty").addEventListener("click", startScan);
  $("#btnBackLibrary").addEventListener("click", async () => { await stopScanner(); showView("viewLibrary"); });
  $("#btnBackFromResults").addEventListener("click", () => showView("viewLibrary"));
  $("#btnBackFromDetail").addEventListener("click", () => showView("viewLibrary"));
  $("#btnManualLookup").addEventListener("click", manualLookup);
  $("#manualBarcode").addEventListener("keydown", (e) => { if (e.key === "Enter") manualLookup(); });
  $("#btnTextSearch").addEventListener("click", textSearch);
  $("#textSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") textSearch(); });
  // crate digger
  $("#btnBackFromDigger").addEventListener("click", async () => { await stopDiggerScanner(); showView("viewLibrary"); });
  $("#btnDiggerLookup").addEventListener("click", diggerManualLookup);
  $("#diggerBarcode").addEventListener("keydown", (e) => { if (e.key === "Enter") diggerManualLookup(); });
  $("#libSearch").addEventListener("input", () => renderLibrary(false));
  $("#libSort").addEventListener("change", renderLibrary);
  $$(".view-toggle .vt").forEach((b) => b.addEventListener("click", () => setViewMode(b.dataset.view)));
  $("#btnToggleFilters").addEventListener("click", toggleFilters);
  $("#btnClearFilters").addEventListener("click", clearFilters);

  // friends modal
  $("#btnCloseFriends").addEventListener("click", () => $("#friendsModal").classList.add("hidden"));
  $("#btnAddFriend").addEventListener("click", addFriend);
  $("#friendInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });
  $("#btnBrowse").addEventListener("click", browseUser);
  $("#browseInput").addEventListener("keydown", (e) => { if (e.key === "Enter") browseUser(); });
  $("#friendsModal").addEventListener("click", (e) => { if (e.target === $("#friendsModal")) $("#friendsModal").classList.add("hidden"); });

  // discogs modal
  $("#btnCloseDiscogs").addEventListener("click", () => $("#discogsModal").classList.add("hidden"));
  $("#btnDiscogsConnect").addEventListener("click", discogsConnect);
  $("#btnDiscogsDisconnect").addEventListener("click", discogsDisconnect);
  $("#btnDiscogsImport").addEventListener("click", discogsImport);
  $("#btnDiscogsResync").addEventListener("click", discogsImport);
  $("#btnDiscogsForget").addEventListener("click", discogsForget);
  $("#discogsInput").addEventListener("keydown", (e) => { if (e.key === "Enter") discogsImport(); });
  $("#discogsModal").addEventListener("click", (e) => { if (e.target === $("#discogsModal")) $("#discogsModal").classList.add("hidden"); });

  // share modal
  $("#btnCloseShare").addEventListener("click", () => $("#shareModal").classList.add("hidden"));
  $("#btnCopyShare").addEventListener("click", copyShare);
  $("#shareModal").addEventListener("click", (e) => { if (e.target === $("#shareModal")) $("#shareModal").classList.add("hidden"); });

  // crate view — flip through records with arrow keys
  document.addEventListener("keydown", (e) => {
    if (viewMode !== "crate") return;
    const lib = $("#viewLibrary");
    if (!lib || lib.classList.contains("hidden")) return;
    const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    navigateCrate(e.key === "ArrowRight" ? 1 : -1);
  });

  // crate view — swipe to flip on touch devices
  addSwipe($("#libraryGrid"), () => {
    if (viewMode === "crate") navigateCrate(1);
  }, () => {
    if (viewMode === "crate") navigateCrate(-1);
  });
}

// ---------- Init ----------
async function init() {
  bindEvents();
  setAuthMode("login");

  const cfg = await api("/api/config");
  googleEnabled = !!(cfg.ok && cfg.data.googleEnabled);
  spotifyEnabled = !!(cfg.ok && cfg.data.spotifyEnabled);

  const me = await api("/api/auth/me");
  if (me.ok) currentUser = me.data;

  const m = window.location.pathname.match(/^\/u\/([^/]+)/);
  const shareUser = m ? decodeURIComponent(m[1]) : null;

  if (shareUser) {
    const ok = await loadPublicLibrary(shareUser);
    if (ok) {
      renderTopbar();
      renderPublicBanner();
      renderLibrary();
      showView("viewLibrary");
      return;
    }
    viewingUsername = null;
  }

  if (currentUser) {
    await loadOwnLibrary();
    renderTopbar();
    renderPublicBanner();
    renderLibrary();
    showView("viewLibrary");
  } else {
    renderTopbar();
    renderPublicBanner();
    showView("viewAuth");
  }
}

document.addEventListener("DOMContentLoaded", init);
