# Agent Delta — Implementation Lead — run-20260720-073025

Phase: IMPLEMENTATION_RUNNING (Convergent 360 S6–S7). Scope: the full selected menu,
WP-001 … WP-006.

## What changed, in one paragraph

Ask Famili could create an "agent" that reported success and did nothing, for four
independent reasons at once. The automation it built carried WHO should run but never
WHAT to run, so every scheduled fire degraded into a read-only status pass. The build
spec could not express a time of day, so "every day at 7 AM" meant "every 24 hours from
whenever you asked". A step titled "Send email…" with no tool behind it was recorded as
a success. And a run that parked on an approval, or whose approval expired, told the
conversation nothing at all. Each of those is now closed at the seam that caused it,
with the audit's own repro scripts promoted into permanent tests that fail if any of
them returns.

## Decisions recorded

- **DEC-I01 — one lifecycle for chat-built helpers.** An agent that the same build puts
  on a schedule lands **Active**; a build with no automation stays **Draft**. Considered
  and rejected: keep everything Draft and refuse to fire. That is a silent no-op wearing
  a safety badge — and status was never enforced at run time anyway (verified in
  `agents.mjs`: neither `selectAgent` nor `isToolStepAllowed` consults it). Safety stays
  where it actually lives: the per-step approval gate.
- **DEC-I02 — the effect-claim detector is deliberately narrow.** It matches delivery
  verbs in a toolless step's own title/detail, and excludes preparatory language
  ("compose", "draft", "decide"). Rationale: the regression risk here is
  over-correction — marking honest reasoning steps as failures would be a new kind of
  lie. Guarded by an explicit CONTROL test.
- **DEC-I03 — `homeops.notify_contact` requires no per-run approval, but refuses to act
  without an acting agent.** The three registry gates (verified, opted-in, per-agent
  allowlist) are the standing consent. A second per-run gate would recreate the
  30-minute expiry race that WP-005 exists to end. Because `deliverNotification` only
  enforces the allowlist when an agentId is supplied, the tool refuses to run
  unattributed rather than trusting callers to pass one.
- **DEC-I04 — the tool cannot address a free-form recipient.** A raw `to` is resolved
  against existing verified methods and refused if unmatched. It can never create one.

## Disagreement with the matching guide (preserved, not silently corrected)

The guide routed all of WP-006 to the client lane (T-601). Part of it — ISS-011,
role-aware proposals — is genuinely a server concern: the promoted persona suite proved
that a Guest receives a `kind: "build"` response that then 403s on confirm. A client-only
fix would have hidden a card the server was still offering. Executed by the lead on the
server surface instead. The guide's rationale is otherwise unchallenged by observation.

## What the mandatory adversarial review changed

The xhigh security pass on WP-005 returned **do-not-ship** with three CRITICAL and two
HIGH findings. I verified each against the code before acting rather than accepting the
report. All five are fixed and pinned as regression tests; three MEDIUM findings are
accepted as out-of-scope residual risks and recorded in the verification matrix rather
than quietly dropped. Two of my own fixes over-corrected and broke existing tests — the
suite caught both, and each was narrowed to the actual hole (notably: a Guest may still
notify their own verified address; only messaging *someone else* externally is
adult-gated).

## Honest limits of this work

- **No email was sent to anyone during this session.** WP-005's live acceptance is
  blocked: the household's Google account is `needs_reconnect`. The mocked lane is
  complete and every gate is proven, but "the email actually arrives" is unproven.
- Everything here is **local**. Production still runs the pre-fix build.
- Native iOS rendering is unproven by decision (DEC-10); client evidence is web-lane only.
- HYP-005 remains open: all fixtures use a scripted provider, so a real cloud model's
  build JSON has not been observed. The target-linkage fix is structural and
  model-independent, which bounds — but does not eliminate — that risk.

## Files touched (server, by the lead)

`server/index.mjs`, `server/planner.mjs`, `server/triggers.mjs`, `server/engine.mjs`,
`server/orchestrator.mjs`, `server/assistant-runs.mjs`, `server/internal-functions.mjs`,
`server/notify.mjs`, `server/agents.mjs`.

New tests: `server/test/false-success-regression.test.mjs` (ART-022),
`server/test/notify-contact-delivery.test.mjs` (ART-023),
`server/test/persona-honesty.test.mjs` (ART-024).

Client surfaces were delegated to two sonnet/medium subagents on disjoint write
surfaces; `server/**` had exactly one writer throughout (checked via `git status` at
every checkpoint).
