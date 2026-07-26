// The walkthrough's content, and which of the two tours a person gets.
//
// Split out of tutorial.tsx so it can be tested: that file is JSX and hooks, this is data and
// one decision. The decision is the only part that isn't measurable at runtime (see the note in
// tutorial.tsx), so it's the only part worth a test.
export interface TourStep {
  /** The <Coach id> this step points at. */
  target: string;
  title: string;
  body: string;
  /** Route to visit before pointing. The step is skipped if its target never appears. */
  route?: string;
  /** Where the bubble prefers to sit. Flipped automatically when there's no room. */
  place?: "above" | "below";
}

/* ---------------------------------- the tour ---------------------------------- */

/**
 * The spine. Deliberately short — this is "show me around", not a manual, and a walkthrough
 * long enough to be comprehensive is one people bail out of halfway, having learned the first
 * three things and mistrusted the rest.
 *
 * Ordered as a journey rather than as a feature list: where your day is, how to ask for
 * something, where the answer lands, and where the rest of it lives.
 */
const SPINE: TourStep[] = [
  {
    target: "today.greeting", route: "/(home)", place: "below",
    title: "This is Today",
    body: "Everything that needs you is on this screen, in the order it needs you. Nothing here is hidden behind a menu.",
  },
  {
    target: "today.members", route: "/(home)", place: "below",
    title: "Everyone in the household",
    body: "Each person has their own colour, and it follows them everywhere — on the calendar, on a task, on a card. Tap a child, grandparent or sitter to see their view of the app.",
  },
  {
    target: "today.ask", route: "/(home)", place: "below",
    title: "Ask Famili anything",
    body: "Plain sentences. \"Book Amelia's dentist for a Tuesday afternoon.\" It plans first, shows you the plan, and asks before anything leaves the house.",
  },
  {
    target: "today.calendar", route: "/(home)", place: "above",
    title: "What's next, and whose it is",
    body: "The next three things, tinted to whoever they belong to. Tap one to open it — including events synced from another calendar, where you can add your own notes without changing theirs.",
  },
  {
    target: "today.help", route: "/(home)", place: "above",
    title: "Hand things off",
    body: "Ask someone to cover something, or offer to cover for them. Grandparents and sitters get their own simplified screen when you do.",
  },
  {
    target: "settings.household", route: "/(settings)", place: "below",
    title: "Who's here, and what they can do",
    body: "Roles, invitations, and the sign-in PIN live here. Roles are enforced by the server, not by this app — so what someone can't see, they genuinely can't reach.",
  },
  {
    target: "settings.connections", route: "/(settings)", place: "below",
    title: "Calendars and accounts",
    body: "Connect a calendar and it syncs both ways. Every account belongs to the person who connected it — yours stays yours.",
  },
  {
    target: "settings.tutorial", route: "/(settings)", place: "above",
    title: "That's the tour",
    body: "You can start it again from here whenever you like. Nothing in the app was changed by taking it.",
  },
];

/* The scoped homes — child, grandparent, sitter — are different screens, not the adult Today
 * with things removed. So none of the spine's targets exist on them, and without this the
 * walkthrough would find nothing and end instantly. Their screens are deliberately small, so
 * their tour is too: the one card that is the whole point of the screen. */
const SCOPED: TourStep[] = [
  {
    target: "scoped.mine", route: "/(home)", place: "below",
    title: "This is yours",
    body: "Everything on this screen is for you — nothing else in the household is hidden here, there just isn't any. Tap something to mark it done.",
  },
  {
    target: "settings.tutorial", route: "/(settings)", place: "above",
    title: "That's it",
    body: "Short on purpose. Start it again from here any time.",
  },
];

/* ---------------------------- per-screen chapters ----------------------------
 * "Show me around" answers "what is this app". A chapter answers "what is THIS SCREEN", which
 * is the question you actually have while standing on it — and it's a different question, so
 * it gets a different entry point rather than a longer spine.
 *
 * Each chapter is keyed by the route it belongs to, so a screen can offer its own walkthrough
 * without knowing anything about the tour that runs across the whole app. Adding one is adding
 * a key here and wrapping a couple of controls in <Coach>.
 */
export const CHAPTERS: Record<string, { label: string; steps: TourStep[] }> = {
  "/(ask)": {
    label: "Asking Famili",
    steps: [
      {
        target: "ask.spaces", place: "below",
        title: "Personal, or the whole family",
        body: "These switch which chats you're looking at — they don't move the one you have open. To move a single chat, press and hold it in the row below.",
      },
      {
        target: "ask.threads", place: "below",
        title: "Your chats",
        body: "Tap one to pick it back up. Press and hold to move it between Personal and Family, or to delete it.",
      },
      {
        target: "ask.attach", place: "above",
        title: "Photos and files",
        body: "Attach a photo of a schedule, a letter, a form. It's read, not just stored — ask about what's in it and you'll get answers from the page.",
      },
      {
        target: "ask.composer", place: "above",
        title: "Just say it plainly",
        body: "No commands to learn. Anything that changes the world outside this app is shown to you first and waits for a yes.",
      },
    ],
  },
  "/calendar": {
    label: "The calendar",
    steps: [
      {
        target: "calendar.strip", place: "below",
        title: "The week, at a glance",
        body: "Each day carries a dot per person who has something on it, in their own colour.",
      },
      {
        target: "calendar.list", place: "above",
        title: "Synced and yours",
        body: "Events from a connected calendar show here alongside the ones made in FamiliOS. You can add your own notes and who's coming to either — what came from elsewhere stays as it is at the source.",
      },
    ],
  },
  "/tasks": {
    label: "Tasks & lists",
    steps: [
      {
        target: "tasks.spaces", place: "below",
        title: "Family, or a nest",
        body: "A nest is a small group inside the household. Its lists are only visible to the people in it — not to everyone, and not to the Owner.",
      },
      {
        target: "tasks.composer", place: "below",
        title: "Add anything",
        body: "A task with a date becomes a real reminder, and can go straight onto the calendar of whoever it's assigned to.",
      },
    ],
  },
};

/**
 * Which tour. Not a filter over one list: a child, grandparent or sitter gets a DIFFERENT
 * SCREEN, not the adult Today with pieces removed, so the spine's targets are absent rather
 * than filtered — measure them all and you'd get an empty tour and a dead button.
 *
 * Everything finer-grained than this stays measurement's job. A control someone can't see is a
 * control that doesn't measure, and its step quietly isn't part of their tour.
 */
export function tourFor(viewMode: string): TourStep[] {
  return viewMode === "owner" || viewMode === "adult" ? SPINE : SCOPED;
}

/** The chapter for a route, if that screen has one. */
export function chapterFor(route: string): { label: string; steps: TourStep[] } | null {
  return CHAPTERS[route] ?? null;
}
