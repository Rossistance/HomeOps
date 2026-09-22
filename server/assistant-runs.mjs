// Assistant run intelligence — the inline chat loop around engine runs.
//
// Two behaviors, both riding the engine's run-finished hook and both scoped to
// runs that came FROM a conversation (sourceRef.conversationId):
//
//   1. Results come back to the chat. Every conversation-born run appends a
//      durable run_result message when it finishes — the thread shows what
//      happened without the user hunting through Activity.
//
//   2. Failures self-heal, once. A failed conversation run gets its step logs
//      mined, an improved plan generated, and that plan auto-executed — with an
//      honest inline message at each stage. After a successful repair the chat
//      offers to save the now-working plan as a reusable helper (a build card
//      the user can confirm). One repair attempt max: a failed repair reports
//      honestly instead of looping.
import {
  getConversation, appendConversationMessage, getMember, appendAudit,
  recordAiUsage, aiBudgetExhausted, getSettings, runWithTenant,
} from "./store.mjs";
import { onRunFinished, onRunParked } from "./engine.mjs";
import { orchestrate } from "./orchestrator.mjs";
import { providerChatWithFallback } from "./ai.mjs";
import { getInternalFunction } from "./internal-functions.mjs";
import { findToolGlobal } from "./providers.mjs";
import { CONNECTORS } from "./connectors.mjs";

const REPAIR_SYS = `You repair a failed household-automation plan using its actual run trace. You get the original plan, each step's status/detail/error, and the tool catalog. Produce a CORRECTED plan that avoids the specific failure:
- Ground every change in the trace — swap a failing tool for a working alternative from the catalog, fix bad inputs, drop or reorder steps that can't succeed, add a reasoning step where data was missing.
- Keep everything that worked. Smallest change that fixes the failure.
- Use tool ids ONLY from the catalog; requiresApproval true for send/write/pay steps.
Respond with ONLY JSON (no prose, no fences):
{ "diagnosis": string, "plan": { "title": string, "summary": string, "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ] } }
"diagnosis" is one plain sentence naming what broke and what you changed.`;

/* ---- WP-003 (ISS-002, FEAT-014): the run summary tells the truth ----
 * The old summary counted `succeeded` steps and called it done: "Done — finished (3/3)".
 * It could not distinguish a briefing that was EMAILED from one that was merely
 * COMPOSED, so the family read success either way (EV-012). The rewrite separates what
 * was delivered from what was only prepared, and names — in plain words — every step
 * that did not happen and why. The warm voice stays; the certainty is now earned.
 *
 * WP-002 (Honest delivery) — the ABOVE fix still had a hole: "delivered" was inferred
 * from `requiresApproval` OR a name-sniffing regex (/send|notify|email|sms|post|deliver/i)
 * against the toolId. `homeops.send_notification_draft` is a review-only DRAFT tool by
 * design (internal-functions.mjs) — it never sends anything — but its id literally
 * CONTAINS "send_notification", so the regex matched and a run that only ever drafted a
 * message was reported as having "delivered". The regex is gone. "Delivered" is now
 * decided by ONE explicit `delivers` flag on the tool's own definition (internal-
 * functions.mjs / providers.mjs / connectors.mjs) — the single source of truth for
 * whether that tool reaches outside the run — never the tool's id, name, or approval
 * gate (an approval gate is about RISK, not about whether the step reaches anyone). */
const SUCCESS_STATUSES = ["succeeded", "done", "completed"];

// Static, synchronous lookup across all three tool catalogs — deliberately NOT the
// tenant-aware listConnectors()/toolCatalog() (this runs from a run-finished hook and
// must also work as a pure function in unit tests with no server/tenant booted). An
// unknown toolId honestly returns false: never claim a delivery for a tool this layer
// can't identify.
function toolDelivers(toolId) {
  if (!toolId) return false;
  const internal = getInternalFunction(toolId);
  if (internal) return !!internal.delivers;
  const platform = findToolGlobal(toolId);
  if (platform) return !!platform.tool.delivers;
  for (const c of CONNECTORS) {
    const t = (c.tools ?? []).find((x) => x.id === toolId);
    if (t) return !!t.delivers;
  }
  return false;
}
function toolIsDraft(toolId) {
  if (!toolId) return false;
  return !!getInternalFunction(toolId)?.draft;
}

// Best-effort human label for WHERE a delivered step reached — read from the step's
// own result first (e.g. homeops.notify_contact reports the real channel it resolved
// to), falling back to a static per-tool hint. Used only for wording; never changes
// what counts as delivered.
const CHANNEL_WORD = { email: "email", sms: "text", in_app: "in-app", dashboard: "in-app" };
const TOOL_CHANNEL_HINT = { "gmail.send": "email", "outlook.send": "email", "sms.send": "text", "slack.postMessage": "Slack", "alexa.announce": "Alexa" };
function channelLabel(step) {
  const ch = step.result?.channel;
  if (ch) return CHANNEL_WORD[ch] ?? String(ch);
  return TOOL_CHANNEL_HINT[step.toolId] ?? null;
}

export function summarizeOutcome(run) {
  const steps = run.steps ?? [];
  const succeeded = steps.filter((s) => SUCCESS_STATUSES.includes(s.status));
  // "Delivered" = a real tool ran, succeeded, AND that tool's own definition says it
  // reaches outside the run. Nothing else — see the flag rationale above.
  const delivered = succeeded.filter((s) => toolDelivers(s.toolId));
  // "Drafted" = a real tool ran, succeeded, produced something a human still has to
  // review and send themselves (send_notification_draft) — distinct from both a real
  // delivery and from ordinary internal record-keeping (create_task, write_memory, …).
  const drafted = succeeded.filter((s) => !toolDelivers(s.toolId) && toolIsDraft(s.toolId));
  const composed = succeeded.filter((s) => !s.toolId);
  const noTool = steps.filter((s) => s.status === "skipped_no_tool");
  const skipped = steps.filter((s) => s.status === "skipped");
  const parked = steps.filter((s) => s.status === "waiting_for_approval");
  const expired = steps.filter((s) => s.status === "expired");
  const failed = steps.filter((s) => s.status === "failed");
  return { steps, succeeded, delivered, drafted, composed, noTool, skipped, parked, expired, failed, anyEffect: delivered.length > 0, anyDraft: drafted.length > 0 };
}

function shortfallLines(o) {
  const lines = [];
  for (const s of o.noTool) lines.push(`• Not sent — "${s.title}" had no delivery tool behind it, so nothing left the house.`);
  for (const s of o.skipped) lines.push(`• Skipped — "${s.title}": ${String(s.detail ?? "not permitted").replace(/^Not permitted:\s*/, "not permitted — ")}`);
  for (const s of o.expired) lines.push(`• Expired — "${s.title}" was waiting on approval and the window closed. Nothing was sent.`);
  for (const s of o.failed) lines.push(`• Failed — "${s.title}": ${String(s.detail ?? "unknown error").slice(0, 160)}`);
  return lines;
}

// Headline for a run that delivered at least one step for real. Names the channel when
// there's exactly one delivered step (the common case) and folds in an honest mention
// of any step that only drafted — a mixed run must never round a draft up to "sent".
function deliveredHeadline(run, o) {
  const n = o.delivered.length;
  const labels = [...new Set(o.delivered.map(channelLabel).filter(Boolean))];
  const where = labels.length === 1 ? ` (${labels[0]})` : labels.length > 1 ? ` (${labels.join(", ")})` : "";
  const draftNote = o.drafted.length ? ` ${o.drafted.length} more step${o.drafted.length === 1 ? "" : "s"} drafted — review before sending.` : "";
  return `Done — "${run.title}" ran and delivered ${n} step${n === 1 ? "" : "s"}${where}.${draftNote}`;
}
// Headline for a run that produced only draft(s) — the exact false-success repro this
// WP fixes: "1 step drafted (review), nothing sent externally", never "delivered".
function draftedHeadline(run, o) {
  const n = o.drafted.length;
  return `I finished "${run.title}" — ${n} step${n === 1 ? "" : "s"} drafted for your review. Nothing was sent externally.`;
}

// Exported for the WP-002 summarizeOutcome truth-table unit test (server/test/
// summarize-outcome.test.mjs) — a pure function over a plain run object, no server
// or tenant context required.
/* ---- K2: a fetched row, ONCE, as structure ----------------------------------
 * Typed verbatim in the 2026-07-25 chat recordings: "still not returned in line, in chat,
 * RESULTS AS CARDS". The restaurant answers came back as prose plus a couple of Yelp links,
 * with nothing comparable side by side.
 *
 * So a row is extracted exactly once, into a plain shape, and BOTH renderers read it: the
 * text path (which still has to work for the web, for notifications, and for any client
 * that only has a string) and the card path (`resultGroups` on the run_result message).
 * One extraction means the two can never disagree about what the run found — the failure
 * mode that produced "Here's the list:" with no list. */
const pick = (o, keys) => {
  for (const k of keys) { const v = o?.[k]; if (v != null && v !== "") return v; }
  return null;
};
const NAME_KEYS = ["title", "name", "summary", "subject", "text", "label"];
const WHEN_KEYS = ["startAt", "start", "dueAt", "date", "at", "when", "time", "scheduledFor"];
const WHERE_KEYS = ["location", "address", "formattedAddress", "venue", "vicinity", "place"];
const DETAIL_KEYS = ["description", "notes", "detail", "snippet", "body", "purpose", "reason"];
const URL_KEYS = ["url", "link", "href", "website", "mapsUrl", "webUrl"];
// The facts the owner asked to compare across rows, with human labels and a fixed order so
// two cards in the same group line up. "busy right now", "estimated wait time", distance and
// drive time are his literal words — when a tool supplies them they show; when it doesn't,
// nothing is invented (see K4 — the data source itself is still missing).
const META_KEYS = [
  ["rating", "Rating"], ["reviewCount", "Reviews"], ["price", "Price"], ["priceLevel", "Price"],
  ["busy", "Busy now"], ["waitTime", "Wait"], ["distance", "Distance"], ["driveTime", "Drive"],
  ["eta", "ETA"], ["openNow", "Open"], ["cuisine", "Cuisine"], ["category", "Category"],
  ["status", "Status"], ["priority", "Priority"], ["dueIn", "Due"],
  ["assigneeName", "For"], ["assignedToName", "For"], ["assignee", "For"], ["owner", "Owner"],
  ["calendarName", "Calendar"], ["calendar", "Calendar"], ["organizer", "Organizer"],
  ["phone", "Phone"], ["attendeeCount", "Attendees"],
];

function metaValue(key, v) {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") {
    if (key === "openNow") return v ? "Open now" : "Closed now";
    return v ? "Yes" : "No";
  }
  if (typeof v === "number") return key === "rating" ? `${v}★` : String(v);
  if (typeof v !== "string") return null;
  return v.slice(0, 40);
}

/** A fetched row reduced to the facts a person can act on. Null when there's no name to
 *  show — a row we can't label is not rendered rather than dumped as JSON. */
export function rowCard(x) {
  if (x == null) return null;
  if (typeof x === "string") { const t = x.trim(); return t ? { title: t.slice(0, 200) } : null; }
  if (typeof x !== "object") return { title: String(x).slice(0, 200) };
  const name = pick(x, NAME_KEYS);
  if (name == null) return null;
  const card = { title: String(name).trim().slice(0, 200) };
  // `when` stays raw so the CLIENT formats it in the device's locale and timezone; the
  // server keeps its own pre-rendered copy for the text path only.
  const when = pick(x, WHEN_KEYS);
  if (when != null) card.when = typeof when === "string" ? when : String(when);
  const where = pick(x, WHERE_KEYS);
  if (where != null && typeof where === "string") card.where = where.slice(0, 160);
  const detail = pick(x, DETAIL_KEYS);
  if (detail != null && typeof detail === "string" && detail.trim() && detail.trim() !== card.title) {
    card.detail = detail.trim().slice(0, 600);
  }
  const url = pick(x, URL_KEYS);
  if (typeof url === "string" && /^https?:\/\//i.test(url)) card.url = url.slice(0, 500);
  if (typeof x.id === "string") card.refId = x.id;
  if (x.allDay === true) card.allDay = true;
  const meta = [];
  const seen = new Set();
  for (const [key, label] of META_KEYS) {
    if (seen.has(label)) continue;          // rating/reviewCount aliases: first hit wins
    const value = metaValue(key, x[key]);
    if (value == null) continue;
    seen.add(label);
    meta.push({ label, value });
    if (meta.length >= 6) break;
  }
  if (meta.length) card.meta = meta;
  return card;
}

function whenText(when) {
  if (!when) return null;
  const d = new Date(when);
  return Number.isNaN(+d) ? String(when)
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** One readable line for a fetched row — enough to recognise it, never a JSON dump. */
function rowLine(x) {
  const c = rowCard(x);
  if (!c) return null;
  const w = c.allDay ? whenText(c.when)?.replace(/,?\s*\d{1,2}:\d{2}\s*[AP]M$/i, "") : whenText(c.when);
  const facts = c.meta?.length ? ` · ${c.meta.map((m) => `${m.label} ${m.value}`).join(" · ")}` : "";
  return `• ${c.title}${w ? ` — ${w}` : ""}${c.where ? ` (${c.where})` : ""}${facts}`;
}

/** The friendly connection a step's tool belongs to ("Google Calendar"), or null for
 *  FamiliOS's own internal functions — nothing to disclose there. A9/A10 asked for this
 *  on every card that runs something: "what was involved". */
function connectorLabelFor(toolId) {
  if (!toolId || toolId.startsWith("homeops.")) return null;
  const platform = findToolGlobal(toolId);
  if (platform?.provider?.name) return platform.provider.name;
  for (const c of CONNECTORS) {
    if ((c.tools ?? []).some((t) => t.id === toolId)) return c.name ?? null;
  }
  const prefix = toolId.split(".")[0];
  return prefix ? prefix.replace(/[_-]+/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()) : null;
}

const ROW_CAP = 12;

/** Every group of rows the run fetched, as structure — the card payload for the chat. */
export function runResultGroups(run) {
  const o = summarizeOutcome(run);
  const groups = [];
  for (const s of o.succeeded) {
    if (!s.toolId) continue;
    const arr = rowsFromResult(s.result);
    if (!arr) continue;
    const rows = arr.slice(0, ROW_CAP).map(rowCard).filter(Boolean);
    if (!rows.length) continue;
    groups.push({
      title: s.title || "Results",
      ...(connectorLabelFor(s.toolId) ? { connector: connectorLabelFor(s.toolId) } : {}),
      toolId: s.toolId,
      rows,
      ...(arr.length > rows.length ? { more: arr.length - rows.length } : {}),
    });
  }
  return groups;
}

/** The first array of row-shaped objects a tool returned, whatever it named it. */
function rowsFromResult(r) {
  if (!r || typeof r !== "object") return null;
  const arr = Array.isArray(r) ? r
    : Object.values(r).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
  return Array.isArray(arr) && arr.length ? arr : null;
}

/**
 * The DATA a run actually fetched, rendered into the reply.
 *
 * Recorded verbatim, three turns running: "you didnt return anything" → "still nothing" →
 * "still nothing", while the assistant kept answering "here's the family task list…". And
 * from another session: "OK, you didn't return anything in the chat thread — did you get
 * the events? I can read here in a list? I need to be able to do that without going back
 * to the Calendar screen."
 *
 * The cause was here: this file only ever surfaced text from REASONING steps
 * (`composed`, i.e. steps with no toolId). A step that actually went and fetched events,
 * tasks or places returns structured ROWS, and those were dropped on the floor — so the
 * family got "Done — finished (1/1 steps)" for a run whose entire purpose was to show
 * them a list. The run worked; the answer just never carried what it found.
 */
function fetchedRowsText(o) {
  const blocks = [];
  for (const s of o.succeeded) {
    if (!s.toolId) continue;                    // reasoning steps are handled separately
    const arr = rowsFromResult(s.result);
    if (!arr) continue;
    const lines = arr.slice(0, ROW_CAP).map(rowLine).filter(Boolean);
    if (!lines.length) continue;
    const more = arr.length > lines.length ? `\n…and ${arr.length - lines.length} more` : "";
    blocks.push(`${s.title ? `${s.title}:\n` : ""}${lines.join("\n")}${more}`);
  }
  return blocks.join("\n\n").trim();
}

/**
 * The outcome message. `includeRows: false` produces the SAME message with the bullet rows
 * left out — for a client that is rendering those rows as cards instead (K2), so the family
 * never reads the same five restaurants twice. Every other reader (the web thread, exports,
 * notifications) takes the full text, which is why the rows can't simply be moved out of it.
 */
export function runOutcomeText(run, { includeRows = true } = {}) {
  const o = summarizeOutcome(run);
  const reasoning = o.composed.filter((s) => s.result?.text).map((s) => s.result.text).join("\n\n").trim();
  const fetched = includeRows ? fetchedRowsText(o) : "";
  // Rows first: when a family asked to SEE something, the list is the answer and the
  // narration is the footnote.
  const combined = [fetched, reasoning].filter(Boolean).join("\n\n");
  const body = combined ? `\n\n${combined.slice(0, 2000)}` : "";
  const shortfalls = shortfallLines(o);
  const caveat = shortfalls.length ? `\n\n${shortfalls.join("\n")}` : "";

  if (run.status === "expired") {
    return `That approval expired — nothing was sent for "${run.title}". Ask me again when you're ready and I'll re-run it.${caveat}`;
  }
  if (run.status === "completed") {
    // The headline must match the strongest thing that actually happened, in order:
    // a real delivery beats a draft, a draft beats a silent shortfall, and only a run
    // with nothing to disclose at all gets the plain "finished (N/N)" wording.
    const head = o.anyEffect
      ? deliveredHeadline(run, o)
      : o.anyDraft
        ? draftedHeadline(run, o)
        : shortfalls.length
          ? `I finished "${run.title}", but nothing was actually sent.`
          : `Done — "${run.title}" finished (${o.succeeded.length}/${o.steps.length} steps).`;
    return `${head}${caveat}${body}`;
  }
  // WP-101 slice 3 (ISS-110): a partially_failed run is one where only OPTIONAL
  // (soft-failed) work fell over — the required work landed. The hard-failure sentence
  // below would be over-negative for it: true that a step failed, but it buries the part
  // that actually worked. Stay honest in both directions — neither "Done" nor "failed".
  if (run.status === "partially_failed") {
    const head = o.anyEffect
      ? deliveredHeadline(run, o)
      : o.anyDraft
        ? draftedHeadline(run, o)
        : `I finished "${run.title}", but part of it didn't work.`;
    return `${head}${caveat}${body}`;
  }
  const bad = o.failed[0];
  return `"${run.title}" failed at step ${bad ? bad.index + 1 : "?"}${bad ? ` (${bad.title})` : ""}: ${run.error ?? "unknown error"}.${caveat}`;
}

/* ---- WP-004 (ISS-008, FEAT-019/005): "Done" always links to the thing ----
 * Every succeeded step that created something with a stable id gets a link on the
 * run_result message, so a task, list item, or artifact a run produced is reachable
 * straight from the chat that started it — not just from Activity/Files & Knowledge
 * after hunting. Derived strictly from each step's OWN recorded result shape
 * (internal-functions.mjs, read-only from here) for the exact tool that ran; never
 * guessed from a title or the run's summary text, and never for a step that didn't
 * succeed. Tasks and list items are the same underlying store resource
 * (homeops.create_list_item writes a Task with type:"list" — see
 * internal-functions.mjs), so both link with kind:"task"; only the label differs.
 * This is additive: the WP-002 artifactId/link fields on the message are untouched. */
const TASK_LINK_LABEL = { "homeops.create_task": "View task", "homeops.create_list_item": "View list item" };
const ARTIFACT_LINK_LABEL = { "homeops.send_notification_draft": "Review draft", "homeops.create_artifact": "View artifact" };
export function buildResultLinks(run) {
  const links = [];
  for (const s of run.steps ?? []) {
    if (!SUCCESS_STATUSES.includes(s.status)) continue;
    // A declared action returns the whole record ({ task }); the older tools a flat id.
    const id = s.result?.id ?? s.result?.task?.id;
    if (!id || typeof id !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(TASK_LINK_LABEL, s.toolId)) {
      links.push({ kind: "task", id, label: TASK_LINK_LABEL[s.toolId] });
    } else if (Object.prototype.hasOwnProperty.call(ARTIFACT_LINK_LABEL, s.toolId)) {
      links.push({ kind: "artifact", id, label: ARTIFACT_LINK_LABEL[s.toolId] });
    }
  }
  return links;
}

function appendToConversation(run, message) {
  const conv = getConversation(run.sourceRef.conversationId);
  if (!conv || conv.householdId !== run.householdId) return false;
  appendConversationMessage(conv.id, { role: "assistant", at: new Date().toISOString(), ...message });
  return true;
}

function traceFor(run) {
  return {
    title: run.title, error: run.error,
    steps: run.steps.map((s) => ({
      index: s.index, toolId: s.toolId, title: s.title, status: s.status,
      detail: String(s.detail ?? "").slice(0, 300), input: s.input,
      resultText: s.result?.text ? String(s.result.text).slice(0, 300) : undefined,
    })),
  };
}


function offerToSaveAgent(run, { repaired } = {}) {
  const plan = { title: run.title, summary: run.summary, steps: run.steps };
  const text = repaired
    ? `The improved plan worked. If the results look right, I can save this as a reusable helper so next time it's one tap.`
    : `That worked. Want me to save "${run.title}" as a reusable helper, so next time it's one tap?`;
  const guidance = repaired
    ? `Verified working ${new Date().toISOString().slice(0, 10)} after an automatic repair. Follow these exact steps.`
    : `Verified working ${new Date().toISOString().slice(0, 10)} from a live run. Follow these exact steps.`;
  appendToConversation(run, {
    kind: "build",
    text,
    build: {
      summary: `Save "${run.title}" as a reusable helper`,
      skill: {
        name: String(plan.title).slice(0, 80),
        description: String(plan.summary || `Verified from a live run.`).slice(0, 400),
        domain: "Family",
        planner_guidance: guidance,
        risk_level: "Low",
        steps: run.steps.map((s, i) => ({ step_id: `s${i + 1}`, name: s.title, tool_id: s.toolId, approval_required: !!s.requiresApproval, input_mapping: {} })),
      },
      agent: { name: String(plan.title).slice(0, 80), purpose: String(plan.summary || plan.title).slice(0, 200), instructions: `Run the "${plan.title}" skill when asked.` },
    },
  });
}

// Only nudge "save as a helper" when the run genuinely DID something reusable: it used at
// least one real tool and had more than one step. Trivial one-shot answers don't get a nag,
// and a run that came from an already-saved skill/agent is skipped (nothing new to save).
function worthSavingAsHelper(run) {
  if (run.sourceRef?.skillId || run.sourceRef?.agentId || run.sourceRef?.savedFrom) return false;
  // WP-003: gate on what SUCCEEDED, not on what was planned. The old check counted
  // planned tool steps, so a run whose only send was a toolless no-op still got the
  // cheerful "That worked — want me to save it?" offer. Offering to immortalize a
  // recipe that just failed to deliver is the false success at its most galling.
  const o = summarizeOutcome(run);
  if (o.noTool.length || o.skipped.length || o.expired.length || o.failed.length) return false;
  const ranRealTool = o.succeeded.filter((s) => s.toolId).length;
  return ranRealTool >= 1 && run.steps.length >= 2;
}

/** Wire the hooks. Called once at boot. */
export function registerAssistantRunHooks() {
  // WP-004 (ISS-004) — a run that PARKS says so in the thread, immediately. Before
  // this, a scheduled 7 AM briefing that stopped at its approval step left the
  // conversation showing "On it —" indefinitely: the run was alive, waiting, and
  // completely invisible. The message names the step, the deadline, and where to act.
  onRunParked((run, { approvalId, expiresAt } = {}) => runWithTenant(run.householdId, async () => {
    if (!run.sourceRef?.conversationId) return;
    const step = run.steps?.[run.cursor];
    const mins = expiresAt ? Math.max(1, Math.round((expiresAt - Date.now()) / 60000)) : null;
    const window = mins ? ` It expires in about ${mins} minute${mins === 1 ? "" : "s"}.` : "";
    appendToConversation(run, {
      kind: "status",
      runId: run.id,
      approvalId: approvalId ?? null,
      text: `Waiting for your approval before "${step?.title ?? run.title}" can run — nothing has been sent yet.${window} Review it in your Inbox to let it through.`,
    });
  }));

  onRunFinished((run) => runWithTenant(run.householdId, async () => {
    if (!run.sourceRef?.conversationId) return;
    // 1. Durable inline result for every conversation-born run.
    // WP-002 slice 4 — when the run produced a draft artifact, carry its id and a real,
    // working link on the message (runOutcomeText already names the review cue in the
    // text itself — see draftedHeadline/deliveredHeadline) so a later WP can render an
    // actual "Review draft" action in the thread instead of sending the family hunting
    // through Activity/Artifacts for what was drafted. Only the first draft is linked;
    // that matches today's plans, which draft at most one notification per run.
    const draftArtifactId = summarizeOutcome(run).drafted[0]?.result?.id ?? null;
    // WP-004 — every created task/list item/artifact across the whole run, not just
    // the first draft (see buildResultLinks above). Additive alongside artifactId/link.
    const links = buildResultLinks(run);
    // K2 — "still not returned in line, in chat, results as cards". The rows ride along as
    // structure so the thread can render them as real, comparable cards; the text still
    // carries the same rows for every other reader (web, notifications, exports).
    const resultGroups = runResultGroups(run);
    appendToConversation(run, {
      kind: "run_result", runId: run.id, status: run.status, text: runOutcomeText(run),
      ...(draftArtifactId ? { artifactId: draftArtifactId, link: `/api/artifacts?runId=${run.id}` } : {}),
      ...(links.length ? { links } : {}),
      ...(resultGroups.length
        // textWithoutRows is the same message minus the bullets the cards now carry — a
        // card-rendering client reads this instead of `text` so nothing is duplicated.
        ? { resultGroups, textWithoutRows: runOutcomeText(run, { includeRows: false }) }
        : {}),
    });
    // 2. Self-healing, once.
    if (run.status === "failed" && !run.sourceRef.isRepair) {
    } else if (run.status === "completed" && run.sourceRef.isRepair) {
      offerToSaveAgent(run, { repaired: true });
    } else if (run.status === "completed" && !run.sourceRef.isRepair && worthSavingAsHelper(run)) {
      // 3. Learn from ordinary success too — not only after a repair. If a plain chat-driven
      //    run genuinely did something reusable, offer to save it as a helper right in the thread.
      offerToSaveAgent(run, { repaired: false });
    } else if (run.status === "failed" && run.sourceRef.isRepair) {
      appendToConversation(run, { kind: "status", text: "The corrected plan failed too — I'm not going to keep guessing. The full traces are in Activity, and I've filed an improvement proposal with what I learned." });
    }
  }));
}
