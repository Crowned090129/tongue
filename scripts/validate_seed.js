#!/usr/bin/env node
// Validates every seed content file against the same validateContent() the server
// uses before serving. Run: node scripts/validate_seed.js
const fs = require("fs");
const path = require("path");
const { validateContent, VALID_LANGS, VALID_TABS } = require("../routes/content");

const dir = path.join(__dirname, "..", "seed", "content");
let ok = 0, bad = 0, missing = 0;
const problems = [];

for (const lang of VALID_LANGS) {
  for (const tab of VALID_TABS) {
    const f = path.join(dir, lang, tab + ".json");
    if (!fs.existsSync(f)) { missing++; problems.push(`MISSING  ${lang}/${tab}`); continue; }
    let data;
    try { data = JSON.parse(fs.readFileSync(f, "utf8")); }
    catch (e) { bad++; problems.push(`BADJSON  ${lang}/${tab}: ${e.message}`); continue; }
    const err = validateContent(lang, tab, data);
    if (err) { bad++; problems.push(`INVALID  ${lang}/${tab}: ${err}`); }
    else {
      // Report the depth so we can see how rich each file is.
      const arr = data.sections || data.categories || data.structures || data.dialogues || data.drills || data.phases || [];
      ok++;
      if (process.env.VERBOSE) console.log(`ok       ${lang}/${tab} (${arr.length} items)`);
    }
  }
}

if (problems.length) { console.log(problems.join("\n")); console.log(""); }
console.log(`${ok} valid, ${bad} invalid, ${missing} missing  (of ${VALID_LANGS.length * VALID_TABS.length})`);
process.exit(bad ? 1 : 0);
