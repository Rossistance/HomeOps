// WP-107 / ISS-114 — "A helper did something technical."
//
// The Activity feed had a hand-written allowlist of plain-language templates. It covered
// 38 event types. The server writes 160. So ~122 of them — most of what a household
// actually does — fell through to that one generic line, and the log could not be used to
// audit what the system had done on anyone's behalf.
//
// Enumerating the missing 122 by hand is how this drifted in the first place: the
// allowlist was written once and the server kept growing. So the fallback is COMPOSITIONAL
// instead. Audit types are already structured `subject.action` (agent.create,
// skill.promote, contact_method.verify), which is enough to say something true and
// specific about any of them — including types that don't exist yet.
//
// Hand-written entries still win where they carry real nuance (a failed run.step names the
// connector and why). The compositional layer is the floor, not the ceiling.
import type { Route } from "@/types";

/** The audit shape the server actually sends. The client type long under-declared it —
 *  these entity ids have been on the wire all along, which is why nothing deep-linked. */
export interface AuditLike {
  type: string;
  ok?: boolean;
  error?: string;
  connectorId?: string;
  toolId?: string;
  runId?: string;
  /** Helper audits still travel under `agentId` — the server kept the field name when
   *  the seven concepts collapsed into one, and renaming it client-side would just
   *  break the deep link for every row already written. */
  agentId?: string;
  triggerId?: string;
  approvalId?: string;
  eventId?: string;
  taskId?: string;
  fileId?: string;
  memoryId?: string;
  memberId?: string;
  subscriptionId?: string;
}

const CONNECTOR_INFO: Record<string, { label: string; connect: string }> = {
  gmail: { label: "Gmail", connect: "Google" },
  gcal: { label: "your Google Calendar", connect: "Google" },
  calendar: { label: "your calendar", connect: "Google" },
  google: { label: "Google", connect: "Google" },
  sms: { label: "text messaging", connect: "the text messaging connector" },
  bluebubbles: { label: "text messaging", connect: "the iMessage bridge" },
  imessage: { label: "text messaging", connect: "the iMessage bridge" },
  weather: { label: "the weather service", connect: "the weather service" },
  rss: { label: "your feeds", connect: "the feed" },
  http: { label: "an outside service", connect: "that connection" },
  browser: { label: "the browser helper", connect: "the browser helper" },
  web: { label: "the web", connect: "that connection" },
};
export function connectorInfo(connectorId?: string, toolId?: string): { label: string; connect: string } {
  const key = (connectorId || toolId?.split(".")[0] || "").toLowerCase();
  return CONNECTOR_INFO[key] ?? { label: toolId ? toolId.split(".")[0] : "a connected service", connect: "it" };
}
const ACTION_VERBS: Record<string, string> = {
  search: "check", get: "check", list: "check", read: "read from", fetch: "check",
  send: "send something through", create: "add something to", write: "save something to",
  update: "update", delete: "remove something from", post: "send something to",
};
function actionVerb(toolId?: string): string {
  return ACTION_VERBS[toolId?.split(".")[1]?.toLowerCase() ?? ""] ?? "use";
}
function errorLine(error: string | undefined, label: string, connect: string): string {
  const err = error ?? "";
  if (/not_connected|not_configured|not_authorized|connector_/.test(err)) return `but ${connect} isn't connected yet`;
  if (/runtime_unavailable/.test(err)) return `but ${label} wasn't reachable`;
  if (/provider_error/.test(err)) return "but it ran into a hiccup along the way";
  if (/timeout/.test(err)) return "but it took too long to respond";
  return "but it didn't work";
}

/** What the first segment of an audit type refers to, in household words. */
const SUBJECT: Record<string, string> = {
  run: "a task", helper: "a helper", agent: "a helper", trigger: "a schedule",
  approval: "an approval",
  calendar: "the calendar", event: "a calendar event", task: "a to-do", meal: "a meal",
  tasklist: "a list", file: "a file", knowledge: "a knowledge note", memory: "a memory",
  member: "a household member", contact_method: "a contact method", identity: "an account",
  session: "a sign-in", household: "the household", backup: "a backup", admin: "an admin action",
  connector: "a connection", account: "a connected account", oauth: "a connection",
  ai: "the AI settings", miniapp: "a mini app", invite: "an invite", nest: "a nest",
  help: "a help request", notify: "a notification", conversation: "a chat",
  push: "push notifications", job: "a background job", webhook: "an incoming webhook",
  sms: "a text message", billing: "billing", browser: "the browser helper",
  engine: "the runtime", server: "the server", store: "stored data", vault: "the secret vault",
  risk_override: "an approval rule", rate: "rate limiting", profiles: "profiles",
  assistant: "Ask FamiliOS", settings: "a household setting", tool: "a tool",
};

/** What the remainder of the type says happened to it. */
const ACTION: Record<string, string> = {
  create: "was created", created: "was created", claim: "was set up",
  update: "was updated", updated: "was updated", patch: "was edited", rename: "was renamed",
  delete: "was deleted", deleted: "was deleted", archive: "was archived",
  run: "ran", manual_run: "was run by hand", test: "was tested", fire: "fired",
  manual_fire: "was triggered by hand", start: "started", complete: "finished",
  promote: "was published", rollback: "was rolled back", duplicate: "was duplicated",
  revoke: "was disconnected", health: "was checked", config: "was configured",
  decide: "was decided", review: "was reviewed", propose: "was suggested",
  restored: "was restored", failed: "didn't work", login: "happened",
  default_seeded: "was set up for you",
  logout: "ended", generate: "was generated", draft: "was drafted",
  infer: "had its capabilities inferred", deprecate: "was retired", sync: "was synced",
  import: "was imported", subscribe: "was subscribed to", unsubscribe: "was unsubscribed",
  push: "was pushed", received: "arrived", inbound: "arrived", register: "was registered",
  verify: "was verified", email_verified: "was verified", limited: "was rate-limited",
  shutdown: "shut down", recover: "recovered", hidden: "were hidden",
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const humanize = (s: string) => s.replace(/[._]+/g, " ").trim();

/**
 * Plain-language line for ONE audit event. Never returns a line that fails to say what
 * happened: the hand-written cases carry nuance, the compositional layer covers the rest,
 * and even an unrecognised type names its own subject and action rather than hiding
 * behind "something technical".
 */
export function plainLanguageAudit(a: AuditLike): string {
  const { label, connect } = connectorInfo(a.connectorId, a.toolId);
  const ok = a.ok !== false;
  switch (a.type) {
    case "run.step":
      return ok ? `A helper finished a step using ${label}.` : `A helper tried to ${actionVerb(a.toolId)} ${label}, ${errorLine(a.error, label, connect)}.`;
    case "tool.execute":
      return ok ? `A helper used ${label} successfully.` : `A helper tried to use ${label}, ${errorLine(a.error, label, connect)}.`;
    case "run.start": return "A helper started working on a task.";
    case "run.complete": return "A helper finished a task.";
    case "run.failed": return "A task didn't finish — a helper ran into a problem it couldn't work around.";
    case "run.step_failed_soft": return "A step of a task didn't work, but the rest kept going.";
    case "run.step_skipped_no_tool": return "A helper skipped a step because it had no real way to send or deliver it.";
    case "run.step_clamped": return "A helper wasn't allowed to take a step — it's outside what it's permitted to do.";
    case "run.await_approval": return "A helper is waiting for someone to approve an action before continuing.";
    case "run.approval_denied": return "An approval wasn't given in time, so a helper's task stopped.";
    case "run.waiting_for_connector": return `A helper is waiting on ${connect} to be connected before it can continue.`;
    case "run.expired": return "A task expired before anyone could act on it.";
    case "run.stalled": return "A task stopped making progress and was stopped so it wouldn't hang forever.";
    case "run.cancel": return "A task was cancelled.";
    case "run.interrupted": return "A task was interrupted by a restart and is being checked on.";
    case "run.policy_block": return "A helper was blocked from a step its permissions don't allow.";
    case "run.preflight_refused": return "A task was refused before it started — something it needed wasn't set up.";
    case "run.approval_skipped_by_override": return "An approval step was skipped because an Owner cleared that gate for the household.";
    case "run.approval_skipped_by_agent_policy": return "An approval step was skipped because this helper is set to run it without asking.";
    case "helper.run": return ok ? "A helper ran and reported what it did." : "A helper ran into a problem and couldn't finish.";
    case "helper.default_seeded": return "A starter helper was set up for your household.";
    case "run.sweep_failed": return "A background tidy-up couldn't finish for one task — it will be retried.";
    case "client.error": return "The app hit an error on someone's device and reported it here.";
    case "notify.deliver": return ok ? "A notification was delivered." : "A notification could not be delivered.";
    case "notify.blocked_by_kill_switch": return "A message was held back because external actions are paused.";
    case "notify.delivered_inapp": return "A message was shown in the app.";
    case "identity.login": case "session.login": return "Someone signed in.";
    case "session.login.breakglass": return "Someone signed in using the emergency recovery PIN.";
    case "settings.update": return "A household setting was changed.";
    case "profiles.hidden": return "Someone tried to view profiles that are hidden until sign-in.";
    case "oauth.callback": return ok ? "A connection finished linking." : "A connection attempt didn't finish.";
    case "calendar.autopush": case "calendar.googledelete": case "calendar.auto_two_way": return "An event was synced with the calendar.";
    case "backup.created": return "A backup of the household's data was made.";
    case "trigger.fire": return "A helper started on its schedule.";
    case "job.run": return "A background job ran.";
    default: break;
  }

  // Compositional floor. `contact_method.verification_sent` → subject "contact_method",
  // action "verification_sent". Multi-segment actions keep their meaning
  // (session.login.breakglass is handled above; anything similar reads sensibly here).
  const [head, ...rest] = String(a.type ?? "").split(".");
  const subject = SUBJECT[head] ?? (head ? `${humanize(head)}` : "something");
  const actionKey = rest.join(".");
  const action = ACTION[actionKey] ?? ACTION[rest[rest.length - 1] ?? ""] ?? "";
  const line = action ? `${subject} ${action}` : `${subject} — ${humanize(actionKey) || "changed"}`;
  return `${cap(line)}${ok ? "." : " — but it didn't succeed."}`;
}

/**
 * Where an entry should take you. Only params each screen is known to READ are used —
 * a link that lands on the right screen is honest; one that passes a param nothing reads
 * just looks like it worked. Returns null when the event names no navigable entity.
 */
export function routeForAudit(a: AuditLike): Route | null {
  if (a.approvalId) return { screen: "messages", params: { tab: "approvals", approval: a.approvalId } };
  if (a.agentId) return { screen: "helpers", params: { id: a.agentId } };
  if (a.connectorId) return { screen: "connections", params: { id: a.connectorId } };
  if (a.memoryId) return { screen: "activity", params: { tab: "memory" } };
  // Screen-granularity for entities whose screens take no id param (verified, not assumed).
  if (a.eventId || a.subscriptionId) return { screen: "calendar" };
  if (a.fileId) return { screen: "files" };
  if (a.taskId) return { screen: "miniapps" };
  if (a.runId) return { screen: "activity" };
  return null;
}
