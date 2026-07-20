// T-105 — WP-001 regression rerun (pattern of audit/evidence/tf008-tf012-repro-transcript.txt)
// Two-account repro against LOCAL :8787 ONLY. Creates disposable TG- records and
// cleans them all up at the end. Never touches production or Google.
const BASE = "http://127.0.0.1:8787";
const ORIGIN = "http://localhost:5173";
const log = (...a) => console.log(...a);

async function call(sess, path, init = {}) {
  const headers = { Origin: ORIGIN, "content-type": "application/json", ...(init.headers || {}) };
  if (sess?.cookie) headers.Cookie = sess.cookie;
  if (sess?.csrf && init.method && init.method !== "GET") headers["x-homeops-csrf"] = sess.csrf;
  const r = await fetch(BASE + "/api" + path, { ...init, headers });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, setCookie: r.headers.get("set-cookie") };
}

async function login(actorId, actorName) {
  const r = await call(null, "/session", { method: "POST", body: JSON.stringify({ actorId, actorName }) });
  const cookie = (r.setCookie || "").split(";")[0];
  const s = { cookie, csrf: r.data?.session?.csrf, actorId };
  log(`== LOGIN ${actorName} -> ${r.status} actor=${r.data?.session?.actorId} role=${r.data?.session?.role}`);
  return s;
}

const owner = await login("m-owner", "Ross");

// disposable helper member
const mk = await call(owner, "/members", { method: "POST", body: JSON.stringify({ displayName: "TG-T105-Helper", role: "Limited Member", relationship: "Grandmother" }) });
const helperId = mk.data?.member?.actorId;
log(`== CREATE member TG-T105-Helper -> ${mk.status} ${helperId}`);
const helper = await login(helperId, "TG-T105-Helper");

// STEP 1: task + ask + accept -> REASSIGNED?
const t1 = await call(owner, "/tasks", { method: "POST", body: JSON.stringify({ title: "TG-T105 clean garage", assignedMemberId: "m-owner" }) });
const taskId = t1.data?.task?.id;
log(`== TASK create -> ${t1.status} ${taskId} assigned=${t1.data?.task?.assignedMemberId}`);
const a1 = await call(owner, "/help-requests", { method: "POST", body: JSON.stringify({ toActorId: helperId, taskId, message: "TG-T105 can you?" }) });
const hr1 = a1.data?.helpRequest?.id;
log(`== ASK -> ${a1.status} ${hr1}`);
const acc = await call(helper, `/help-requests/${hr1}/respond`, { method: "POST", body: JSON.stringify({ response: "accept" }) });
log(`== ACCEPT -> ${acc.status} reassigned=${acc.data?.reassigned} task.assignedMemberId=${acc.data?.task?.assignedMemberId}`);
const tks = await call(helper, "/tasks");
const mine = (tks.data?.tasks || []).find((t) => t.id === taskId);
log(`>>> DISCRIMINATOR: task.assignedMemberId after accept = ${mine?.assignedMemberId} (helper=${helperId})`);
log(`>>> helper's assigned list contains task: ${mine?.assignedMemberId === helperId}`);

// STEP 2: duplicate ask on same (task, recipient) while... (now accepted, so create a fresh pending pair)
const t2 = await call(owner, "/tasks", { method: "POST", body: JSON.stringify({ title: "TG-T105 dedupe probe", assignedMemberId: "m-owner" }) });
const task2 = t2.data?.task?.id;
const b1 = await call(owner, "/help-requests", { method: "POST", body: JSON.stringify({ toActorId: helperId, taskId: task2, message: "TG-T105 first ask" }) });
const b2 = await call(owner, "/help-requests", { method: "POST", body: JSON.stringify({ toActorId: helperId, taskId: task2, message: "TG-T105 second ask" }) });
log(`== DEDUPE: first=${b1.status} second=${b2.status} error=${b2.data?.error} existing=${b2.data?.helpRequest?.id === b1.data?.helpRequest?.id}`);

// STEP 3: offer direction — helper offers on owner's task2, owner accepts -> task2 to helper
// (cancel the pending ask first so the offer is the live record)
await call(owner, `/help-requests/${b1.data?.helpRequest?.id}/cancel`, { method: "POST", body: "{}" });
const off = await call(helper, "/help-requests", { method: "POST", body: JSON.stringify({ toActorId: "m-owner", kind: "offer", taskId: task2, message: "TG-T105 I can help" }) });
const accO = await call(owner, `/help-requests/${off.data?.helpRequest?.id}/respond`, { method: "POST", body: JSON.stringify({ response: "accept" }) });
log(`== OFFER-ACCEPT -> ${accO.status} reassigned=${accO.data?.reassigned} task.assignedMemberId=${accO.data?.task?.assignedMemberId} (offerer=${helperId})`);

// CLEANUP: delete TG-T105 tasks, remaining help-requests are terminal; archive member
for (const id of [taskId, task2]) { const d = await call(owner, `/tasks/${id}`, { method: "DELETE" }); log(`== CLEANUP task ${id} -> ${d.status}`); }
const hrs = await call(owner, "/help-requests");
const residue = (hrs.data?.helpRequests || []).filter((h) => (h.message || "").includes("TG-T105"));
log(`== TG-T105 help-request residue (terminal, purged in T-501 sweep): ${residue.map((h) => h.id + ":" + h.status).join(", ")}`);
const dm = await call(owner, `/members/${helperId}`, { method: "DELETE" });
log(`== CLEANUP member ${helperId} -> ${dm.status}`);

// Resident-data integrity: counts visible to owner (unchanged core surfaces)
const [ev, fl] = await Promise.all([call(owner, "/events"), call(owner, "/files")]);
log(`== INTEGRITY: events=${ev.data?.events?.length} files=${fl.data?.files?.length} tasks=${(await call(owner, "/tasks")).data?.tasks?.length}`);
