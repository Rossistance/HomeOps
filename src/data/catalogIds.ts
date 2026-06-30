/**
 * Stable catalog IDs shared by the seed data and the catalog content files.
 * Centralizing them guarantees cross-references line up even though the catalog
 * content lives in separate modules.
 */

export const AGENT_TEMPLATE_IDS = {
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
