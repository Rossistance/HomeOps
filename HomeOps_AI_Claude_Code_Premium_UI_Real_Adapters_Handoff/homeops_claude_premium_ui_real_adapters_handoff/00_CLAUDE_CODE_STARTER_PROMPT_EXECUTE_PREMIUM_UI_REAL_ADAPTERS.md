# Starter Prompt for Claude Code

You are working in the existing HomeOps AI repository. Execute this handoff as a full rescue build.

The current Claude-built app is below the visual quality bar and still lands mock/demo adapter behavior. Treat the existing UI as an implementation draft, not as a design direction. Treat the existing demo adapter system as a failed baseline, not as an acceptable architecture.

Read and follow all handoff files in this package, especially:

- `CLAUDE.md`
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

## Required build behavior

Before editing files, inspect the repository and produce a concise internal plan. Then implement.

Do not ask for approval to perform the work unless blocked by missing repository files.

Do not write a report instead of changing the app.

Do not spend the first phase creating tests. Development comes first. Tests and validation happen after the implementation is complete.

## Two mandatory transformations

### 1. Premium family operating system UI

Redesign the current product so it feels like a premium family operating system, not a generic admin dashboard. The new UI must be intentionally designed, emotionally polished, information-rich, responsive, and credible as a modern personal productivity/family coordination/AI assistant app.

### 2. Real connector infrastructure

Remove all simulated adapter behavior. Build real connector infrastructure with configured/unconfigured states. If credentials or backend execution are required, build the backend boundary and configuration surfaces. Do not fake success.

## Completion rule

You may not claim success until all loopback gates in `11_SUCCESS_CRITERIA_AND_LOOPBACK_AUDIT_GATES.md` pass. If any gate fails, return to implementation mode.
