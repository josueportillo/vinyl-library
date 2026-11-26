#!/usr/bin/env bash
set -e
cd /home/administrator/vinyl-library

echo "=== node --check on edited files ==="
for f in api/release.js api/discogs.js api/library.js lib/colors.js app.js; do
  if node --check "$f" 2>&1 | tail -1; then
    echo "OK: $f"
  else
    echo "FAIL: $f"
  fi
done

echo
echo "=== unit test: extractColors ==="
node -e '
const { extractColors } = require("./lib/colors.js");
const cases = [
  { formats: [{ name: "Vinyl", text: "Pink", descriptions: ["LP", "Album"] }], expect: ["Pink"] },
  { formats: [{ name: "Vinyl", text: "Purple / White Swirl", descriptions: ["LP"] }], expect: ["Purple / White Swirl"] },
  { formats: [{ name: "Vinyl", text: "Blue Marbled", descriptions: ["LP", "Album"] }], expect: ["Blue Marbled"] },
  { formats: [{ name: "Vinyl", descriptions: ["LP", "Album", "Limited Edition", "Picture Disc"] }], expect: ["Picture Disc"] },
  { formats: [{ name: "Vinyl", descriptions: ["LP", "Album"] }], expect: [] },
  { formats: [{ name: "Vinyl", text: "White Label", descriptions: ["LP"] }], expect: [] },
];
let pass = 0, fail = 0;
for (const c of cases) {
  const got = extractColors(c.formats);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  console.log((ok ? "PASS" : "FAIL") + "  " + JSON.stringify(c.formats) + " => " + JSON.stringify(got));
  ok ? pass++ : fail++;
}
console.log("extractColors: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
'
