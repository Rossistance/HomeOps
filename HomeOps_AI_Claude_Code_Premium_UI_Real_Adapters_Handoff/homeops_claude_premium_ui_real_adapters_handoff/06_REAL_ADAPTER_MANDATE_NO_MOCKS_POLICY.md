# Real Adapter Mandate — No Mocks, No Simulations

## Core rule

The app may not contain simulated external integrations.

This does not mean every third-party account must be usable without credentials. It means the product must stop pretending. Every connector must be either:

1. Real and configured
2. Real but unconfigured
3. Unsupported and unavailable
4. Local-only and honestly scoped to local data

## Forbidden user-facing patterns

Remove:

- Demo mode
- Mock adapter
- Simulated connector
- Fake OAuth
- Authorize demo
- Connect demo
- Fake webhook URL that pretends to work
- Fake browser login
- Fake external message sent
- Fake external file download
- Fake provider call
- Placeholder adapter that appears usable
- Future adapter as a substitute for implementation

## Acceptable patterns

Allowed:

- “Not configured”
- “Requires OAuth setup”
- “Requires backend runtime”
- “Requires environment variable”
- “Unavailable until configured”
- “Local file import only”
- “Read-only connector configured”
- “Write action blocked pending approval”
- “Provider returned error”
- “Token expired”
- “Reconnect required”

## Adapter readiness levels

Each connector must have a readiness state:

- Not Installed
- Installed, Not Configured
- Configured, Needs Authorization
- Authorized, Read-Only
- Authorized, Write-Capable
- Connected, Healthy
- Degraded
- Error
- Revoked

## Required connector categories

The app must support real infrastructure for:

- OAuth API connectors
- API key connectors
- Custom HTTP connectors
- OpenAPI imported connectors
- MCP server connectors
- RSS/feed connectors
- Webhook receivers
- File import connectors
- Browser automation connectors
- AI provider connectors

## What counts as real in this pass

A connector counts as real only if:

- It has a real configuration surface.
- It stores configuration securely or delegates to a backend vault abstraction.
- It exposes real tool manifests.
- It exposes real trigger manifests if applicable.
- It can execute actual calls when configured.
- It fails honestly when not configured.
- It logs real execution attempts.
- It respects approval gates.
- It does not fabricate successful output.

## Provider credentials

Do not hardcode credentials.

Use environment variables, backend vault configuration, or secure connection setup.

If credentials are missing, show a setup-required state.

## Seed data policy

Seed data may exist only as local household sample data.

Seed data must not imply real external events occurred.

Seed data must not include fake external provider domains as if they are working.

If sample connectors are needed, they must be labeled as example configuration templates, not working demo adapters.
