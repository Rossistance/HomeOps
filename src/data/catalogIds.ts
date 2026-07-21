/**
 * Stable catalog IDs shared by the seed data and the catalog content files.
 * Centralizing them guarantees cross-references line up even though the catalog
 * content lives in separate modules.
 */

export const AGENT_TEMPLATE_IDS = {
  // Use-case build (run-20260720-225249): active agent-home use-case.
  mealPlannerSignoff: "tmpl-agent-meal-planner-signoff", // UC-21
  familyBriefing: "tmpl-agent-family-briefing",
  schoolDaycare: "tmpl-agent-school-daycare",
  billReceipt: "tmpl-agent-bill-receipt",
  mealGrocery: "tmpl-agent-meal-grocery",
  travelPlanner: "tmpl-agent-travel-planner",
  medical: "tmpl-agent-medical",
  homeMaintenance: "tmpl-agent-home-maintenance",
  caregiving: "tmpl-agent-caregiving",
  documentOrganizer: "tmpl-agent-document-organizer",
  petCare: "tmpl-agent-pet-care",
  giftBirthday: "tmpl-agent-gift-birthday",
  inboxHelper: "tmpl-agent-inbox-helper",
} as const;

export const WORKFLOW_TEMPLATE_IDS = {
  // Use-case build (run-20260720-225249): active workflow-home use-cases.
  schoolCorrespondence: "wf-school-correspondence", // UC-01
  smartClimateNightMode: "wf-smart-climate-night-mode", // UC-12
  morningStatusText: "wf-morning-status-text", // UC-14
  dailyFamilyBriefing: "wf-daily-family-briefing",
  protectFocusBlocks: "wf-protect-focus-blocks",
  fridayInboxCleanup: "wf-friday-inbox-cleanup",
  appointmentRecap: "wf-appointment-recap",
  replyNudge: "wf-reply-nudge",
  householdSupportTriage: "wf-household-support-triage",
  personalChiefOfStaff: "wf-personal-chief-of-staff",
  receiptCollector: "wf-receipt-collector",
  financeReconciliation: "wf-finance-reconciliation",
  subscriptionReview: "wf-subscription-review",
  personalRecordsFiling: "wf-personal-records-filing",
  legalDocumentReview: "wf-legal-document-review",
  homeOfficeDaycareSearch: "wf-home-office-daycare-search",
  bookingBriefing: "wf-booking-briefing",
  relationshipNurturing: "wf-relationship-nurturing",
  websiteChangeMonitor: "wf-website-change-monitor",
  feedMonitor: "wf-feed-monitor",
  researchDeepDive: "wf-research-deep-dive",
  weeklyOperationsSummary: "wf-weekly-operations-summary",
  callConversationAnalysis: "wf-call-conversation-analysis",
} as const;

/**
 * Backing-skill ids for the 9 ACTIVE use-cases (run-20260720-225249, DEC-001).
 * Each active use-case ships a declarative catalog entry (workflow/agent template
 * above) AND a runnable backing Skill seeded server-side (server/seed.mjs) whose
 * steps[].tool_id are the exact real catalog tool ids. These string ids are the
 * single registry of those skill ids; server/seed.mjs seeds the same literals
 * (it cannot import this TS module across the build boundary).
 */
export const USE_CASE_SKILL_IDS = {
  schoolCorrespondence: "skl_uc01_school_correspondence", // UC-01 (active, contract-verified)
  smartClimateNightMode: "skl_uc12_climate_nightmode",    // UC-12 (active, device-runtime-unverified)
  morningStatusText: "skl_uc14_morning_status_text",      // UC-14 (active-partial: weather+text; rss stub)
  recipeExtractor: "skl_uc17_recipe_extractor",           // UC-17 (active)
  memoryScrapbooker: "skl_uc18_memory_scrapbooker",       // UC-18 (active, live-verified)
  eventCoordinator: "skl_uc19_event_coordinator",         // UC-19 (active, live-verified)
  choreDocLinker: "skl_uc20_chore_doc_linker",            // UC-20 (active, live-verified)
  mealPlannerSignoff: "skl_uc21_meal_planner_signoff",    // UC-21 (active, live-verified core)
  internalSystemSync: "skl_uc22_internal_system_sync",    // UC-22 (active, live-verified core)
} as const;

/** Runnable agent ids that own the two delivery-capable active use-cases. */
export const USE_CASE_AGENT_IDS = {
  morningStatus: "agt_morning_status",   // owns UC-14's notify_contact allowlist
  mealPlanner: "agt_meal_planner",       // owns UC-21's notify_contact allowlist
} as const;

export const PLAYBOOK_IDS = {
  dailyFamilyBriefing: "pb-daily-family-briefing",
  weeklyFamilyPlanning: "pb-weekly-family-planning",
  schoolEmailTriage: "pb-school-email-triage",
  receiptProcessing: "pb-receipt-processing",
  monthlyBudgetReview: "pb-monthly-budget-review",
  tripPlanning: "pb-trip-planning",
  medicalAppointmentPrep: "pb-medical-appointment-prep",
  caregiverUpdate: "pb-caregiver-update",
  homeRepairQuoteComparison: "pb-home-repair-quote-comparison",
  documentRenewalTracking: "pb-document-renewal-tracking",
  groceryListFromMessages: "pb-grocery-list-from-messages",
  birthdayPartyPlanning: "pb-birthday-party-planning",
  petCareRoutine: "pb-pet-care-routine",
  emergencyDocumentPacket: "pb-emergency-document-packet",
} as const;
