// HomeOps AI — idempotent boot seed. Ensures the household has at least one real
// agent and one real, runnable hybrid skill so the canonical runtime has something
// to select and execute out of the box. The seeded skill uses only internal
// functions (+ a gated sign-off step), so it runs end-to-end with no external
// account — demonstrating the full approval→resume→execute→audit→memory loop.
import { listAgents, putAgent, listSkills, putSkill, listFunctions, putFunction, listMembers, putMember, listPlaybooks, putPlaybook, listContactMethods, putContactMethod } from "./store.mjs";

// Canonical household roster — the server-owned source of truth for each actor's
// role. Mirrors the frontend demo family (src/data/seed.ts) so the dev profile
// switcher keeps working, but here the role is authoritative: the session route
// resolves a session's role from this registry, never from the client.
const SEED_MEMBERS = [
  { actorId: "m-alex", displayName: "Alex Harper", role: "Owner", relationship: "Parent" },
  { actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", relationship: "Parent" },
  { actorId: "m-lily", displayName: "Lily Harper", role: "Child View", relationship: "Child (age 9)" },
  { actorId: "m-noah", displayName: "Noah Harper", role: "Child View", relationship: "Child (age 6)" },
  { actorId: "m-elaine", displayName: "Elaine Brooks", role: "Guest/Helper", relationship: "Grandparent / caregiving contact" },
  { actorId: "m-sam", displayName: "Sam Rivera", role: "Guest/Helper", relationship: "Babysitter" },
];

export function seedDefaults() {
  const nowISO = new Date().toISOString();

  // Seed the household roster once (idempotent). Existing members are left as-is so a
  // server-side role change is never clobbered by a reboot.
  const haveMembers = new Set(listMembers().map((m) => m.actorId));
  for (const m of SEED_MEMBERS) {
    if (!haveMembers.has(m.actorId)) putMember({ ...m, householdId: "local" });
  }

  // Contact methods — the server-owned delivery registry. Same ids/state as the
  // frontend demo seed (src/data/seed.ts), so the web client's one-time migration
  // is a no-op for these and mobile sees the same registry. Idempotent by id;
  // household edits (verify, allowlists, deletes of OTHER methods) are never clobbered.
  const haveContacts = new Set(listContactMethods().map((c) => c.id));
  const activeMembers = new Set(listMembers().filter((m) => !m.archived).map((m) => m.actorId));
  for (const c of [
    { id: "ct-alex-email", memberId: "m-alex", label: "Primary email", type: "Email", value: "alex@harper.example", verified: true, optInStatus: "Opted In" },
    { id: "ct-alex-text", memberId: "m-alex", label: "Mobile (text)", type: "Phone/Text", value: "(555) 010-2244", verified: true, optInStatus: "Opted In" },
    { id: "ct-morgan-email", memberId: "m-morgan", label: "Primary email", type: "Email", value: "morgan@harper.example", verified: true, optInStatus: "Opted In" },
    { id: "ct-elaine-text", memberId: "m-elaine", label: "Mobile (prefers text)", type: "Phone/Text", value: "(555) 018-7700", verified: true, optInStatus: "Opted In" },
    { id: "ct-sam-text", memberId: "m-sam", label: "Mobile", type: "Phone/Text", value: "(555) 044-3311", verified: false, optInStatus: "Pending" },
  ]) {
    if (!haveContacts.has(c.id) && activeMembers.has(c.memberId)) {
      putContactMethod({ ...c, householdId: "local", allowedAgentIds: [], createdBy: "system", createdAt: nowISO, updatedAt: nowISO });
    }
  }

  if (!listAgents().some((a) => a.id === "agt_household")) {
    putAgent({
      id: "agt_household",
      householdId: "local",
      name: "Household Assistant",
      icon: "Bot",
      purpose: "General family operations helper.",
      instructions: "Help with daily household coordination. Always pause for approval before sending or sharing anything sensitive.",
      status: "Active",
      spaceType: "Family",
      system: true,
      skillIds: ["skl_morning_brief"],
      allowedToolIds: ["weather.current", "calendar.list", "gmail.search", "homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"],
      allowedFunctionIds: ["homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"],
      deniedFunctionIds: [],
      approvalPolicy: {},
      triggers: [],
      version: 1,
      createdAt: Date.now(),
      updatedAt: nowISO,
    });
  }

  if (!listSkills().some((s) => s.id === "skl_morning_brief")) {
    putSkill({
      id: "skl_morning_brief",
      householdId: "local",
      name: "Morning Family Briefing",
      description: "Note the briefing in memory, draft a briefing artifact, then request household sign-off before sharing.",
      domain: "Family",
      type: "briefing",
      mode: "hybrid",
      defaultAgentId: "agt_household",
      planner_guidance: "Summarize the day for the family — weather, calendar, important emails. Be concise and warm. Always get sign-off before sharing externally.",
      input_schema: [{ key: "recipient", label: "Share with", type: "text", required: false }],
      output_schema: [],
      required_connectors: [],
      required_tools: ["homeops.write_memory", "homeops.create_artifact"],
      required_functions: ["homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"],
      optional_tools: ["weather.current", "calendar.list", "gmail.search"],
      optional_functions: [],
      steps: [
        { step_id: "s1", name: "Remember the briefing context", description: "Record that the briefing was generated.", tool_id: "homeops.write_memory", input_mapping: { scope: "family", type: "Routine", text: "Generated the morning family briefing." }, approval_required: false },
        { step_id: "s2", name: "Draft the briefing", description: "Create the briefing artifact.", tool_id: "homeops.create_artifact", input_mapping: { kind: "briefing", title: "Morning Family Briefing", body: "Here is your day at a glance." }, approval_required: false },
        { step_id: "s3", name: "Request sign-off before sharing", description: "Pause for a human to approve sharing.", tool_id: "homeops.create_approval", input_mapping: { subject: "Share the morning briefing", detail: "Share today's briefing with {{recipient}}." }, approval_required: true },
      ],
      approval_policy: { gates: ["s3"] },
      risk_level: "Medium",
      memory_policy: { scope: "family" },
      test_cases: [],
      version: 1,
      status: "available",
      createdAt: Date.now(),
      updatedAt: nowISO,
    });
  }

  // Example functions (Slice 4): one internal-backed function that can reach
  // "available" via a real test with no external account, and one connector_api
  // function that demonstrates the describe→connect→test→available path (shows
  // needs_connector until the household connects Gmail). Both start as drafts.
  const fnExists = (id) => listFunctions().some((f) => f.id === id);

  if (!fnExists("fn_note_to_memory")) {
    putFunction({
      id: "fn_note_to_memory",
      householdId: "local",
      name: "Note to family memory",
      description: "Write a short note into the household's shared memory. A safe, low-risk function backed by an internal handler — testable with no external account.",
      type: "internal",
      action: "Write",
      risk: "Low",
      approval_required: false,
      input_schema: [
        { key: "text", label: "Note text", type: "textarea", required: true, default: "Tested the note-to-memory function." },
        { key: "scope", label: "Scope", type: "text", required: false, default: "family" },
      ],
      output_schema: [{ key: "id", label: "Memory id", type: "text" }],
      config: { functionId: "homeops.write_memory" },
      status: "draft",
      lastTest: null,
      system: false,
      version: 1,
      createdAt: Date.now(),
      updatedAt: nowISO,
    });
  }

  if (!fnExists("fn_gmail_recent")) {
    putFunction({
      id: "fn_gmail_recent",
      householdId: "local",
      name: "Recent inbox digest",
      description: "Search the connected Gmail account for recent messages. Read-only — wraps the real gmail.search tool. Stays in needs_connector until Gmail is connected.",
      type: "connector_api",
      action: "Read",
      risk: "Sensitive",
      approval_required: false,
      input_schema: [{ key: "query", label: "Search query", type: "text", required: false, default: "newer_than:7d" }],
      output_schema: [{ key: "messages", label: "Messages", type: "json" }],
      config: { toolId: "gmail.search", inputDefaults: { query: "newer_than:7d" } },
      status: "draft",
      lastTest: null,
      system: false,
      version: 1,
      createdAt: Date.now(),
      updatedAt: nowISO,
    });
  }

  // Starter playbooks (Phase 6) — server-owned so every client (web/mobile) reads the
  // same library. Idempotent: seeded once, never clobbering household edits.
  const havePlaybooks = new Set(listPlaybooks().map((p) => p.id));
  const seedPlaybook = (p) => { if (!havePlaybooks.has(p.id)) putPlaybook({ householdId: "local", archived: false, system: true, createdBy: "system", createdAt: nowISO, updatedAt: nowISO, ...p }); };
  seedPlaybook({
    id: "pb_school_form",
    name: "School form turnaround",
    description: "From photo of a form to a signed, returned, calendared obligation.",
    whenToUse: "A school sends home any form with a deadline — permission slips, picture day, fundraisers.",
    category: "School",
    steps: [
      "Photograph the form and upload it to Files & Knowledge.",
      "Extract the deadline and any payment amount.",
      "Create a task assigned to a parent, due 2 days before the deadline.",
      "Add a calendar event for the deadline day.",
      "If payment is required, note the amount on the task.",
      "Pause for sign-off before sending any reply to the school.",
    ],
    requiredConnections: ["Local Files"],
    outputFormat: "A due task + calendar event linked to the uploaded form.",
    approvalRules: ["Any outbound email or payment step pauses for an adult's approval."],
  });
  seedPlaybook({
    id: "pb_weekly_reset",
    name: "Sunday weekly reset",
    description: "Close out last week and stage the next one in 15 minutes.",
    whenToUse: "Every Sunday evening, or after any chaotic week.",
    category: "Routines",
    steps: [
      "Review last week's incomplete tasks — reschedule or drop each one.",
      "Skim the next 7 days of calendar events; confirm drivers and what-to-bring lists.",
      "Plan the week's dinners in Meals and send ingredients to groceries.",
      "Check pending approvals and clear the queue.",
      "Ask HomeOps for a week-ahead briefing.",
    ],
    requiredConnections: [],
    outputFormat: "A clean task list, staffed calendar, and a filled meal plan for the week.",
    approvalRules: [],
  });
}
