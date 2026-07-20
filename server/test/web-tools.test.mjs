// WEB TOOLS — production web capability (search/read/recipe) parsers. These are
// the pure halves (no network): HTML→text, entity decoding, ISO durations, and
// schema.org/Recipe extraction (JSON-LD incl. @graph + HowToSection, microdata
// fallback, honest null when a page has no structured recipe).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// ../web.mjs transitively imports ../store.mjs (getSecret); point the store at an
// isolated temp dir BEFORE that first import so this test can never resolve the
// live server/.data (ISS-001 guard in store.mjs enforces this).
process.env.HOMEOPS_DATA_DIR ||= fs.mkdtempSync(join(os.tmpdir(), "homeops-webtools-"));
const { htmlToText, decodeEntities, friendlyDuration, recipeFromHtml, extractTitle } = await import("../web.mjs");

test("htmlToText strips scripts/styles, keeps block structure, decodes entities", () => {
  const html = `<html><head><style>p{color:red}</style><script>alert(1)</script></head>
  <body><h1>Dinner &amp; Sides</h1><p>First</p><ul><li>one</li><li>two</li></ul></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes("Dinner & Sides"));
  assert.ok(text.includes("• one"));
  assert.ok(!text.includes("alert"));
  assert.ok(!text.includes("color:red"));
});

test("decodeEntities handles named, decimal, and hex forms", () => {
  assert.equal(decodeEntities("&frac12; cup &amp; 350&deg;F &#8212; done &#x2713;"), "½ cup & 350°F — done ✓");
});

test("friendlyDuration converts ISO-8601 durations", () => {
  assert.equal(friendlyDuration("PT1H30M"), "1 hr 30 min");
  assert.equal(friendlyDuration("PT45M"), "45 min");
  assert.equal(friendlyDuration("not-a-duration"), "");
});

test("extractTitle reads the <title> tag", () => {
  assert.equal(extractTitle("<html><head><title> Best  Chili </title></head></html>"), "Best Chili");
});

test("recipeFromHtml parses JSON-LD @graph with HowToStep instructions", () => {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "ignore me" },
      {
        "@type": ["Recipe"],
        name: "Weeknight Chili",
        description: "Cozy &amp; fast.",
        recipeYield: ["4", "4 servings"],
        totalTime: "PT45M",
        image: { url: "https://example.com/chili.jpg" },
        recipeIngredient: ["1 lb ground beef", "1 can beans", "2 cups tomatoes"],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Brown the beef." },
          { "@type": "HowToSection", name: "Simmer", itemListElement: [{ "@type": "HowToStep", text: "Add beans and tomatoes." }] },
        ],
      },
    ],
  };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
  const out = recipeFromHtml(html, { title: "fallback", url: "https://example.com/chili" });
  assert.equal(out.source, "json-ld");
  assert.equal(out.recipe.name, "Weeknight Chili");
  assert.equal(out.recipe.yield, "4");
  assert.equal(out.recipe.totalTime, "45 min");
  assert.equal(out.recipe.image, "https://example.com/chili.jpg");
  assert.deepEqual(out.recipe.ingredients, ["1 lb ground beef", "1 can beans", "2 cups tomatoes"]);
  assert.deepEqual(out.recipe.instructions, ["Brown the beef.", "Simmer: Add beans and tomatoes."]);
  assert.equal(out.recipe.url, "https://example.com/chili");
});

test("recipeFromHtml falls back to itemprop microdata ingredients", () => {
  const html = `<div itemscope itemtype="https://schema.org/Recipe">
    <span itemprop="recipeIngredient">2 eggs</span>
    <span itemprop="recipeIngredient">1 cup flour</span>
  </div>`;
  const out = recipeFromHtml(html, { title: "Pancakes", url: "https://example.com/p" });
  assert.equal(out.source, "microdata");
  assert.deepEqual(out.recipe.ingredients, ["2 eggs", "1 cup flour"]);
  assert.equal(out.recipe.name, "Pancakes");
});

test("recipeFromHtml returns null when a page has no structured recipe (honest failure)", () => {
  assert.equal(recipeFromHtml("<html><body><p>Just a blog post about food.</p></body></html>", {}), null);
});
