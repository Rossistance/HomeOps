# Claude Code Project Instructions — HomeOps AI Premium UI + Real Adapter Rescue

You are working on the existing HomeOps AI repository.

This is a rescue build. The current product is functional but visually below the quality bar and still contains demo/mock adapter behavior. Your mission is to transform it into a premium family operating system with real connector infrastructure.

## Hard operating rules

- Do not claim completion until every development requirement is implemented.
- Do not spend the early phase writing tests instead of building. Finish development first, then validate.
- Do not preserve low-quality UI patterns just because they already exist.
- Do not merely restyle colors, spacing, or border radius. Redesign the experience intentionally.
- Do not leave demo/mock/simulated external integrations in the product.
- Do not show fake successful external actions.
- Do not use labels such as demo adapter, simulated connector, fake OAuth, mock browser, placeholder provider, or pretend webhook in user-facing product UI.
- If a provider is not configured, show a real unconfigured state with setup instructions and disabled actions.
- If a real connector requires server-side infrastructure, implement that boundary instead of pretending the client can do it.
- If a feature cannot be made real in this pass, remove it from active product flow or mark it as unavailable until configured. Do not simulate success.
- Every screen must look and behave like part of one premium product system.
- Every screen must be responsive and intentionally designed for desktop and mobile.
- All high-risk real-world actions require approval gates and activity logging.

## Required outcome

A premium HomeOps AI application that feels like a real product for families and individuals, with:

- High-quality product shell
- Premium dashboard
- Intentional navigation
- Modern command center
- Real connector architecture
- Real tool registry
- Real trigger registry
- Real approval engine
- Real execution/audit layer
- Real unconfigured/configured connector states
- Backend boundary for OAuth, webhooks, scheduled jobs, browser automation, and secrets
- No simulated external actions

## Quality bar

The final app must plausibly compete visually and experientially with modern personal productivity, family coordination, and AI assistant apps. It should feel calm, premium, trustworthy, intelligent, warm, and capable.

If the final app still looks like a generic Vite/Tailwind dashboard, keep working.

## Validation order

1. Complete implementation.
2. Run build/type/lint checks available in the repo.
3. Run visual screenshot review.
4. Run mock-adapter removal audit.
5. Run connector architecture audit.
6. Run screen-by-screen product quality audit.
7. Fix failures.
8. Repeat until all gates pass.
