// EMAIL ON THE WIRE — what a household's Gmail actually sends. Invariants: a subject with
// non-ASCII (every helper deliverable has "·" and "—") is RFC 2047 encoded so it arrives as
// written instead of as Latin-1 mojibake; ASCII subjects stay readable in raw form; the body
// is base64 so emoji survive; the message is multipart/alternative with an HTML shape of the
// same text (headings + bullets), with nothing in the text interpreted as markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeHeaderValue, textToHtml, buildRawEmail } from "../mime.mjs";

const decodeRaw = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const decodeWords = (h) => h.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8")).replace(/\r\n /g, "");

test("ASCII headers pass through; non-ASCII becomes UTF-8 B encoded-words that decode back exactly", () => {
  assert.equal(encodeHeaderValue("Plain subject"), "Plain subject");
  const subject = "FamiliOS · Week Ahead — Next seven days";
  const enc = encodeHeaderValue(subject);
  assert.match(enc, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(decodeWords(enc), subject);
});

test("long non-ASCII subjects split into ≤75-char encoded-words on character boundaries", () => {
  const subject = "FamiliOS · Appointment Prep — Speech therapy prep for Monday, September 21 — leave-by time, questions, what to bring 🇸🇻";
  const enc = encodeHeaderValue(subject);
  const words = enc.split("\r\n ");
  assert.ok(words.length > 1, "folded into several words");
  for (const w of words) assert.ok(w.length <= 75, `encoded-word too long: ${w.length}`);
  assert.equal(decodeWords(enc), subject, "no multibyte sequence was cut");
});

test("CR/LF in a header value can't inject headers", () => {
  assert.equal(encodeHeaderValue("Hi\r\nBcc: evil@example.com"), "Hi Bcc: evil@example.com");
});

test("the raw message is multipart/alternative with base64 parts, and both parts decode to the text", () => {
  const text = "Tuesday is the clearest choice.\n\nConflicts\n- Monday, September 21, 3:45 PM: Melissa — telehealth\n- Monday 4:30 PM: Ross\n\nWhat I did\nRead the calendar for 🇸🇻 week.";
  const raw = buildRawEmail({ to: "ross@example.com", subject: "FamiliOS · Week Ahead — Conflicts", text });
  const msg = decodeRaw(raw);
  assert.match(msg, /^To: ross@example\.com\r\n/);
  assert.match(msg, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(msg, /\r\nMIME-Version: 1\.0\r\n/);
  assert.match(msg, /Content-Type: multipart\/alternative; boundary="([^"]+)"/);
  const boundary = msg.match(/boundary="([^"]+)"/)[1];
  const parts = msg.split(`--${boundary}`).slice(1, -1);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
  assert.match(parts[1], /Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
  const body = (p) => Buffer.from(p.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(body(parts[0]), text, "plain part is byte-for-byte what the helper wrote");
  assert.ok(body(parts[1]).includes("🇸🇻"), "emoji survive in the HTML part");
  for (const line of msg.split("\r\n")) assert.ok(line.length <= 998, "no line over the RFC limit");
});

test("textToHtml: headings before bullets, bullets as lists, paragraphs otherwise, text escaped", () => {
  const html = textToHtml("One-line summary first.\n\nConflicts\n- Monday <b>3:45</b>\n- Tuesday\n\nWhat I did\nRead the calendar & the tasks.");
  assert.match(html, /<p[^>]*>One-line summary first\.<\/p>/);
  assert.match(html, /<h3[^>]*>Conflicts<\/h3>\s*<ul[^>]*><li[^>]*>Monday &lt;b&gt;3:45&lt;\/b&gt;<\/li><li[^>]*>Tuesday<\/li><\/ul>/);
  assert.match(html, /<h3[^>]*>What I did<\/h3>\s*<p[^>]*>Read the calendar &amp; the tasks\.<\/p>/);
  assert.ok(!html.includes("<b>"), "nothing in the body is interpreted as markup");
});
