# Connector Infrastructure Architecture

## Required infrastructure layers

Implement or refactor toward these layers:

1. Connector Registry
2. Auth Manager
3. Secret/Vault Abstraction
4. Tool Registry
5. Trigger Registry
6. Execution Engine
7. Approval Engine
8. Activity/Audit Log
9. Error/Retry System
10. Webhook Receiver
11. Background Job Scheduler
12. Browser Automation Runtime
13. Provider Configuration UI
14. Health Check System

## Connector Registry

The connector registry defines every provider and connector instance.

Each connector definition must include:

- Connector ID
- Provider name
- Category
- Auth type
- Configuration schema
- Connection status
- Available tools
- Available triggers
- Required scopes
- Risk levels
- Approval rules
- Health check
- Error state
- Last run
- Last auth refresh
- Runtime location: client, backend, browser automation, external MCP

## Auth Manager

Must support:

- OAuth authorization initiation
- OAuth callback handling
- Token refresh
- API key configuration
- Personal access token configuration
- MCP server credentials
- Browser session authorization
- Revocation
- Reauthorization

Client-only storage of secrets is not acceptable for production-sensitive connectors.

## Secret/Vault Abstraction

Even if backed by local development storage initially, there must be an abstraction for:

- Storing secrets
- Fetching secrets only in backend execution context
- Never exposing secrets in UI logs
- Rotating/revoking credentials
- Showing redacted config values

## Tool Registry

Tools are the executable actions exposed by connectors.

Each tool must include:

- Tool ID
- Connector ID
- Name
- Description
- Input schema
- Output schema
- Required auth/scopes
- Risk level
- Approval rule
- Runtime
- Execution status
- Error handling
- Audit event format

## Trigger Registry

Triggers are events that can start automations.

Each trigger must include:

- Trigger ID
- Connector ID
- Type
- Filter rules
- Polling or webhook mechanism
- Last event time
- Next run time
- Failure count
- Assigned automation
- Replay support when feasible

## Execution Engine

The execution engine runs tools and workflows.

It must:

- Check connector status
- Check tool availability
- Check scopes
- Check approval rules
- Build execution plan
- Run only real configured tools
- Log every attempt
- Return typed success/failure
- Never fabricate results
- Surface errors to user

## Backend boundary

Real connectors require backend support for:

- OAuth secrets
- Token exchange
- Token refresh
- Webhook receiving
- Scheduled background jobs
- Long-running tasks
- Browser automation sessions
- External API calls that require secrets
- Secure audit logging

If the current project has no backend, add one or clearly partition the repository into frontend and backend packages.
