// The starter-helper catalog, server-owned.
//
// G6, from the 2026-07-25 walkthrough at [19:18]: "There's only four templates in the mobile
// app — but the web app has a lot more. Those all need to be brought over here, and grouped
// into sections so I can navigate them quickly."
//
// Mobile shipped four hand-written entries that existed nowhere else, while the web read
// thirteen from src/data/agentTemplates.ts. Two catalogs, one of them a stub. This module is
// the server's copy, served at GET /api/agent-templates so a client asks rather than carries
// its own list — the same "living and seeding from the server" rule the rest of the app now
// follows.
//
// A template is deliberately NOT a pre-built agent. It is a well-phrased opening sentence:
// the planner drafts the real helper from `prompt`, against this household's actual
// connections and capabilities, and the family approves what it proposes. That's why there's
// no step graph here — a canned one would be a promise the household's setup might not keep.

/** Section order is the order they appear. Family first: it's what most people came for. */
export const TEMPLATE_SECTIONS = [
  { key: "Family", title: "Everyday family", blurb: "The week, the meals, the people." },
  { key: "School", title: "School & activities", blurb: "Paperwork, due dates, pickups." },
  { key: "Bills", title: "Money", blurb: "Bills, receipts, subscriptions." },
  { key: "Medical", title: "Health", blurb: "Appointments, prep, follow-ups." },
  { key: "Caregiving", title: "Caregiving", blurb: "Coordinating care for someone." },
  { key: "Home Maintenance", title: "Home", blurb: "Upkeep, repairs, seasons." },
  { key: "Pets", title: "Pets", blurb: "Feeding, walks, vet visits." },
  { key: "Travel", title: "Travel", blurb: "Trips end to end." },
  { key: "Personal", title: "Just for you", blurb: "Your inbox, your documents." },
];

export const AGENT_TEMPLATES = [
  {
    id: "tpl_family_briefing", name: "Family Briefing", category: "Family", icon: "sun.max",
    desc: "One morning summary of everything today needs",
    prompt: "Create a Family Briefing helper that pulls together one morning summary of the household's day — today's calendar events, who has to be where, tasks due, and anything waiting on someone — and sends it to the family each morning.",
  },
  {
    id: "tpl_meal_grocery", name: "Meals & Groceries", category: "Family", icon: "fork.knife",
    desc: "Plans the week's dinners and keeps the grocery list current",
    prompt: "Create a Meals & Groceries helper that plans next week's dinners, adds the missing ingredients to our shared grocery list, and puts each meal on the calendar.",
  },
  {
    id: "tpl_meal_signoff", name: "Meal Planner with sign-off", category: "Family", icon: "checkmark.seal",
    desc: "Same, but the menu waits for someone to approve it",
    prompt: "Create a Meal Planner helper that drafts next week's menu with groceries and calendar slots, then waits for a household sign-off before sending the approved menu to the family.",
  },
  {
    id: "tpl_gift_birthday", name: "Gifts & Birthdays", category: "Family", icon: "gift",
    desc: "Remembers the dates and gets ahead of them",
    prompt: "Create a Gifts & Birthdays helper that remembers our family's birthdays and occasions, reminds us a couple of weeks ahead, and suggests gift ideas and party planning steps.",
  },
  {
    id: "tpl_carpool", name: "Carpool Coordinator", category: "Family", icon: "person.2",
    desc: "Reads practice times and sorts out who's driving",
    prompt: "Create a Carpool Coordinator helper that reads practice and activity times from our calendar and drafts pickup confirmations for my approval.",
  },
  {
    id: "tpl_school", name: "School & Daycare", category: "School", icon: "graduationcap",
    desc: "Turns school paperwork into dates you won't miss",
    prompt: "Create a School & Daycare helper that watches for school and daycare paperwork, summarizes what it says, and turns every due date into a reminder.",
  },
  {
    id: "tpl_homework", name: "Homework Helper", category: "School", icon: "book",
    desc: "Tracks assignments and nudges before they're due",
    prompt: "Create a Homework Helper that tracks the kids' assignments and reminds them on school nights before anything is due.",
  },
  {
    id: "tpl_bills", name: "Bills & Receipts", category: "Bills", icon: "tag",
    desc: "What's coming due, and where the money went",
    prompt: "Create a Bills & Receipts helper that tracks bills coming due and turns uploaded receipts into a categorized spending picture.",
  },
  {
    id: "tpl_subscriptions", name: "Subscription Watch", category: "Bills", icon: "arrow.triangle.2.circlepath",
    desc: "Catches renewals before they charge",
    prompt: "Create a Subscription Watch helper that finds our recurring subscriptions and warns us before each one renews, with what it costs and when it last went up.",
  },
  {
    id: "tpl_medical", name: "Medical Appointments", category: "Medical", icon: "heart",
    desc: "Appointments, what to bring, and overdue follow-ups",
    prompt: "Create a Medical Appointments helper that tracks our appointments, preps what we need to bring or ask, and flags follow-ups that are overdue.",
  },
  {
    id: "tpl_caregiving", name: "Caregiving Coordinator", category: "Caregiving", icon: "hand.raised.fingers.spread",
    desc: "Appointments, medications, rides, and updates in one place",
    prompt: "Create a Caregiving Coordinator helper that keeps appointments, medications, rides, and family updates organized for a relative who needs care.",
  },
  {
    id: "tpl_home", name: "Home Maintenance", category: "Home Maintenance", icon: "wrench.adjustable",
    desc: "Seasonal upkeep, repairs, and quote comparisons",
    prompt: "Create a Home Maintenance helper that tracks home upkeep tasks, schedules seasonal maintenance, and helps compare repair quotes.",
  },
  {
    id: "tpl_yard", name: "Plants & Yard", category: "Home Maintenance", icon: "leaf",
    desc: "Watering and yard reminders that follow the weather",
    prompt: "Create a Plants & Yard helper that sends weekly watering and yard reminders, adjusted to the actual weather forecast.",
  },
  {
    id: "tpl_pets", name: "Pet Care", category: "Pets", icon: "pawprint",
    desc: "Feeding, walks, vet visits, supplies",
    prompt: "Create a Pet Care helper that keeps our pets' feeding, walks, vet visits, and supplies on track for the whole household.",
  },
  {
    id: "tpl_travel", name: "Travel Planner", category: "Travel", icon: "airplane",
    desc: "Itinerary, packing, reservations, documents",
    prompt: "Create a Travel Planner helper that spots trips on our calendar and builds the itinerary, packing list, reservations and document checks for each one.",
  },
  {
    id: "tpl_trip_prep", name: "Trip Prep", category: "Travel", icon: "suitcase",
    desc: "Two weeks out: passports, packing, pet-sitting",
    prompt: "Create a Trip Prep helper that, two weeks before any trip on the calendar, checks passport and document expiry, builds a packing list, and reminds us about pet care and mail.",
  },
  {
    id: "tpl_inbox", name: "Inbox Helper", category: "Personal", icon: "tray.full",
    desc: "Triages email into what matters and what to do",
    prompt: "Create an Inbox Helper that triages the family inbox, surfaces what actually matters, and turns the rest into tasks or draft replies for me to review.",
  },
  {
    id: "tpl_documents", name: "Document Organizer", category: "Personal", icon: "folder",
    desc: "Files what arrives, summarizes it, tracks renewals",
    prompt: "Create a Document Organizer helper that files incoming documents into the right place, summarizes what each one says, and tracks anything that has to be renewed.",
  },
];

/** Grouped for a screen that has to be navigable, not a wall of 18 cards. */
export function agentTemplateSections() {
  return TEMPLATE_SECTIONS
    .map((s) => ({ ...s, templates: AGENT_TEMPLATES.filter((t) => t.category === s.key) }))
    .filter((s) => s.templates.length > 0);
}
