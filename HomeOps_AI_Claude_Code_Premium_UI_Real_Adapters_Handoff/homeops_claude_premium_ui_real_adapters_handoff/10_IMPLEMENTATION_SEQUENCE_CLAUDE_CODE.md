# Claude Code Implementation Sequence

Do not start with tests. Complete the development work first.

## Phase 0 — Repository orientation

- Inspect current source tree.
- Identify all demo/mock/simulated adapter references.
- Identify all screens and shared UI primitives.
- Identify state/store patterns.
- Identify build commands.
- Identify whether backend exists.

Deliverable: internal implementation plan.

## Phase 1 — Remove demo-mode product behavior

- Remove global demo mode.
- Remove user-facing demo badges.
- Remove “Authorize demo” and “Connect demo.”
- Refactor seed data to remove fake external success.
- Convert demo connections to real provider templates with not-configured states.
- Remove simulated external action success paths.
- Ensure no agent run can claim an external action completed unless a real configured tool executed.

## Phase 2 — Add real connector architecture

- Implement connector registry.
- Implement tool registry.
- Implement trigger registry.
- Implement execution engine.
- Implement approval gate checks.
- Implement connector health state.
- Implement real unconfigured/configured status model.
- Implement activity logging for tool attempts and failures.

## Phase 3 — Add backend/runtime boundary

- Add backend package or server runtime if missing.
- Add OAuth boundary.
- Add secrets abstraction.
- Add webhook receiver.
- Add background job scheduler boundary.
- Add browser automation runtime boundary.
- Wire frontend to backend configuration states.

## Phase 4 — Premium design system rebuild

- Replace low-quality card patterns.
- Build premium app shell.
- Build refined design tokens.
- Build upgraded components.
- Build premium hero panels, status cards, timeline components, drawers, approval cards, connector cards, and agent cards.
- Ensure all screens use the new system.

## Phase 5 — Screen-by-screen redesign

Redesign in this order:

1. Global shell
2. Dashboard
3. Connections
4. Agents
5. Automations
6. Messages/Approvals
7. Files & Knowledge
8. Mini Apps
9. Household Spaces
10. Playbooks
11. Activity & Memory
12. Settings

## Phase 6 — End-to-end flows

Implement real-state flows:

- Configure connector
- Missing config blocks execution
- Read-only tool can execute if configured
- Write tool creates approval
- Approval allows execution
- Failure logs correctly
- Webhook event triggers automation
- Browser workflow enters login-required state
- Agent run shows real dependency/status chain

## Phase 7 — Validation after development

Only after development is complete:

- Run typecheck/build/lint where available.
- Capture screenshots.
- Run visual quality audit.
- Run mock/simulation removal audit.
- Run connector architecture audit.
- Run screen-by-screen completion audit.
- Fix failures and repeat.
