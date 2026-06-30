# Backend, Auth, Secrets, and Browser Automation Boundaries

## Why backend is required

The current app is frontend/local-first. That is not enough for real connectors.

Real connectors require backend/runtime support for:

- OAuth client secrets
- OAuth callbacks
- Token exchange
- Token refresh
- Webhook URLs
- Background schedules
- Long-running executions
- Browser automation
- Secure external API calls
- Secrets vaulting
- Server-side audit logs

## Minimum backend requirement

Add a backend package or runtime layer that supports:

- Health endpoint
- Connector config endpoints
- OAuth start and callback endpoints
- Token refresh service
- Tool execution endpoint
- Webhook receiver endpoint
- Background job scheduler
- Browser automation session endpoint
- Audit event persistence
- Redacted logs

## Environment/configuration

The app must support environment-driven configuration for providers.

Examples of configuration types:

- OAuth client ID
- OAuth client secret
- Redirect URI
- API base URL
- API key
- MCP server URL
- Webhook public base URL
- Browser automation runtime URL
- Secret encryption key
- AI provider key if enabled

Do not hardcode secrets.

## Browser automation

Browser automation is acceptable only as a real runtime-backed feature.

Required:

- Real browser automation adapter
- User login handoff state
- Persistent session storage boundary
- Clear terms/risk copy
- Approval before acting
- Screenshot/status observation
- Failure handling
- Audit trail

Not allowed:

- Fake browser workflows
- Fake downloaded files
- Fake login completion
- Fake cancellation success

## Webhooks

Webhook receiver must be real if presented as available.

Required:

- Server route
- Secret/signature validation where applicable
- Payload capture
- Event log
- Replay or test-payload capability
- Trigger routing
- Failure state

Do not show fake hook URLs as if working.

## AI providers

AI providers must be real or unavailable.

Allowed:

- Local deterministic assistance for purely local UI behavior.
- Real provider adapters when configured with credentials.
- Browser/local semantic search if implemented honestly.

Forbidden:

- Placeholder “provider” toggles that look enabled.
- Fake AI generation from a disabled provider.
