// Generates the FamiliOS "huddle" brand assets from the handoff geometry spec
// (96pt reference frame): app icon, splash logo, and Android adaptive icon
// layers. Pure Node — renders RGBA buffers and writes PNGs via zlib.
// Run: node scripts/gen-brand-assets.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "images");
mkdirSync(OUT, { recursive: true });

/* ---------- tiny PNG encoder (RGBA, 8-bit) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(path, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${w}x${h}, ${(png.length / 1024).toFixed(0)} KB)`);
}

/* ---------- rendering helpers ---------- */
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const INK1 = hex("#252D42"), INK2 = hex("#12161F");
const SPLASH1 = hex("#232B3E"), SPLASH2 = hex("#10141E");
const EMBER = hex("#E0662C"), PORCELAIN = hex("#F5F1E9"), GOLD = hex("#E8A34E");
const GLOW = [224, 102, 44];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Handoff huddle geometry in the 96pt frame: (x, y, diameter, color).
const CIRCLES = [
  [18, 34, 44, EMBER],
  [55, 43, 29, PORCELAIN],
  [40, 17, 20, GOLD],
];

/**
 * Render one asset.
 * mode "icon": full-bleed ink gradient + glow + huddle (iOS masks corners).
 * mode "mark": transparent bg, huddle only (splash logo / adaptive foreground,
 *              mark scaled to `markScale` of the canvas, centered).
 * mode "bg":   ink gradient + glow only (adaptive background).
 */
function render(path, size, mode, markScale = 1) {
  const rgba = Buffer.alloc(size * size * 4);
  // 160deg CSS gradient direction (clockwise from north).
  const ang = (160 * Math.PI) / 180;
  const dx = Math.sin(ang), dy = -Math.cos(ang);
  const projMin = Math.min(0, dx * size) + Math.min(0, dy * size);
  const projMax = Math.max(0, dx * size) + Math.max(0, dy * size);
  const [g1, g2] = mode === "icon" ? [INK1, INK2] : [SPLASH1, SPLASH2];

  // Mark placement: the 96-frame maps into a centered square of size*markScale.
  const ms = (size * markScale) / 96;
  const off = (size - size * markScale) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (mode !== "mark") {
        const t = clamp01(((dx * x + dy * y) - projMin) / (projMax - projMin));
        r = g1[0] + (g2[0] - g1[0]) * t;
        g = g1[1] + (g2[1] - g1[1]) * t;
        b = g1[2] + (g2[2] - g1[2]) * t;
        a = 255;
        // ember radial glow at (78%, 82%), radius 60% of the canvas
        const gd = Math.hypot(x - size * 0.78, y - size * 0.82) / (size * 0.6);
        const glow = 0.4 * (1 - smooth(0, 1, gd));
        r = r + (GLOW[0] - r) * glow;
        g = g + (GLOW[1] - g) * glow;
        b = b + (GLOW[2] - b) * glow;
      }
      if (mode !== "bg") {
        for (const [cx, cy, d, col] of CIRCLES) {
          const rad = (d / 2) * ms;
          const dist = Math.hypot(x - (off + (cx + d / 2) * ms), y - (off + (cy + d / 2) * ms));
          const cov = 1 - smooth(rad - 1.2, rad + 1.2, dist);
          if (cov > 0) {
            r = r + (col[0] - r) * cov;
            g = g + (col[1] - g) * cov;
            b = b + (col[2] - b) * cov;
            a = Math.max(a, cov * 255);
          }
        }
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r); rgba[i + 1] = Math.round(g); rgba[i + 2] = Math.round(b); rgba[i + 3] = Math.round(a);
    }
  }
  writePng(path, size, size, rgba);
}

render(join(OUT, "icon.png"), 1024, "icon");
render(join(OUT, "splash-logo.png"), 512, "mark", 0.9);
render(join(OUT, "android-icon-foreground.png"), 1024, "mark", 0.55);
render(join(OUT, "android-icon-background.png"), 1024, "bg");
render(join(OUT, "android-icon-monochrome.png"), 1024, "mark", 0.55);
render(join(OUT, "favicon.png"), 96, "icon");
