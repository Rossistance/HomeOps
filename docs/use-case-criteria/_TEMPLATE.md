# _TEMPLATE — Use-Case Criteria Doc Format (DEC-003)

This is the canonical per-use-case criteria-doc format used across `docs/use-case-criteria/`.
Copy this structure for any new UC-NN.md. It is connector-decoupled: the doc states the spec
and the test criteria independently of whether the backing connector is active, so any
use-case can be selectively tested later without activating connectors it doesn't need.

```
# UC-NN — <name>
status: inactive | active
catalog_home: workflowTemplate | agentTemplate | skill
trigger: <TriggerType> + <detail>
connectors: [<name>:inactive, ...]
tool_ids: [<exact ids from the row — these are the REAL ids the step chain WOULD use once the connector exists>]
---
> **NOT IMPLEMENTED — connector inactive.** This use-case is a documented spec only. No backing skill and no catalog entry ship for it. Activate the named connector(s), then it can be built and verified against the criteria below.

## Intent (verbatim prompt)
<the source use-case Plain English Prompt, verbatim — copied exactly>

## Tool / step contract
| # | tool_id | action | approval | connector | active? | input keys |
(one row per step in the chain; active? = false for the inactive connector tools; approval = true for any send/write/post/download step)

## Acceptance criteria (observable, testable — no bare "works/fast")
- AC1 … (each a checkable assertion on a concrete result shape that WOULD hold once active)
- (3-6 ACs)

## Test procedure
- Active path (real run, once connector activated): boot local stack, TG- prefixed test data, run the skill, inspect the returned record shape.
- Mock / contract path (available NOW without the connector): assert the step graph + request shape against a stubbed provider api(); NO live connector required. Describe the stub shape.

## Not-verified / blocked
- <exact blocker> — unblock: <exact action: connect connector X / set env Y>
```

Notes:
- The `> **NOT IMPLEMENTED …**` banner is required on every doc for an inactive use-case and must
  be omitted (replaced with a normal status line) once a use-case's connector is activated and a
  real skill/catalog entry ships for it.
- `tool_ids` are always the real, exact ids the implementation would use — never placeholders —
  even while the use-case is inactive, so the doc stays accurate once the connector is wired up.
