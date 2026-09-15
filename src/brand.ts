/**
 * Brand configuration. The product can be renamed end-to-end by editing this
 * single object — every screen, the sidebar, the document title, and seeded
 * copy read from here.
 */
export const brand = {
  name: "FamiliOS",
  shortName: "FamiliOS",
  tagline:
    "Personal agent teams for family life, household admin, caregiving, errands, documents, reminders, and recurring life workflows.",
  oneLiner: "Your family operating system.",
  householdLabel: "Household",
  circleLabel: "Family Circle",
  agentLabel: "Helper",
  agentLabelPlural: "Helpers",
  knowledgeLabel: "Knowledge Library",
} as const;

export type Brand = typeof brand;
