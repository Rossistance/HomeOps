# ELEMENT-MAP — apps/mobile (derived from source, top-gun-ios preflight step 4)

Derivation: grep of `testID` / `accessibilityLabel` across `apps/mobile/src` on 2026-07-19 (HEAD ffcfa33).
**Finding: zero `testID`s exist anywhere in the app.** All locators below are accessibility-id fallbacks populated from `accessibilityLabel` (React Native → XCUITest accessible name). Per top-gun-ios locator policy: accessibility id first, then `-ios predicate string` on label/visible text; never absolute XPath. A work package to add `testID`s to high-traffic elements is warranted (recorded as WP-007 slice / OPP).

Not confirmed against a live session (Appium/Appetize blocked — see preflight); map is source-derived for future harness value.

## Tab bar (visible text, (home)/_layout + app/_layout)
| Screen | Locator strategy |
|---|---|
| Today / Ask / Agents / Library / Settings | predicate `label == "<Tab>" AND type == "XCUIElementTypeButton"` |

## Event form — (home)/event-form.tsx
| Element | accessibilityLabel |
|---|---|
| Title input | `Event title` |
| Scheduled switch | `Event has a date and time` |
| Date/time pickers (non-iOS dialog) | `` `${label}: ${text}. Change` `` (iOS uses native @expo/ui compact picker — no RN label) |
| Remove end time | `Remove end time` |
| Add end time | `Add end time` |
| Location input | `Event location` |
| Bring chip remove | `` `Remove ${item}` `` |
| Bring input | `Add items to bring, comma-separated` |
| Buttons | Button component sets accessibilityLabel=title: `Save changes` / `Add event` / `Update in Google` / `Push to Google` / `Delete event` / `Approve & push` / `Deny` |

## Home / help loop — (home)/index.tsx, grandparent.tsx, help.tsx
| Element | Label |
|---|---|
| Accept help (adult home) | `Accept` (Button title) |
| Accept help (grandparent) | `I can help` / `Yes, thank you` |
| Decline (grandparent) | `Can't this time` / `Maybe not now`; decline note input `Decline note` |
| Ask/Offer toggle (help.tsx) | `Ask for help` / `Offer help` |
| Person chip | `` `Ask ${name}` `` / `` `Help ${name}` `` |
| Link event row | `` `Link ${title}` `` ; task row `` `Link task ${title}` `` |
| Message input | `Help request message` |
| Grandparent header | `My profile`, `Switch profile`, `Ask or offer help` |

## Library / upload — (library)/index.tsx, sheets/upload-sheet.tsx
| Element | Label |
|---|---|
| Upload button | `Upload` |
| New knowledge | `New knowledge` |
| Search input | `Search files by name or type` |
| Space card | `` `${label}, ${count} files` `` |
| File row | `` `${name}, ${size}, open/close preview` `` |
| Upload sheet name input | `File name` |
| Remove picked page | `` `Remove ${label ?? "file"}` `` |
| Sheet CTA | `Upload & file` (Button title) |

## Tasks — (settings)/tasks.tsx
| Element | Label |
|---|---|
| Row (long-press only) | `` `${t.title}` `` |
| Checkbox | `Mark as done` / `Mark as open` |
| New task input | `New task title` |
| Done section | `` `Completed, ${n} tasks` `` |

## Ask — (ask)/index.tsx
`New chat`, `` `${label} space` ``, `Run in progress — tap to view`, suggestion chips (=text), `Attach a file`, `Message`, `Send`, `` `Remove attachment ${name}` ``.

## Auth — components/Lock.tsx
Profile row: `` `Sign in as ${name}, ${role}${", PIN required"?}` ``; PIN input `Household PIN`.

Settings/Connections/Meals/AI/Contacts/Agents surfaces carry labels throughout (see grep, 80+ labeled elements) — coverage is good for label-based automation; stability would improve with explicit testIDs.
