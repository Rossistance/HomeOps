# Success Criteria and Loopback Audit Gates

Claude Code may not claim completion until every gate below passes.

If any item fails, return to implementation mode.

## Gate 1 — No mock/simulation gate

Search the user-facing codebase for:

- demo adapter
- demo mode
- mock
- simulated
- fake
- Authorize demo
- Connect demo
- placeholder provider
- future adapter
- `.demo`

Passing criteria:

- No user-facing product copy implies simulated external actions.
- No connector can fake a successful external action.
- Demo seed data no longer pretends to represent real external integrations.
- Documentation may include migration notes, but product UI must not.

If failed: return to implementation mode.

## Gate 2 — Real connector infrastructure gate

Passing criteria:

- Connector registry exists.
- Tool registry exists.
- Trigger registry exists.
- Execution engine exists.
- Approval engine is integrated into tool execution.
- Connector status supports not-configured/configured/auth/error states.
- Tool execution fails honestly when connector is not configured.
- Tool execution logs attempts.
- Write tools require approval.
- Webhook receiver boundary exists.
- OAuth/backend boundary exists.
- Browser automation boundary exists.

If failed: return to implementation mode.

## Gate 3 — Backend/runtime gate

Passing criteria:

- Backend/runtime exists or repository clearly includes a server package.
- OAuth callback boundary exists.
- Secrets abstraction exists.
- Webhook endpoint exists.
- Background job boundary exists.
- Browser automation runtime boundary exists.
- Frontend does not pretend to run server-only integrations.

If failed: return to implementation mode.

## Gate 4 — Premium UI gate

Passing criteria:

- Dashboard no longer looks like a generic card grid.
- App shell looks intentionally designed.
- Navigation is grouped and polished.
- Connections screen feels like a real integration console.
- Agents screen feels like an AI helper command center.
- Approvals/messages feel premium and trustworthy.
- Mobile view feels like a real app.
- Empty/error/configuration states are polished.
- No screen looks like a default Tailwind/Vite dashboard.

If failed: return to implementation mode.

## Gate 5 — Screen completion gate

Every primary screen must be finished:

- Dashboard
- Agents
- Automations
- Connections
- Messages/Approvals
- Files & Knowledge
- Mini Apps
- Household Spaces
- Playbooks
- Activity & Memory
- Settings

Passing criteria:

- Each screen has real purpose.
- Each screen has premium layout.
- Each screen has live data.
- Each screen has meaningful empty/error states.
- Each screen is responsive.
- Each screen avoids demo/mock behavior.

If failed: return to implementation mode.

## Gate 6 — Workflow reality gate

Run through these scenarios:

1. User tries to run an automation requiring unconfigured email connector.
2. App blocks execution and explains setup required.
3. User configures or partially configures a connector.
4. Tool availability changes based on configuration and scopes.
5. User attempts high-risk action.
6. Approval request is created.
7. Approval action is logged.
8. Execution failure/success is logged honestly.
9. Webhook test payload is received by real receiver or blocked if not configured.
10. Browser workflow enters login-required state and does not pretend to complete.

If failed: return to implementation mode.

## Gate 7 — Build validation gate

After development:

- Install dependencies if needed.
- Run typecheck.
- Run build.
- Run lint if available.
- Fix all blocking errors.
- Do not ignore build failures.

If failed: return to implementation mode.

## Gate 8 — Visual screenshot gate

Capture screenshots for:

- Desktop dashboard
- Desktop connections
- Desktop agent detail
- Desktop messages/approvals
- Mobile dashboard
- Mobile connections
- Mobile approval flow

Passing criteria:

- Screenshots look premium.
- No low-quality layouts.
- No obvious overflow.
- No generic dashboard feel.
- No mock/demo labels.

If failed: return to implementation mode.

## Final completion statement

The final response must include:

- What changed
- What files changed
- What real connector infrastructure now exists
- What provider setup is required
- What backend/runtime was added
- What validation was run
- Screenshot audit summary
- Remaining honest limitations

Do not claim all adapters are connected unless actual credentials/configuration are present.
