// Turning an answer's links into cards.
//
// "These are links… they need to be displayed as cards, just like throughout the app, within
//  this actual chat bubble — individual ones, so they're more structured, I can see them, I can
//  click on them."
//
// The extraction is the part worth testing: it runs over model output, which is the least
// predictable text in the app. A missed link is a card that doesn't appear; a bad one is a card
// that goes nowhere.
import test from "node:test";
import assert from "node:assert/strict";
import { linksIn } from "./answer-links.ts";

test("markdown links become cards, titled by their link text", () => {
  const out = linksIn("The closest match is [Ryobi 18V Drill](https://example.com/ryobi), though [this one](https://other.com/x) is cheaper.");
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Ryobi 18V Drill");
  assert.equal(out[0].url, "https://example.com/ryobi");
  assert.equal(out[1].title, "this one");
});

test("a bare URL is still a card, titled by its host", () => {
  // Models produce these constantly, and a bare URL in a paragraph is the least tappable thing
  // on the screen — exactly the case he was pointing at.
  const out = linksIn("Have a look at https://www.homedepot.com/p/12345 for the price.");
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "homedepot.com", "www. is noise in a card title");
});

test("trailing punctuation is not part of the URL", () => {
  // "…see https://example.com/page." would otherwise open a 404 with a full stop on the end.
  const out = linksIn("See https://example.com/page.");
  assert.equal(out[0].url, "https://example.com/page");
});

test("the same link mentioned twice is ONE card", () => {
  // Two identical cards read as a bug, not as emphasis.
  const out = linksIn("[A](https://example.com/x) and later https://example.com/x again");
  assert.equal(out.length, 1);
});

test("an answer with no links produces no cards", () => {
  assert.equal(linksIn("Soccer is at 4:15 on Tuesday.").length, 0);
  assert.equal(linksIn("").length, 0);
});

test("order is preserved — the first thing mentioned is the first card", () => {
  const out = linksIn("First [one](https://a.com), then [two](https://b.com), then [three](https://c.com).");
  assert.deepEqual(out.map((l) => l.url), ["https://a.com", "https://b.com", "https://c.com"]);
});

test("markdown is consumed before bare-URL scanning, so a link isn't found twice", () => {
  // The markdown form contains a bare URL inside it. Scanning naively would emit the same
  // destination as both a titled card and an untitled one.
  const out = linksIn("[Titled](https://example.com/thing)");
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Titled");
});
