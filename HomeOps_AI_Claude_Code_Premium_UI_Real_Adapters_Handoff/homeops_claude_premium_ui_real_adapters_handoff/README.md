# HomeOps AI — Claude Code Premium UI + Real Adapter Rescue Handoff

This package is a second-stage Claude Code handoff for the more-developed Claude-built HomeOps AI app.

It is not a feature polish pass. It is a hard rescue directive.

The current app is considered below the visual quality bar and still contains demo/mock adapter behavior. Claude Code must rebuild the product so it feels like a premium family operating system and convert the adapter system from simulated demo connectors into real connector infrastructure.

## Primary objective

Turn the current HomeOps AI app into a premium, believable, modern family operating system that could plausibly compete with personal productivity, family coordination, and AI assistant products.

## Non-negotiables

1. The current UI is not acceptable as a baseline.
2. Do not merely restyle existing cards.
3. Design the experience intentionally from the product model outward.
4. Remove demo/mock/simulated adapter language and behavior.
5. Implement real adapter infrastructure.
6. If a real provider cannot be used without credentials, show a real unconfigured connector state, not a fake working connector.
7. Add backend/runtime infrastructure where required for real integrations.
8. Do not focus on test creation until development is complete.
9. After development is complete, run the validation/audit gates.
10. If any gate fails, loop back into implementation mode.

## Use in Claude Code

Copy `CLAUDE.md` into the repository root or merge it with the existing project instructions.

Start Claude Code with:

`00_CLAUDE_CODE_STARTER_PROMPT_EXECUTE_PREMIUM_UI_REAL_ADAPTERS.md`

Then provide the remaining files as project references.

## Package contents

- `CLAUDE.md`
- `00_CLAUDE_CODE_STARTER_PROMPT_EXECUTE_PREMIUM_UI_REAL_ADAPTERS.md`
- `01_MASTER_RESCUE_BUILD_PROMPT.md`
- `02_CURRENT_CLAUDE_BUILD_AUDIT.md`
- `03_PREMIUM_FAMILY_OS_PRODUCT_AND_UI_DIRECTION.md`
- `04_SCREEN_BY_SCREEN_REDESIGN_SPEC.md`
- `05_DESIGN_SYSTEM_AND_VISUAL_QUALITY_BAR.md`
- `06_REAL_ADAPTER_MANDATE_NO_MOCKS_POLICY.md`
- `07_CONNECTOR_INFRASTRUCTURE_ARCHITECTURE.md`
- `08_TOOL_TRIGGER_APPROVAL_EXECUTION_ENGINE.md`
- `09_BACKEND_AUTH_SECRETS_BROWSER_AUTOMATION_BOUNDARIES.md`
- `10_IMPLEMENTATION_SEQUENCE_CLAUDE_CODE.md`
- `11_SUCCESS_CRITERIA_AND_LOOPBACK_AUDIT_GATES.md`
- `12_VISUAL_QA_AND_SCREENSHOT_AUDIT.md`
- `13_FINAL_HANDOFF_REPORT_TEMPLATE.md`
- `14_SOURCE_CONTEXT_AND_REFERENCES.md`
- `handoff_manifest.json`

## Source package inspection summary

Uploaded package inspected: `home ops claude.zip`.

Build result after installing dependencies: `npm run build` succeeded.

Critical issue: the app still declares demo mode and demo adapters throughout product copy, seed data, connector flows, and README. This handoff treats that as a blocking failure.
