// Top Gun audit run-20260720-073025 — persona role-variant passes at HEAD.
// Separated persona passes (one physical agent, disclosed): Adult Admin build path,
// Child View AI gate, Guest/Helper plan gate, and the /api/notify registry email
// gate for the scheduler-adjacent case (no Google account -> fail-closed proof).
import http from "node:http";
import fs from "node:fs";
import { startServer, stopServer, makeSession } from "../../../../../server/test/harness.mjs";

const OUT = new URL("./persona-output.json", import.meta.url);
const results = { startedAt: new Date().toISOString(), passes: {} };

const BUILD_RESPONSE = {
  kind: "build",
  answer: "I'll set up a weekly chores helper.",
  build: {
    summary: "Weekly chores reminder",
    skill: { name: "TG-Chore Reminder", description: "Remind about chores", domain: "Family", planner_guidance: "remind", risk_level: "Low", steps: [{ name: "Compose reminder", tool_id: null, approval_required: false }, { name: "Draft the notification", tool_id: "homeops.send_notification_draft", approval_required: false }] },
    agent: { name: "TG-Chore Agent", purpose: "chores", instructions: "Remind weekly." },
    automation: { name: "TG-weekly chores", type: "recurring", intervalMs: 604800000, runAt: null },
  },
};
function modelReply(messages) {
  const sys = String(messages?.[0]?.content ?? "");
  if (sys.includes("You are FamiliOS, a warm, capable assistant")) return JSON.stringify(BUILD_RESPONSE);
  if (sys.includes("You execute ONE reasoning step")) return JSON.stringify({ text: "Reminder composed: take out bins, water plants.", data: null });
  if (sys.includes("fill the input fields")) return JSON.stringify({ to: "family", subject: "Chores", body: "Take out bins, water plants." });
  if (sys.includes("completed household-assistant run revealed")) return JSON.stringify({ remember: false, text: "" });
  return JSON.stringify({ kind: "answer", answer: "ok" });
}
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
    let messages = []; try { messages = JSON.parse(body).messages ?? []; } catch {}
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(JSON.stringify({ message: { content: modelReply(messages) } }) + "\n");
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await startServer();
try {
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  const morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  const lily = await makeSession(ctx, "m-lily");     // Child View
  const sam = await makeSession(ctx, "m-sam");       // Guest/Helper
  await morgan.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await morgan.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });

  // JRN-2 (Morgan, Adult Admin): chat-build a weekly helper with a DRAFT-notification
  // skill step, materialize, fire — does the scheduled run even reference the skill?
  const conv = await morgan.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-morgan chores" }) });
  const a = await morgan.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: create a helper that reminds the family about chores every week", conversationId: conv.data.conversation.id }) });
  const b = await morgan.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a.data?.build, conversationId: conv.data.conversation.id }) });
  const trigId = b.data?.created?.automation?.id;
  const fire = await morgan.req(`/api/triggers/${trigId}/fire`, { method: "POST", body: JSON.stringify({}) });
  await sleep(2500);
  const run = fire.data?.runId ? (await morgan.req(`/api/runs/${fire.data.runId}`)).data?.run : null;
  results.passes.JRN2_morgan_build = {
    kind: a.data?.kind, buildOk: b.data?.ok,
    agentTools: b.data?.created?.agent?.allowedFunctionIds,
    run: run && { status: run.status, steps: (run.steps ?? []).map((s) => ({ toolId: s.toolId, title: s.title, status: s.status, detail: String(s.detail ?? "").slice(0, 160) })) },
  };

  // JRN-3 (Lily, Child View): AI chat gate — child without aiEnabled must be refused.
  const c1 = await lily.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: hi" }) });
  // and the build route must role-gate regardless.
  const c2 = await lily.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: BUILD_RESPONSE.build }) });
  results.passes.JRN3_lily_child = { assistant: { status: c1.status, error: c1.data?.error }, build: { status: c2.status, error: c2.data?.error } };

  // JRN-4 (Sam, Guest/Helper): plan/do-now gate for the lowest role.
  const g1 = await sam.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: send everyone a note" }) });
  const g2 = await sam.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: BUILD_RESPONSE.build }) });
  results.passes.JRN4_sam_guest = { assistant: { status: g1.status, kind: g1.data?.kind, error: g1.data?.error }, build: { status: g2.status, error: g2.data?.error } };

  // JRN-5 (registry email gate): /api/notify with Morgan's verified contact method and
  // NO Google account — the honest fail-closed path a real send would hit.
  const n1 = await morgan.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: "ct-morgan-email", title: "TG test", body: "TG registry gate check" }) });
  results.passes.JRN5_notify_gate = { status: n1.status, data: n1.data };

  results.finishedAt = new Date().toISOString();
} finally {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  await stopServer(ctx);
  await new Promise((r) => fake.close(r));
}
console.log(JSON.stringify(results, null, 2));
