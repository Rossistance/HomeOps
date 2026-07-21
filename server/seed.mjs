// FamiliOS AI — idempotent boot seed. Ensures the household has at least one real
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

  /* ============================================================== *
   * USE-CASE BUILD (run-20260720-225249) — 9 ACTIVE backing skills.
   * Each is the runnable half of an active use-case (DEC-001): a real,
   * deterministic Skill whose steps[].tool_id are exact catalog ids. The
   * declarative catalog entries live in src/data (workflow/agent templates);
   * these seeds are what the run engine actually executes and verifies.
   * Idempotent by id. Two delivery-capable use-cases (UC-14, UC-21) own a
   * dedicated permissive agent so homeops.notify_contact can resolve its
   * per-agent allowlist consent (the agent-tool allowlist is left empty =
   * deny-only/permissive; the SEND consent still lives on the contact method).
   * ============================================================== */
  const agentExists = (id) => listAgents().some((a) => a.id === id);
  const baseAgent = (id, name, purpose) => ({
    id, householdId: "local", name, icon: "Bot", purpose,
    instructions: "Run the assigned use-case skill. Always deliver only to verified, allowlisted contact methods; pause for approval on any sign-off step.",
    status: "Active", spaceType: "Family", system: true,
    skillIds: [], allowedToolIds: [], allowedFunctionIds: [], deniedFunctionIds: [],
    approvalPolicy: {}, triggers: [], version: 1, createdAt: Date.now(), updatedAt: nowISO,
  });
  if (!agentExists("agt_morning_status")) {
    putAgent({ ...baseAgent("agt_morning_status", "Morning Status Helper", "Sends the 6:30 AM weather + meal-prep status text to an allowlisted contact method."), skillIds: ["skl_uc14_morning_status_text"] });
  }
  if (!agentExists("agt_meal_planner")) {
    putAgent({ ...baseAgent("agt_meal_planner", "Meal Planner & Sign-Off", "Plans next week's meals, drafts the menu notification, records household sign-off, and dispatches to allowlisted contacts."), skillIds: ["skl_uc21_meal_planner_signoff"] });
  }

  const skillExists = (id) => listSkills().some((s) => s.id === id);
  const baseSkill = (over) => ({
    householdId: "local", domain: "Family", mode: "deterministic", defaultAgentId: null,
    planner_guidance: "", input_schema: [], output_schema: [],
    required_connectors: [], required_tools: [], required_functions: [],
    optional_tools: [], optional_functions: [], approval_policy: {}, risk_level: "Low",
    memory_policy: {}, test_cases: [], version: 1, status: "available", system: true,
    createdAt: Date.now(), updatedAt: nowISO, ...over,
  });
  const seedSkill = (skill) => { if (!skillExists(skill.id)) putSkill(baseSkill(skill)); };

  // UC-17 — Smart Recipe Extractor (Web Search & Reading; all Read; no approval).
  seedSkill({
    id: "skl_uc17_recipe_extractor", name: "Smart Recipe Extractor", type: "web",
    description: "Search the web for a recipe, read the top result, and extract a clean structured recipe (ingredients + steps, ads stripped).",
    required_connectors: ["Web Search & Reading"], required_tools: ["web.search", "web.read", "web.recipe"],
    steps: [
      { step_id: "s1", name: "Search the web", description: "Find candidate recipe pages.", tool_id: "web.search", input_mapping: { query: "quick kid-friendly weeknight dinner recipes" }, approval_required: false },
      { step_id: "s2", name: "Read the top result", description: "Fetch the best result page (URL threads from the search result).", tool_id: "web.read", input_mapping: { url: "" }, approval_required: false },
      { step_id: "s3", name: "Extract the recipe", description: "Isolate ingredients + instructions, strip ads (honest null if no structured recipe).", tool_id: "web.recipe", input_mapping: { url: "" }, approval_required: false },
    ],
  });

  // UC-18 — Digital Memory Scrapbooker (FamiliOS-native; no approval; live-runnable).
  seedSkill({
    id: "skl_uc18_memory_scrapbooker", name: "Digital Memory Scrapbooker", type: "custom",
    description: "Log weekend highlights to the family journal, then compile a formatted keepsake artifact.",
    required_tools: ["homeops.write_memory", "homeops.create_artifact"],
    required_functions: ["homeops.write_memory", "homeops.create_artifact"],
    input_schema: [{ key: "highlights", label: "Weekend highlights", type: "textarea", required: false }],
    memory_policy: { scope: "family" },
    steps: [
      { step_id: "s1", name: "Log the memory", description: "Record the weekend highlights into the family journal.", tool_id: "homeops.write_memory", input_mapping: { scope: "family", type: "Memory", text: "Weekend family outing — highlights and photos logged to the family journal." }, approval_required: false },
      { step_id: "s2", name: "Compile keepsake", description: "Produce a formatted keepsake artifact from the highlights.", tool_id: "homeops.create_artifact", input_mapping: { kind: "keepsake", title: "Weekend Family Scrapbook", body: "A formatted keepsake compiled from this weekend's family highlights and photos." }, approval_required: false },
    ],
  });

  // UC-19 — Event Coordinator & Logistics Assigner (native; eventId threads step 1 → 2/3/4).
  seedSkill({
    id: "skl_uc19_event_coordinator", name: "Event Coordinator & Logistics Assigner", type: "custom",
    description: "Draft a family event, build its prep checklist, assign a driver, and assign what-to-bring — all on one threaded eventId.",
    required_tools: ["homeops.create_event_draft", "homeops.update_event_checklist", "homeops.assign_driver", "homeops.assign_what_to_bring"],
    required_functions: ["homeops.create_event_draft", "homeops.update_event_checklist", "homeops.assign_driver", "homeops.assign_what_to_bring"],
    steps: [
      { step_id: "s1", name: "Draft the event", description: "Create the Family Reunion Picnic event draft.", tool_id: "homeops.create_event_draft", input_mapping: { title: "Family Reunion Picnic", startAt: "2026-08-15T12:00:00", location: "Riverside Park", participantIds: [] }, approval_required: false },
      { step_id: "s2", name: "Build the checklist", description: "Add prep items including 'Pick up ice' (eventId threads from step 1).", tool_id: "homeops.update_event_checklist", input_mapping: { eventId: "", items: ["Pick up ice", "Set up tables", "Bring sunscreen"] }, approval_required: false },
      { step_id: "s3", name: "Assign a driver", description: "Assign the designated driver for logistics.", tool_id: "homeops.assign_driver", input_mapping: { eventId: "", driverId: "m-morgan" }, approval_required: false },
      { step_id: "s4", name: "Assign what-to-bring", description: "Assign who brings the side dishes.", tool_id: "homeops.assign_what_to_bring", input_mapping: { eventId: "", items: [{ item: "Potato salad", memberId: "m-morgan" }, { item: "Watermelon", memberId: "m-alex" }] }, approval_required: false },
    ],
  });

  // UC-20 — Chore Manager & Document Linker (native; doc ref in task.notes — NOT attach_note, which targets events).
  seedSkill({
    id: "skl_uc20_chore_doc_linker", name: "Chore Manager & Document Linker", type: "custom",
    description: "Create a chore task with the home-insurance policy reference in its notes, then add a weekend list item. Uses task.notes for the reference because attach_note_or_file_reference targets events, not tasks.",
    required_tools: ["homeops.create_task", "homeops.create_list_item"],
    required_functions: ["homeops.create_task", "homeops.create_list_item"],
    steps: [
      { step_id: "s1", name: "Create the chore task", description: "Create 'Fix Backyard Fence' with the insurance policy reference in notes.", tool_id: "homeops.create_task", input_mapping: { title: "Fix Backyard Fence", priority: "medium", notes: "Reference: Home insurance policy guide (policy #HO-2026) in Files & Knowledge. Linked via task notes — FamiliOS task attachments are held on the task's notes field." }, approval_required: false },
      { step_id: "s2", name: "Add weekend list item", description: "Append 'Buy wood screws' to the Weekend list.", tool_id: "homeops.create_list_item", input_mapping: { text: "Buy wood screws", listName: "Weekend" }, approval_required: false },
    ],
  });

  // UC-22 — Internal System Sync (native core; gmail.search is the optional live-enrichment step, contract-only).
  seedSkill({
    id: "skl_uc22_internal_system_sync", name: "Internal System Sync", type: "custom",
    description: "Parse a family-meeting transcript into memory, then compose a 'today's alerts' digest artifact from recent activity. The digest is COMPOSED from write_memory + create_artifact (no built-in 'inbox digest' tool exists); gmail.search enriches it when Google is connected.",
    required_tools: ["homeops.write_memory", "homeops.create_artifact"],
    required_functions: ["homeops.write_memory", "homeops.create_artifact"],
    optional_tools: ["gmail.search"],
    memory_policy: { scope: "family" },
    steps: [
      { step_id: "s1", name: "Parse transcript to memory", description: "Log the meeting transcript into internal memory.", tool_id: "homeops.write_memory", input_mapping: { scope: "family", type: "Transcript", text: "Family meeting transcript: agreed chore rotation (Dad handles trash Tuesdays); finish summer-camp signups by August; schedule dentist for the kids." }, approval_required: false },
      { step_id: "s2", name: "Compose alerts digest", description: "Build today's alerts digest artifact from recent activity and the transcript.", tool_id: "homeops.create_artifact", input_mapping: { kind: "digest", title: "Today's Alerts Digest", body: "Today's alerts, composed from recent family activity and the meeting transcript: chore rotation agreed; summer-camp signups due by August; dentist to be scheduled. When Google is connected, gmail.search (newer_than:1d) adds live email alerts to this digest." }, approval_required: false },
    ],
  });

  // UC-01 — School Correspondence Organizer (Gmail; label/move is approval-gated). Contract-verified (no live Gmail in harness).
  seedSkill({
    id: "skl_uc01_school_correspondence", name: "School Correspondence Organizer", type: "email",
    description: "Weekday-morning: find school-district mail, read the label set, and move it out of the primary inbox under an approval gate.",
    defaultAgentId: "agt_household", required_connectors: ["Gmail"],
    required_tools: ["gmail.search", "gmail.listLabels", "gmail.modifyLabels"], risk_level: "High",
    steps: [
      { step_id: "s1", name: "Search school mail", description: "Find recent school-district messages.", tool_id: "gmail.search", input_mapping: { query: "from:(school OR district OR pta OR daycare) newer_than:1d", maxResults: "50" }, approval_required: false },
      { step_id: "s2", name: "List labels", description: "Read the current Gmail label set.", tool_id: "gmail.listLabels", input_mapping: {}, approval_required: false },
      { step_id: "s3", name: "Label and move", description: "Add 'School' and remove from INBOX — approval-gated write.", tool_id: "gmail.modifyLabels", input_mapping: { messageIds: "", addLabels: "School", removeLabels: "INBOX" }, approval_required: true },
    ],
    approval_policy: { gates: ["s3"] },
  });

  // UC-12 — Smart Climate Night-Mode (Google Home; setThermostat approval-gated). Contract/device-runtime-unverified.
  seedSkill({
    id: "skl_uc12_climate_nightmode", name: "Smart Climate Night-Mode", type: "smarthome",
    description: "10 PM nightly: verify devices online, then set the living-room thermostat to 68°F (20°C) under an approval gate. Runtime-device-unverified (no physical Nest + HOMEOPS_SDM_PROJECT_ID).",
    required_connectors: ["Google Home"],
    required_tools: ["smarthome.listDevices", "smarthome.setThermostat"], risk_level: "Medium",
    steps: [
      { step_id: "s1", name: "List devices", description: "Confirm connected smart devices are online.", tool_id: "smarthome.listDevices", input_mapping: {}, approval_required: false },
      { step_id: "s2", name: "Set thermostat", description: "Set the living-room thermostat to 20°C (68°F) — approval-gated.", tool_id: "smarthome.setThermostat", input_mapping: { deviceId: "", celsius: "20" }, approval_required: true },
    ],
    approval_policy: { gates: ["s2"] },
  });

  // UC-14 — Morning Status Text (Weather + Text via notify_contact, NOT sms.send; RSS stubbed/optional).
  seedSkill({
    id: "skl_uc14_morning_status_text", name: "Morning Status Text", type: "briefing",
    description: "6:30 AM: fetch current weather (+ optional meal-prep RSS when configured), compose, and text it via the contact-method registry (homeops.notify_contact — NOT sms.send, so an unattended schedule can actually deliver). RSS is stubbed until the RSS/Feed connector is configured.",
    defaultAgentId: "agt_morning_status", required_connectors: ["Weather", "Text Messaging"],
    required_tools: ["weather.current", "homeops.notify_contact"], optional_tools: ["rss.latest"], risk_level: "High",
    input_schema: [{ key: "methodId", label: "Text contact method id", type: "text", required: false }],
    steps: [
      { step_id: "s1", name: "Fetch weather", description: "Get current local conditions (soft-fails gracefully if the Weather connector is offline).", tool_id: "weather.current", input_mapping: {}, approval_required: false },
      { step_id: "s2", name: "Text the status", description: "Deliver the morning status to the allowlisted text method via the registry (never sms.send on the unattended path).", tool_id: "homeops.notify_contact", input_mapping: { methodId: "{{methodId}}", subject: "Morning status", body: "Good morning! Here's your daily status — current local weather and today's meal-prep notes. Have a great day." }, approval_required: false },
    ],
  });

  // UC-21 — Multi-Channel Meal Planner & Sign-Off. Order: plan → draft → SIGN-OFF (gated) → dispatch,
  // so the household sign-off is recorded before any external dispatch (recorded design choice).
  seedSkill({
    id: "skl_uc21_meal_planner_signoff", name: "Multi-Channel Meal Planner & Sign-Off", type: "meal",
    description: "Plan next week's meals (planner + groceries + calendar), draft the menu notification, record household sign-off (approval-gated), then dispatch to allowlisted contact methods.",
    defaultAgentId: "agt_meal_planner",
    required_tools: ["homeops.plan_meal", "homeops.send_notification_draft", "homeops.create_approval", "homeops.notify_contact"],
    required_functions: ["homeops.plan_meal", "homeops.send_notification_draft", "homeops.create_approval", "homeops.notify_contact"],
    risk_level: "High",
    input_schema: [{ key: "methodId", label: "Contact method id for menu dispatch", type: "text", required: false }],
    steps: [
      { step_id: "s1", name: "Plan the meal", description: "Add next week's dinner to the planner (auto-adds groceries + calendar event).", tool_id: "homeops.plan_meal", input_mapping: { title: "Sheet-Pan Chicken Fajitas", date: "2026-07-27", slot: "dinner", ingredients: ["chicken breast", "bell peppers", "onion", "tortillas", "fajita seasoning"], instructions: ["Slice chicken and veggies", "Toss with seasoning", "Roast 25 min at 425F", "Warm tortillas and serve"], servings: 4 }, approval_required: false },
      { step_id: "s2", name: "Draft the menu notification", description: "Draft the menu overview notification for review.", tool_id: "homeops.send_notification_draft", input_mapping: { subject: "Next week's dinner menu", body: "Here's the proposed dinner menu for next week — please review and sign off.", channel: "email" }, approval_required: false },
      { step_id: "s3", name: "Request household sign-off", description: "Record the household sign-off (approval-gated) BEFORE dispatch.", tool_id: "homeops.create_approval", input_mapping: { subject: "Approve next week's menu", detail: "Please sign off on next week's dinner menu before it is dispatched to the family." }, approval_required: true },
      { step_id: "s4", name: "Dispatch the menu", description: "Send the approved menu to an allowlisted contact method (honest transport outcome if none configured).", tool_id: "homeops.notify_contact", input_mapping: { methodId: "{{methodId}}", subject: "Next week's dinner menu", body: "The family dinner menu for next week is approved — here it is for your reference." }, approval_required: false },
    ],
    approval_policy: { gates: ["s3"] },
  });

  // Starter playbooks (Phase 6 + web-catalog parity) — server-owned so every client
  // (web/mobile) reads the same library. Additive-idempotent: runs on EVERY boot and
  // upserts any missing system playbook by id or name, so households seeded before a
  // new starter existed still receive it — without duplicating existing ones or ever
  // touching user-created/edited playbooks.
  const existingPlaybooks = listPlaybooks();
  const havePlaybooks = new Set(existingPlaybooks.map((p) => p.id));
  const havePlaybookNames = new Set(existingPlaybooks.map((p) => String(p.name ?? "").trim().toLowerCase()));
  const seedPlaybook = (p) => {
    if (havePlaybooks.has(p.id) || havePlaybookNames.has(p.name.trim().toLowerCase())) return;
    putPlaybook({ householdId: "local", archived: false, system: true, createdBy: "system", createdAt: nowISO, updatedAt: nowISO, ...p });
  };
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
      "Ask FamiliOS for a week-ahead briefing.",
    ],
    requiredConnections: [],
    outputFormat: "A clean task list, staffed calendar, and a filled meal plan for the week.",
    approvalRules: [],
  });
  // Web-catalog parity — the 14 built-ins from src/data/playbooksCatalog.ts, same
  // names/categories/steps/rules, so web and mobile browse an identical library.
  seedPlaybook({
    id: "pb-daily-family-briefing",
    name: "Daily Family Briefing",
    description: "Pull together each morning's family briefing from the household calendar, inbox, reminders, school notices, and weather so the day starts with one calm overview instead of a scramble.",
    whenToUse: "Run every morning, or any time you need a quick read on what today holds for the whole household before everyone heads out the door.",
    category: "Communication & Coordination",
    steps: [
      "Check today's calendar across personal and shared family spaces and list every appointment, drop-off, pickup, and activity with times.",
      "Scan the inbox and messages for anything urgent from school, caregivers, or providers that needs a reply or action today.",
      "Gather overdue and due-today reminders, chores, and any bills that need paying soon.",
      "Add the local weather and call out anything it changes, like packing rain gear or moving an outdoor plan indoors.",
      "Summarize the highlights into a short briefing: today's schedule, school reminders, bills due, errands, and waiting-on items.",
      "Finish with two or three recommended next actions ranked by what matters most this morning.",
    ],
    requiredConnections: ["Calendar", "Email", "Reminders & Tasks"],
    outputFormat: "A short morning briefing shown as a dashboard card and a message thread, with an optional email or text summary for household members who want it sent.",
    approvalRules: [
      "No approval needed to post the briefing inside the app.",
      "Approval required before sending the briefing to anyone outside the household.",
    ],
  });
  seedPlaybook({
    id: "pb-weekly-family-planning",
    name: "Weekly Family Planning",
    description: "Look ahead at the coming week across schedules, school events, activities, meals, and chores, then surface conflicts and gaps so the household can plan together before the week begins.",
    whenToUse: "Run on a weekend or the evening before the week starts, whenever the family wants to get ahead of the next seven days.",
    category: "Communication & Coordination",
    steps: [
      "Review the next seven days of calendar events for every family member and flag overlaps, double-bookings, and tight transitions.",
      "Pull upcoming school events, deadlines, activity schedules, and any RSVPs or forms due during the week.",
      "Identify which days need coverage for drop-offs, pickups, and caregiving, and note where a driver or sitter is still unassigned.",
      "Draft a simple meal plan for the week and build a starter grocery list from what is missing.",
      "List the recurring chores and one-off tasks for the week and suggest who could own each one.",
      "Assemble everything into a week-at-a-glance plan and highlight the decisions the family still needs to make.",
    ],
    requiredConnections: ["Calendar", "Reminders & Tasks"],
    outputFormat: "A week-at-a-glance plan with a day-by-day schedule, a meal plan, a chore list, and a short section of open decisions, shared as a dashboard card and message thread.",
    approvalRules: [
      "No approval needed to draft and share the plan inside the household.",
      "Approval required before assigning tasks that send reminders to other family members.",
    ],
  });
  seedPlaybook({
    id: "pb-school-email-triage",
    name: "School Email Triage",
    description: "Sort through school and daycare email, summarize what each message is asking for, pull out due dates and forms, and turn anything actionable into reminders so nothing slips past a deadline.",
    whenToUse: "Run whenever school email piles up or on a regular weekday schedule, especially during busy enrollment, permission-slip, and event seasons.",
    category: "School & Activities",
    steps: [
      "Scan the inbox for messages from schools, teachers, daycare, and activity organizers and group them by child and by topic.",
      "Summarize each message in one or two lines so it is clear what is being asked and whether action is needed.",
      "Extract dates, deadlines, event times, and any forms, permission slips, or payments mentioned.",
      "Save attached school PDFs to the right child's school folder and tag them for easy retrieval.",
      "Create reminders for every deadline, scheduled a couple of days early for anything needing a signature or response.",
      "Draft replies for messages that clearly need one and hold them for review before anything is sent.",
    ],
    requiredConnections: ["Email", "Documents & Storage", "Reminders & Tasks"],
    outputFormat: "A triage summary grouped by child, a list of extracted deadlines and forms, filed attachments, and draft replies held for approval.",
    approvalRules: [
      "Approval required before sending any reply to a school, teacher, or provider.",
      "Approval required before archiving or deleting a school message.",
    ],
  });
  seedPlaybook({
    id: "pb-receipt-processing",
    name: "Receipt Processing",
    description: "Turn uploaded or emailed receipts into clean, categorized records by reading the vendor, date, and amount, filing each receipt by month, and rolling the totals into a spending summary.",
    whenToUse: "Run whenever a batch of receipts comes in, or on a regular schedule to keep household spending records current without manual data entry.",
    category: "Finance & Files",
    steps: [
      "Collect new receipts from uploads and email and confirm each one is readable before processing.",
      "Read the vendor, date, and total from each receipt and note the payment method when it is shown.",
      "Assign a spending category to each receipt and flag any that are ambiguous for a quick human review.",
      "File each receipt image or PDF into the correct month-and-category folder so it is easy to find later.",
      "Total the receipts by category and by month and note anything unusual or unexpectedly large.",
      "Produce a spending summary and list the receipts that still need a category confirmed.",
    ],
    requiredConnections: ["Documents & Storage", "Email", "Finance & Bills"],
    outputFormat: "A categorized receipt list with detected vendor, date, and amount, receipts filed by month, and a spending summary highlighting items that need review.",
    approvalRules: [
      "No approval needed to read, categorize, and file receipts.",
      "Approval required before logging into an external order or billing account through a browser workflow.",
    ],
  });
  seedPlaybook({
    id: "pb-monthly-budget-review",
    name: "Monthly Household Budget Review",
    description: "Pull the month's spending together, compare it against the household budget, explain where money went, and surface where the family is over, under, or trending toward a problem.",
    whenToUse: "Run at the end of each month, or before a planning conversation when the household wants a clear picture of where the money actually went.",
    category: "Finance & Files",
    steps: [
      "Gather the month's categorized receipts and any imported transaction files into one combined record.",
      "Group spending by category and compare each category against its budgeted target.",
      "Calculate totals, the variance against budget, and the change from the previous month.",
      "Call out the categories that went over, the ones with room to spare, and any one-off charges that skewed the picture.",
      "Note recurring charges and subscriptions worth a second look, especially anything that looks unused.",
      "Write a plain-English summary with the headline numbers and two or three suggestions for next month.",
    ],
    requiredConnections: ["Finance & Bills", "Documents & Storage"],
    outputFormat: "A monthly budget report with category totals, budget-versus-actual variance, month-over-month change, and a short narrative with suggestions.",
    approvalRules: [
      "No approval needed to generate the review inside the app.",
      "Approval required before sharing the budget report with anyone outside the household.",
    ],
  });
  seedPlaybook({
    id: "pb-trip-planning",
    name: "Trip Planning",
    description: "Pull a trip together in one place by gathering reservations, building a day-by-day itinerary, drafting packing lists for each traveler, and tracking the budget and the documents everyone needs to bring.",
    whenToUse: "Run when planning a family vacation, a visit to relatives, or any multi-day trip that needs reservations, packing, and a shared schedule.",
    category: "Travel",
    steps: [
      "Collect the trip basics: dates, destination, travelers, and the purpose or must-do items.",
      "Pull confirmed reservations for flights, lodging, rentals, and activities from email and uploaded confirmations.",
      "Build a day-by-day itinerary with travel times, check-ins, and planned activities, and flag any gaps or conflicts.",
      "Draft a packing checklist tailored to each traveler, the destination, and the expected weather.",
      "Track the budget against estimated and booked costs and note where the trip is trending over or under.",
      "Assemble a travel-document checklist, such as IDs, boarding passes, and insurance, and set reminders for anything still missing.",
    ],
    requiredConnections: ["Calendar", "Email", "Documents & Storage"],
    outputFormat: "A trip dashboard with a day-by-day itinerary, per-traveler packing lists, a budget tracker, and a travel-document checklist, savable as a mini app.",
    approvalRules: [
      "No approval needed to assemble the plan inside the app.",
      "Approval required before making any booking or sending messages to providers.",
    ],
  });
  seedPlaybook({
    id: "pb-medical-appointment-prep",
    name: "Medical Appointment Prep",
    description: "Get ready for an upcoming medical appointment by pulling the relevant history, listing questions to ask, gathering the documents and forms to bring, and sorting out logistics like timing and transportation.",
    whenToUse: "Run a few days before any doctor, dentist, specialist, or therapy appointment, for yourself, the children, or a family member you help care for.",
    category: "Medical & Caregiving",
    steps: [
      "Confirm the appointment details: who it is for, the provider, the date, the time, and the location.",
      "Review recent notes, past visit summaries, and medication or symptom history relevant to this appointment.",
      "Draft a short list of questions and concerns to raise, drawing on any recent changes worth mentioning.",
      "Gather the documents to bring, such as insurance cards, referrals, intake forms, and prior test results.",
      "Sort out logistics, including travel time, who is driving, and whether a fasting or pre-visit instruction applies.",
      "Assemble a prep summary and set reminders for the appointment and for anything to do beforehand.",
    ],
    requiredConnections: ["Calendar", "Documents & Storage", "Health & Caregiving"],
    outputFormat: "A prep summary with appointment details, relevant history, a question list, a documents-to-bring checklist, and logistics notes, with reminders set.",
    approvalRules: [
      "No approval needed to assemble the prep summary internally.",
      "Approval required before messaging a medical provider or sharing health records with anyone.",
    ],
  });
  seedPlaybook({
    id: "pb-caregiver-update",
    name: "Caregiver Update",
    description: "Keep everyone helping care for a family member on the same page with a clear update covering recent appointments, medication changes, daily notes, and what is coming up next.",
    whenToUse: "Run on a regular cadence or after a notable event, such as a doctor visit or a change in care, when the people helping need a shared update.",
    category: "Medical & Caregiving",
    steps: [
      "Gather notes, appointments, and any changes since the last update for the family member receiving care.",
      "Summarize recent appointments and their outcomes, including any new instructions from providers.",
      "Note medication changes, the current schedule, and anything caregivers should watch for.",
      "Capture daily observations such as mood, appetite, sleep, and mobility in a few plain lines.",
      "List what is coming up next, including upcoming appointments, refills, and tasks that need a hand.",
      "Compose a warm, clear update and confirm the approved recipient list before it goes out.",
    ],
    requiredConnections: ["Health & Caregiving", "Messaging", "Calendar"],
    outputFormat: "A caregiver update with recent appointments, medication notes, daily observations, and upcoming items, shared as a message and an optional family update.",
    approvalRules: [
      "Approval required before sending the update to anyone outside the household.",
      "Approval required before including sensitive health details, and recipients are limited to the approved caregiving circle.",
    ],
  });
  seedPlaybook({
    id: "pb-home-repair-quote-comparison",
    name: "Home Repair Quote Comparison",
    description: "Make sense of competing home-repair quotes by lining up the price, scope, timeline, and warranty side by side so the household can choose a contractor with confidence.",
    whenToUse: "Run when collecting bids for a repair or home project and you want an apples-to-apples comparison before deciding who to hire.",
    category: "Home Maintenance",
    steps: [
      "Collect the quotes from uploads and email and confirm each one is for the same job before comparing.",
      "Pull the key details from each quote: total price, scope of work, materials, timeline, and warranty terms.",
      "Line the quotes up in a side-by-side comparison so differences in scope and price are easy to see.",
      "Flag gaps and red flags, such as missing scope items, vague terms, or an unusually low or high bid.",
      "Note each contractor's licensing, insurance, and any reviews or references that were provided.",
      "Summarize the trade-offs and suggest follow-up questions to ask before making a decision.",
    ],
    requiredConnections: ["Documents & Storage", "Email"],
    outputFormat: "A side-by-side comparison table of price, scope, timeline, and warranty, plus a summary of trade-offs and suggested follow-up questions.",
    approvalRules: [
      "No approval needed to assemble and compare the quotes internally.",
      "Approval required before contacting a contractor or accepting any quote.",
    ],
  });
  seedPlaybook({
    id: "pb-document-renewal-tracking",
    name: "Document Renewal Tracking",
    description: "Keep important documents from expiring by reading their renewal dates, tracking what is coming due, and reminding the household well before any license, passport, or policy lapses.",
    whenToUse: "Run on a regular schedule, or after filing new documents, to stay ahead of renewals for IDs, passports, insurance, registrations, and memberships.",
    category: "Documents",
    steps: [
      "Review the documents in the household records and identify which ones carry an expiration or renewal date.",
      "Extract the expiration date and renewal details from each document and note who it belongs to.",
      "Build a renewal tracker listing each document, its owner, its expiration date, and its status.",
      "Identify what is expiring soon and what has already lapsed, sorted by how urgent each one is.",
      "Set reminders well ahead of each deadline, with extra lead time for anything that takes weeks to process.",
      "Summarize what needs attention now and outline the renewal steps for the most urgent items.",
    ],
    requiredConnections: ["Documents & Storage", "Reminders & Tasks", "Calendar"],
    outputFormat: "A renewal tracker listing each document, owner, expiration date, and status, with reminders set and a summary of what needs attention now.",
    approvalRules: [
      "No approval needed to track renewals and set reminders.",
      "Approval required before submitting any renewal or sharing identity documents externally.",
    ],
  });
  seedPlaybook({
    id: "pb-grocery-list-from-messages",
    name: "Grocery List From Messages",
    description: "Turn the scattered 'can you grab' texts and messages into one organized grocery list, merging duplicates and sorting items by aisle so the next store run is quick and complete.",
    whenToUse: "Run before a grocery trip, or continuously through the week, to gather requests from family messages into a single shared list.",
    category: "Errands & Shopping",
    steps: [
      "Scan recent family messages and texts for grocery requests and items people mentioned running low on.",
      "Pull out each requested item along with any quantity, brand, or size mentioned.",
      "Merge duplicate requests and combine quantities so the same item is not listed twice.",
      "Sort the items into store sections, such as produce, dairy, pantry, and frozen, to make shopping faster.",
      "Flag anything ambiguous, like a brand that needs confirming, and note who asked for each special item.",
      "Produce a clean, shareable grocery list ready to use or sync into the household grocery mini app.",
    ],
    requiredConnections: ["Messaging", "Shopping & Groceries"],
    outputFormat: "A clean grocery list grouped by store section with merged quantities, ready to share or sync into the grocery mini app.",
    approvalRules: [
      "No approval needed to compile and share the list inside the household.",
      "Approval required before placing an order or making a purchase from the list.",
    ],
  });
  seedPlaybook({
    id: "pb-birthday-party-planning",
    name: "Birthday Party Planning",
    description: "Plan a birthday party end to end by setting the date and theme, building the guest list and invitations, tracking RSVPs and a budget, and managing the checklist of food, supplies, and activities.",
    whenToUse: "Run a few weeks ahead of a child's or family member's birthday when there is a party to organize and details to keep straight.",
    category: "Family & Events",
    steps: [
      "Confirm the basics: whose birthday it is, the date and time, the theme, the location, and the guest count.",
      "Build the guest list and draft invitations, then set up a simple way to track RSVPs.",
      "Plan the food, cake, and supplies and turn them into a shopping and to-do checklist.",
      "Outline the activities or entertainment and a rough timeline for the day of the party.",
      "Track the budget across venue, food, decorations, and favors and flag where it is trending over.",
      "Set reminders for the key deadlines, such as sending invites, ordering the cake, and final headcount.",
    ],
    requiredConnections: ["Calendar", "Reminders & Tasks", "Shopping & Groceries"],
    outputFormat: "A party plan with guest list and RSVP tracker, a shopping and to-do checklist, a day-of timeline, and a budget tracker, savable as a mini app.",
    approvalRules: [
      "No approval needed to plan the party inside the app.",
      "Approval required before sending invitations or making purchases and bookings.",
    ],
  });
  seedPlaybook({
    id: "pb-pet-care-routine",
    name: "Pet Care Routine",
    description: "Keep the household's pet care running smoothly with a clear routine for feeding, walks, and medications, plus tracking for vet visits, vaccinations, and supplies that need restocking.",
    whenToUse: "Run to set up or refresh a pet's daily routine, or on a regular cadence to stay ahead of vet appointments, medications, and supply runs.",
    category: "Pets",
    steps: [
      "List the household pets and capture each one's feeding schedule, walk routine, and care needs.",
      "Build a daily and weekly routine covering feeding times, walks, grooming, and play, and note who handles each one.",
      "Track medications and treatments with dosages and timing, and flag refills that are running low.",
      "Record vet appointments and vaccination dates and set reminders for anything due soon.",
      "Monitor supplies like food, litter, and medication and add low items to the household shopping list.",
      "Assemble a pet care summary with the routine, upcoming appointments, and supplies to restock.",
    ],
    requiredConnections: ["Reminders & Tasks", "Calendar", "Health & Caregiving"],
    outputFormat: "A pet care summary with the daily and weekly routine, a medication schedule, upcoming vet and vaccination dates, and a supply restock list.",
    approvalRules: [
      "No approval needed to build and track the routine internally.",
      "Approval required before booking a vet appointment or messaging a provider.",
    ],
  });
  seedPlaybook({
    id: "pb-emergency-document-packet",
    name: "Emergency Document Packet",
    description: "Pull the household's critical documents and contacts into one secure, well-organized packet so the most important information is ready to reach in an emergency.",
    whenToUse: "Run when first assembling an emergency kit, and refresh it periodically or after a major life change such as a move, new policy, or new family member.",
    category: "Documents",
    steps: [
      "Identify the documents an emergency packet should hold, such as IDs, insurance, medical info, and key account details.",
      "Gather the relevant files from the household records and confirm each one is current and readable.",
      "Compile an emergency contact list including family, doctors, and providers, with their roles noted.",
      "Note essential medical details such as allergies, medications, and conditions for each family member.",
      "Organize everything into a clear, secure packet and mark sensitive items so they stay protected.",
      "List what is still missing or out of date and set reminders to fill the gaps and review the packet on a schedule.",
    ],
    requiredConnections: ["Documents & Storage", "Health & Caregiving", "Reminders & Tasks"],
    outputFormat: "A secure, organized emergency packet with critical documents, an emergency contact list, essential medical details, and a checklist of missing items.",
    approvalRules: [
      "Approval required before sharing the packet or any sensitive document with anyone.",
      "Sensitive items are marked and handled with extra protection, and external sharing always requires explicit approval.",
    ],
  });
}
