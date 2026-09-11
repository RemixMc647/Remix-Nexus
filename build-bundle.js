// scripts/build-bundle.js
//
// Zips the www/ folder (the web layer the Capacitor app actually runs)
// into bundles/latest.zip, and writes bundles/latest.json with a fresh
// version stamp. This is what server.js's /api/app-update/version and
// /download/bundle routes hand out to the app.
//
// Run this every time you want a web-layer change (HTML/CSS/JS) pushed
// live to the Android app without an Android Studio rebuild:
//
//   npm run bundle:build
//
// Then deploy/restart the server (or just commit+push if Render
// auto-deploys). Any app that's open, or gets opened, downloads and
// applies the new bundle automatically — see www/js/live-update.js.
//
// Reminder: this only ships web-layer changes. If you added a new
// native Capacitor plugin, changed permissions, or bumped a native
// dependency, you still need a real APK rebuild — this script can't
// (and shouldn't) replace that.

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const WWW_DIR = path.join(__dirname, '..', 'www');
const BUNDLES_DIR = path.join(__dirname, '..', 'bundles');
const ZIP_PATH = path.join(BUNDLES_DIR, 'latest.zip');
const MANIFEST_PATH = path.join(BUNDLES_DIR, 'latest.json');

if (!fs.existsSync(WWW_DIR)) {
  console.error(`❌ www/ folder not found at ${WWW_DIR}. Run this from the project root (where package.json lives).`);
  process.exit(1);
}
fs.mkdirSync(BUNDLES_DIR, { recursive: true });

// Timestamp-based version — always increasing, no manual bumping needed.
// The app only cares that it's different from what it currently has.
const version = String(Date.now());

const output = fs.createWriteStream(ZIP_PATH);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)
  );
  console.log(`✅ Bundle ${version} built — ${(archive.pointer() / 1024).toFixed(1)} KB.`);
  console.log('   Deploy/restart the server and the app will pick it up automatically.');
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') console.warn('⚠️ ', err.message);
  else throw err;
});
archive.on('error', (err) => { throw err; });

archive.pipe(output);
archive.directory(WWW_DIR, false); // false = don't nest under a "www" folder inside the zip
archive.finalize();
