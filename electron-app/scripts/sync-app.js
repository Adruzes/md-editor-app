// Copies the shared app source (index.html / style.css / app.js / libs) from
// the parent md-editor-app/ folder into electron-app/app/ so there is a
// single source of truth: the same files power both the lightweight
// browser-based edition and this Electron edition. Runs automatically
// before packaging (see package.json "prepackage-win").
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DEST = path.join(__dirname, "..", "app");
const FILES = ["index.html", "style.css", "app.js"];
const DIRS = ["libs"];

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(DEST, file));
}
for (const dir of DIRS) {
  fs.cpSync(path.join(ROOT, dir), path.join(DEST, dir), { recursive: true });
}

console.log(`Synced ${FILES.length} files and ${DIRS.length} folder(s) into electron-app/app/`);
