#!/usr/bin/env node
/**
 * HomeOps AI — PWA icon generator
 * Converts the SVG source icon to PNG for maximum browser/iOS compatibility.
 *
 * Usage:
 *   npm install --save-dev sharp        (one-time)
 *   node mobile-version/setup-icons.mjs
 *
 * Output: public/icons/{icon-192x192,icon-512x512,apple-touch-icon,favicon-32x32,favicon-16x16}.png
 * After running, update vite.config.ts to swap .svg → .png in the manifest icons array.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");

const SIZES = [
  { name: "icon-192x192.png", size: 192 },
  { name: "icon-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-16x16.png", size: 16 },
];

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("\n  sharp is not installed. Run:");
    console.error("  npm install --save-dev sharp\n");
    process.exit(1);
  }

  const svgPath = path.join(ICONS_DIR, "icon.svg");
  let svgBuffer;
  try {
    svgBuffer = readFileSync(svgPath);
  } catch {
    console.error(`\n  Cannot find source SVG at ${svgPath}\n`);
    process.exit(1);
  }

  console.log("\nGenerating PWA icons from icon.svg...\n");
  for (const { name, size } of SIZES) {
    const outPath = path.join(ICONS_DIR, name);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`  ✓ ${name}  (${size}×${size})`);
  }

  console.log("\n  All icons written to public/icons/");
  console.log("\nNext step:");
  console.log("  In vite.config.ts, update the manifest icons array:");
  console.log('  { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },');
  console.log('  { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
