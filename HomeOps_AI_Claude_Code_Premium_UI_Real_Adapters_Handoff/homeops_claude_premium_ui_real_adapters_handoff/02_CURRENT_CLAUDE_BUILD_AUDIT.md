# Current Claude Build Audit

This audit is based on inspection of the uploaded package `home ops claude.zip`.

## Repository structure observed

The app contains:

- `src/App.tsx`
- `src/brand.ts`
- `src/components`
- `src/screens`
- `src/data`
- `src/lib`
- `src/storage`
- `src/store`
- Vite/React/TypeScript/Tailwind setup

## Build status

After installing dependencies, the production build succeeded.

The build success does not mean the product is acceptable. Functional build is only the starting point.

## Critical issue: demo adapter system remains

Evidence found in the project:

- `README.md` states “Demo adapters only.”
- `README.md` states no real Gmail/Calendar/SMS/bank/browser execution.
- `src/brand.ts` contains a global demo-mode flag.
- `src/screens/Connections.tsx` presents “Authorize (demo)” and “Connect (demo)” actions.
- `src/data/seed.ts` includes demo providers, demo browser URLs, demo webhook URLs, and disabled provider placeholders.
- `src/data/workflowTemplates.ts` repeatedly references demo connections.
- Seeded activity and browser workflows represent simulated external events.
- AI provider settings are disabled placeholders rather than real configured provider states.

This is a hard failure under the new requirements.

## Critical issue: UI quality below target

The current UI has reasonable utility structure but does not feel like a premium family operating system.

Observed problems:

- Generic left-nav dashboard layout.
- Flat card grid visual language.
- Weak emotional product identity.
- Low-depth dashboard composition.
- Limited family/personality context in layout.
- Generic icon-card patterns.
- Weak distinction between daily command center, agent orchestration, family coordination, and connector infrastructure.
- Little evidence of intentionally designed hero areas, relationship maps, timeline systems, family rhythm views, or AI command-center affordances.
- Connection and workflow screens feel like admin tables/cards rather than premium consumer/prosumer software.
- Mini apps are likely embedded modules rather than a delightful product layer.
- Mobile is structurally present but not visually excellent.

## Preserve

Do preserve useful architecture where it helps:

- Existing entity model concepts
- Zustand/store patterns if still suitable
- IndexedDB persistence
- Existing screen coverage
- Approval-first concepts
- Activity log concept
- Agent/template/playbook data models
- Command bar concept
- Local file/knowledge concepts

## Replace or heavily redesign

Replace or heavily redesign:

- Global visual system
- App shell
- Dashboard composition
- Connections UX
- Agent detail UX
- Workflow builder UX
- Approval inbox UX
- Browser automation UX
- Settings/provider configuration UX
- Demo-mode connection flow
- Any user-facing simulated external action

## Mandatory codebase cleanup

Search the repository for these terms and remove or refactor them from user-facing product behavior:

- demo adapter
- demo mode
- mock
- simulated
- fake
- placeholder provider
- Authorize demo
- Connect demo
- future adapter
- no real external action
- `.demo` URLs used as if real endpoints

Documentation may mention the old state in migration notes only, not as product behavior.
