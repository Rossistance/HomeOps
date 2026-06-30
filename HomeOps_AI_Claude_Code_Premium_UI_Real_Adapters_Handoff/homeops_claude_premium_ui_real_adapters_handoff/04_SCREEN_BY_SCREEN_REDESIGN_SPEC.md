# Screen-by-Screen Redesign Specification

## Global Shell

Required:

- Premium left navigation on desktop.
- Premium bottom navigation on mobile.
- Beautiful top command zone.
- Household context visible.
- Search/command entry prominent.
- Connector health visible but not noisy.
- Approval count visible.
- No demo badges.
- No generic gray panels.
- Unified spacing, type scale, and interaction patterns.

## Dashboard

Must be completely redesigned.

Required sections:

1. Hero family briefing
2. Today timeline
3. Attention queue
4. Pending approvals
5. Active helper agents
6. Family member rhythm strip
7. Connected systems health
8. Recently processed documents
9. Suggested next actions
10. Mini app launch area

Success bar:

- The dashboard should look like the flagship screenshot of the product.
- The first viewport must immediately communicate premium quality.

## Agents

Required redesign:

- Agent cards should feel alive and purposeful.
- Agents should show connected tools, permissions, active triggers, recent work, and approval posture.
- Agent detail should include run timeline, tools available, knowledge used, memory, and next suggested workflows.
- Agent creation should feel like creating a real helper, not filling a generic form.

Must include:

- Agent status rails
- Agent capability preview
- Tool availability
- Configured connector dependencies
- Real disabled state if connector missing
- Run history tied to execution engine

## Automations

Required redesign:

- Show automations as life routines, not technical cron jobs.
- Include trigger source, assigned agent, tools used, approval gates, last run, next run, and failure state.
- Workflow builder must show a generated plan before activation.

No simulated runs allowed.

If trigger infrastructure is not configured, automation must be unavailable or local-only with a clear real boundary.

## Connections

This is one of the most important screens.

Must transform from demo cards into a real integration console.

Required sections:

- Connected systems
- Needs configuration
- Available providers
- Custom HTTP/OpenAPI
- MCP servers
- Webhooks
- Browser sessions
- RSS/feed connectors
- File import connectors

Each connector must show:

- Auth type
- Configuration status
- Required environment variables or credentials
- Granted scopes
- Available tools
- Available triggers
- Risk level
- Approval requirements
- Last health check
- Last successful tool call
- Error state
- Revoke/disconnect

Forbidden:

- Authorize demo
- Connect demo
- Future adapter copy as primary content
- Fake success

## Messages and Approvals

Redesign into a premium communications and decision inbox.

Required:

- Message threads
- Approval cards
- Risk labeling
- Data-used disclosure
- Tool/action preview
- Recipient preview
- Approve/deny/edit/ask-for-changes
- Audit trail after decision

## Files & Knowledge

Required:

- Premium document library
- Knowledge graph feel
- Tags, sensitivity, linked agents, linked workflows
- Extracted dates/tasks when real parser supports it
- If parser is not real, do not fake extraction; mark processing unavailable or limited to real supported types.
- Folder-like navigation and search.

## Mini Apps

Required:

- Mini apps should feel like polished embedded apps.
- They should use shared product design tokens.
- They must not look like isolated widgets.
- Show data source and sync state.
- No fake external sync.

## Household Spaces

Required:

- Create a warm family system view.
- Members, spaces, permissions, roles, shared connectors, sensitive data.
- Guest/helper access should feel safe and understandable.

## Playbooks

Required:

- Playbooks as reusable household procedures.
- Show required connectors, approval gates, output format, and run readiness.
- If required connector is missing, show blocked state.

## Activity & Memory

Required:

- Timeline of real user/app actions.
- Search/filter by agent, connector, tool, approval, file, member.
- Memory entries should show source, confidence, sensitivity, and approval status.

## Settings

Required:

- Real provider setup.
- Backend status.
- OAuth app configuration.
- Secrets storage configuration.
- Webhook base URL.
- Browser automation runtime status.
- AI provider configuration if implemented.
- Data export/import.
- Kill switch for external actions.
