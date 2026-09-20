// THE WIRE to the iMessage bridge — what leaves for the cloud Mac and what arrives from it.
//
// A fake BlueBubbles server stands in for the Mac so the tests can see exactly what the
// module sends (the password as ?password= AND as a bearer header, the chat GUID, the
// method) and drive the branches that matter: a chat the Mac already has, a first contact
// it has to create, a wrong password, a Mac that isn't there. The webhook parser is fed the
// shapes the server actually posts, plus the events that must be ignored.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-bluebubbles-"));

/* ---- a fake Mac ---- */
const seen = [];
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, path: url.pathname, password: url.searchParams.get("password"), auth: req.headers.authorization, body });
    const reply = (code, json) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (url.searchParams.get("password") !== "pw") return reply(401, { status: 401, message: "Unauthorized", error: { type: "Authentication Error", error: "Invalid password" } });
    if (url.pathname === "/api/v1/ping") return reply(200, { status: 200, message: "pong" });
    if (url.pathname === "/api/v1/message/text") {
      if (String(body?.chatGuid ?? "").includes("+15550000404")) return reply(404, { status: 404, message: "Not Found", error: { type: "Chat Error", error: "Chat does not exist" } });
      return reply(200, { status: 200, message: "Message sent!", data: { guid: "msg-1", text: body.message } });
    }
    if (url.pathname === "/api/v1/chat/new") return reply(200, { status: 200, message: "Chat created", data: { guid: `iMessage;-;${body.addresses[0]}`, messages: [{ guid: "msg-new-1" }] } });
    reply(404, { status: 404, message: "no such route" });
  });
});

let port, bb, store;
before(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  port = fake.address().port;
  process.env.BLUEBUBBLES_URL = `http://127.0.0.1:${port}/`;   // trailing slash on purpose
  process.env.BLUEBUBBLES_PASSWORD = "pw";
  store = await import("../store.mjs");
  bb = await import("../bluebubbles.mjs");
});
after(async () => {
  await new Promise((r) => fake.close(r));
  try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ---- handles ---- */

test("handles normalise to what iMessage uses: E.164 phones, lower-case Apple IDs", () => {
  assert.equal(bb.normalizeAddress("(555) 010-8899"), "+15550108899");
  assert.equal(bb.normalizeAddress("1 555 010 8899"), "+15550108899");
  assert.equal(bb.normalizeAddress("+15550108899"), "+15550108899");
  assert.equal(bb.normalizeAddress("+44 20 7946 0958"), "+442079460958");
  assert.equal(bb.normalizeAddress("Ross@Example.com"), "ross@example.com");
  assert.equal(bb.normalizeAddress(""), "");
  assert.equal(bb.chatGuidFor("(555) 010-8899"), "iMessage;-;+15550108899");
  assert.equal(bb.chatGuidFor("+15550108899", "SMS"), "SMS;-;+15550108899");
});

test("sameHandle sees through formatting; group GUIDs are recognised", () => {
  assert.ok(bb.sameHandle("(555) 010-8899", "+15550108899"));
  assert.ok(!bb.sameHandle("(555) 010-8899", "+15550108800"));
  assert.ok(bb.sameHandle("Ross@Example.com", "ross@example.com"));
  assert.ok(!bb.sameHandle("ross@example.com", "+15550108899"));
  assert.ok(bb.isGroupChatGuid("iMessage;+;chat123"));
  assert.ok(!bb.isGroupChatGuid("iMessage;-;+15550108899"));
});

/* ---- the webhook ---- */

test("a new-message event is read into one shape, whatever layout the server used", () => {
  const nested = bb.parseInboundWebhook({ type: "new-message", data: { guid: "p:0/1", text: "  hi  ", isFromMe: false, handle: { address: "+1 (555) 010-8899", service: "iMessage" }, chats: [{ guid: "iMessage;-;+15550108899" }], dateCreated: 1 } });
  assert.equal(nested.type, "new-message");
  assert.equal(nested.guid, "p:0/1");
  assert.equal(nested.text, "hi");
  assert.equal(nested.address, "+15550108899");
  assert.equal(nested.chatGuid, "iMessage;-;+15550108899");
  assert.equal(nested.isFromMe, false);
  assert.equal(nested.isGroup, false);

  const bare = bb.parseInboundWebhook({ guid: "p:0/2", text: "yo", handle: { address: "+15550108899" } });
  assert.equal(bare.type, "new-message");
  assert.equal(bare.address, "+15550108899");
  assert.equal(bare.chatGuid, null, "no chat listed → nothing to remember");
  assert.equal(bare.isGroup, null, "no chat listed → the group question is UNANSWERED, not answered 'no'");
});

test("NEGATIVE: what must never reach the assistant is marked, not dropped silently", () => {
  assert.deepEqual(bb.parseInboundWebhook({ type: "typing-indicator", data: {} }), { type: "typing-indicator", ignored: true });
  assert.equal(bb.parseInboundWebhook({ type: "new-message", data: { guid: "x", text: "me", isFromMe: true, handle: { address: "+15550108899" } } }).isFromMe, true);
  assert.equal(bb.parseInboundWebhook({ type: "new-message", data: { guid: "x", text: "all", handle: { address: "+15550108899" }, chats: [{ guid: "iMessage;+;chat9" }] } }).isGroup, true);
  assert.equal(bb.parseInboundWebhook(null), null);
  assert.equal(bb.parseInboundWebhook("nope"), null);
});

test("the shared secret is accepted from a header, a bearer, or the registered URL", () => {
  const url = new URL("http://x/api/webhooks/bluebubbles?secret=s3");
  assert.equal(bb.webhookSecretPresented({ "x-familios-webhook-secret": "s1" }, url), "s1");
  assert.equal(bb.webhookSecretPresented({ authorization: "Bearer s2" }, url), "s2");
  assert.equal(bb.webhookSecretPresented({}, url), "s3");
  assert.equal(bb.webhookSecretPresented({}, new URL("http://x/hook")), null);
  assert.ok(bb.secretMatches("abc", "abc"));
  assert.ok(!bb.secretMatches("abc", "abd"));
  assert.ok(!bb.secretMatches("", "abc"), "an empty secret never matches");
  assert.ok(!bb.secretMatches("abc", null));
});

/* ---- outbound ---- */

test("ping reaches the Mac with the password in both places BlueBubbles and a proxy look", async () => {
  seen.length = 0;
  const h = await bb.ping();
  assert.equal(h.ok, true);
  assert.equal(h.status, "healthy");
  assert.equal(seen[0].path, "/api/v1/ping");
  assert.equal(seen[0].password, "pw", "BlueBubbles reads ?password=");
  assert.equal(seen[0].auth, "Bearer pw", "a tunnel in front of the Mac can enforce the same secret");
});

test("sendText addresses the one-to-one chat and sends the full body via the private API", async () => {
  seen.length = 0;
  const r = await bb.sendText({ to: "(555) 010-8899", text: "Dinner is at 6." });
  assert.equal(r.ok, true);
  assert.equal(r.action, "sent");
  assert.equal(r.chatGuid, "iMessage;-;+15550108899");
  assert.equal(r.guid, "msg-1");
  const call = seen.find((s) => s.path === "/api/v1/message/text");
  assert.equal(call.method, "POST");
  assert.equal(call.body.chatGuid, "iMessage;-;+15550108899");
  assert.equal(call.body.message, "Dinner is at 6.");
  assert.equal(call.body.method, "private-api");
  assert.match(call.body.tempGuid, /^familios-/);
});

test("a remembered chat GUID wins over the address-derived one", async () => {
  seen.length = 0;
  const r = await bb.sendText({ to: "+15550108899", chatGuid: "iMessage;-;ross@example.com", text: "hi" });
  assert.equal(r.ok, true);
  assert.equal(seen[0].body.chatGuid, "iMessage;-;ross@example.com");
});

test("FIRST CONTACT: when the Mac has no chat with the handle, the chat is created with the message", async () => {
  seen.length = 0;
  const r = await bb.sendText({ to: "+15550000404", text: "Welcome to FamiliOS." });
  assert.equal(r.ok, true);
  assert.equal(r.action, "started");
  assert.equal(r.chatGuid, "iMessage;-;+15550000404");
  assert.equal(r.guid, "msg-new-1");
  assert.deepEqual(seen.map((s) => s.path), ["/api/v1/message/text", "/api/v1/chat/new"]);
  assert.deepEqual(seen[1].body.addresses, ["+15550000404"]);
  assert.equal(seen[1].body.message, "Welcome to FamiliOS.");
});

test("NEGATIVE: nothing to say or nobody to say it to is refused before the network", async () => {
  seen.length = 0;
  assert.equal((await bb.sendText({ to: "+15550108899", text: "   " })).error, "invalid_input");
  assert.equal((await bb.sendText({ text: "hello" })).error, "invalid_input");
  assert.equal(seen.length, 0);
});

test("a wrong password is reported as unauthorized, not as a mystery", async () => {
  process.env.BLUEBUBBLES_PASSWORD = "wrong";
  try {
    const h = await bb.ping();
    assert.equal(h.ok, false);
    assert.equal(h.status, "unauthorized");
    const r = await bb.sendText({ to: "+15550108899", text: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "provider_error");
    assert.match(r.message, /Invalid password/);
  } finally { process.env.BLUEBUBBLES_PASSWORD = "pw"; }
});

test("a Mac that isn't there is 'unreachable'; no config is 'not_configured'", async () => {
  const saved = process.env.BLUEBUBBLES_URL;
  try {
    process.env.BLUEBUBBLES_URL = "http://127.0.0.1:1";   // nothing listens on port 1
    const r = await bb.sendText({ to: "+15550108899", text: "hi" });
    assert.equal(r.error, "unreachable");
    assert.equal((await bb.ping()).status, "unreachable");
    process.env.BLUEBUBBLES_URL = "";
    assert.equal((await bb.sendText({ to: "+15550108899", text: "hi" })).error, "not_configured");
    assert.equal((await bb.ping()).status, "not_configured");
    assert.equal(bb.bluebubblesConfigured(), false);
  } finally { process.env.BLUEBUBBLES_URL = saved; }
});

/* ---- thread memory ---- */

test("the chat a person used is remembered on every method that carries their number, and found again", () => {
  store.putContactMethod({ id: "cm-a", memberId: "m-alex", householdId: "local", type: "Phone/Text", value: "(555) 010-8899", verified: true, optInStatus: "Opted In" });
  store.putContactMethod({ id: "cm-b", memberId: "m-morgan", householdId: "local", type: "Phone/Text", value: "+1 555-010-8899", verified: true, optInStatus: "Opted In" });
  store.putContactMethod({ id: "cm-c", memberId: "m-alex", householdId: "local", type: "Email", value: "alex@example.com", verified: true, optInStatus: "Opted In" });
  assert.equal(bb.rememberedChatGuid("+15550108899"), null);
  assert.equal(bb.rememberChatGuid("+15550108899", "iMessage;-;+15550108899"), 2, "both phone methods, not the email");
  assert.equal(bb.rememberChatGuid("+15550108899", "iMessage;-;+15550108899"), 0, "idempotent");
  assert.equal(bb.rememberedChatGuid("(555) 010-8899"), "iMessage;-;+15550108899");
  assert.equal(bb.rememberChatGuid("+15550108899", "iMessage;+;group"), 0, "a group thread is never remembered as someone's chat");
  assert.equal(store.getContactMethod("cm-c").imessageChatGuid, undefined);
});
