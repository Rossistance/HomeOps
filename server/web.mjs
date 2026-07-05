// HomeOps — production web capability (search / read / recipe extraction).
//
// Zero-dependency: works on any host (Render, local, CI) with plain fetch, so
// web + iOS clients get real web access WITHOUT the local Playwright runtime.
// When BROWSER_RUNTIME_URL points at a live runtime, `readPage` upgrades to a
// real headless browser for JS-heavy pages; otherwise it degrades honestly to
// server-side HTML fetching (which covers search engines and recipe sites).
import { safeFetch } from "./net.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };

/* ------------------------------ HTML helpers ----------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", eacute: "é", amp_: "&" };
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
    .replace(/&([a-z0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Strip an HTML document down to readable text (block tags become newlines). */
export function htmlToText(html) {
  let s = String(html ?? "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function extractTitle(html) {
  const m = String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

function extractLinks(html, baseUrl, limit = 30) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const text = htmlToText(m[2]).slice(0, 100);
    if (!text) continue;
    try {
      const href = new URL(m[1], baseUrl).toString();
      if (href.startsWith("http")) out.push({ text, href });
    } catch { /* skip malformed */ }
  }
  return out;
}

/* -------------------------------- Search --------------------------------- */
// Plain-English web search with no API key. DuckDuckGo's HTML endpoint is the
// primary (scrape-tolerant, no JS); Bing HTML is the fallback. Results carry
// title + url + snippet so the planner can pick pages to read.

function parseDuckDuckGo(html) {
  const results = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    let href = decodeEntities(m[1]);
    // DDG wraps targets: //duckduckgo.com/l/?uddg=<encoded>&rut=…
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
    if (!/^https?:\/\//.test(href)) continue;
    results.push({ title: htmlToText(m[2]).slice(0, 160), url: href, snippet: "" });
  }
  // Attach snippets in document order (result__snippet blocks parallel the anchors).
  const snips = [];
  const sre = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/gi;
  while ((m = sre.exec(html)) && snips.length < results.length + 4) snips.push(htmlToText(m[1]).slice(0, 240));
  for (let i = 0; i < results.length; i++) results[i].snippet = snips[i] ?? "";
  return results;
}

function parseBing(html) {
  const results = [];
  const re = /<li class="b_algo[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    const href = decodeEntities(m[1]);
    if (!/^https?:\/\//.test(href)) continue;
    results.push({ title: htmlToText(m[2]).slice(0, 160), url: href, snippet: htmlToText(m[3] ?? "").slice(0, 240) });
  }
  return results;
}

export async function searchWeb(query, { maxResults = 8 } = {}) {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, error: "invalid_input", message: "Provide a search query." };
  const attempts = [];
  // 1) DuckDuckGo HTML
  const ddg = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: FETCH_HEADERS }, { timeoutMs: 10_000, maxBytes: 2_000_000 });
  if (ddg.ok && ddg.httpOk) {
    const results = parseDuckDuckGo(ddg.text);
    if (results.length) return { ok: true, engine: "duckduckgo", query: q, results: results.slice(0, maxResults) };
    attempts.push("duckduckgo: no results parsed");
  } else attempts.push(`duckduckgo: ${ddg.error ?? ddg.status}`);
  // 2) Bing HTML fallback
  const bing = await safeFetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { headers: FETCH_HEADERS }, { timeoutMs: 10_000, maxBytes: 2_000_000 });
  if (bing.ok && bing.httpOk) {
    const results = parseBing(bing.text);
    if (results.length) return { ok: true, engine: "bing", query: q, results: results.slice(0, maxResults) };
    attempts.push("bing: no results parsed");
  } else attempts.push(`bing: ${bing.error ?? bing.status}`);
  return { ok: false, error: "search_failed", message: `Web search failed (${attempts.join("; ")}).` };
}

/* --------------------------------- Read ---------------------------------- */

async function tryBrowserRuntime(url) {
  const base = (process.env.BROWSER_RUNTIME_URL || "").replace(/\/$/, "");
  if (!base || !/^https?:/.test(base)) return null;
  const r = await safeFetch(`${base}/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }, { allowLoopback: true, timeoutMs: 35_000, maxBytes: 4_000_000 });
  if (!r.ok || !r.httpOk) return null;
  try { const j = JSON.parse(r.text); return j.ok ? j : null; } catch { return null; }
}

const MAX_TEXT = 18_000;

/**
 * Read a page: title + readable text + links. Prefers the headless runtime when
 * configured (real JS rendering); otherwise fetches HTML directly. `rendered`
 * reports which path produced the content so callers can be honest about it.
 */
export async function readPage(url, { maxChars = MAX_TEXT } = {}) {
  let target;
  try { target = new URL(url).toString(); } catch { return { ok: false, error: "invalid_url", message: "Provide an http(s) URL." }; }

  const direct = await safeFetch(target, { headers: FETCH_HEADERS }, { timeoutMs: 12_000, maxBytes: 3_000_000 });
  let html = direct.ok && direct.httpOk ? direct.text : "";
  let finalUrl = direct.ok ? direct.finalUrl : target;
  let text = html ? htmlToText(html) : "";
  let rendered = "http";

  // Thin/blocked pages get a second chance in the real browser (if available).
  if (text.length < 400) {
    const viaRuntime = await tryBrowserRuntime(target);
    if (viaRuntime && (viaRuntime.text?.length ?? 0) > text.length) {
      return { ok: true, title: viaRuntime.title ?? "", url: viaRuntime.url ?? target, text: String(viaRuntime.text ?? "").slice(0, maxChars), links: viaRuntime.links ?? [], rendered: "browser" };
    }
  }
  if (!html && !text) return { ok: false, error: "fetch_failed", message: `Could not read ${target} (${direct.error ?? `HTTP ${direct.status}`}).` };
  return { ok: true, title: extractTitle(html), url: finalUrl, text: text.slice(0, maxChars), links: extractLinks(html, finalUrl), rendered, html };
}

/* -------------------------------- Recipes -------------------------------- */
// Most recipe sites publish schema.org/Recipe JSON-LD — a clean, structured
// ingredient + instruction source with no scraping heuristics required.

function collectJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* tolerate malformed blocks */ }
  }
  return out;
}

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r; } return null; }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => String(t).toLowerCase() === "recipe")) return node;
  if (node["@graph"]) return findRecipeNode(node["@graph"]);
  return null;
}

function instructionText(node) {
  if (typeof node === "string") return htmlToText(node);
  if (!node || typeof node !== "object") return "";
  if (node.text) return htmlToText(node.text);
  if (node.itemListElement) return flattenInstructions(node.itemListElement).join("\n");
  if (node.name) return htmlToText(node.name);
  return "";
}
function flattenInstructions(raw) {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const steps = [];
  for (const item of arr) {
    const type = String(item?.["@type"] ?? "").toLowerCase();
    if (type === "howtosection" && item.itemListElement) {
      const name = item.name ? htmlToText(item.name) : "";
      const inner = flattenInstructions(item.itemListElement);
      steps.push(...(name ? inner.map((s) => `${name}: ${s}`) : inner));
    } else {
      const t = instructionText(item);
      if (t) steps.push(...t.split("\n").map((s) => s.trim()).filter(Boolean));
    }
  }
  return steps;
}

function firstImage(img) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === "object") return img.url ?? "";
  return "";
}

/** ISO-8601 duration (PT1H30M) → friendly "1 hr 30 min". */
export function friendlyDuration(iso) {
  const m = String(iso ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return "";
  const [, d, h, min] = m;
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? "s" : ""}`);
  if (h) parts.push(`${h} hr`);
  if (min) parts.push(`${min} min`);
  return parts.join(" ");
}

/**
 * Pure recipe parser (unit-testable, no network): JSON-LD first (reliable),
 * itemprop microdata fallback second, honest null third.
 */
export function recipeFromHtml(html, { title = "", url = "" } = {}) {
  const node = findRecipeNode(collectJsonLd(html));
  if (node) {
    const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : []).map((i) => htmlToText(i)).filter(Boolean);
    const instructions = flattenInstructions(node.recipeInstructions);
    return {
      source: "json-ld",
      recipe: {
        name: htmlToText(node.name ?? title).slice(0, 160),
        description: htmlToText(node.description ?? "").slice(0, 400),
        url,
        image: firstImage(node.image),
        yield: Array.isArray(node.recipeYield) ? String(node.recipeYield[0]) : String(node.recipeYield ?? ""),
        totalTime: friendlyDuration(node.totalTime) || friendlyDuration(node.cookTime) || "",
        ingredients, instructions,
      },
    };
  }
  // Microdata fallback: itemprop="recipeIngredient" / legacy "ingredients"
  const ing = [];
  const ire = /itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\//gi;
  let m;
  while ((m = ire.exec(html)) && ing.length < 60) { const t = htmlToText(m[1]); if (t) ing.push(t); }
  if (ing.length) {
    return { source: "microdata", recipe: { name: title, description: "", url, image: "", yield: "", totalTime: "", ingredients: ing, instructions: [] } };
  }
  return null;
}

/** Extract a structured recipe from a live page. */
export async function extractRecipe(url) {
  const page = await readPage(url, { maxChars: 4000 });
  if (!page.ok) return page;
  const found = recipeFromHtml(page.html ?? "", { title: page.title, url: page.url });
  if (found) return { ok: true, ...found };
  return { ok: false, error: "no_recipe_found", message: `No structured recipe data found at ${page.url}. The page text is available via web.read.`, title: page.title };
}
