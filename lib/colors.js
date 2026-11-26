// Shared vinyl-color extraction for the Vinyl Library serverless functions.
// Discogs stores a pressing's vinyl color in the format's free-text field
// (`formats[].text`, e.g. "Pink", "Purple / White") and occasionally in
// `formats[].descriptions` ("Picture Disc"). This helper checks both so the
// library and search results agree on the pressing's color.

const COLOR_KEYWORDS = [
  "black", "blue", "red", "green", "yellow", "orange", "purple", "pink",
  "white", "clear", "transparent", "translucent", "gold", "silver", "brown",
  "grey", "gray", "marbled", "marble", "splatter", "smoke", "swirl",
  "coke bottle", "half and half", "picture disc", "opaque", "multicolor",
  "multi-color", "multi-colour", "multicolour", "coloured", "colored",
  "turquoise", "teal", "magenta", "amber", "beige", "cream", "lavender",
  "burgundy", "crimson", "navy", "violet", "indigo", "ruby", "emerald", "neon",
  "mint", "olive", "aqua", "copper", "bronze", "tan", "charcoal", "bone",
  "rust", "coral", "peach", "champagne", "salmon",
];

// Word-boundary matchers so a color like "red" is not matched inside an
// unrelated word (e.g. "Remastered" ends in "red").
const COLOR_PATTERNS = COLOR_KEYWORDS.map((k) => {
  const safe = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${safe}\\b`, "i");
});

function extractColors(formats) {
  const out = [];
  const seen = new Set();
  for (const f of (formats || [])) {
    const candidates = [
      ...(f.descriptions || []),
      ...(f.text ? [f.text] : []),
    ];
    for (const raw of candidates) {
      const s = String(raw).trim();
      if (!s) continue;
      if (/white\s+label/i.test(s)) continue; // promo/test pressing, not a color
      if (COLOR_PATTERNS.some((re) => re.test(s)) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

module.exports = { extractColors, COLOR_KEYWORDS, COLOR_PATTERNS };
