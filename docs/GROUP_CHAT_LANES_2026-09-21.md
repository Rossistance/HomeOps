# Three lanes: Famili overhearing, Famili answering, Famili alone with you

**Shipped 2026-09-21.** Supersedes the routing and tool-scope sections of
[GROUP_CHAT_2026-09-20.md](GROUP_CHAT_2026-09-20.md), which stays as the record of what was
decided the day before. The consent design in that document is unchanged and still governs.

The day-old version treated the family group chat as a place the assistant should barely be
trusted in: no tool menu at all, an 8B classifier returning a `kind` from a three-value enum,
and a frozen four-id floor the server mapped that enum onto.

That is the right shape for speech nobody asked for. It is the wrong shape for a question —
and it compounds, because **the voice agent is built on this same foundation**. An assistant
that can only reach three hardcoded verbs in a text thread cannot hold a phone call either.

So the model stopped being the thing that gets narrowed. The **channel** is.

## The lanes

| | Lane 1 — passive | Lane 2 — addressed | Lane 3 — 1:1 |
|---|---|---|---|
| Trigger | any member message, swept after 45s quiet | a wake word, **from a verified member** | any text |
| Brain | `triageChat`, 8B, JSON enum | `runAssistantAgent`, dense | `runAssistantAgent`, dense |
| Tools | none shown; enum → 3 ids | **full catalog** | **full catalog** |
| Data | member transcript | **household-shared only** | household **+ personal** |
| Acts as | `agt_chat` | `agt_household` | `agt_household` |
| Speak budget | 6/day | 30/day | uncapped |
| Runs | background sweep | async, outside the chat lock | inline in the webhook |

`agt_chat` stopped being a cage and became **only a voice** — the identity `sms.send`
executes as, so "may Famili speak in my group chat" stays the one dial an Owner already
granted. Its seeded allow-list is now `["sms.send"]` alone. Existing records are not
rewritten: a family's four-id list still contains `sms.send`, so speaking keeps working and
the other three ids are simply inert.

## What replaced the floor

Not a smaller menu. A real identity.

A Lane 2 turn is **attributed** to `agt_household`, which is what makes
`engine.mjs:executeToolForChat` run its policy ladder at all — the allow-list, the household
kill switch, risk overrides. On top of that, `policy.mjs` gained **rule 4b**: every
relaxation below it is a grant the household's *adults* made, so a non-adult never inherits
one. A Limited Member's consequential call is **drafted and parked** for an adult to sign,
through the approval queue that already existed.

Adult threshold is `isAdultRole()` — Owner, Adult Admin **and Adult Member** execute. One
adult vocabulary, not two.

`PROPOSAL_TOOL_IDS` survives for Lane 1 and is now **derived** from `PROPOSAL_KINDS`, so the
enum and the tool set cannot drift.

## The wake word is strict on purpose

Fires on an explicit address only: `@famili`, a greeting (`hey famili`), or punctuation
after the name (`famili,` / `famili:`). **Bare `famili <text>` does not fire** — "we should
ask Famili about it" is the family talking *about* the assistant.

That costs recall. `Famili what's on Saturday?` is the most natural phrasing there is and it
misses. Rather than guess the trade, every near-miss is written to the decision log as
`wake_near_miss`, so the rule gets widened against a number in a few weeks instead of an
argument now.

**One gap found and closed while building this.** `isStopRequest` only ever knew the bare
and comma forms. Once `detectWake` taught the feature three more ways to say the name,
`Famili: stop`, `@famili stop` and `hey famili stop` fell through the stop check and matched
the *wake* rule — which would have answered a request to leave by starting a dense model
turn with the prompt "stop". Checking stop first does not help when the stop check cannot
read the sentence. Revocation now recognises every address form the rest of the module does.

## Why Lane 2 runs outside the chat lock

A dense turn can take minutes. Held under `withChatLock` it would block every other message
in that chat for the duration — **including "Famili stop"** — stall the triage sweep, and
make a redelivery's dedupe check queue behind the very turn it exists to short-circuit.

So the lock does the claim (milliseconds, no model) and a durable **turn lease** on the chat
record guards the work. The webhook answers `200 wake_accepted` immediately and the answer
arrives in the thread as its own message, which is how every other outbound already works.
A second wake word during a live turn is recorded and **silently** skipped — announcing "I'm
busy" into a family thread is the nagging this product refuses. `imessage.wake_busy` counts
how often that costs anyone anything.

The lease is durable rather than in-memory because this deployment restarts on every deploy,
and it is released only by its holder, so a turn that overran cannot clear a reclaimer's
claim.

## The new security surface, stated plainly

A dense model with real tools now reads text written by people outside the household. Three
things stand between that and harm:

1. Only a **verified member** can start a turn. A non-member's wake word runs nothing — and
   is not told why, because a stranger learning their wake word was refused for want of
   verification is a stranger learning this thread belongs to a FamiliOS household.
2. The system prompt names outsider lines as **reported speech, never instructions**.
3. Every consequential tool call still goes through the **approval ladder**.

The first two reduce the odds. **Only the third is a guarantee.** The worst outcome of a
successful injection must remain a drafted, parked action an adult has to sign. Do not weaken
the third to make the lane feel snappier.

## `storeAllChatParticipants`

Default **false**, unchanged for every household. One family can decide to keep the whole
conversation — a thread that is only ever family, where Famili having the full context is
worth more than the abstention.

It takes the household PIN, and it is not a silent change:

- **Turning it on** announces the new policy into every bound chat *first*; if any chat
  cannot be told, the whole change is refused and named. The sentence Famili spoke at bind
  time is a promise made to people who are not FamiliOS users and cannot check it.
- **Turning it off** announces, then **deletes** every stored non-member row. Holding their
  words under a policy the household has withdrawn is the one outcome this must not produce.

Even when on, the **raw handle is never stored on the row** — only a scrypt hash under the
chat's own salt. Keeping the message is what the family chose; keeping a stranger's phone
number is a second, larger decision nobody asked for.

Two things it deliberately does **not** change:

- **`verifySpan` still requires a member.** Whether a non-member's words are *kept* and
  whether they can *settle* something are different questions. A neighbour saying "let's do
  4pm" is not this family deciding. That refusal is now recorded as `span_from_non_member`,
  distinct from `span_not_found`, so the precision log can finally tell a hallucinating
  classifier from a working one being declined.
- **`windowDigest` stays member-only in every household**, now by choice rather than
  necessity: precision is compared across households, and a number computed over a different
  set of text in different families is not a number.

## Two bugs fixed on the way past

- **1:1 texts ran unattributed.** `sms.mjs` passed no agent, and `engine.mjs:381` gates the
  entire policy ladder behind `if (agent)`. So a household's denied tools, kill switch, risk
  overrides and `Trusted` stance never applied to texting, in either direction. They do now.
- **The 1:1 idempotency claim was written *after* the LLM turn.** Two deliveries inside that
  window both passed, and the family got two answers, two plans and two approvals for one
  text. The claim now happens before the turn, as the group branch always did.

## Still open

- Real wake-word recall against how families actually type. The near-miss log is the
  instrument; revisit in a few weeks.
- One turn at a time per chat. A family asking two things in a row gets one answer. Silence
  is the least-bad option; `imessage.wake_busy` says whether that is true.
- Lane 2 does not close an open Lane 1 proposal, so "Famili, no — make it Sunday" leaves a
  stale offer live for up to 30 minutes.
- A settings PATCH that sends messages is unusual. It is precedented by `bindChat` and it is
  what keeps the announcement honest, but it is worth knowing about.
