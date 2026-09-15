/**
 * Sample household seed — "The Harper Family" (local sample data only; no real external events).
 *
 * Builds a complete, internally consistent household so the app feels alive on
 * first launch (opt-in sample data, clearly labelled in onboarding). All dates are anchored
 * to the moment of seeding so it never looks stale.
 *
 * The helpers here are written out in full rather than pulled from a template catalog.
 * A helper IS its instructions, so a sample one has to carry the words a family would
 * actually read — a catalog id standing in for them taught nothing about the concept.
 */
import type {
  AppData,
  Agent,
  ActivityLogEntry,
  ApprovalRequest,
  CalendarEvent,
  ContactMethod,
  FileAsset,
  HelperRun,
  KnowledgeItem,
  Member,
  MemoryEntry,
  MessageThread,
  Message,
  MiniApp,
  Space,
  Task,
} from "@/types";
import { SCHEMA_VERSION } from "@/storage/db";
import { addDays, addHours, atTime, nextWeekday } from "@/lib/dates";

export function buildSeedData(): AppData {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const N = iso(now);
  const ago = (h: number) => iso(addHours(now, -h));

  /* ------------------------------- members ------------------------------- */
  const members: Member[] = [
    { id: "m-alex", displayName: "Alex Harper", role: "Owner", avatarColor: "ink", initials: "AH", relationship: "Parent", spaceIds: [], isCurrentUser: true, email: "alex@harper.example", createdAt: N, updatedAt: N },
    { id: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", avatarColor: "lavender", initials: "MH", relationship: "Parent", spaceIds: [], email: "morgan@harper.example", createdAt: N, updatedAt: N },
    { id: "m-lily", displayName: "Lily Harper", role: "Child View", avatarColor: "coral", initials: "LH", relationship: "Child (age 9)", spaceIds: [], createdAt: N, updatedAt: N },
    { id: "m-noah", displayName: "Noah Harper", role: "Child View", avatarColor: "sky", initials: "NH", relationship: "Child (age 6)", spaceIds: [], createdAt: N, updatedAt: N },
    { id: "m-elaine", displayName: "Elaine Brooks", role: "Guest/Helper", avatarColor: "sage", initials: "EB", relationship: "Grandparent / caregiving contact", spaceIds: [], createdAt: N, updatedAt: N },
    { id: "m-sam", displayName: "Sam Rivera", role: "Guest/Helper", avatarColor: "amber", initials: "SR", relationship: "Babysitter", spaceIds: [], createdAt: N, updatedAt: N },
  ];

  const contactMethods: ContactMethod[] = [
    // CONSENT IS NEVER SEEDED — same rule, same reason as server/seed.mjs (2026-07-30).
    // These are also the records migrateContactMethodsToServer() pushes up on first sync,
    // so shipping them pre-consented here would have re-opened the hole the server fix
    // closed: a demo address that satisfies every fail-closed gate in notify.mjs.
    { id: "ct-alex-email", memberId: "m-alex", label: "Primary email", type: "Email", value: "alex@harper.example", verified: false, optInStatus: "Pending", allowedAgentIds: [] },
    { id: "ct-alex-text", memberId: "m-alex", label: "Mobile (text)", type: "Phone/Text", value: "(555) 010-2244", verified: false, optInStatus: "Pending", allowedAgentIds: [] },
    { id: "ct-morgan-email", memberId: "m-morgan", label: "Primary email", type: "Email", value: "morgan@harper.example", verified: false, optInStatus: "Pending", allowedAgentIds: [] },
    { id: "ct-elaine-text", memberId: "m-elaine", label: "Mobile (prefers text)", type: "Phone/Text", value: "(555) 018-7700", verified: false, optInStatus: "Pending", allowedAgentIds: [] },
    { id: "ct-sam-text", memberId: "m-sam", label: "Mobile", type: "Phone/Text", value: "(555) 044-3311", verified: false, optInStatus: "Pending", allowedAgentIds: [] },
  ];

  /* -------------------------------- spaces ------------------------------- */
  const spaces: Space[] = [
    { id: "sp-personal", name: "Personal", type: "Personal", description: "Alex's private space — solo life admin and reminders.", icon: "User", accent: "ink", memberIds: ["m-alex"], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
    { id: "sp-family", name: "Family", type: "Family", description: "Shared coordination for the whole Harper household.", icon: "Users", accent: "sage", memberIds: ["m-alex", "m-morgan", "m-lily", "m-noah"], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
    { id: "sp-school", name: "School", type: "School", description: "Forms, notices, and schedules for Lily and Noah.", icon: "GraduationCap", accent: "sky", memberIds: ["m-alex", "m-morgan", "m-lily", "m-noah"], agentIds: [], connectionIds: [], sensitive: true, createdAt: N, updatedAt: N },
    { id: "sp-bills", name: "Bills", type: "Bills", description: "Household bills, receipts, and budget.", icon: "Receipt", accent: "amber", memberIds: ["m-alex", "m-morgan"], agentIds: [], connectionIds: [], sensitive: true, createdAt: N, updatedAt: N },
    { id: "sp-medical", name: "Medical", type: "Medical", description: "Appointments, prescriptions, and health records.", icon: "Stethoscope", accent: "coral", memberIds: ["m-alex", "m-morgan"], agentIds: [], connectionIds: [], sensitive: true, createdAt: N, updatedAt: N },
    { id: "sp-travel", name: "Travel", type: "Travel", description: "Trips, itineraries, and reservations.", icon: "Plane", accent: "sky", memberIds: ["m-alex", "m-morgan", "m-lily", "m-noah"], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
    { id: "sp-home", name: "Home Maintenance", type: "Home Maintenance", description: "Repairs, quotes, and seasonal upkeep.", icon: "Wrench", accent: "amber", memberIds: ["m-alex", "m-morgan"], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
    { id: "sp-caregiving", name: "Caregiving", type: "Caregiving", description: "Coordinating care and rides for Elaine.", icon: "HeartHandshake", accent: "lavender", memberIds: ["m-alex", "m-morgan", "m-elaine"], agentIds: [], connectionIds: [], sensitive: true, createdAt: N, updatedAt: N },
    { id: "sp-pets", name: "Pets", type: "Pets", description: "Care routine for the family dog, Biscuit.", icon: "PawPrint", accent: "sage", memberIds: ["m-alex", "m-lily", "m-noah"], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
  ];
  // back-fill member.spaceIds
  for (const s of spaces) for (const mid of s.memberIds) members.find((m) => m.id === mid)?.spaceIds.push(s.id);

  /* Connectors are real backend infrastructure — see server/ and src/connectors. */

  /* ------------------------------- helpers ------------------------------- */
  type HelperSeed = { id: string; name: string; icon: string; status: Agent["status"]; spaceId: string; purpose: string; instructions: string; conns: string[] };
  const helperSeeds: HelperSeed[] = [
    { id: "ag-briefing", name: "Morning Briefing", icon: "Sun", status: "Active", spaceId: "sp-family", conns: ["gcal", "gmail", "weather"],
      purpose: "One short summary of the day, every morning.",
      instructions: "Every morning, look at today's calendar for everyone in the house, any unread school or household email, and anything due today. Write one short summary: who needs to be where, what has to be signed or paid, and what changed since yesterday. If something needs a reply, draft it and ask me before sending." },
    { id: "ag-school", name: "School & Daycare", icon: "GraduationCap", status: "Active", spaceId: "sp-school", conns: ["gmail", "files-local", "gcal"],
      purpose: "Keeps school email, forms and deadlines from slipping.",
      instructions: "Watch for email from the school or daycare. Summarise each one in a sentence, pull out any date, form or payment it asks for, and add those to the calendar or the to-do list. Never reply to the school without asking me first." },
    { id: "ag-bill", name: "Bills & Receipts", icon: "Receipt", status: "Active", spaceId: "sp-bills", conns: ["files-local", "gmail"],
      purpose: "Files receipts and tells me what is due.",
      instructions: "When a receipt or bill arrives by email or upload, file it, note the vendor, amount and due date, and add a reminder a few days before it is due. Tell me about anything unusual — a charge that looks like a duplicate, or an amount well above the usual. Never pay anything." },
    { id: "ag-meal", name: "Meals & Groceries", icon: "UtensilsCrossed", status: "Active", spaceId: "sp-family", conns: ["sms"],
      purpose: "Turns the week's meals into one grocery list.",
      instructions: "Look at this week's meal plan and the household's messages for anything someone said we need. Build one grocery list, grouped by aisle, and note what we already have. Ask me before ordering anything." },
    { id: "ag-medical", name: "Appointments", icon: "Stethoscope", status: "Active", spaceId: "sp-medical", conns: ["gcal", "gmail", "files-local"],
      purpose: "Gets us ready for every appointment.",
      instructions: "Before any medical or dental appointment, check who it is for, what paperwork or insurance card is needed, and whether anything has to be done beforehand. Put a short prep note on the calendar entry and remind me the evening before." },
    { id: "ag-home", name: "Home Maintenance", icon: "Wrench", status: "Active", spaceId: "sp-home", conns: ["gmail", "files-local"],
      purpose: "Tracks repairs, quotes and seasonal jobs.",
      instructions: "Keep track of open repairs and the quotes we have received for each. When a new quote arrives, compare it with the others and say plainly which looks best and why. Remind me about seasonal jobs — filters, gutters, the water heater — a couple of weeks ahead." },
    { id: "ag-caregiving", name: "Caregiving", icon: "HeartHandshake", status: "Active", spaceId: "sp-caregiving", conns: ["gcal", "sms", "files-local"],
      purpose: "Keeps the family in the loop on Grandma Jean.",
      instructions: "Each week, gather what happened with Grandma Jean — appointments, medication changes, visits — and write one short update the family can read. Keep the emergency document packet current. Ask me before sending anything to anyone outside the household." },
    { id: "ag-document", name: "Documents", icon: "FolderOpen", status: "Active", spaceId: "sp-personal", conns: ["files-local", "browser"],
      purpose: "Files what arrives and flags what expires.",
      instructions: "File new documents where they belong, name them so they can be found later, and note any expiry or renewal date — passports, licences, insurance, registrations. Tell me a month before anything expires. Treat anything with an ID number on it as sensitive." },
    { id: "ag-pet", name: "Pet Care", icon: "PawPrint", status: "Paused", spaceId: "sp-pets", conns: ["gcal"],
      purpose: "Vet visits, medication and food reminders.",
      instructions: "Keep the pets' vet visits, vaccinations and medication on the calendar, and remind me when food or medication is running low." },
    { id: "ag-inbox", name: "Inbox Helper", icon: "Inbox", status: "Active", spaceId: "sp-personal", conns: ["gmail"],
      purpose: "Sorts the inbox and surfaces what actually needs me.",
      instructions: "Go through the inbox, label what is household admin, school, or a receipt, and tell me the few things that genuinely need a reply from me. Draft replies where it is obvious, but always ask before sending." },
  ];

  const agents: Agent[] = helperSeeds.map((seed) => ({
    id: seed.id,
    name: seed.name,
    icon: seed.icon,
    purpose: seed.purpose,
    status: seed.status,
    spaceId: seed.spaceId,
    ownerMemberId: "m-alex",
    instructions: seed.instructions,
    connectionIds: seed.conns,
    allowedToolIds: [],
    memoryIds: [],
    knowledgeItemIds: [],
    fileIds: [],
    /* THE PROSE THAT SHIPPED AS A RULE.
     *
     * policy.mjs matches `autoAllow` / `alwaysApprove` against CAPABILITY IDS. Agents
     * created from the old templates were seeded with English sentences instead, so the
     * field a family would point at to explain how their household is protected matched
     * no capability, ever. It read like the strictest rule in the product and did nothing.
     * The lists start empty; what a helper may do on its own is the autonomy dial now. */
    approvalPolicy: { autoAllow: [], alwaysApprove: [] },
    safetyLimits: ["Asks before acting outside the household."],
    createdAt: ago(72),
    updatedAt: ago(2),
  }));
  for (const a of agents) spaces.find((sp) => sp.id === a.spaceId)?.agentIds.push(a.id);
  for (const sp of spaces) { const cids = new Set<string>(); for (const a of agents) if (a.spaceId === sp.id) a.connectionIds.forEach((c) => cids.add(c)); sp.connectionIds = [...cids]; }

  /* -------------------------------- files -------------------------------- */
  const files: FileAsset[] = [
    { id: "f-pictureday", name: "School Picture Day Form.pdf", type: "PDF", sizeBytes: 184320, tags: ["school", "form", "signature"], ownerMemberId: "m-morgan", spaceId: "sp-school", uploadedAt: ago(26), linkedAgentIds: ["ag-school"], summary: "Picture Day order form for Lily. Requires a parent signature and payment selection.", detectedDates: [iso(nextWeekday(now, 5, 9))], detectedTasks: ["Sign Picture Day form", "Choose photo package", "Return form to school"], sensitive: false, searchIndexed: true, folder: "Uploads", createdByAgentId: "ag-school" },
    { id: "f-soccer", name: "Soccer Snack Schedule.pdf", type: "PDF", sizeBytes: 96000, tags: ["soccer", "schedule"], ownerMemberId: "m-alex", spaceId: "sp-family", uploadedAt: ago(40), linkedAgentIds: ["ag-briefing"], summary: "Snack rotation for Noah's soccer team. The Harpers are assigned the week after next.", detectedDates: [iso(addDays(now, 11))], detectedTasks: ["Bring snacks for the team on assigned week"], sensitive: false, searchIndexed: true, folder: "Reference" },
    { id: "f-utility", name: "Utility Bill May.pdf", type: "PDF", sizeBytes: 142000, tags: ["bills", "utility"], ownerMemberId: "m-alex", spaceId: "sp-bills", uploadedAt: ago(50), linkedAgentIds: ["ag-bill"], summary: "Electric & water bill. Amount due $142.30, due the first Monday.", detectedDates: [iso(nextWeekday(now, 1, 9))], detectedTasks: ["Pay utility bill ($142.30)"], sensitive: true, searchIndexed: true, folder: "Uploads", createdByAgentId: "ag-bill" },
    { id: "f-dentist", name: "Pediatric Dentist Intake.pdf", type: "PDF", sizeBytes: 210000, tags: ["medical", "dentist", "intake"], ownerMemberId: "m-morgan", spaceId: "sp-medical", uploadedAt: ago(30), linkedAgentIds: ["ag-medical"], summary: "New-patient intake form for the pediatric dentist. Bring insurance card and a signed consent.", detectedDates: [iso(atTime(addDays(now, 1), 15, 30))], detectedTasks: ["Complete intake form", "Bring insurance card"], sensitive: true, searchIndexed: true, folder: "Uploads" },
    { id: "f-camp", name: "Summer Camp Brochure.pdf", type: "PDF", sizeBytes: 540000, tags: ["camp", "summer", "brochure"], ownerMemberId: "m-alex", spaceId: "sp-family", uploadedAt: ago(60), linkedAgentIds: ["ag-document"], summary: "Summer camp options and pricing. Registration opens soon; spots are limited.", detectedDates: [iso(addDays(now, 9))], detectedTasks: ["Compare camp options", "Watch for registration to open"], sensitive: false, searchIndexed: true, folder: "Reference" },
    { id: "f-grocery", name: "Grocery Receipt Batch.csv", type: "CSV", sizeBytes: 8200, tags: ["receipts", "grocery", "finance"], ownerMemberId: "m-alex", spaceId: "sp-bills", uploadedAt: ago(22), linkedAgentIds: ["ag-bill"], summary: "12 grocery and household receipts for the month. Total $384.22. Three need a category.", detectedDates: [], detectedTasks: ["Review 3 uncategorized receipts"], detectedReceipts: [{ vendor: "Greenfield Market", amount: 84.12, date: iso(addDays(now, -3)), category: "Groceries" }, { vendor: "Corner Pharmacy", amount: 23.4, date: iso(addDays(now, -5)), category: "Health", needsReview: true }, { vendor: "Hardware Depot", amount: 47.9, date: iso(addDays(now, -6)), category: "Home", needsReview: true }], sensitive: false, searchIndexed: true, folder: "Uploads", previewContent: "date,vendor,amount,category\n2026-05-29,Greenfield Market,84.12,Groceries\n2026-05-27,Corner Pharmacy,23.40,\n2026-05-26,Hardware Depot,47.90,\n2026-05-24,Greenfield Market,61.18,Groceries\n2026-05-22,Fuel Stop,38.00,Transport" },
    { id: "f-repair", name: "Home Repair Quote.pdf", type: "PDF", sizeBytes: 320000, tags: ["home", "repair", "quote"], ownerMemberId: "m-alex", spaceId: "sp-home", uploadedAt: ago(28), linkedAgentIds: ["ag-home"], summary: "Quote from Maple Plumbing to replace the water heater: $1,180, valid 30 days.", detectedDates: [iso(addDays(now, 30))], detectedTasks: ["Compare with a second quote", "Schedule the repair"], sensitive: false, searchIndexed: true, folder: "Uploads", createdByAgentId: "ag-home" },
    { id: "f-trip", name: "Trip Confirmation.pdf", type: "PDF", sizeBytes: 130000, tags: ["travel", "reservation"], ownerMemberId: "m-morgan", spaceId: "sp-travel", uploadedAt: ago(70), linkedAgentIds: ["ag-travel"], summary: "Cabin reservation confirmation for the weekend mountain trip. Check-in 4:00 PM.", detectedDates: [iso(addDays(now, 14))], detectedTasks: ["Add check-in time to calendar"], sensitive: false, searchIndexed: true, folder: "Reference" },
    { id: "f-subscription", name: "Subscription Statement.csv", type: "CSV", sizeBytes: 6100, tags: ["finance", "subscriptions"], ownerMemberId: "m-alex", spaceId: "sp-bills", uploadedAt: ago(18), linkedAgentIds: ["ag-bill"], summary: "Card statement lines that look like recurring subscriptions. 6 detected, 2 likely unused.", detectedDates: [], detectedTasks: ["Review 2 unused subscriptions"], sensitive: true, searchIndexed: true, folder: "Uploads", previewContent: "date,merchant,amount\n2026-06-01,StreamFlix,15.99\n2026-06-03,CloudStore 200GB,2.99\n2026-06-05,KidLearn App,9.99\n2026-06-08,FitnessPass,29.99\n2026-06-10,NewsDaily,12.00\n2026-06-12,MusicWave,10.99" },
    { id: "f-emergency", name: "Emergency Contacts.md", type: "MD", sizeBytes: 2400, tags: ["emergency", "contacts", "reference"], ownerMemberId: "m-alex", spaceId: "sp-family", uploadedAt: ago(100), linkedAgentIds: ["ag-caregiving"], summary: "Key emergency contacts, doctors, and the family's safe-word and pickup list.", detectedDates: [], detectedTasks: [], sensitive: true, searchIndexed: true, folder: "Reference", previewContent: "# Emergency Contacts\n\n- Pediatrician: Dr. Patel — (555) 200-1010\n- Dentist: Bright Smiles Pediatric — (555) 200-3030\n- Grandparent (Elaine): (555) 018-7700 (prefers text)\n- Neighbor (spare key): Dana — (555) 011-7788\n- Vet (Biscuit): Westside Animal — (555) 200-9090\n\n## Pickup list\nApproved to pick up Lily & Noah: Alex, Morgan, Elaine, Sam." },
  ];

  /* ------------------------------ knowledge ------------------------------ */
  const knowledge: KnowledgeItem[] = [
    { id: "k-instr", title: "How agents should talk to our family", type: "Custom Instruction", content: "Be warm and concise. Lead with what needs attention. Use first names. Never share children's, medical, or financial details outside the household. Always ask before contacting the school, doctors, or vendors.", fileAssetIds: [], tags: ["voice", "rules"], spaceId: "sp-family", createdBy: "Alex Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: true, createdAt: ago(90), updatedAt: ago(20) },
    { id: "k-fact-soccer", title: "Soccer practice timing", type: "Family Fact", content: "Noah's soccer practice is usually Thursday evening at 5:30 PM at Riverside Park.", fileAssetIds: ["f-soccer"], tags: ["soccer", "schedule"], spaceId: "sp-family", createdBy: "Alex Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: false, createdAt: ago(80), updatedAt: ago(80) },
    { id: "k-pref-grandma", title: "Grandparent prefers text", type: "Preference", content: "Elaine prefers short text-style updates over email. Send caregiving updates as texts.", fileAssetIds: [], tags: ["caregiving", "elaine"], spaceId: "sp-caregiving", createdBy: "Morgan Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: false, createdAt: ago(70), updatedAt: ago(70) },
    { id: "k-contact-ped", title: "Pediatrician — Dr. Patel", type: "Important Contact", content: "Dr. Patel, (555) 200-1010. Lily and Noah's pediatrician. Portal messages require approval.", fileAssetIds: ["f-emergency"], tags: ["medical", "contact"], spaceId: "sp-medical", createdBy: "Morgan Harper", sensitive: true, agentReadable: true, agentEditableRequiresApproval: true, createdAt: ago(70), updatedAt: ago(70) },
    { id: "k-template-recap", title: "Appointment recap template", type: "Template", content: "Summary · Decisions · Action items · Due dates · Open questions. Keep it under 150 words.", fileAssetIds: [], tags: ["template", "recap"], spaceId: "sp-family", createdBy: "Alex Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: false, createdAt: ago(60), updatedAt: ago(60) },
    { id: "k-rule-external", title: "External email rule", type: "Rule", content: "External emails to school, doctors, landlords, or vendors always require parent approval before sending.", fileAssetIds: [], tags: ["approval", "rule"], spaceId: "sp-family", createdBy: "Alex Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: true, createdAt: ago(60), updatedAt: ago(60) },
    { id: "k-rule-medical", title: "Sensitive document rule", type: "Rule", content: "Medical, tax, legal, and identity documents should be marked sensitive and kept within their space.", fileAssetIds: [], tags: ["sensitive", "rule"], spaceId: "sp-family", createdBy: "Alex Harper", sensitive: false, agentReadable: true, agentEditableRequiresApproval: true, createdAt: ago(60), updatedAt: ago(60) },
    { id: "k-saved-bill", title: "When is the utility bill due?", type: "Saved Answer", content: "The utility bill is usually due near the first Monday of the month, around $140.", fileAssetIds: ["f-utility"], tags: ["bills"], spaceId: "sp-bills", createdBy: "Bill & Receipt Agent", sensitive: false, agentReadable: true, agentEditableRequiresApproval: false, createdAt: ago(40), updatedAt: ago(40) },
  ];
  // link knowledge to agents
  agents.find((a) => a.id === "ag-briefing")!.knowledgeItemIds = ["k-instr", "k-fact-soccer"];
  agents.find((a) => a.id === "ag-caregiving")!.knowledgeItemIds = ["k-pref-grandma", "k-contact-ped"];
  agents.find((a) => a.id === "ag-bill")!.knowledgeItemIds = ["k-saved-bill"];
  agents.find((a) => a.id === "ag-school")!.knowledgeItemIds = ["k-rule-external"];

  /* ------------------------------- memories ------------------------------ */
  const memories: MemoryEntry[] = [
    { id: "mem-soccer", agentId: "ag-briefing", spaceId: "sp-family", type: "Routine", title: "Soccer is Thursday evenings", content: "Soccer practice is usually Thursday evening at 5:30 PM.", tags: ["soccer", "schedule"], source: "Observed from calendar", confidence: 0.92, userApproved: true, sensitive: false, createdAt: ago(80), updatedAt: ago(80) },
    { id: "mem-school-sign", agentId: "ag-school", spaceId: "sp-school", type: "Rule", title: "School forms need a signature", content: "School forms usually require a parent signature.", tags: ["school"], source: "Pattern across forms", confidence: 0.88, userApproved: true, sensitive: false, createdAt: ago(70), updatedAt: ago(70) },
    { id: "mem-bill", agentId: "ag-bill", spaceId: "sp-bills", type: "Routine", title: "Utility bill near first Monday", content: "Utility bill is usually due near the first Monday of the month.", tags: ["bills"], source: "Pattern across statements", confidence: 0.85, userApproved: true, sensitive: false, createdAt: ago(60), updatedAt: ago(60) },
    { id: "mem-grandma", agentId: "ag-caregiving", spaceId: "sp-caregiving", type: "Preference", title: "Grandparent prefers text updates", content: "Elaine prefers text-style updates.", tags: ["caregiving"], source: "Told by Morgan", confidence: 1, userApproved: true, sensitive: false, createdAt: ago(70), updatedAt: ago(70) },
    { id: "mem-external", agentId: "ag-school", spaceId: "sp-school", type: "Rule", title: "External school emails need approval", content: "External emails to school require approval.", tags: ["approval"], source: "Set by Alex", confidence: 1, userApproved: true, sensitive: false, createdAt: ago(60), updatedAt: ago(60) },
    { id: "mem-medical-sensitive", agentId: "ag-medical", spaceId: "sp-medical", type: "Rule", title: "Medical documents are sensitive", content: "Medical documents should be marked sensitive.", tags: ["sensitive", "medical"], source: "Set by Morgan", confidence: 1, userApproved: true, sensitive: true, createdAt: ago(55), updatedAt: ago(55) },
    { id: "mem-camp", agentId: "ag-document", spaceId: "sp-family", type: "Insight", title: "Camp registration fills fast", content: "Summer camp spots tend to fill within a day of registration opening — worth monitoring.", tags: ["camp"], source: "Last year", confidence: 0.7, userApproved: false, sensitive: false, createdAt: ago(20), updatedAt: ago(20) },
  ];
  for (const m of memories) agents.find((a) => a.id === m.agentId)?.memoryIds.push(m.id);

  /* ------------------------------- events -------------------------------- */
  const events: CalendarEvent[] = [
    { id: "ev-dentist", title: "Pediatric dentist — Lily", startAt: iso(atTime(addDays(now, 1), 15, 30)), endAt: iso(atTime(addDays(now, 1), 16, 15)), location: "Bright Smiles Pediatric", spaceId: "sp-medical", memberIds: ["m-lily", "m-morgan"], category: "Medical", movable: false, source: "Google Calendar", notes: "Bring insurance card + intake form." },
    { id: "ev-soccer", title: "Soccer practice — Noah", startAt: iso(nextWeekday(now, 4, 17, 30)), endAt: iso(nextWeekday(now, 4, 19, 0)), location: "Riverside Park", spaceId: "sp-family", memberIds: ["m-noah", "m-alex"], category: "Activity", movable: false, source: "Google Calendar" },
    { id: "ev-ptc", title: "Parent-teacher conference", startAt: iso(nextWeekday(now, 5, 10, 0)), endAt: iso(nextWeekday(now, 5, 10, 30)), location: "Lincoln Elementary", spaceId: "sp-school", memberIds: ["m-morgan"], category: "School", movable: true, source: "Google Calendar" },
    { id: "ev-grocery", title: "Grocery pickup", startAt: iso(atTime(now, 11, 30)), endAt: iso(atTime(now, 12, 0)), location: "Greenfield Market", spaceId: "sp-family", memberIds: ["m-alex"], category: "Errand", movable: true, source: "Google Calendar" },
    { id: "ev-dinner", title: "Family dinner plan", startAt: iso(nextWeekday(now, 3, 18, 0)), endAt: iso(nextWeekday(now, 3, 19, 0)), location: "Home", spaceId: "sp-family", memberIds: ["m-alex", "m-morgan", "m-lily", "m-noah"], category: "Family", movable: true, source: "Google Calendar" },
    { id: "ev-ride", title: "Drive Elaine to appointment", startAt: iso(nextWeekday(now, 2, 9, 0)), endAt: iso(nextWeekday(now, 2, 11, 0)), location: "Riverside Clinic", spaceId: "sp-caregiving", memberIds: ["m-morgan", "m-elaine"], category: "Caregiving", movable: true, source: "Google Calendar" },
    { id: "ev-trip", title: "Trip planning deadline", startAt: iso(addDays(now, 14)), spaceId: "sp-travel", memberIds: ["m-alex"], category: "Travel", movable: true, source: "Travel Planner Agent" },
  ];

  /* -------------------------------- tasks -------------------------------- */
  const chore = (id: string, title: string, status: Task["status"], assignee: string): Task => ({ id, title, type: "chore", status, dueAt: iso(atTime(now, 18, 0)), assignedMemberId: assignee, spaceId: "sp-family", priority: "medium", source: "agent", createdByAgentId: "ag-briefing", createdAt: ago(20), updatedAt: ago(2) });
  const tasks: Task[] = [
    chore("tk-dishwasher", "Empty dishwasher", "todo", "m-lily"),
    chore("tk-soccerbag", "Pack soccer bag", "todo", "m-noah"),
    chore("tk-feeddog", "Feed dog", "in-progress", "m-noah"),
    chore("tk-laundry", "Put away laundry", "needs-help", "m-lily"),
    chore("tk-outfit", "Choose school outfit", "done", "m-lily"),
    chore("tk-trash", "Take trash out", "todo", "m-alex"),
    // bills + reminders + errands
    { id: "tk-utility", title: "Pay utility bill", type: "bill", status: "todo", dueAt: iso(nextWeekday(now, 1, 9)), assignedMemberId: "m-alex", spaceId: "sp-bills", priority: "high", amount: 142.3, source: "agent", createdByAgentId: "ag-bill", notes: "Auto-detected from Utility Bill May.pdf", createdAt: ago(50), updatedAt: ago(2) },
    { id: "tk-internet", title: "Internet bill", type: "bill", status: "todo", dueAt: iso(addDays(now, 5)), assignedMemberId: "m-alex", spaceId: "sp-bills", priority: "medium", amount: 79.99, source: "agent", createdByAgentId: "ag-bill", createdAt: ago(40), updatedAt: ago(40) },
    { id: "tk-signform", title: "Sign Picture Day form", type: "reminder", status: "todo", dueAt: iso(nextWeekday(now, 5, 9)), assignedMemberId: "m-morgan", spaceId: "sp-school", priority: "high", source: "agent", createdByAgentId: "ag-school", notes: "From School Picture Day Form.pdf", createdAt: ago(26), updatedAt: ago(26) },
    { id: "tk-prescription", title: "Pick up prescription", type: "errand", status: "todo", dueAt: iso(addDays(now, -1)), assignedMemberId: "m-alex", spaceId: "sp-medical", priority: "high", source: "user", notes: "Overdue", createdAt: ago(48), updatedAt: ago(48) },
    { id: "tk-camp", title: "Compare summer camp options", type: "task", status: "todo", dueAt: iso(addDays(now, 7)), assignedMemberId: "m-alex", spaceId: "sp-family", priority: "medium", source: "agent", createdByAgentId: "ag-document", createdAt: ago(60), updatedAt: ago(60) },
    { id: "tk-quote", title: "Get a 2nd water-heater quote", type: "task", status: "in-progress", dueAt: iso(addDays(now, 4)), assignedMemberId: "m-alex", spaceId: "sp-home", priority: "medium", source: "agent", createdByAgentId: "ag-home", createdAt: ago(28), updatedAt: ago(10) },
  ];

  /* -------------------------------- runs --------------------------------- */
  // Two sample runs only, and both are things a helper genuinely produces: one that
  // finished, and one parked on an approval.
  const runs: HelperRun[] = [];
  runs.push({
    id: "run-briefing", agentId: "ag-briefing", triggerLabel: "Every day at 7:00 AM", status: "Completed",
    startedAt: ago(6), completedAt: ago(6),
    inputSummary: "Calendar, email, school notices, tasks",
    outputSummary: "Did 3 things",
    actionsTaken: ["Read today's calendar", "Checked school email", "Posted the briefing"],
    steps: [
      { label: "Read the calendar", status: "done", detail: "4 events today", timestamp: ago(6) },
      { label: "Checked school email", status: "done", detail: "Picture Day form due Friday", timestamp: ago(6) },
      { label: "Posted the briefing", status: "done", detail: "Dashboard + message thread", timestamp: ago(6) },
    ],
    approvalRequestIds: [], activityEntryIds: [],
  });
  runs.push({
    id: "run-school", agentId: "ag-school", triggerLabel: "Run now", status: "Waiting for Approval",
    startedAt: ago(26),
    inputSummary: "School Picture Day form",
    outputSummary: "Waiting for approval on 1 thing",
    actionsTaken: ["Filed document", "Created reminder", "Drafted reply"],
    steps: [
      { label: "Summarised the form", status: "done", detail: "Needs a signature by Friday", timestamp: ago(26) },
      { label: "Created a reminder", status: "done", detail: "Sign Picture Day form", timestamp: ago(26) },
      { label: "Send reply to school", status: "blocked", detail: "Waiting for your approval", timestamp: ago(26) },
    ],
    approvalRequestIds: ["ap-school-email"], activityEntryIds: [],
  });

  /* ------------------------------ approvals ------------------------------ */
  const approvals: ApprovalRequest[] = [
    { id: "ap-school-email", title: "Send school form follow-up email", description: "School & Daycare Agent drafted a reply to confirm the Picture Day form.", riskLevel: "High", requestedByAgentId: "ag-school", spaceId: "sp-school", proposedAction: "Send email to school office (outside the household)", dataUsedSummary: "School Picture Day Form.pdf, family contact details", recipientSummary: "office@lincoln-elementary.example", previewContent: "Hi Lincoln Elementary office,\n\nConfirming Lily Harper's Picture Day package (Package B) and that the form is signed and on its way back with her tomorrow.\n\nThank you,\nMorgan Harper", status: "Pending", relatedRunId: "run-school", relatedThreadId: "th-school", category: "Email", createdAt: ago(26), updatedAt: ago(26) },
    { id: "ap-move-event", title: "Move grocery pickup to protect a focus block", description: "Suggest moving grocery pickup to open a 10:00 AM–12:00 PM focus block.", riskLevel: "Medium", proposedAction: "Move 'Grocery pickup' from 11:30 AM to 4:30 PM", requestedByAgentId: "ag-briefing", spaceId: "sp-personal", dataUsedSummary: "Google Calendar (today)", recipientSummary: "Calendar change (no external recipient)", previewContent: "Proposed change:\n• Grocery pickup → 4:30 PM\n\nResult: a protected 10:00 AM–12:00 PM focus block.", status: "Pending", category: "Calendar", createdAt: ago(5), updatedAt: ago(5) },
    { id: "ap-cancel-sub", title: "Cancel unused subscription (FitnessPass)", description: "FitnessPass ($29.99/mo) shows no usage in 3 months.", riskLevel: "High", requestedByAgentId: "ag-bill", spaceId: "sp-bills", proposedAction: "Run browser workflow to cancel FitnessPass", dataUsedSummary: "Subscription Statement.csv", recipientSummary: "fitnesspass.example (external site)", previewContent: "Plan: open FitnessPass account → cancel membership → save confirmation. Estimated savings: $359.88/year.", status: "Pending", category: "Subscription", createdAt: ago(8), updatedAt: ago(8) },
    { id: "ap-browser-download", title: "Browser workflow: download pay stub", description: "Records Agent wants to sign in to the employer portal and download documents.", riskLevel: "Sensitive", requestedByAgentId: "ag-document", spaceId: "sp-personal", proposedAction: "Run browser login workflow + download sensitive documents", dataUsedSummary: "Employer portal (you sign in)", recipientSummary: "Local secure folder", previewContent: "We never ask for your password. You'll sign in directly in the secure browser preview, then the agent downloads and files the documents as sensitive.", status: "Pending", relatedRunId: undefined, category: "Browser", createdAt: ago(3), updatedAt: ago(3) },
  ];
  // historical (decided) approvals for activity richness
  approvals.push({ id: "ap-old-recap", title: "Send appointment recap to Elaine", description: "Caregiving recap shared with grandparent.", riskLevel: "High", requestedByAgentId: "ag-caregiving", spaceId: "sp-caregiving", proposedAction: "Text recap to Elaine", dataUsedSummary: "Appointment notes", recipientSummary: "Elaine Brooks (text)", previewContent: "Recap texted to Elaine.", status: "Approved", decisionByMemberId: "m-morgan", decisionAt: ago(28), category: "Message", createdAt: ago(29), updatedAt: ago(28) });
  approvals.push({ id: "ap-old-denied", title: "Auto-archive 'school' label emails", description: "Inbox Helper asked to auto-archive school-labeled emails.", riskLevel: "High", requestedByAgentId: "ag-inbox", spaceId: "sp-personal", proposedAction: "Always-allow archive of school-labeled email", dataUsedSummary: "Inbox labels", recipientSummary: "n/a", previewContent: "Denied — school emails should not be auto-archived.", status: "Denied", decisionByMemberId: "m-alex", decisionAt: ago(45), category: "Email", createdAt: ago(46), updatedAt: ago(45) });

  /* ------------------------------- threads ------------------------------- */
  const threads: MessageThread[] = [
    { id: "th-briefing", title: "Today's Family Briefing", participantIds: ["m-alex", "ag-briefing"], agentIds: ["ag-briefing"], spaceId: "sp-family", status: "open", preview: "Good morning! Here's everything for today…", unread: false, pinned: true, createdAt: ago(6), updatedAt: ago(6) },
    { id: "th-school", title: "School form requires signature", participantIds: ["m-morgan", "ag-school"], agentIds: ["ag-school"], spaceId: "sp-school", status: "open", preview: "Picture Day form needs a signature by Friday.", unread: true, createdAt: ago(26), updatedAt: ago(26) },
    { id: "th-receipt", title: "Three receipts need categories", participantIds: ["m-alex", "ag-bill"], agentIds: ["ag-bill"], spaceId: "sp-bills", status: "open", preview: "I categorized 9 of 12 receipts — 3 need your input.", unread: true, createdAt: ago(22), updatedAt: ago(22) },
    { id: "th-repair", title: "Compare home repair quote", participantIds: ["m-alex", "ag-home"], agentIds: ["ag-home"], spaceId: "sp-home", status: "open", preview: "Maple Plumbing quoted $1,180. Want a 2nd quote?", unread: false, createdAt: ago(28), updatedAt: ago(28) },
    { id: "th-caregiving", title: "Caregiving update for Elaine", participantIds: ["m-morgan", "m-elaine", "ag-caregiving"], agentIds: ["ag-caregiving"], spaceId: "sp-caregiving", status: "open", preview: "Tuesday ride to the clinic is set. Texted Elaine.", unread: false, createdAt: ago(28), updatedAt: ago(28) },
  ];

  const messages: Message[] = [
    { id: "msg-b1", threadId: "th-briefing", senderType: "agent", senderId: "ag-briefing", senderName: "Family Briefing Agent", body: "Good morning! Today: pediatric dentist for Lily at 3:30 PM. 4 chores assigned (1 needs help). Utility bill ($142.30) due Monday. One urgent email from the soccer coach. Recommended: sign the Picture Day form.", channel: "In-App", deliveryStatus: "Delivered", requiresReply: false, createdAt: ago(6) },
    { id: "msg-s1", threadId: "th-school", senderType: "agent", senderId: "ag-school", senderName: "School & Daycare Agent", body: "The Picture Day form for Lily needs a parent signature by Friday. I filed it in the School space and set a reminder. I drafted a reply to the school office — approve it and I'll send it.", channel: "In-App", deliveryStatus: "Delivered", requiresReply: true, approvalRequestId: "ap-school-email", createdAt: ago(26) },
    { id: "msg-r1", threadId: "th-receipt", senderType: "agent", senderId: "ag-bill", senderName: "Bill & Receipt Agent", body: "I processed the May receipt batch: 12 receipts, $384.22 total. I auto-categorized 9. These 3 need your input: Corner Pharmacy ($23.40), Hardware Depot ($47.90), and Fuel Stop ($38.00).", channel: "In-App", deliveryStatus: "Delivered", requiresReply: true, createdAt: ago(22) },
    { id: "msg-rep1", threadId: "th-repair", senderType: "agent", senderId: "ag-home", senderName: "Home Maintenance Agent", body: "Maple Plumbing quoted $1,180 to replace the water heater (valid 30 days). I can help you compare with a second quote and schedule the work once you choose.", channel: "In-App", deliveryStatus: "Delivered", requiresReply: false, createdAt: ago(28) },
    { id: "msg-c1", threadId: "th-caregiving", senderType: "agent", senderId: "ag-caregiving", senderName: "Caregiving Coordinator", body: "Tuesday's ride to Riverside Clinic at 9:00 AM is set with Morgan. I texted Elaine a short reminder (she prefers text). I'll send a recap after the appointment.", channel: "In-App", deliveryStatus: "Delivered", requiresReply: false, createdAt: ago(28) },
  ];

  /* ------------------------------ mini apps ------------------------------ */
  const miniApps: MiniApp[] = [
    {
      id: "app-chore", name: "Family Chore Board", type: "Chore Board", description: "Drag chores across To Do, In Progress, Done, and Needs Help.", spaceId: "sp-family", createdByAgentId: "ag-briefing",
      data: { columns: [{ key: "todo", title: "To Do" }, { key: "in-progress", title: "In Progress" }, { key: "done", title: "Done" }, { key: "needs-help", title: "Needs Help" }], source: "Live family chores (type: chore)" },
      linkedEntityIds: ["tk-dishwasher", "tk-soccerbag", "tk-feeddog", "tk-laundry", "tk-outfit", "tk-trash"], version: 4, status: "active", createdAt: ago(50), updatedAt: ago(2),
    },
    {
      id: "app-trip", name: "Weekend Mountain Trip", type: "Trip Planner", description: "Itinerary, packing, documents, budget, reservations, and to-dos.", spaceId: "sp-travel", createdByAgentId: "ag-travel",
      data: {
        destination: "Pinecrest Cabins", dates: "In two weeks (Fri–Sun)",
        itinerary: [{ day: "Friday", items: ["Drive up after school", "Check in 4:00 PM", "Dinner at the cabin"] }, { day: "Saturday", items: ["Morning hike", "Lake afternoon", "Board games"] }, { day: "Sunday", items: ["Pack up", "Brunch in town", "Drive home"] }],
        packing: [{ id: "p1", text: "Hiking shoes", done: false }, { id: "p2", text: "Kids' jackets", done: true }, { id: "p3", text: "Snacks & water", done: false }, { id: "p4", text: "First-aid kit", done: false }, { id: "p5", text: "Board games", done: true }],
        documents: ["Trip Confirmation.pdf"], reservations: [{ name: "Pinecrest Cabin #4", detail: "Confirmed · check-in 4:00 PM" }],
        budget: [{ label: "Cabin", amount: 420 }, { label: "Gas", amount: 80 }, { label: "Food", amount: 160 }, { label: "Activities", amount: 60 }],
        todos: [{ id: "t1", text: "Confirm pet sitter for Biscuit", done: false }, { id: "t2", text: "Fill the car", done: false }],
      },
      linkedEntityIds: ["f-trip"], version: 3, status: "active", createdAt: ago(70), updatedAt: ago(12),
    },
    {
      id: "app-budget", name: "Household Budget Snapshot", type: "Budget Snapshot", description: "Bills due, recent receipts, subscriptions, and category totals.", spaceId: "sp-bills", createdByAgentId: "ag-bill",
      data: {
        rows: [{ id: "rb1", label: "Greenfield Market", amount: 84.12, date: iso(addDays(now, -3)), source: "Receipt" }, { id: "rb2", label: "Fuel Stop", amount: 38.0, date: iso(addDays(now, -5)), source: "Receipt" }],
        categoryTotals: [{ label: "Groceries", amount: 412 }, { label: "Utilities", amount: 222 }, { label: "Transport", amount: 96 }, { label: "Health", amount: 64 }, { label: "Subscriptions", amount: 82 }],
        alerts: ["Dining is 18% over last month.", "2 subscriptions look unused."],
      },
      linkedEntityIds: ["tk-utility", "tk-internet"], version: 6, status: "active", createdAt: ago(60), updatedAt: ago(6),
    },
    {
      id: "app-subs", name: "Subscription Review", type: "Subscription Tracker", description: "Recurring charges, usage estimates, and cancellation approvals.", spaceId: "sp-bills", createdByAgentId: "ag-bill",
      data: {
        subscriptions: [
          { id: "su1", name: "StreamFlix", monthly: 15.99, lastCharge: iso(addDays(now, -18)), usage: "Used weekly", recommendation: "Keep" },
          { id: "su2", name: "CloudStore 200GB", monthly: 2.99, lastCharge: iso(addDays(now, -16)), usage: "Active", recommendation: "Keep" },
          { id: "su3", name: "KidLearn App", monthly: 9.99, lastCharge: iso(addDays(now, -14)), usage: "Used by Lily", recommendation: "Keep" },
          { id: "su4", name: "FitnessPass", monthly: 29.99, lastCharge: iso(addDays(now, -90)), usage: "No usage in 3 months", recommendation: "Cancel" },
          { id: "su5", name: "NewsDaily", monthly: 12.0, lastCharge: iso(addDays(now, -9)), usage: "Rarely opened", recommendation: "Consider cancelling" },
          { id: "su6", name: "MusicWave", monthly: 10.99, lastCharge: iso(addDays(now, -7)), usage: "Used daily", recommendation: "Keep" },
        ],
      },
      linkedEntityIds: ["f-subscription"], version: 2, status: "active", createdAt: ago(40), updatedAt: ago(8),
    },
  ];

  /* ------------------------------- activity ------------------------------ */
  const A = (h: number, e: Partial<ActivityLogEntry> & { actionType: string; description: string; actorName: string; status: ActivityLogEntry["status"] }): ActivityLogEntry => ({
    id: `act-${h}-${e.actionType}`, timestamp: ago(h), actorType: e.actorType ?? "agent", actorId: e.actorId ?? "system", actorName: e.actorName, actionType: e.actionType, description: e.description, entityType: e.entityType, entityId: e.entityId, spaceId: e.spaceId, status: e.status, metadata: e.metadata,
  });
  const activity: ActivityLogEntry[] = [
    A(3, { actorType: "agent", actorId: "ag-document", actorName: "Document Organizer Agent", actionType: "connector.checked", description: "Browser Automation needs a runtime before sign-in workflows can run", entityType: "connector", entityId: "browser", spaceId: "sp-personal", status: "pending" }),
    A(3, { actorType: "agent", actorId: "ag-document", actorName: "Document Organizer Agent", actionType: "approval.requested", description: "Approval requested: download pay stubs (sensitive)", entityType: "approval", entityId: "ap-browser-download", spaceId: "sp-personal", status: "pending" }),
    A(5, { actorType: "agent", actorId: "ag-briefing", actorName: "Family Briefing Agent", actionType: "approval.requested", description: "Approval requested: move grocery pickup for a focus block", entityType: "approval", entityId: "ap-move-event", spaceId: "sp-personal", status: "pending" }),
    A(6, { actorType: "webhook", actorId: "webhook", actorName: "Webhook Receiver", actionType: "webhook.received", description: "Webhook received: camp registration confirmation → routed to Bill & Receipt Agent", entityType: "connector", entityId: "webhook", spaceId: "sp-bills", status: "success" }),
    A(6, { actorType: "agent", actorId: "ag-briefing", actorName: "Morning Briefing", actionType: "helper.run", description: "Ran on schedule — 7:00 AM", entityType: "agent", entityId: "ag-briefing", spaceId: "sp-family", status: "info" }),
    A(6, { actorType: "agent", actorId: "ag-briefing", actorName: "Morning Briefing", actionType: "helper.run", description: "Wrote the morning briefing", entityType: "agent", entityId: "ag-briefing", spaceId: "sp-family", status: "success" }),
    A(6, { actorType: "agent", actorId: "ag-briefing", actorName: "Family Briefing Agent", actionType: "summary.generated", description: "Posted today's family briefing", entityType: "thread", entityId: "th-briefing", spaceId: "sp-family", status: "success" }),
    A(8, { actorType: "agent", actorId: "ag-bill", actorName: "Bill & Receipt Agent", actionType: "approval.requested", description: "Approval requested: cancel unused subscription (FitnessPass)", entityType: "approval", entityId: "ap-cancel-sub", spaceId: "sp-bills", status: "pending" }),
    A(10, { actorType: "user", actorId: "m-alex", actorName: "Alex Harper", actionType: "miniapp.updated", description: "Updated the Household Budget Snapshot", entityType: "miniApp", entityId: "app-budget", spaceId: "sp-bills", status: "info" }),
    A(20, { actorType: "agent", actorId: "ag-inbox", actorName: "Inbox Helper", actionType: "helper.run", description: "Ran on schedule — Friday inbox pass", entityType: "agent", entityId: "ag-inbox", spaceId: "sp-personal", status: "info" }),
    A(22, { actorType: "agent", actorId: "ag-bill", actorName: "Bill & Receipt Agent", actionType: "file.processed", description: "Processed Grocery Receipt Batch.csv: 12 receipts, $384.22", entityType: "file", entityId: "f-grocery", spaceId: "sp-bills", status: "success" }),
    A(26, { actorType: "agent", actorId: "ag-school", actorName: "School & Daycare Agent", actionType: "approval.requested", description: "Approval requested: send school form follow-up email", entityType: "approval", entityId: "ap-school-email", spaceId: "sp-school", status: "pending" }),
    A(26, { actorType: "agent", actorId: "ag-school", actorName: "School & Daycare Agent", actionType: "file.processed", description: "Filed School Picture Day Form.pdf and created a reminder", entityType: "file", entityId: "f-pictureday", spaceId: "sp-school", status: "success" }),
    A(28, { actorType: "user", actorId: "m-morgan", actorName: "Morgan Harper", actionType: "approval.granted", description: "Approved: send appointment recap to Elaine", entityType: "approval", entityId: "ap-old-recap", spaceId: "sp-caregiving", status: "success" }),
    A(34, { actorType: "agent", actorId: "ag-document", actorName: "Documents", actionType: "helper.run", description: "Couldn't finish — the camp registration page was unavailable", entityType: "agent", entityId: "ag-document", spaceId: "sp-family", status: "error" }),
    A(45, { actorType: "user", actorId: "m-alex", actorName: "Alex Harper", actionType: "approval.denied", description: "Denied: auto-archive school-labeled emails", entityType: "approval", entityId: "ap-old-denied", spaceId: "sp-personal", status: "warning" }),
    A(48, { actorType: "user", actorId: "m-alex", actorName: "Alex Harper", actionType: "connection.added", description: "Connected Local Files", entityType: "connection", entityId: "cn-budget", spaceId: "sp-bills", status: "success" }),
    A(60, { actorType: "agent", actorId: "ag-document", actorName: "Document Organizer Agent", actionType: "memory.created", description: "Memory created: camp registration fills fast", entityType: "memory", entityId: "mem-camp", spaceId: "sp-family", status: "success" }),
    A(70, { actorType: "user", actorId: "m-alex", actorName: "Alex Harper", actionType: "agent.created", description: "Created helper agent “Family Briefing Agent”", entityType: "agent", entityId: "ag-briefing", spaceId: "sp-family", status: "success" }),
  ];

  /* ------------------------------- settings ------------------------------ */
  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    seededAt: N,
    household: { id: "hh-harper", name: "The Harper Family", ownerMemberId: "m-alex", createdAt: ago(120), updatedAt: N },
    members,
    contactMethods,
    spaces,
    agents,
    runs,
    threads,
    messages,
    files,
    knowledge,
    miniApps,
    memories,
    approvals,
    activity,
    events,
    tasks,
    settings: defaultSettings(),
  };

  return data;
}

/** Default app settings (shared by the sample and blank households). */
export function defaultSettings(): AppData["settings"] {
  return {
    theme: "warm",
    notifications: { inApp: true, emailDigest: true, textAlerts: false },
    privacy: { sensitiveMemoryStaysInSpace: true, requireApprovalForExternal: true },
    ai: {
      activeProvider: "local",
      providers: [
        { id: "local", label: "Local rules engine", enabled: true, apiKeyPlaceholder: "", note: "Default. Runs entirely on-device with deterministic logic. No data leaves your browser." },
        { id: "anthropic", label: "Anthropic Claude", enabled: false, apiKeyPlaceholder: "Managed in Settings → AI Providers", note: "Connect a real provider in Settings → AI Providers." },
        { id: "openai", label: "OpenAI", enabled: false, apiKeyPlaceholder: "Managed in Settings → AI Providers", note: "Connect a real provider in Settings → AI Providers." },
        { id: "gemini", label: "Google Gemini", enabled: false, apiKeyPlaceholder: "Managed in Settings → AI Providers", note: "Connect a real provider in Settings → AI Providers." },
      ],
    },
    soloProfessionalMode: false,
  };
}

/**
 * True when this store holds the local SAMPLE household ("The Harper Family") rather
 * than a real one.
 *
 * The sample ships as the store's DEFAULT `data` so the shell can render before
 * onboarding. That is safe on its own, but its records carry no `serverId` — so a
 * server-authoritative hydrate treats every one of them as a never-synced local draft
 * and preserves it forever. Merged into a real household that surfaces as sample
 * events, spaces, helpers, knowledge, memories and messages blended in with the
 * family's own data.
 *
 * Detected by the sample's own member ids (not a flag) so stores seeded before this
 * check existed are recognised too. Two matches is enough — a member may have been
 * renamed or removed while exploring.
 */
const SAMPLE_MEMBER_IDS = ["m-alex", "m-morgan", "m-lily", "m-noah"];
export function isSampleData(d: Pick<AppData, "members">): boolean {
  const ids = new Set((d.members ?? []).map((m) => m.id));
  return SAMPLE_MEMBER_IDS.filter((id) => ids.has(id)).length >= 2;
}

/**
 * A real, empty household for first-run "Create household" onboarding. One owner
 * (the current user) and two starter spaces; everything else starts blank.
 */
export function buildEmptyData(householdName: string, ownerName: string): AppData {
  const N = new Date().toISOString();
  const ownerId = "m-owner";
  const initials = ownerName.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "ME";
  const members: Member[] = [
    { id: ownerId, displayName: ownerName.trim() || "You", role: "Owner", avatarColor: "ink", initials, relationship: "Account owner", spaceIds: ["sp-personal", "sp-family"], isCurrentUser: true, createdAt: N, updatedAt: N },
  ];
  const spaces: Space[] = [
    { id: "sp-personal", name: "Personal", type: "Personal", description: "Your private space.", icon: "User", accent: "ink", memberIds: [ownerId], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
    { id: "sp-family", name: "Family", type: "Family", description: "Shared coordination for your household.", icon: "Users", accent: "sage", memberIds: [ownerId], agentIds: [], connectionIds: [], sensitive: false, createdAt: N, updatedAt: N },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: N,
    household: { id: "hh-local", name: householdName.trim() || "My Household", ownerMemberId: ownerId, createdAt: N, updatedAt: N },
    members,
    contactMethods: [],
    spaces,
    agents: [],
    runs: [],
    threads: [],
    messages: [],
    files: [],
    knowledge: [],
    miniApps: [],
    memories: [],
    approvals: [],
    activity: [],
    events: [],
    tasks: [],
    settings: defaultSettings(),
  };
}
