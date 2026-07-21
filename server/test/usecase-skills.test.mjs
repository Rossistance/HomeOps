// FamiliOS — use-case build verification (run-20260720-225249).
//
// Durable local verification for the 9 ACTIVE use-case backing skills seeded in
// server/seed.mjs. This is the committed realization of WP-013's "reusable run +
// cleanup helper": the harness boots the REAL server against an isolated temp data
// dir (never the real family tenant), auto-seeds, and exercises each skill through
// the true run engine. All named test records are TG-/use-case fixtures inside the
// throwaway tenant, so there is nothing to clean up in the real store.
//
// Honest lanes (blocked/partial are NEVER asserted as pass):
//   LIVE     — run end-to-end, assert the real records created (UC-18/19/20/22 and
//              UC-21's homeops core + recorded sign-off).
//   CONTRACT — assert the seeded skill's step graph, real tool_ids, and approval
//              flags (UC-01/12/14/17 — external connectors/web egress cannot run in
//              a hermetic tenant, so their runtime stays honestly unverified here).
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRun(runId, extra = [], timeoutMs = 25000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(200);
  }
  return run;
}

async function runSkillById(skillId, params = {}, extra = []) {
  const r = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ skillId, params, source: "skill_test" }) });
  const runId = r.data?.run?.id ?? r.data?.runId;
  assert.ok(runId, `run should start for ${skillId}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return await waitForRun(runId, extra);
}

const listOf = (data, ...keys) => { for (const k of keys) if (Array.isArray(data?.[k])) return data[k]; return []; };
const getMemory = async () => listOf((await owner.req("/api/memory")).data, "memory", "items");
const getArtifacts = async () => listOf((await owner.req("/api/artifacts")).data, "artifacts", "items");
const getEvents = async () => listOf((await owner.req("/api/events")).data, "events", "items");
const getTasks = async () => listOf((await owner.req("/api/tasks")).data, "tasks", "items");
const getMeals = async () => listOf((await owner.req("/api/meals")).data, "meals", "items");
const getSkill = async (id) => (await owner.req("/api/skills")).data?.skills?.find((s) => s.id === id);
const toolIds = (skill) => (skill?.steps ?? []).map((s) => s.tool_id ?? s.toolId ?? null);

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner (adult)
});
after(async () => { await stopServer(ctx); });

describe("UC active builds — LIVE (real FamiliOS records)", () => {
  test("UC-18 Digital Memory Scrapbooker — writes a family memory + keepsake artifact", async () => {
    const run = await runSkillById("skl_uc18_memory_scrapbooker");
    assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
    const mem = await getMemory();
    assert.ok(mem.some((m) => /family journal/i.test(String(m.text ?? ""))), "the weekend memory row must exist");
    const arts = await getArtifacts();
    assert.ok(arts.some((a) => a.kind === "keepsake" && /Scrapbook/i.test(String(a.title ?? ""))), "a keepsake artifact must be created");
  });

  test("UC-19 Event Coordinator — one event, 'Pick up ice' on checklist, driver + what-to-bring, all on one threaded eventId", async () => {
    const run = await runSkillById("skl_uc19_event_coordinator");
    assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
    const events = await getEvents();
    const picnics = events.filter((e) => /Family Reunion Picnic/i.test(String(e.title ?? "")));
    assert.equal(picnics.length, 1, "exactly one Family Reunion Picnic event");
    const ev = picnics[0];
    assert.ok((ev.checklist ?? []).some((c) => /Pick up ice/i.test(String(c.text ?? ""))), "checklist must contain 'Pick up ice'");
    assert.equal(ev.driverId, "m-morgan", "driver must be assigned on the SAME event (eventId threaded)");
    assert.ok((ev.whatToBring ?? []).length >= 1, "at least one what-to-bring item on the same event");
    // Prove the threading: every follow-on step succeeded (empty eventId would have
    // returned event_not_found and failed the run).
    assert.ok(run.steps.every((s) => s.status === "succeeded"), "all four steps succeeded — eventId threaded from step 1");
  });

  test("UC-20 Chore + Doc Linker — task carries the doc ref in notes; weekend list item; NO attach misuse", async () => {
    const skill = await getSkill("skl_uc20_chore_doc_linker");
    assert.ok(!toolIds(skill).includes("homeops.attach_note_or_file_reference"), "must NOT use attach_note_or_file_reference (it targets events)");
    const run = await runSkillById("skl_uc20_chore_doc_linker");
    assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
    const tasks = await getTasks();
    const fence = tasks.find((t) => /Fix Backyard Fence/i.test(String(t.title ?? "")));
    assert.ok(fence, "the chore task must exist");
    assert.match(String(fence.notes ?? ""), /insurance|policy/i, "the doc reference must be retrievable from task.notes");
    assert.ok(tasks.some((t) => /Buy wood screws/i.test(String(t.title ?? "")) && /Weekend/i.test(String(t.listName ?? ""))), "the 'Buy wood screws' item must be on the Weekend list");
  });

  test("UC-22 Internal System Sync — transcript memory + composed digest artifact (real tool_ids only)", async () => {
    const skill = await getSkill("skl_uc22_internal_system_sync");
    // Correction guard: every step is a real internal tool_id; no fabricated 'inbox digest' tool.
    for (const tid of toolIds(skill)) assert.ok(tid && String(tid).startsWith("homeops."), `every UC-22 step must be a real homeops tool, got ${tid}`);
    const run = await runSkillById("skl_uc22_internal_system_sync");
    assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
    const mem = await getMemory();
    assert.ok(mem.some((m) => /meeting transcript/i.test(String(m.text ?? ""))), "transcript memory row must exist");
    const arts = await getArtifacts();
    assert.ok(arts.some((a) => a.kind === "digest" && /Alerts Digest/i.test(String(a.title ?? ""))), "a composed digest artifact must be created");
  });
});

describe("UC-21 Meal Planner & Sign-Off — LIVE core + gated sign-off + honest dispatch", () => {
  test("plans meals + groceries + event + draft, records sign-off before dispatch, reports honest transport truth", async () => {
    // A verified, opted-in method allowlisted for the seeded meal-planner agent.
    const mk = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-menu", type: "Email", value: "tg-menu@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: ["agt_meal_planner"] }),
    });
    const method = mk.data?.contactMethod;
    assert.ok(method?.id, `TG- method setup failed: ${JSON.stringify(mk.data)}`);
    assert.deepEqual(method.allowedAgentIds, ["agt_meal_planner"], "agent must be allowlisted for the send-consent gate");

    const run = await runSkillById("skl_uc21_meal_planner_signoff", { methodId: method.id }, ["waiting_for_approval"]);
    assert.equal(run.status, "waiting_for_approval", "must park at the sign-off approval before any dispatch");

    // LIVE core already ran (steps before the gate).
    const meals = await getMeals();
    const meal = meals.find((m) => /Chicken Fajitas/i.test(String(m.title ?? "")));
    assert.ok(meal, "the meal must land in the planner");
    const tasks = await getTasks();
    assert.ok(tasks.some((t) => t.type === "list" && /Groceries/i.test(String(t.listName ?? ""))), "groceries must be added to the shared list");
    const events = await getEvents();
    assert.ok(events.some((e) => e.mealId === meal.id), "a calendar event must be created for the meal");
    const arts1 = await getArtifacts();
    assert.ok(arts1.some((a) => a.kind === "notification-draft"), "a menu notification draft must exist");

    // Approve the sign-off — the parked step carries the real approval id.
    const parked = run.steps.find((s) => s.status === "waiting_for_approval");
    assert.ok(parked?.approvalId, "the sign-off step must carry a real approval id");
    const dec = await owner.req(`/api/approvals/${parked.approvalId}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    assert.ok(dec.status < 400, `approve failed: ${JSON.stringify(dec.data)}`);

    const done = await waitForRun(run.id, [], 25000);
    // Sign-off is recorded as a durable approved-decision artifact, BEFORE dispatch.
    const arts2 = await getArtifacts();
    assert.ok(arts2.some((a) => a.kind === "approved-decision" && /Approve next week's menu/i.test(String(a.title ?? ""))), "the household sign-off must be recorded");
    // Dispatch: all registry consent gates passed; with no mail transport connected in
    // the hermetic tenant the honest outcome is a transport refusal, NOT a false success.
    const dispatch = done.steps.find((s) => s.toolId === "homeops.notify_contact");
    assert.ok(dispatch, "the dispatch step must remain in the durable trace");
    if (dispatch.status !== "succeeded") {
      assert.doesNotMatch(String(dispatch.detail ?? ""), /isn't allowed|not a verified|opted in/i, "all registry consent gates passed — only the transport remained");
    }
  });
});

describe("UC active builds — CONTRACT (step graph + real tool_ids + approval flags)", () => {
  async function catalogHasAll(ids) {
    const r = await owner.req("/api/functions/tool-catalog");
    const blob = JSON.stringify(r.data ?? {});
    for (const id of ids) assert.match(blob, new RegExp(id.replace(/\./g, "\\.")), `tool_id ${id} must exist in the live catalog (never invented)`);
  }

  test("UC-17 Recipe Extractor — web.search → web.read → web.recipe, all Read, no approval", async () => {
    const skill = await getSkill("skl_uc17_recipe_extractor");
    assert.deepEqual(toolIds(skill), ["web.search", "web.read", "web.recipe"]);
    assert.ok((skill.steps ?? []).every((s) => !s.approval_required), "all steps are Read — no approval");
    await catalogHasAll(["web.search", "web.read", "web.recipe"]);
  });

  test("UC-01 School Correspondence — gmail chain with an approval-gated label/move", async () => {
    const skill = await getSkill("skl_uc01_school_correspondence");
    assert.deepEqual(toolIds(skill), ["gmail.search", "gmail.listLabels", "gmail.modifyLabels"]);
    const write = skill.steps.find((s) => (s.tool_id ?? s.toolId) === "gmail.modifyLabels");
    assert.equal(write.approval_required, true, "the label/move write must be approval-gated");
    await catalogHasAll(["gmail.search", "gmail.listLabels", "gmail.modifyLabels"]);
  });

  test("UC-12 Smart Climate Night-Mode — listDevices → setThermostat, approval-gated write", async () => {
    const skill = await getSkill("skl_uc12_climate_nightmode");
    assert.deepEqual(toolIds(skill), ["smarthome.listDevices", "smarthome.setThermostat"]);
    const set = skill.steps.find((s) => (s.tool_id ?? s.toolId) === "smarthome.setThermostat");
    assert.equal(set.approval_required, true, "setThermostat must be approval-gated");
    await catalogHasAll(["smarthome.listDevices", "smarthome.setThermostat"]);
  });

  test("UC-14 Morning Status Text — weather + notify_contact, NEVER sms.send", async () => {
    const skill = await getSkill("skl_uc14_morning_status_text");
    assert.deepEqual(toolIds(skill), ["weather.current", "homeops.notify_contact"]);
    assert.ok(!toolIds(skill).includes("sms.send"), "the unattended path must use notify_contact, never sms.send");
    await catalogHasAll(["weather.current", "homeops.notify_contact"]);
  });
});

describe("Catalog integrity — no active skill cites a fabricated tool_id", () => {
  test("every non-null step tool_id across all 9 active skills resolves in the live catalog", async () => {
    const r = await owner.req("/api/functions/tool-catalog");
    const blob = JSON.stringify(r.data ?? {});
    const ids = [
      "skl_uc01_school_correspondence", "skl_uc12_climate_nightmode", "skl_uc14_morning_status_text",
      "skl_uc17_recipe_extractor", "skl_uc18_memory_scrapbooker", "skl_uc19_event_coordinator",
      "skl_uc20_chore_doc_linker", "skl_uc21_meal_planner_signoff", "skl_uc22_internal_system_sync",
    ];
    for (const sid of ids) {
      const skill = await getSkill(sid);
      assert.ok(skill, `${sid} must be seeded`);
      for (const tid of toolIds(skill)) {
        if (!tid) continue;
        assert.match(blob, new RegExp(String(tid).replace(/\./g, "\\.")), `${sid} cites ${tid}, which must exist in the catalog`);
      }
    }
  });
});
