/**
 * Built-in playbook catalog.
 *
 * Playbooks are reusable, step-by-step instructions that helper agents follow
 * for recurring household, family, and personal-life workflows. The seed layer
 * clones these entries and wires `supportingFileIds`, `linkedAgentIds`, and
 * timestamps at clone time, so those fields are intentionally left empty here.
 */

import type { Playbook } from "@/types";
import { PLAYBOOK_IDS } from "./catalogIds";

export const playbookCatalog: Playbook[] = [
  {
    id: PLAYBOOK_IDS.dailyFamilyBriefing,
    name: "Daily Family Briefing",
    description:
      "Pull together each morning's family briefing from the household calendar, inbox, reminders, school notices, and weather so the day starts with one calm overview instead of a scramble.",
    whenToUse:
      "Run every morning, or any time you need a quick read on what today holds for the whole household before everyone heads out the door.",
    steps: [
      { order: 1, text: "Check today's calendar across personal and shared family spaces and list every appointment, drop-off, pickup, and activity with times." },
      { order: 2, text: "Scan the inbox and messages for anything urgent from school, caregivers, or providers that needs a reply or action today." },
      { order: 3, text: "Gather overdue and due-today reminders, chores, and any bills that need paying soon." },
      { order: 4, text: "Add the local weather and call out anything it changes, like packing rain gear or moving an outdoor plan indoors." },
      { order: 5, text: "Summarize the highlights into a short briefing: today's schedule, school reminders, bills due, errands, and waiting-on items." },
      { order: 6, text: "Finish with two or three recommended next actions ranked by what matters most this morning." },
    ],
    requiredConnections: ["Calendar", "Email", "Reminders & Tasks"],
    requiredFileTypes: ["PDF", "TXT"],
    outputFormat:
      "A short morning briefing shown as a dashboard card and a message thread, with an optional email or text summary for household members who want it sent.",
    approvalRules: [
      "No approval needed to post the briefing inside the app.",
      "Approval required before sending the briefing to anyone outside the household.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Communication & Coordination",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.weeklyFamilyPlanning,
    name: "Weekly Family Planning",
    description:
      "Look ahead at the coming week across schedules, school events, activities, meals, and chores, then surface conflicts and gaps so the household can plan together before the week begins.",
    whenToUse:
      "Run on a weekend or the evening before the week starts, whenever the family wants to get ahead of the next seven days.",
    steps: [
      { order: 1, text: "Review the next seven days of calendar events for every family member and flag overlaps, double-bookings, and tight transitions." },
      { order: 2, text: "Pull upcoming school events, deadlines, activity schedules, and any RSVPs or forms due during the week." },
      { order: 3, text: "Identify which days need coverage for drop-offs, pickups, and caregiving, and note where a driver or sitter is still unassigned." },
      { order: 4, text: "Draft a simple meal plan for the week and build a starter grocery list from what is missing." },
      { order: 5, text: "List the recurring chores and one-off tasks for the week and suggest who could own each one." },
      { order: 6, text: "Assemble everything into a week-at-a-glance plan and highlight the decisions the family still needs to make." },
    ],
    requiredConnections: ["Calendar", "Reminders & Tasks"],
    requiredFileTypes: ["PDF", "CSV"],
    outputFormat:
      "A week-at-a-glance plan with a day-by-day schedule, a meal plan, a chore list, and a short section of open decisions, shared as a dashboard card and message thread.",
    approvalRules: [
      "No approval needed to draft and share the plan inside the household.",
      "Approval required before assigning tasks that send reminders to other family members.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Communication & Coordination",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.schoolEmailTriage,
    name: "School Email Triage",
    description:
      "Sort through school and daycare email, summarize what each message is asking for, pull out due dates and forms, and turn anything actionable into reminders so nothing slips past a deadline.",
    whenToUse:
      "Run whenever school email piles up or on a regular weekday schedule, especially during busy enrollment, permission-slip, and event seasons.",
    steps: [
      { order: 1, text: "Scan the inbox for messages from schools, teachers, daycare, and activity organizers and group them by child and by topic." },
      { order: 2, text: "Summarize each message in one or two lines so it is clear what is being asked and whether action is needed." },
      { order: 3, text: "Extract dates, deadlines, event times, and any forms, permission slips, or payments mentioned." },
      { order: 4, text: "Save attached school PDFs to the right child's school folder and tag them for easy retrieval." },
      { order: 5, text: "Create reminders for every deadline, scheduled a couple of days early for anything needing a signature or response." },
      { order: 6, text: "Draft replies for messages that clearly need one and hold them for review before anything is sent." },
    ],
    requiredConnections: ["Email", "Documents & Storage", "Reminders & Tasks"],
    requiredFileTypes: ["PDF", "DOCX", "Images"],
    outputFormat:
      "A triage summary grouped by child, a list of extracted deadlines and forms, filed attachments, and draft replies held for approval.",
    approvalRules: [
      "Approval required before sending any reply to a school, teacher, or provider.",
      "Approval required before archiving or deleting a school message.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "School & Activities",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.receiptProcessing,
    name: "Receipt Processing",
    description:
      "Turn uploaded or emailed receipts into clean, categorized records by reading the vendor, date, and amount, filing each receipt by month, and rolling the totals into a spending summary.",
    whenToUse:
      "Run whenever a batch of receipts comes in, or on a regular schedule to keep household spending records current without manual data entry.",
    steps: [
      { order: 1, text: "Collect new receipts from uploads and email and confirm each one is readable before processing." },
      { order: 2, text: "Read the vendor, date, and total from each receipt and note the payment method when it is shown." },
      { order: 3, text: "Assign a spending category to each receipt and flag any that are ambiguous for a quick human review." },
      { order: 4, text: "File each receipt image or PDF into the correct month-and-category folder so it is easy to find later." },
      { order: 5, text: "Total the receipts by category and by month and note anything unusual or unexpectedly large." },
      { order: 6, text: "Produce a spending summary and list the receipts that still need a category confirmed." },
    ],
    requiredConnections: ["Documents & Storage", "Email", "Finance & Bills"],
    requiredFileTypes: ["PDF", "Images", "CSV"],
    outputFormat:
      "A categorized receipt list with detected vendor, date, and amount, receipts filed by month, and a spending summary highlighting items that need review.",
    approvalRules: [
      "No approval needed to read, categorize, and file receipts.",
      "Approval required before logging into an external order or billing account through a browser workflow.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Finance & Files",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.monthlyBudgetReview,
    name: "Monthly Household Budget Review",
    description:
      "Pull the month's spending together, compare it against the household budget, explain where money went, and surface where the family is over, under, or trending toward a problem.",
    whenToUse:
      "Run at the end of each month, or before a planning conversation when the household wants a clear picture of where the money actually went.",
    steps: [
      { order: 1, text: "Gather the month's categorized receipts and any imported transaction files into one combined record." },
      { order: 2, text: "Group spending by category and compare each category against its budgeted target." },
      { order: 3, text: "Calculate totals, the variance against budget, and the change from the previous month." },
      { order: 4, text: "Call out the categories that went over, the ones with room to spare, and any one-off charges that skewed the picture." },
      { order: 5, text: "Note recurring charges and subscriptions worth a second look, especially anything that looks unused." },
      { order: 6, text: "Write a plain-English summary with the headline numbers and two or three suggestions for next month." },
    ],
    requiredConnections: ["Finance & Bills", "Documents & Storage"],
    requiredFileTypes: ["CSV", "XLSX", "PDF"],
    outputFormat:
      "A monthly budget report with category totals, budget-versus-actual variance, month-over-month change, and a short narrative with suggestions.",
    approvalRules: [
      "No approval needed to generate the review inside the app.",
      "Approval required before sharing the budget report with anyone outside the household.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Finance & Files",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.tripPlanning,
    name: "Trip Planning",
    description:
      "Pull a trip together in one place by gathering reservations, building a day-by-day itinerary, drafting packing lists for each traveler, and tracking the budget and the documents everyone needs to bring.",
    whenToUse:
      "Run when planning a family vacation, a visit to relatives, or any multi-day trip that needs reservations, packing, and a shared schedule.",
    steps: [
      { order: 1, text: "Collect the trip basics: dates, destination, travelers, and the purpose or must-do items." },
      { order: 2, text: "Pull confirmed reservations for flights, lodging, rentals, and activities from email and uploaded confirmations." },
      { order: 3, text: "Build a day-by-day itinerary with travel times, check-ins, and planned activities, and flag any gaps or conflicts." },
      { order: 4, text: "Draft a packing checklist tailored to each traveler, the destination, and the expected weather." },
      { order: 5, text: "Track the budget against estimated and booked costs and note where the trip is trending over or under." },
      { order: 6, text: "Assemble a travel-document checklist, such as IDs, boarding passes, and insurance, and set reminders for anything still missing." },
    ],
    requiredConnections: ["Calendar", "Email", "Documents & Storage"],
    requiredFileTypes: ["PDF", "Images", "CSV"],
    outputFormat:
      "A trip dashboard with a day-by-day itinerary, per-traveler packing lists, a budget tracker, and a travel-document checklist, savable as a mini app.",
    approvalRules: [
      "No approval needed to assemble the plan inside the app.",
      "Approval required before making any booking or sending messages to providers.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Travel",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.medicalAppointmentPrep,
    name: "Medical Appointment Prep",
    description:
      "Get ready for an upcoming medical appointment by pulling the relevant history, listing questions to ask, gathering the documents and forms to bring, and sorting out logistics like timing and transportation.",
    whenToUse:
      "Run a few days before any doctor, dentist, specialist, or therapy appointment, for yourself, the children, or a family member you help care for.",
    steps: [
      { order: 1, text: "Confirm the appointment details: who it is for, the provider, the date, the time, and the location." },
      { order: 2, text: "Review recent notes, past visit summaries, and medication or symptom history relevant to this appointment." },
      { order: 3, text: "Draft a short list of questions and concerns to raise, drawing on any recent changes worth mentioning." },
      { order: 4, text: "Gather the documents to bring, such as insurance cards, referrals, intake forms, and prior test results." },
      { order: 5, text: "Sort out logistics, including travel time, who is driving, and whether a fasting or pre-visit instruction applies." },
      { order: 6, text: "Assemble a prep summary and set reminders for the appointment and for anything to do beforehand." },
    ],
    requiredConnections: ["Calendar", "Documents & Storage", "Health & Caregiving"],
    requiredFileTypes: ["PDF", "DOCX", "Images"],
    outputFormat:
      "A prep summary with appointment details, relevant history, a question list, a documents-to-bring checklist, and logistics notes, with reminders set.",
    approvalRules: [
      "No approval needed to assemble the prep summary internally.",
      "Approval required before messaging a medical provider or sharing health records with anyone.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Medical & Caregiving",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.caregiverUpdate,
    name: "Caregiver Update",
    description:
      "Keep everyone helping care for a family member on the same page with a clear update covering recent appointments, medication changes, daily notes, and what is coming up next.",
    whenToUse:
      "Run on a regular cadence or after a notable event, such as a doctor visit or a change in care, when the people helping need a shared update.",
    steps: [
      { order: 1, text: "Gather notes, appointments, and any changes since the last update for the family member receiving care." },
      { order: 2, text: "Summarize recent appointments and their outcomes, including any new instructions from providers." },
      { order: 3, text: "Note medication changes, the current schedule, and anything caregivers should watch for." },
      { order: 4, text: "Capture daily observations such as mood, appetite, sleep, and mobility in a few plain lines." },
      { order: 5, text: "List what is coming up next, including upcoming appointments, refills, and tasks that need a hand." },
      { order: 6, text: "Compose a warm, clear update and confirm the approved recipient list before it goes out." },
    ],
    requiredConnections: ["Health & Caregiving", "Messaging", "Calendar"],
    requiredFileTypes: ["PDF", "TXT"],
    outputFormat:
      "A caregiver update with recent appointments, medication notes, daily observations, and upcoming items, shared as a message and an optional family update.",
    approvalRules: [
      "Approval required before sending the update to anyone outside the household.",
      "Approval required before including sensitive health details, and recipients are limited to the approved caregiving circle.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Medical & Caregiving",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.homeRepairQuoteComparison,
    name: "Home Repair Quote Comparison",
    description:
      "Make sense of competing home-repair quotes by lining up the price, scope, timeline, and warranty side by side so the household can choose a contractor with confidence.",
    whenToUse:
      "Run when collecting bids for a repair or home project and you want an apples-to-apples comparison before deciding who to hire.",
    steps: [
      { order: 1, text: "Collect the quotes from uploads and email and confirm each one is for the same job before comparing." },
      { order: 2, text: "Pull the key details from each quote: total price, scope of work, materials, timeline, and warranty terms." },
      { order: 3, text: "Line the quotes up in a side-by-side comparison so differences in scope and price are easy to see." },
      { order: 4, text: "Flag gaps and red flags, such as missing scope items, vague terms, or an unusually low or high bid." },
      { order: 5, text: "Note each contractor's licensing, insurance, and any reviews or references that were provided." },
      { order: 6, text: "Summarize the trade-offs and suggest follow-up questions to ask before making a decision." },
    ],
    requiredConnections: ["Documents & Storage", "Email"],
    requiredFileTypes: ["PDF", "DOCX", "Images"],
    outputFormat:
      "A side-by-side comparison table of price, scope, timeline, and warranty, plus a summary of trade-offs and suggested follow-up questions.",
    approvalRules: [
      "No approval needed to assemble and compare the quotes internally.",
      "Approval required before contacting a contractor or accepting any quote.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Home Maintenance",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.documentRenewalTracking,
    name: "Document Renewal Tracking",
    description:
      "Keep important documents from expiring by reading their renewal dates, tracking what is coming due, and reminding the household well before any license, passport, or policy lapses.",
    whenToUse:
      "Run on a regular schedule, or after filing new documents, to stay ahead of renewals for IDs, passports, insurance, registrations, and memberships.",
    steps: [
      { order: 1, text: "Review the documents in the household records and identify which ones carry an expiration or renewal date." },
      { order: 2, text: "Extract the expiration date and renewal details from each document and note who it belongs to." },
      { order: 3, text: "Build a renewal tracker listing each document, its owner, its expiration date, and its status." },
      { order: 4, text: "Identify what is expiring soon and what has already lapsed, sorted by how urgent each one is." },
      { order: 5, text: "Set reminders well ahead of each deadline, with extra lead time for anything that takes weeks to process." },
      { order: 6, text: "Summarize what needs attention now and outline the renewal steps for the most urgent items." },
    ],
    requiredConnections: ["Documents & Storage", "Reminders & Tasks", "Calendar"],
    requiredFileTypes: ["PDF", "Images", "DOCX"],
    outputFormat:
      "A renewal tracker listing each document, owner, expiration date, and status, with reminders set and a summary of what needs attention now.",
    approvalRules: [
      "No approval needed to track renewals and set reminders.",
      "Approval required before submitting any renewal or sharing identity documents externally.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Documents",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.groceryListFromMessages,
    name: "Grocery List From Messages",
    description:
      "Turn the scattered 'can you grab' texts and messages into one organized grocery list, merging duplicates and sorting items by aisle so the next store run is quick and complete.",
    whenToUse:
      "Run before a grocery trip, or continuously through the week, to gather requests from family messages into a single shared list.",
    steps: [
      { order: 1, text: "Scan recent family messages and texts for grocery requests and items people mentioned running low on." },
      { order: 2, text: "Pull out each requested item along with any quantity, brand, or size mentioned." },
      { order: 3, text: "Merge duplicate requests and combine quantities so the same item is not listed twice." },
      { order: 4, text: "Sort the items into store sections, such as produce, dairy, pantry, and frozen, to make shopping faster." },
      { order: 5, text: "Flag anything ambiguous, like a brand that needs confirming, and note who asked for each special item." },
      { order: 6, text: "Produce a clean, shareable grocery list ready to use or sync into the household grocery mini app." },
    ],
    requiredConnections: ["Messaging", "Shopping & Groceries"],
    requiredFileTypes: ["TXT", "Images"],
    outputFormat:
      "A clean grocery list grouped by store section with merged quantities, ready to share or sync into the grocery mini app.",
    approvalRules: [
      "No approval needed to compile and share the list inside the household.",
      "Approval required before placing an order or making a purchase from the list.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Errands & Shopping",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.birthdayPartyPlanning,
    name: "Birthday Party Planning",
    description:
      "Plan a birthday party end to end by setting the date and theme, building the guest list and invitations, tracking RSVPs and a budget, and managing the checklist of food, supplies, and activities.",
    whenToUse:
      "Run a few weeks ahead of a child's or family member's birthday when there is a party to organize and details to keep straight.",
    steps: [
      { order: 1, text: "Confirm the basics: whose birthday it is, the date and time, the theme, the location, and the guest count." },
      { order: 2, text: "Build the guest list and draft invitations, then set up a simple way to track RSVPs." },
      { order: 3, text: "Plan the food, cake, and supplies and turn them into a shopping and to-do checklist." },
      { order: 4, text: "Outline the activities or entertainment and a rough timeline for the day of the party." },
      { order: 5, text: "Track the budget across venue, food, decorations, and favors and flag where it is trending over." },
      { order: 6, text: "Set reminders for the key deadlines, such as sending invites, ordering the cake, and final headcount." },
    ],
    requiredConnections: ["Calendar", "Reminders & Tasks", "Shopping & Groceries"],
    requiredFileTypes: ["PDF", "Images", "CSV"],
    outputFormat:
      "A party plan with guest list and RSVP tracker, a shopping and to-do checklist, a day-of timeline, and a budget tracker, savable as a mini app.",
    approvalRules: [
      "No approval needed to plan the party inside the app.",
      "Approval required before sending invitations or making purchases and bookings.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Family & Events",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.petCareRoutine,
    name: "Pet Care Routine",
    description:
      "Keep the household's pet care running smoothly with a clear routine for feeding, walks, and medications, plus tracking for vet visits, vaccinations, and supplies that need restocking.",
    whenToUse:
      "Run to set up or refresh a pet's daily routine, or on a regular cadence to stay ahead of vet appointments, medications, and supply runs.",
    steps: [
      { order: 1, text: "List the household pets and capture each one's feeding schedule, walk routine, and care needs." },
      { order: 2, text: "Build a daily and weekly routine covering feeding times, walks, grooming, and play, and note who handles each one." },
      { order: 3, text: "Track medications and treatments with dosages and timing, and flag refills that are running low." },
      { order: 4, text: "Record vet appointments and vaccination dates and set reminders for anything due soon." },
      { order: 5, text: "Monitor supplies like food, litter, and medication and add low items to the household shopping list." },
      { order: 6, text: "Assemble a pet care summary with the routine, upcoming appointments, and supplies to restock." },
    ],
    requiredConnections: ["Reminders & Tasks", "Calendar", "Health & Caregiving"],
    requiredFileTypes: ["PDF", "Images", "TXT"],
    outputFormat:
      "A pet care summary with the daily and weekly routine, a medication schedule, upcoming vet and vaccination dates, and a supply restock list.",
    approvalRules: [
      "No approval needed to build and track the routine internally.",
      "Approval required before booking a vet appointment or messaging a provider.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Pets",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: PLAYBOOK_IDS.emergencyDocumentPacket,
    name: "Emergency Document Packet",
    description:
      "Pull the household's critical documents and contacts into one secure, well-organized packet so the most important information is ready to reach in an emergency.",
    whenToUse:
      "Run when first assembling an emergency kit, and refresh it periodically or after a major life change such as a move, new policy, or new family member.",
    steps: [
      { order: 1, text: "Identify the documents an emergency packet should hold, such as IDs, insurance, medical info, and key account details." },
      { order: 2, text: "Gather the relevant files from the household records and confirm each one is current and readable." },
      { order: 3, text: "Compile an emergency contact list including family, doctors, and providers, with their roles noted." },
      { order: 4, text: "Note essential medical details such as allergies, medications, and conditions for each family member." },
      { order: 5, text: "Organize everything into a clear, secure packet and mark sensitive items so they stay protected." },
      { order: 6, text: "List what is still missing or out of date and set reminders to fill the gaps and review the packet on a schedule." },
    ],
    requiredConnections: ["Documents & Storage", "Health & Caregiving", "Reminders & Tasks"],
    requiredFileTypes: ["PDF", "DOCX", "Images"],
    outputFormat:
      "A secure, organized emergency packet with critical documents, an emergency contact list, essential medical details, and a checklist of missing items.",
    approvalRules: [
      "Approval required before sharing the packet or any sensitive document with anyone.",
      "Sensitive items are marked and handled with extra protection, and external sharing always requires explicit approval.",
    ],
    supportingFileIds: [],
    linkedAgentIds: [],
    category: "Documents",
    createdAt: "",
    updatedAt: "",
  },
];
