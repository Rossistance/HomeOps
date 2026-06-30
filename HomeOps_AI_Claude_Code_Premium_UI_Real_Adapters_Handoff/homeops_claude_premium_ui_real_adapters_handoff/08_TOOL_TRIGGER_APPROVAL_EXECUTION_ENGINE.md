# Tool, Trigger, Approval, and Execution Engine Specification

## Tool execution lifecycle

Every tool execution must flow through:

1. User/agent requests action.
2. Planner selects tool.
3. Execution engine checks connector status.
4. Execution engine checks authorization/scopes.
5. Execution engine checks approval requirement.
6. If approval required, create approval request and stop.
7. If approved or low-risk allowed, execute tool.
8. Capture result or error.
9. Log activity.
10. Update relevant app data.

## Approval rules

Approval required before:

- Sending external email or text
- Changing calendar events
- Deleting or archiving external files
- Uploading sensitive documents externally
- Submitting forms
- Cancelling subscriptions
- Making purchases or payments
- Contacting schools, doctors, vendors, landlords, or service providers
- Running browser workflows that act on behalf of the user
- Sharing children, medical, legal, financial, or identity information

Approval not required by default for:

- Local draft creation
- Local reminder creation
- Local task creation
- Local summary generation
- Local file tagging
- Local knowledge search
- Read-only external fetches when connector has read scope

## Trigger lifecycle

Every trigger must:

- Have a real source
- Have a configured connector
- Have an enabled automation
- Log the received event
- Apply filters
- Create an automation run
- Execute through the engine
- Respect approvals
- Fail honestly

## Failure states

Must support:

- Connector not configured
- Auth expired
- Missing scope
- Approval required
- Rate limited
- Provider error
- Network error
- Invalid input
- Webhook signature failed
- Browser session requires login
- Browser selector failed
- Secret missing
- Runtime unavailable

## User-facing execution visibility

The user must always be able to see:

- What tool was selected
- Which connector was used
- What data was read
- What action was proposed
- Whether approval was required
- Whether it succeeded or failed
- What error occurred
- What the agent did next
