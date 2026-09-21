# Milestone specification — inference, native messaging, deferred coordination, voice

**Received 2026-09-20.** Committed here because the plan that answers it cites it
throughout, and a contract that lives only in a chat log is not a contract.

This is the source document as given, summarised faithfully. Where the
implementation departed from it, the departure is recorded at the end rather
than edited into the text.

---

## Part 1 — Core principles

Five, taken from the existing codebase rather than invented for this milestone:

1. **Honest system states, zero fabricated success.** Never simulate an
   integration, fabricate success, or mask latency with decorative fiction. An
   impediment returns a strongly typed failure.
2. **Strict authority boundaries and permission gates.** Autonomous action in the
   outside world is gated behind explicit human consent. Automated systems may
   listen, triage and propose; execution requires authorization by an
   authenticated household member.
3. **Data isolation and trust substrate.** Tenant data is physically partitioned
   per household. External inference must be ephemeral and zero-retention.
4. **Calm, unobtrusive interface.** Reduce administrative friction. Never narrate
   internal machinery, spam notification surfaces, or generate social
   awkwardness in shared channels.
5. **Radical simplicity and dependency discipline.** Favour native runtimes and
   first-party control over SaaS middleware.

## Part 2 — Inference strategy

Local quantized models on-device were explored and rejected: small edge models
struggle with reliable multi-step tool calling, hallucinate schema arguments,
and impose severe mobile build-matrix complexity. Dedicated cloud GPUs hosting
self-managed 70B models 24/7 were also rejected: fixed leasing costs create
negative margins at low volume.

**Decision: elastic serverless open-weights inference**, billed per token, with a
two-tier split:

- **Passive triage tier (~8B class):** sub-second, negligible per-message cost,
  evaluates ambient conversation as a silent classifier.
- **Dense execution tier (~70B class):** activated only for explicit intent
  parsing, prompt synthesis, or strict JSON tool calling.

## Part 3 — Native messaging and the "lurker" pattern

Building a dedicated in-app messaging interface forces household members to
abandon established habits. The architecture pivots to meeting families in
native group chats, bridged first-party.

- **Phase 1, passive observer.** Incoming messages arrive as real-time events.
  The triage model evaluates rolling context against a strict negative-bias
  prompt and must remain silent unless it identifies a clear, settled,
  unambiguous logistical request. On detection, one concise confirmation
  proposal into the thread.
- **Phase 2, permission-gated execution.** An affirmative reply maps the sender's
  handle against the authenticated member registry; the dense tier formats the
  tool parameters and calls the backend capability.
- **Phase 3, verifiable visual proof.** Replying "confirmed, it has been added"
  is an unverifiable simulated state. On success the backend renders the actual
  UI card headlessly, screenshots it, and replies with both the sentence and the
  image.

## Part 4 — Asynchronous deferred coordination

The failure mode addressed is public nagging. Member A raises Member B's medical
appointment in the group; Famili offers; B says no. Continuing to prompt creates
embarrassment; forgetting drops a health task.

1. **Silent state preservation.** Acknowledge, leave the thread, log a tracking
   record: origin conversation, initiator, target, intent, future evaluation
   time.
2. **Dual-path non-invasive audit.** At the threshold, scan the calendar for a
   matching new event, and scan the origin conversation for a manual update.
   Either confirms resolution and the loop terminates silently.
3. **Private channel flipping.** If unaddressed, never the group: a 1:1 direct
   message to Member B.
4. **Isolated closure, consent-gated relay.** A decline marks it permanently
   dismissed. An acceptance executes, then asks B privately whether to tell A.
   Only on explicit consent does anything post back to the group.

## Part 5 — JIT voice agent compilation

Roughly eighty telephone scenarios across home maintenance, family logistics and
local commerce, to be served without dozens of brittle hardcoded personas.

**Archetype templates** stored locally define an interaction category, a
conversational objective, friction handlers (IVR trees, hold music, vague
pricing, missing information) and a mandatory extraction schema.

**The compilation loop:** milliseconds before dialing, the dense tier ingests the
archetype, the user's context and decrypted vault identity, synthesises an
ephemeral system prompt and a strict extraction schema. A **validation gate**
parses the compiled payload and rejects the call with an honest failure rather
than dialing with corrupted instructions.

**Termination protocol.** Voice models struggle to end calls. The compiler
injects an absolute mandate: once every field is gathered or refused, close and
drop the line. Plus DTMF for IVR trees, hold detection with a hard timeout, an
authorized-values boundary for identity requests, and graceful termination with
a typed error when a business refuses automated agents.

## Part 6 — Benchmark-grade realtime voice

Zero conversational gaps, proactive degradation management, total audio
preservation, low-latency synchronisation, high-accuracy grounding.

- **ASR:** telemetry sampled at 0.1s computing the delta between audio sent and
  audio confirmed as transcribed; a 5.0s backlog trips failover; a rolling
  circular buffer flushed only on explicit confirmation and replayed into the
  backup; priority-ranked provider swapping; a 20s warm-up window suppressing
  secondary alarms.
- **LLM:** deployment-level granular routing; competitive multi-request racing
  with first-valid-token wins; rolling latency and error-rate health monitoring;
  RAG-grounded mid-call retrieval; tiered cross-model-family fallbacks.

## Part 7 — The task

Critical architectural review and blind-spot analysis; at least two distinct
architectures for a lightweight Node/SQLite runtime, contrasted on overhead,
state complexity, fault tolerance and solo maintainability; and a comprehensive
end-to-end implementation blueprint with data models, state transitions, the
listener lifecycle, the voice lifecycle, and a failure-mode taxonomy.

---

## Where the implementation departed from this document

Recorded here rather than edited above, so the specification stays as received.

**Scope.** Parts 3 and 4 were built; Part 5 and 6 were specified only
([ADR-002](../adr/ADR-002-voice-agent-contract.md)). Part 3 was further split:
bind-and-observe shipped enabled, propose-and-execute ships behind a per-household
flag until a shadow period produces a precision number.

**Part 6 is not built first-party.** A vendor carries the media plane; FamiliOS
owns archetypes, compilation, the validation gate, the authorized value set,
termination and typed outcomes. The Part 6 requirements became a vendor
scorecard. Reasoning in ADR-002.

**Part 3's silence rule was not sufficient.** As specified it protects outsiders
from learning a household exists. It says nothing about recording them, and the
bridge is one Apple ID for every household. The durable transcript was narrowed
to household members only, a bind-time announcement was added, and revocation
was opened to anyone in the thread.

**Part 3's "one Apple ID" premise limits the feature.** Chat GUIDs are
deployment-global, so a cross-household bind is refused outright rather than
resolved. Unsettled; see GROUP_CHAT_2026-09-20.md.

**Part 4's transcript audit was narrowed.** It may close a loop and may never
report completion. Only a calendar record is ever relayed to another person.

**Part 2's zero-retention claim is a procurement question, not a code one.** The
provider rows ship; the guarantee depends on the contract with whichever
provider a deployment configures, and is not asserted by the software.
