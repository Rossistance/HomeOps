# ADR-002: Voice agents — vendor media plane, first-party prompt compilation

**Status:** Accepted · 2026-09-20
**Scope:** The contract only. No telephony ships in this milestone.
**Related:** [VOICE_ARCHETYPES.md](../VOICE_ARCHETYPES.md) · [specs/2026-09-20-milestone-spec.md](../specs/2026-09-20-milestone-spec.md)

## Context

FamiliOS should be able to make a phone call on a household's behalf: book the
dentist, confirm a plumber's call-out fee, check whether the pharmacy actually
has the thing in stock. Roughly eighty such scenarios were catalogued.

The specification that prompted this ADR described a benchmark-grade realtime
pipeline built first-party: audio telemetry sampled every 0.1s, a 5-second
processing-backlog tripwire, a circular buffer replayed into a backup ASR
provider mid-call, and parallel LLM requests raced across geographically
separate deployments.

That is a realistic description of what production voice needs. It is also a
full-time realtime-audio engineering project — WebSocket transport, codec
negotiation, jitter, backpressure, endpointing — with no relationship to family
logistics, inside a runtime whose distinguishing feature is that its HTTP layer
has no framework and its store has no dependencies.

## Decision

**A vendor carries the media plane. FamiliOS owns everything above it.**

| FamiliOS owns (first-party, in `server/`) | Vendor carries |
|---|---|
| Archetype storage and versioning | Media transport, codecs, jitter |
| JIT prompt compilation from archetype + context + vault values | ASR, TTS, barge-in, endpointing |
| The extraction schema and its validation gate | IVR/DTMF emission, hold detection |
| The termination mandate | Turn-taking latency |
| Typed call outcomes and the transcript record | Provider-internal failover |
| Consent, authorization, the pre-dial authorized value set | — |

The Part 6 requirements from the source specification become a **vendor
scorecard** rather than a build list: measured p50/p95 turn latency, documented
failover behaviour, DTMF support, hold and IVR detection, per-minute cost, and
whether audio and transcripts can be retained under the household's setting.

## Why not first-party

Three of the specification's own requirements are the argument against building
it, because each is harder than it reads:

1. **The circular buffer is where audio is lost, not where it is saved.**
   Replaying unconfirmed audio into a backup provider needs transcoding
   (providers differ on sample rate and on μ-law versus PCM16, and a naive byte
   replay is noise), a resolution for the race between the confirmation token
   and the failover decision (or the tail arrives twice and the model answers
   twice), and a hard byte cap with an explicit typed drop for a provider that
   accepts audio and never confirms.
2. **The 20-second warm-up window is a second outage in disguise.** Suppressing
   alarms while a backup stabilises means a backup that is *also* failing is
   invisible for twenty seconds. The window should suppress failover, not
   observation, and a call-level timeout must sit outside it.
3. **Racing costs N times the tokens, every turn.** Aborting a stream does not
   reliably stop server-side generation, so cancellation is best-effort as far
   as billing is concerned, and N sockets per turn per call is a real
   file-descriptor ceiling. Racing belongs on the first turn, where latency is
   most visible and context smallest; later turns hedge on a timer.

None of these are reasons the requirements are wrong. They are reasons to buy
the layer that has already solved them.

## Consequences

**Good.** The differentiating work — archetypes, compilation, the validation
gate, grounded pre-dial values, typed outcomes — is the part FamiliOS is
actually better placed to do, and it is portable. The vendor is a replaceable
component rather than an architecture.

**Bad.** Audio leaves the house. That is a real cost against the privacy story
and it is stated plainly rather than argued away: the household's *data* stays
in its own database, but a phone call does not.

**Accepted risk.** Vendor lock-in on the media plane, mitigated by keeping the
typed-outcome vocabulary and the archetype format independent of any vendor's
schema.

## The compile-and-validate loop

1. Resolve archetype, caller context, and the **authorized value set** from the
   vault — before dialing, so no live call waits on a decrypt.
2. The dense tier synthesises an ephemeral system prompt and an extraction
   schema.
3. **The validation gate** parses the compiled payload and rejects the call,
   without dialing, when: the schema is malformed; a required field has no type;
   the termination mandate is absent; the prompt references a value outside the
   authorized set; or the prompt exceeds its size bound. A rejected compile is
   `compile_rejected` and names the failing rule. It is never a best-effort dial.
4. Only a validated payload reaches the vendor.

The authorized value set is the security boundary. A receptionist asking for
something outside it gets an honest "I don't have that with me" and the field is
recorded as `refused_by_policy`, never guessed.

## Termination

Every compiled prompt ends with a non-negotiable clause: once each schema field
is gathered or definitively refused, speak one closing sentence and hang up.

Enforced **twice** — in the prompt, and as a hard wall-clock cap FamiliOS
applies independently — because the failure being prevented is precisely a model
not following its prompt.

## Typed outcomes

A call ends in exactly one recorded outcome, never a summary paragraph:

`completed` · `partially_completed` (with the gaps named) · `counterparty_refused_ai` ·
`no_answer` · `voicemail` · `ivr_dead_end` · `hold_timeout` · `disconnected` ·
`compile_rejected` · `policy_blocked` · `provider_unavailable`

These map onto the existing run-step vocabulary, so a call is an ordinary step
in a run, approval-gated like any other action that reaches outside.

## Disclosure and recording

**Recording and transcript retention are a per-household setting, defaulting to
transcript-only, no audio.**

**Disclosure posture: identify as an assistant when asked.** This is the
household owner's decision, recorded as such. It is implemented as one prompt
fragment plus one `disclosure` field on the archetype, so the posture is one
line to change rather than a refactor.

**The trigger to flip it to proactive disclosure**, named in advance so nobody
has to relitigate it under pressure: counsel confirming an in-force obligation
(see PENDING below), a vendor requiring it, or the first
`counterparty_refused_ai` outcome that cites undisclosed automation.

**The decider is the household Owner**, through the same setting.

**PENDING:** the in-force status and applicability of AI-disclosure obligations
(EU AI Act Article 50) and US two-party-consent recording rules. This is a
question for counsel, not for this document, and it is recorded as open rather
than answered from memory. The design isolates the posture so the answer changes
one line.
