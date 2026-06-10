/**
 * assets/generate-icons.js
 *
 * Generates all required app icon + splash PNG sizes from the SVG source files.
 * Uses sharp (auto-installed if missing) — no global CLI tools needed.
 *
 * Run: node assets/generate-icons.js
 *
 * Outputs:
 *   public/icon-192.png     — PWA manifest + Android
 *   public/icon-512.png     — PWA manifest
 *   assets/icon.png         — @capacitor/assets source (1024×1024)
 *   assets/splash.png       — @capacitor/assets source (2732×2732)
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs   = require("fs");

const ROOT = path.resolve(__dirname, "..");

// Auto-install sharp if not present
function ensureSharp() {
  try {
    require.resolve("sharp");
  } catch {
    console.log("Installing sharp for icon generation…");
    execSync("npm install --no-save sharp", { cwd: ROOT, stdio: "inherit" });
  }
  return require("sharp");
}

async function generate() {
  const sharp = ensureSharp();

  const iconSvg   = path.join(__dirname, "icon.svg");
  const splashSvg = path.join(__dirname, "splash.svg");

  const iconSvgBuf   = fs.readFileSync(iconSvg);
  const splashSvgBuf = fs.readFileSync(splashSvg);

  const jobs = [
    // PWA manifest icons (web + Android Chrome)
    { buf: iconSvgBuf,   size: 192,  out: path.join(ROOT, "public", "icon-192.png") },
    { buf: iconSvgBuf,   size: 512,  out: path.join(ROOT, "public", "icon-512.png") },
    // Capacitor assets source files (used by npx @capacitor/assets generate)
    { buf: iconSvgBuf,   size: 1024, out: path.join(__dirname, "icon.png") },
    { buf: splashSvgBuf, size: 2732, out: path.join(__dirname, "splash.png") },
  ];

  for (const { buf, size, out } of jobs) {
    await sharp(buf).resize(size, size).png().toFile(out);
    console.log(`✓  ${path.relative(ROOT, out)}  (${size}×${size})`);
  }

  console.log("\nAll icons generated.\n");
  console.log("Next steps:");
  console.log("  1. npx @capacitor/assets generate   ← creates all iOS/Android icon sizes");
  console.log("  2. npx cap sync                      ← syncs web assets to native projects");
}

generate().catch(e => { console.error(e); process.exit(1); });
