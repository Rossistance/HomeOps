// FamiliOS — production web capability (search / read / recipe extraction).
//
// Works on any host with plain fetch; JS-heavy pages upgrade to a real headless
// browser in this order: (1) in-process Playwright Chromium (server/browser.mjs,
// installed via `npm run install-browser`), (2) an external runtime at
// BROWSER_RUNTIME_URL. Without either it degrades honestly to server-side HTML
// fetching (which covers search engines and recipe sites).
import { safeFetch } from "./net.mjs";
import { renderPage, browserAvailable } from "./browser.mjs";
import { getSecret } from "./store.mjs";

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
// Search provider chain. Hosted deployments (Render etc.) sit on datacenter IPs
// that DuckDuckGo resets and Bing serves bot-walls to, so a real search API is
// used FIRST when a key is configured:
//   BRAVE_SEARCH_API_KEY  — https://api.search.brave.com (free tier)
//   TAVILY_API_KEY        — https://tavily.com (free tier)
// Without a key the scrape chain (DDG html → DDG lite → Bing html) still works
// from residential/dev IPs and degrades honestly elsewhere.

async function searchBrave(q, maxResults) {
  const key = (process.env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!key) return null;
  const r = await safeFetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(maxResults, 20)}`,
    { headers: { accept: "application/json", "x-subscription-token": key } },
    { timeoutMs: 10_000, maxBytes: 2_000_000 },
  );
  if (!r.ok || !r.httpOk) return { error: `brave: ${r.error ?? r.status}` };
  try {
    const j = JSON.parse(r.text);
    const results = (j.web?.results ?? []).map((x) => ({
      title: String(x.title ?? "").slice(0, 160),
      url: String(x.url ?? ""),
      snippet: htmlToText(String(x.description ?? "")).slice(0, 240),
    })).filter((x) => /^https?:\/\//.test(x.url));
    return results.length ? { results } : { error: "brave: no results" };
  } catch { return { error: "brave: bad_json" }; }
}

async function searchTavily(q, maxResults) {
  const key = (process.env.TAVILY_API_KEY || "").trim();
  if (!key) return null;
  const r = await safeFetch(
    "https://api.tavily.com/search",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, query: q, max_results: Math.min(maxResults, 10) }) },
    { timeoutMs: 12_000, maxBytes: 2_000_000 },
  );
  if (!r.ok || !r.httpOk) return { error: `tavily: ${r.error ?? r.status}` };
  try {
    const j = JSON.parse(r.text);
    const results = (j.results ?? []).map((x) => ({
      title: String(x.title ?? "").slice(0, 160),
      url: String(x.url ?? ""),
      snippet: String(x.content ?? "").slice(0, 240),
    })).filter((x) => /^https?:\/\//.test(x.url));
    return results.length ? { results } : { error: "tavily: no results" };
  } catch { return { error: "tavily: bad_json" }; }
}

// OpenAI web search: the household's existing OpenAI key (env or the key saved
// in Settings → AI Providers) powers real search via the Responses API's
// web_search tool. No browser, no scraping, works on any host — this is what
// keeps Ask runs alive on small instances where Chromium can't run.
function openAIKey() {
  const env = (process.env.OPENAI_API_KEY || "").trim();
  if (env) return env;
  try { return (getSecret("ai.openai", "apiKey") || "").trim() || null; } catch { return null; }
}

async function searchOpenAI(q, maxResults) {
  const key = openAIKey();
  if (!key) return null;
  const call = (toolType) => safeFetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: toolType }],
        tool_choice: { type: toolType },
        input: `Web search: ${q}\nReturn a short answer that cites sources.`,
      }),
    },
    { timeoutMs: 25_000, maxBytes: 2_000_000 },
  );
  // Tool name differs across API generations; try the current one, fall back once.
  let r = await call("web_search_preview");
  if (r.ok && !r.httpOk && r.status === 400) r = await call("web_search");
  if (!r.ok || !r.httpOk) return { error: `openai: ${r.error ?? r.status}` };
  try {
    const j = JSON.parse(r.text);
    const results = [];
    const seen = new Set();
    for (const item of j.output ?? []) {
      for (const part of item.content ?? []) {
        // url_citation annotations carry {url, title}; the text itself is the summary.
        for (const a of part.annotations ?? []) {
          const u = a.url ?? a.url_citation?.url;
          const t = a.title ?? a.url_citation?.title ?? "";
          if (u && /^https?:\/\//.test(u) && !seen.has(u)) {
            seen.add(u);
            results.push({ title: String(t).slice(0, 160) || u, url: u, snippet: String(part.text ?? "").slice(0, 240) });
          }
        }
      }
    }
    return results.length ? { results: results.slice(0, maxResults) } : { error: "openai: no cited results" };
  } catch { return { error: "openai: bad_json" }; }
}

// DDG "lite" endpoint: plain table markup on separate infra — sometimes
// reachable when html.duckduckgo.com tarpits a hosted IP.
function parseDuckDuckGoLite(html) {
  const results = [];
  const re = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
    if (!/^https?:\/\//.test(href)) continue;
    results.push({ title: htmlToText(m[2]).slice(0, 160), url: href, snippet: "" });
  }
  const snips = [];
  const sre = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  while ((m = sre.exec(html)) && snips.length < results.length + 4) snips.push(htmlToText(m[1]).slice(0, 240));
  for (let i = 0; i < results.length; i++) results[i].snippet = snips[i] ?? "";
  return results;
}

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

  // 1) Keyed APIs first — the only reliable path from hosted/datacenter IPs.
  // The OpenAI tier reuses the household's existing AI key, so a deployment
  // with a working assistant automatically has working search.
  for (const [engine, fn] of [["brave", searchBrave], ["tavily", searchTavily], ["openai", searchOpenAI]]) {
    const r = await fn(q, maxResults);
    if (r === null) continue; // key not configured
    if (r.results) return { ok: true, engine, query: q, results: r.results.slice(0, maxResults) };
    attempts.push(r.error);
  }
  const anyKey = !!(process.env.BRAVE_SEARCH_API_KEY || process.env.TAVILY_API_KEY || openAIKey());

  // 2) DuckDuckGo HTML
  const ddg = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: FETCH_HEADERS }, { timeoutMs: 10_000, maxBytes: 2_000_000 });
  if (ddg.ok && ddg.httpOk) {
    const results = parseDuckDuckGo(ddg.text);
    if (results.length) return { ok: true, engine: "duckduckgo", query: q, results: results.slice(0, maxResults) };
    attempts.push("duckduckgo: no results parsed");
  } else attempts.push(`duckduckgo: ${ddg.error ?? ddg.status}`);
  // 3) DuckDuckGo lite (separate infra; sometimes survives when html.* is blocked)
  const lite = await safeFetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, { headers: FETCH_HEADERS }, { timeoutMs: 10_000, maxBytes: 2_000_000 });
  if (lite.ok && lite.httpOk) {
    const results = parseDuckDuckGoLite(lite.text);
    if (results.length) return { ok: true, engine: "duckduckgo-lite", query: q, results: results.slice(0, maxResults) };
    attempts.push("ddg-lite: no results parsed");
  } else attempts.push(`ddg-lite: ${lite.error ?? lite.status}`);
  // 4) Bing HTML fallback
  const bing = await safeFetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { headers: FETCH_HEADERS }, { timeoutMs: 10_000, maxBytes: 2_000_000 });
  if (bing.ok && bing.httpOk) {
    const results = parseBing(bing.text);
    if (results.length) return { ok: true, engine: "bing", query: q, results: results.slice(0, maxResults) };
    attempts.push("bing: no results parsed");
  } else attempts.push(`bing: ${bing.error ?? bing.status}`);

  // 5) Real-browser fallback: render the results page in the in-process Chromium.
  // Datacenter IPs get bot-walled on plain fetches, but a real browser usually
  // passes — this is what makes keyless search work on hosted deployments.
  if (browserAvailable()) {
    for (const [engine, url, parse] of [
      ["duckduckgo-browser", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parseDuckDuckGo],
      ["bing-browser", `https://www.bing.com/search?q=${encodeURIComponent(q)}`, parseBing],
    ]) {
      const page = await renderPage(url, { timeoutMs: 20_000 });
      if (!page?.html) { attempts.push(`${engine}: render failed`); continue; }
      const results = parse(page.html);
      if (results.length) return { ok: true, engine, query: q, results: results.slice(0, maxResults) };
      attempts.push(`${engine}: no results parsed`);
    }
  }

  const hint = anyKey ? "" : " Hosted deployments are often bot-walled by search engines — set BRAVE_SEARCH_API_KEY or TAVILY_API_KEY (both have free tiers) for reliable search.";
  return { ok: false, error: "search_failed", message: `Web search failed (${attempts.join("; ")}).${hint}` };
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

  // Thin pages (JS shells, bot walls) get a second chance in a real browser.
  // Never render targets safeFetch refused on policy (SSRF guard).
  const thin = text.length < 400 || /<div id=["'](root|app|__next)["']>\s*<\/div>/i.test(html);
  if (thin && !direct.policyBlocked) {
    // 1) In-process Playwright Chromium (full JS runtime), when installed.
    if (browserAvailable()) {
      const viaLocal = await renderPage(target);
      if (viaLocal && (viaLocal.text?.length ?? 0) > text.length) {
        html = viaLocal.html ?? html;
        finalUrl = viaLocal.url ?? finalUrl;
        text = viaLocal.text ?? text;
        rendered = "browser";
        return { ok: true, title: viaLocal.title || extractTitle(html), url: finalUrl, text: text.slice(0, maxChars), links: extractLinks(html, finalUrl), rendered, html };
      }
    }
    // 2) External browser runtime, when configured.
    const viaRuntime = await tryBrowserRuntime(target);
    if (viaRuntime && (viaRuntime.text?.length ?? 0) > text.length) {
      return { ok: true, title: viaRuntime.title ?? "", url: viaRuntime.url ?? target, text: String(viaRuntime.text ?? "").slice(0, maxChars), links: viaRuntime.links ?? [], rendered: "browser" };
    }
    // 3) Reader proxy (r.jina.ai): renders the page remotely and returns readable
    // markdown. No key, no local browser — the fallback that keeps small hosts
    // reading bot-walled sites. Honest label: rendered:"proxy".
    const viaProxy = await safeFetch(`https://r.jina.ai/${target}`, { headers: { accept: "text/plain" } }, { timeoutMs: 25_000, maxBytes: 2_000_000 });
    if (viaProxy.ok && viaProxy.httpOk && (viaProxy.text?.length ?? 0) > Math.max(600, text.length)) {
      const md = viaProxy.text;
      const mTitle = md.match(/^Title:\s*(.+)$/m)?.[1] ?? md.match(/^#\s+(.+)$/m)?.[1] ?? "";
      return { ok: true, title: mTitle.trim().slice(0, 200), url: target, text: md.slice(0, maxChars), links: extractLinks(html, finalUrl), rendered: "proxy" };
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

/** LLM text-extraction fallback for pages with readable content but no
 * schema.org Recipe markup (or bot-walled HTML rescued via the reader proxy).
 * Uses the household's OpenAI key; returns null quietly when unavailable so
 * the honest no_recipe_found path still runs. Output carries
 * extraction:"text" so callers can label provenance. */
async function recipeFromText(page, { maxChars = 6000 } = {}) {
  const key = openAIKey();
  const text = String(page.text ?? "");
  if (!key || text.length < 600) return null;
  const r = await safeFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Extract the main recipe from the page text. Reply with JSON: {\"found\":boolean,\"name\":string,\"ingredients\":string[],\"instructions\":string[]}. If the page has no single concrete recipe (e.g. it's a list of links), reply {\"found\":false}. Never invent ingredients that aren't in the text." },
          { role: "user", content: `Page: ${page.title ?? ""} (${page.url})\n\n${text.slice(0, maxChars)}` },
        ],
      }),
    },
    { timeoutMs: 25_000, maxBytes: 1_000_000 },
  );
  if (!r.ok || !r.httpOk) return null;
  try {
    const j = JSON.parse(r.text);
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    if (!parsed.found || !Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) return null;
    return {
      ok: true,
      source: page.url,
      extraction: "text",
      recipe: {
        name: String(parsed.name ?? page.title ?? "Recipe").slice(0, 160),
        url: page.url,
        ingredients: parsed.ingredients.map((x) => String(x).slice(0, 160)).slice(0, 40),
        instructions: (parsed.instructions ?? []).map((x) => String(x).slice(0, 400)).slice(0, 25),
      },
    };
  } catch { return null; }
}

/** Estimate a standard ingredient list for a dish by name — the last-resort
 * enrichment plan_meal uses when no recipe page could be read. Clearly labeled
 * estimated:true so callers can tell users to check quantities. */
export async function estimateIngredients(title, servings = 4) {
  const key = openAIKey();
  if (!key || !String(title ?? "").trim()) return null;
  const r = await safeFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `List the standard ingredients (with rough quantities for ${servings} servings) and short instructions for the dish the user names. JSON: {"ingredients":string[],"instructions":string[]}.` },
          { role: "user", content: String(title).slice(0, 200) },
        ],
      }),
    },
    { timeoutMs: 20_000, maxBytes: 500_000 },
  );
  if (!r.ok || !r.httpOk) return null;
  try {
    const parsed = JSON.parse(JSON.parse(r.text).choices?.[0]?.message?.content ?? "{}");
    if (!Array.isArray(parsed.ingredients) || parsed.ingredients.length === 0) return null;
    return {
      estimated: true,
      ingredients: parsed.ingredients.map((x) => String(x).slice(0, 160)).slice(0, 40),
      instructions: (parsed.instructions ?? []).map((x) => String(x).slice(0, 400)).slice(0, 25),
    };
  } catch { return null; }
}

/** Extract a structured recipe from a live page. Search often lands on gallery /
 * listicle pages ("25 easy weeknight dinners") that carry no Recipe JSON-LD of
 * their own — those exist to link to real recipe pages, so before failing we
 * follow up to three same-site recipe-looking links and extract from the first
 * one that has structured data. */
export async function extractRecipe(url) {
  const page = await readPage(url, { maxChars: 4000 });
  if (!page.ok) return page;
  const found = recipeFromHtml(page.html ?? "", { title: page.title, url: page.url });
  if (found) return { ok: true, ...found };

  // Tier 1: URLs that say "recipe". Tier 2: dish-slug links (single hyphenated
  // path segment + multi-word anchor text — how most food blogs address recipes).
  const NAV_TEXT = /^(home|about|recipes?|blog|menu|search|more|next|previous|comments?|reply|log in|sign up)$/i;
  const mineCandidates = (html, baseUrl) => {
    const host = (() => { try { return new URL(baseUrl).hostname; } catch { return null; } })();
    const sameSite = extractLinks(html ?? "", baseUrl, 120)
      .filter((l) => { try { return new URL(l.href).hostname === host && l.href.split("#")[0] !== baseUrl; } catch { return false; } })
      .filter((l) => !/\/(gallery|collection|roundup|category|tag|about|contact|shop|privacy|newsletter|subscribe)\b/i.test(l.href));
    // Roundup slugs ("/easy-salad-recipes/", "/weeknight-dinners/") are more
    // listicles, not dishes — skip them or we burn our tries on nav links.
    const ROUNDUP_SLUG = /(-|\b)(recipes|dinners|ideas|meals|dishes|sides|desserts|breakfasts|lunches|favorites)\/?$/i;
    const tier1 = sameSite.filter((l) => /\/recipes?\//i.test(l.href) && !ROUNDUP_SLUG.test(l.href));
    const tier2 = sameSite.filter((l) => {
      try {
        const path = new URL(l.href).pathname;
        return /^\/[a-z0-9]+(?:-[a-z0-9]+)+\/?$/i.test(path) && !ROUNDUP_SLUG.test(path)
          && l.text.trim().split(/\s+/).length >= 2 && !NAV_TEXT.test(l.text.trim());
      } catch { return false; }
    });
    const seen = new Set();
    return [...tier1, ...tier2].filter((l) => !seen.has(l.href) && seen.add(l.href)).slice(0, 5);
  };

  let candidates = mineCandidates(page.html, page.url);
  // Many food sites hydrate their listicle links with JS (the static HTML has
  // hrefless anchors) — a real render is the only way to see them, and some
  // inject the Recipe JSON-LD client-side too.
  if (candidates.length === 0 && browserAvailable()) {
    const rendered = await renderPage(page.url);
    if (rendered?.html) {
      const renderedFound = recipeFromHtml(rendered.html, { title: rendered.title, url: rendered.url });
      if (renderedFound) return { ok: true, ...renderedFound };
      candidates = mineCandidates(rendered.html, rendered.url ?? page.url);
    }
  }
  for (const c of candidates) {
    const sub = await readPage(c.href, { maxChars: 4000 });
    if (!sub.ok) continue;
    const subFound = recipeFromHtml(sub.html ?? "", { title: sub.title, url: sub.url });
    if (subFound) return { ok: true, ...subFound, via: page.url };
  }

  // Last tier: the page (or its proxy-rendered text) is readable but carries no
  // machine recipe schema — extract with the household's LLM, honestly labeled.
  const textFound = await recipeFromText(page, { maxChars: 6000 });
  if (textFound) return textFound;
  return {
    ok: false, error: "no_recipe_found",
    message: `No structured recipe data found at ${page.url}${candidates.length ? ` (also tried: ${candidates.map((c) => c.href).join(", ")})` : ""}. The page text is available via web.read.`,
    title: page.title,
  };
}
