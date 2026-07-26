// What the Ask Famili card asks you.
//
// "…go through a rotation of clever, market-aware question samples — instead of 'what can I
//  take off your plate today', come up with something clever to substitute but aligned. It
//  would load a new one each time you open, maybe 20 different ones that are recycled."
//
// The rule I held these to: every line has to be answerable. This card is a text field, so a
// question it asks is a question you might type an answer INTO — which rules out cleverness
// that leaves you with nothing to say. "Ready to conquer the day?" is a slogan; "What's the
// one thing you keep forgetting to do?" is a prompt with an obvious next keystroke.
//
// They also stay honest about what this app is. Nothing here promises a chore is done, or
// implies Famili has already noticed something it hasn't. It asks; you answer; it acts, with
// approval, the way the rest of the app works.
const PROMPTS = [
  "What can I take off your plate today?",
  "What's the one thing you keep forgetting to do?",
  "What's still unsorted for this week?",
  "Who needs to be somewhere, and when?",
  "What have you been meaning to book?",
  "What would make tomorrow morning easier?",
  "Anything you'd rather not think about again?",
  "What's for dinner — or should I work that out?",
  "Who's covering what this weekend?",
  "What did somebody promise to handle?",
  "Is there a bill, a form, or a renewal waiting?",
  "What would you hand off if you could?",
  "What's on the calendar that shouldn't be?",
  "Who haven't you replied to yet?",
  "What needs buying before the week's out?",
  "Anything the whole house should know?",
  "What's the errand you keep driving past?",
  "Which appointment still needs making?",
  "What are we forgetting about next week?",
  "What's worth doing before everyone's home?",
];

/**
 * One prompt per open, and not the one you just saw.
 *
 * The caller keeps the last index (it's cheap, and persisting it would mean a disk read on the
 * first frame of the first screen — a worse trade than occasionally repeating across a cold
 * start). Within a session, consecutive repeats are impossible, which is the part anyone would
 * actually notice.
 */
export function pickPrompt(previous?: string | null): string {
  if (PROMPTS.length === 0) return "What can I take off your plate today?";
  const pool = previous ? PROMPTS.filter((p) => p !== previous) : PROMPTS;
  return pool[Math.floor(Math.random() * pool.length)] ?? PROMPTS[0];
}

export const ASK_PROMPT_COUNT = PROMPTS.length;
