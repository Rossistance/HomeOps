# HomeOps Calendar Jam Investigation and Engineering Bug Ticket

**Jam:** `https://jam.dev/c/7b44f45c-982c-4b50-8172-619c6b951934`  
**Recorded environment:** iPhone 13 Pro Max, iOS 27.0, 428×926 viewport  
**Recording duration:** 16 minutes, 6 seconds  
**Application surfaces:** HomeOps Expo iOS app, HomeOps backend on Render, Google Calendar synchronization, calendar agenda/month views

---

## Investigation Result

The Jam contains **four related issue clusters**, not one isolated defect:

| Cluster | Severity | What failed |
|---|---:|---|
| Event lifecycle and state refresh | High | Newly created events sometimes do not appear in the agenda immediately, with no clear success or failure state. |
| Google Calendar synchronization | High | Deleting an event locally does not delete its Google counterpart; the next sync restores the event. All-day date boundaries are also inconsistent. |
| Mobile event-editor usability | High | The keyboard obscures fields, focused inputs are not scrolled into view, and long titles or addresses cannot be read or navigated properly. |
| Calendar information architecture | Medium | Event cards truncate important details, source-account information is unclear, subscriptions are buried, and location/map actions are missing. |

The known HomeOps architecture uses a React/Vite/Zustand web application, a Node backend, and an Expo SDK 56 mobile client sharing server-owned event and Google Calendar functionality. That makes the most likely failure boundaries the Expo client state layer, the event API, and the Google Calendar synchronization service.

---

# What Went Wrong and Why

## 1. Created events are not deterministically reflected in the calendar

The user successfully completes the creation flow but returns to the agenda and cannot find the event. Navigation and manual sync do not provide a reliable answer.

The likely cause is one of these paths:

- The create request succeeds, but the Expo client neither inserts the canonical returned event into its Zustand/query state nor invalidates and refetches the visible date range.
- The create request fails, but the editor closes without surfacing the failure.

Either path has the same underlying reliability problem:

> The interface transitions to a success-looking state before confirmed server persistence and calendar reconciliation.

## 2. Google-backed events are deleted only from the household copy

The recording shows an event deleted in HomeOps, followed by a sync that restores it from Google.

This establishes the failure boundary with high confidence:

> The remote Google event remains authoritative after the HomeOps deletion.

The exact code fault is probably one of:

- The local delete route never invokes Google Calendar deletion.
- The event no longer carries its `externalEventId`, calendar ID, or connected account ID when deleted.
- The remote delete fails, but the local record is removed and the error is suppressed.
- No deletion tombstone prevents the next import from recreating the event.

## 3. All-day date semantics are inconsistent

An anniversary appears across two days when the UI suggests a one-day event. Google represents an all-day event with an **exclusive end date**. The app is likely treating the same end date as inclusive somewhere in import, storage, editing, or rendering.

For example, a one-day Google all-day event on July 23 can be represented as:

```text
start.date = 2026-07-23
end.date   = 2026-07-24
```

HomeOps must convert that boundary exactly once and consistently.

## 4. The event editor is not keyboard-aware

The recording shows fields hidden behind the iOS keyboard, no automatic scroll to the focused field, inconvenient transitions between fields, and content that cannot be inspected while typing.

Likely component-level causes include:

- A regular `ScrollView` or modal without effective keyboard avoidance.
- No `scrollToFocusedInput` behavior.
- Fixed-height or single-line `TextInput` configuration for titles and addresses.
- Missing `returnKeyType`, `blurOnSubmit`, and next-field focus handling.
- Editor draft state stored only in component state and reset on unmount.

## 5. Event drafts are discarded too easily

The user enters event information, leaves the editor without saving, and expects the incomplete event to remain available. Instead, the draft disappears.

An unsaved event draft should remain available until:

- the event is saved successfully; or
- the user explicitly chooses **Discard draft**.

## 6. The product communicates synchronization state ambiguously

“Save & update Google,” “Also add to my Google Calendar,” source-account attribution, approval language, and sync status do not clearly distinguish:

- saved locally;
- queued for Google;
- synchronized;
- synchronization failed;
- imported from Google;
- pending deletion;
- deletion failed; or
- disconnected from Google.

That ambiguity magnifies every lifecycle defect because the user cannot tell which system contains the authoritative event.

---

# Customer Experience and Impact

The user cannot confidently answer basic questions such as:

- Did my event save?
- Was it added to Google?
- Did deletion remove it everywhere?
- Why did it return?
- Which Google account owns it?
- Is this one all-day event or a two-day event?

For a family operations product, this is a **trust and data-integrity problem**, not merely visual polish. It can create resurrected events, conflicting schedules, duplicate reminders, missed activities, and accidental reliance on stale information. The mobile form problems also increase abandonment and incorrect data entry because users cannot see or review what they typed.

---

# Root-Cause Confidence

| Finding | Confidence | Evidence status |
|---|---:|---|
| Remote Google deletion is absent, failed, or ignored | High | The event reappears after synchronization, proving the remote copy remained. |
| Client calendar state is stale after event creation | Medium-high | The event editor closes but the visible date range is not reconciled. A failed request cannot be excluded without network logs. |
| Mobile inputs are configured inside a non-keyboard-aware form | High | Multiple fields are visibly obscured and long text cannot be navigated. |
| All-day end date is being interpreted inconsistently | Medium-high | The observed two-day span is characteristic of an inclusive/exclusive boundary mismatch. |
| Draft editor state is discarded on dismissal | High | Unsaved content disappears when leaving and reopening the editor. |

The Jam’s processed console, interaction, and network endpoints did not return their underlying streams through the connector. These are therefore **trace-grounded behavioral root causes**, but not yet line-of-code confirmations.

---

# Engineering-Ready Bug Ticket

## Title

**Calendar event lifecycle, Google synchronization, and mobile editor reliability**

## Classification

- **Type:** Bug / data-integrity defect cluster
- **Priority:** P1 — High
- **Affected surfaces:** Expo iOS application, calendar event API, Google Calendar synchronization, agenda/month views
- **Source:** Jam `7b44f45c-982c-4b50-8172-619c6b951934`
- **Environment:** Real iPhone 13 Pro Max, iOS 27.0, 428×926 viewport
- **User impact:** Users cannot reliably create, locate, edit, synchronize, or delete calendar events.

## Problem Statement

The calendar workflow presents successful-looking UI transitions without guaranteeing that local state, server state, and Google Calendar state agree.

During the recorded session:

1. A newly created event did not consistently appear in the agenda.
2. An event deleted from HomeOps remained in Google Calendar and was restored during the next synchronization.
3. A one-day all-day event appeared to span two dates.
4. Long titles and addresses did not wrap or remain inspectable.
5. The iOS keyboard obscured lower fields and the form did not scroll focused controls into view.
6. Unsaved event drafts were discarded when the editor was dismissed.
7. Google account ownership and synchronization status were unclear.

## Expected Behavior

A calendar mutation must have one authoritative, observable lifecycle:

```text
editing → saving → saved locally → synchronizing externally → synchronized
```

Or:

```text
editing → saving → failed
```

On failure, the editor and draft must remain available.

After creation, the returned canonical event must immediately appear in every relevant local view. After deletion of a Google-linked event, both HomeOps and Google must reflect the deletion, or HomeOps must clearly retain a pending/failed state and prevent remote reimport.

## Actual Behavior

- The editor can close without the new event appearing.
- No actionable failure message explains whether persistence failed.
- Local deletion can remove only the HomeOps copy.
- Google synchronization subsequently recreates the supposedly deleted event.
- All-day dates can render across an extra day.
- Mobile inputs become hidden or unreadable while editing.
- Draft state is lost when the editor is dismissed.

---

# Clean Reproduction Steps

## Reproduction A — Created event does not appear

1. Open **Calendar → Agenda**.
2. Tap **Add event**.
3. Enter a title.
4. Enable **All-day**.
5. Set the start and end date to the same date.
6. Complete the add/save action.
7. Return to that date in the agenda.
8. Navigate away and back or initiate synchronization.

**Actual:** The event may not appear, and no failure state is displayed.  
**Expected:** The event appears immediately after the server confirms creation.

## Reproduction B — Google-linked deletion is reversed

1. Create or open an event linked to Google Calendar.
2. Confirm that the event has a connected account and remote synchronization state.
3. Tap **Delete event**.
4. Confirm deletion.
5. Trigger Google synchronization.

**Actual:** The event is removed locally but returns after synchronization.  
**Expected:** The Google event is deleted as part of the operation, or the local event remains visibly pending until remote deletion succeeds.

## Reproduction C — Long title is inaccessible

1. Tap **Add event**.
2. Enter a title similar to:

   > Here is the long title again to test text wrapping formatting and alignment.

3. Attempt to review the beginning and end of the title.
4. Save and inspect the event card and detail view.

**Actual:** The title does not wrap correctly and cannot be reliably scrolled or reviewed.  
**Expected:** The title grows to multiple lines within a reasonable limit and remains fully reviewable.

## Reproduction D — Keyboard obscures event fields

1. Open an event editor.
2. Focus **Location** and enter a long address.
3. Focus **Notes**.
4. Attempt to continue to **What to bring** without dismissing the keyboard.
5. Try to inspect all text in each field.

**Actual:** Fields are hidden by the keyboard, focus does not scroll the field into view, and long values are difficult or impossible to inspect.  
**Expected:** The editor scrolls the focused field above the keyboard and supports predictable Next/Done navigation.

## Reproduction E — Unsaved draft disappears

1. Open **Add event**.
2. Enter a title and other information.
3. Dismiss or navigate away without saving.
4. Reopen the event editor.

**Actual:** The entered draft is gone.  
**Expected:** The draft is restored until explicitly discarded or successfully saved.

## Reproduction F — All-day event spans an extra date

1. Open or import a one-day all-day Google event.
2. Inspect its start and end date in HomeOps.
3. Inspect the event in the agenda.

**Actual:** The event may display on two dates.  
**Expected:** A Google all-day event with an exclusive next-day end boundary displays as one day.

---

# Root-Cause Hypotheses to Verify

## H1 — Mutation result is not reconciled with client state

Inspect the mobile event-create mutation and determine whether it:

- awaits the server response;
- validates the response;
- upserts the returned canonical event;
- invalidates all affected date-range queries;
- updates agenda and month stores;
- keeps the editor open when the request fails; and
- preserves the draft on failure.

## H2 — Remote-delete metadata or execution is missing

Trace the deletion path through:

```text
Expo editor
→ mobile API client
→ event delete route
→ event repository
→ Google connector
→ synchronization importer
```

Verify propagation of:

- local event ID;
- external Google event ID;
- Google calendar ID;
- connector/account ID;
- household ID;
- deletion status;
- remote response; and
- retry state.

## H3 — No durable deletion tombstone exists

Determine whether synchronization can distinguish:

- a new remote event;
- a locally deleted remote event awaiting deletion;
- a remote deletion that failed;
- a deliberately disconnected local copy; and
- an event that should not be reimported.

A deleted Google-linked event must not be silently recreated while a deletion operation is pending or failed.

## H4 — All-day date normalization is split across layers

Establish one shared rule:

- UI represents the dates the user sees.
- Google all-day `end.date` is exclusive.
- Internal storage either uses exclusive end consistently or converts only at connector boundaries.
- Agenda rendering must never apply the conversion a second time.

## H5 — Event editor uses fixed or single-line input behavior

Inspect title, location, notes, and list-entry controls for:

- `multiline`;
- dynamic height;
- wrapping;
- internal scrolling;
- keyboard avoidance;
- scroll-to-focused-input behavior;
- Next/Done focus management; and
- safe-area insets.

---

# Required Implementation Changes

## 1. Create/update transaction

- Keep the editor open while saving.
- Disable duplicate submission.
- Treat non-2xx responses and malformed payloads as failures.
- Upsert the server-returned event into client state.
- Invalidate/refetch all agenda and month ranges containing the event.
- Show a persistent success or failure result.
- Preserve the draft on failure.

## 2. Google synchronization state machine

Add explicit states such as:

```text
local_only
sync_pending
synced
sync_failed
delete_pending
delete_failed
```

The interface must display the connected account and current state instead of inferring success from button wording.

## 3. Remote deletion

For Google-linked events:

1. Mark the local event `delete_pending`.
2. Invoke Google Calendar deletion with the correct account, calendar, and event IDs.
3. Record the remote response.
4. Finalize or tombstone the local event only after success.
5. On failure, retain a visible recoverable record.
6. Prevent normal imports from recreating an event with an active deletion tombstone.

## 4. Shared all-day normalization

Create one shared conversion utility and use it in import, export, editor initialization, and rendering. Add round-trip tests covering Google’s exclusive end date.

## 5. Keyboard-aware mobile editor

- Use a keyboard-aware scrolling container.
- Scroll focused inputs above the keyboard.
- Make the title multiline with dynamic height and a sensible maximum.
- Make long location values reviewable.
- Configure Next/Done actions and refs between fields.
- Include bottom safe-area and keyboard padding.
- Keep save/delete actions accessible without hiding form content.

## 6. Draft persistence

Persist the active draft by household and draft/event ID. Clear it only after:

- confirmed successful save; or
- explicit **Discard draft** confirmation.

## 7. Information hierarchy

- Display calendar source/account on imported or synchronized events.
- Replace ambiguous sync copy with explicit status.
- Move subscriptions into a compact expandable control near synchronization settings.
- Allow event cards to expose essential information without opening the full editor.
- Make locations actionable through Apple Maps and Google Maps deep links.
- Increase the visibility and accessibility labels of metadata icons.

---

# Required Automated Tests

| ID | Test |
|---|---|
| CAL-001 | Successful create returns a canonical event and immediately inserts it into the active agenda. |
| CAL-002 | Create failure leaves the editor open, preserves the draft, and displays the server error. |
| CAL-003 | Successful update refreshes agenda, month, and event-detail state without manual synchronization. |
| CAL-004 | Google-linked deletion sends the correct external event, account, and calendar identifiers. |
| CAL-005 | Failed remote deletion leaves a visible `delete_failed` state and does not report success. |
| CAL-006 | A sync cannot reimport an event with an active deletion tombstone. |
| CAL-007 | Successful remote deletion removes the event locally and remotely. |
| CAL-008 | A one-day Google all-day event round-trips without becoming a two-day event. |
| CAL-009 | Timed events retain timezone and daylight-saving boundaries through round-trip conversion. |
| CAL-010 | Long titles wrap and remain readable in editor, detail, agenda, and month views. |
| CAL-011 | Focusing each lower form field scrolls it above the iOS keyboard. |
| CAL-012 | Next/Done keyboard actions advance or dismiss predictably. |
| CAL-013 | Draft content survives editor dismissal and app foreground/background transitions. |
| CAL-014 | Draft content clears after confirmed save or explicit discard. |
| CAL-015 | Sync status and source account are accessible to VoiceOver and visually identifiable. |

---

# Observability Requirements

Add one correlation ID across the complete mutation path.

For every create, update, delete, and synchronization operation, log:

- operation type;
- local event ID;
- external event ID when present;
- household ID;
- connector/account ID;
- request start and completion;
- local persistence result;
- remote Google result;
- client reconciliation result;
- retry or terminal failure state.

Do not log event descriptions, addresses, notes, tokens, or other private calendar content.

---

# Acceptance Criteria

- A successfully created event appears immediately without navigation or manual refresh.
- A failed create cannot look successful.
- Deleting a synchronized event cannot result in silent resurrection.
- Remote failures are visible and recoverable.
- One-day all-day events display on exactly one day.
- Long titles and locations remain readable and editable.
- Every event-editor field can be reached while the keyboard remains open.
- Unsaved drafts survive accidental dismissal.
- Source account and synchronization state are unambiguous.
- Backend, mobile, and synchronization tests pass.
- The fix is validated on an iPhone 13 Pro Max-sized viewport and at least one smaller iPhone viewport.

---

# Issue Grouping

Only one Jam link was supplied, so there is no cross-Jam deduplication set yet. Within this recording, the issues should be grouped as:

## 1. Calendar data integrity

- Event absent after creation
- Remote deletion not propagated
- Deleted event restored by sync
- All-day boundary mismatch

## 2. Mobile event-editor interaction

- Keyboard occlusion
- No focused-field scrolling
- Long text not wrapping or navigable
- Draft loss

## 3. Calendar synchronization comprehension

- Source account unclear
- Button wording does not represent actual state
- Remote/local ownership unclear

## 4. Calendar readability and navigation

- Truncated cards and addresses
- Small metadata icons
- Subscriptions buried at the bottom
- Missing maps and location suggestions
- Missing stronger week separation

---

# Repository and Deployment Inspection Boundary

The connected GitHub account was `Rossistance`, but the active GitHub app installation exposed only three Symphony repositories. The HomeOps repository was not available through that installation.

Consequently, this investigation could not map the findings to confirmed filenames, commits, functions, or pull requests.

The Render service/log connector and Expo/TestFlight build records were also not exposed in the active session. Therefore:

- no Render runtime logs or environment variables were verified;
- no EAS build or TestFlight build number was inspected;
- no code-level fix was applied;
- no HomeOps GitHub issue was created; and
- no line-of-code root cause was claimed.

The first implementation step should be to expose the HomeOps repository to the connected GitHub app and correlate the Jam’s mutation sequence with Render request logs before changing code.

After backend changes, restart the HomeOps Node server rather than relying on frontend hot module replacement, and verify that the expected processes are serving the current code before trusting validation results.

---

# Recommended Delivery Sequence

1. Expose the HomeOps repository to the connected GitHub installation.
2. Identify the exact TestFlight build and Render deployment used during the Jam.
3. Correlate event create/delete timestamps with Render logs.
4. Add structured tracing across mobile, API, repository, and Google connector boundaries.
5. Reproduce the create, delete, and all-day failures.
6. Add failing automated tests before changing implementation.
7. Fix local mutation reconciliation.
8. Implement durable Google deletion state and tombstones.
9. Centralize all-day normalization.
10. Refactor the mobile editor for keyboard-aware behavior.
11. Add draft persistence.
12. Improve synchronization status and source-account UI.
13. Run backend, mobile, integration, and visual tests.
14. Deploy the backend to Render.
15. Build and distribute the corrected Expo/TestFlight version.
16. Repeat the original Jam steps and verify every acceptance criterion.

---

# Final Assessment

The recording does not show a single cosmetic calendar defect. It shows a connected reliability problem spanning:

- mobile form behavior;
- client-side state reconciliation;
- backend event persistence;
- Google Calendar mutation semantics;
- synchronization conflict handling; and
- user-facing status communication.

The highest-priority fix is to make calendar mutations transactional and observable across HomeOps and Google Calendar.

A user should never be left wondering whether an event was created, synchronized, deleted, restored, lost, or still waiting for action.
