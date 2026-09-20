# Voice archetypes — five, not eighty

**Status:** Contract, not code. Nothing here ships until the telephony milestone.
**Decision:** [adr/ADR-002-voice-agent-contract.md](adr/ADR-002-voice-agent-contract.md)

## Why five

The source specification catalogued roughly eighty phone scenarios: plumbers,
HVAC, roofing, pest control, pediatric check-ups, orthodontists, vets, tutors,
pharmacies, bakeries, dry cleaners, the DMV, the cable company.

Eighty prompt files is eighty things to keep true. They drift, they disagree
with each other about how to handle hold music, and the ninth one someone adds
copies the bugs of the third.

Read for their *shape* rather than their subject, the eighty collapse into
five. A plumber quoting a call-out fee and an appliance repair shop quoting a
diagnostic fee are the same conversation. So are booking a dentist and booking a
dog groomer. What differs between them is context: a name, a date, a part
number, a symptom. Context is an argument, not a variant.

## The five

### 1. Diagnostic dispatch
Describe a fault, establish availability and the call-out or diagnostic fee,
book a visit.

*Covers:* plumbing, HVAC, electrical, appliance repair, garage doors, septic,
locksmithing, chimney.

**Objective:** get someone qualified to the house, and know what it costs before
they arrive.
**Extraction:** `earliestAvailable` (date, required) · `calloutFee` (money,
required) · `feeWaivedIfRepaired` (bool) · `emergencyAvailable` (bool) ·
`bookedSlot` (datetime) · `referenceNumber` (string)
**Friction:** an after-hours line that only takes emergencies; "we'd have to see
it" in place of a fee; a dispatcher who wants an address before quoting.

### 2. Quote gathering
Describe scope, obtain a price basis and a site-visit slot.

*Covers:* roofing, landscaping, cleaning, hauling, fencing, tree work, painting,
pool, solar, window washing, gutters, flooring, moving.

**Objective:** a comparable number, and what it is a number *for*.
**Extraction:** `priceBasis` (enum: flat / hourly / per-unit / site-visit-required,
required) · `quotedAmount` (money) · `siteVisitSlot` (datetime) ·
`quoteValidDays` (int) · `includesMaterials` (bool)
**Friction:** a price that turns out to exclude materials; "starting from"
pricing; a quote that needs photographs.

### 3. Appointment scheduling
A named person, a named service, a preferred window.

*Covers:* medical, dental, optometry, orthodontics, veterinary, grooming,
tutoring, music lessons, salons, camps, sports registration.

**Objective:** a specific slot for a specific person, and what to bring.
**Extraction:** `bookedSlot` (datetime, required) · `patientOrClient` (string,
required) · `arriveEarlyMinutes` (int) · `bringItems` (string[]) ·
`cancellationPolicy` (string) · `newClientPaperwork` (bool)
**Friction:** a receptionist asking for identity data (see the value set below);
"we can put you on the waitlist"; a practice that takes bookings only online.

### 4. Inventory verification
Confirm a specific item is physically on a shelf, and hold it.

*Covers:* pharmacy, hardware, retail, nurseries, butchers, bakeries, sporting
goods, bike and phone repair parts.

**Objective:** do not drive across town for nothing.
**Extraction:** `inStock` (bool, required) · `quantityAvailable` (int) ·
`heldUntil` (datetime) · `substituteOffered` (string) · `price` (money)
**Friction:** "the computer says two but let me look"; a hold policy that is
really a reservation fee; an item that exists in another branch.

### 5. Queue navigation
Traverse an automated menu to a human, state a reference, obtain a status.

*Covers:* utilities, telecoms, municipal waste, airlines, government services,
delivery and freight.

**Objective:** reach a person, then get one fact.
**Extraction:** `reachedHuman` (bool, required) · `statusSummary` (string,
required) · `referenceNumber` (string) · `estimatedResolution` (date) ·
`callbackOffered` (bool)
**Friction:** a menu that loops; hold music indistinguishable from speech; a
callback offer that ends the call.

## What an archetype record holds

```
{ id, version,
  objective,              // one sentence, the thing the call is FOR
  guidance,               // tactics: how to open, when to stop pushing
  frictionHandlers: [ { situation, response } ],
  extractionSchema: [ { field, type, required, description } ],
  termination,            // the mandate, verbatim and non-negotiable
  disclosure }            // the posture fragment; see ADR-002
```

**Scenario-specific detail is never stored here.** A part number, a child's
name, a preferred window, a policy number: all of that arrives as context at
compile time. If a new scenario needs a new archetype, that is evidence the
five are wrong, and the fix is to revisit the five rather than to add a sixth
quietly.

## The authorized value set

The single most important thing on this page.

Before dialing, the compiler resolves an explicit set of values the agent is
permitted to say: a date of birth, a policy number, an address, a card's last
four. The compiled prompt may reference only values in that set, and the
validation gate rejects a prompt that reaches outside it.

A receptionist asking for something that is not in the set gets an honest
"I don't have that with me", and the field is recorded as `refused_by_policy`.

It is resolved **before** the call, not during it, for two reasons. A vault read
plus a database query inside a live conversation is dead air at exactly the
wrong moment. And a value set fixed in advance is auditable: what the agent
*could* have said is a record, not a reconstruction.

## The termination mandate

> Once every field in your extraction schema has either been gathered or
> definitively refused, say one short closing sentence and end the call. Do not
> offer further help. Do not ask if there is anything else. Do not wait for the
> other person to hang up.

Voice models are bad at ending phone calls. They are agreeable by construction
and a conversation with no task left is exactly the shape that produces endless
pleasantry. This is enforced **twice**: here, and as a hard wall-clock cap
FamiliOS applies on its own, because the failure being prevented is a model not
following its prompt.
