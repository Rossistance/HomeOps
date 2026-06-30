# Source Context and References

## Uploaded source inspected

The uploaded `home ops claude.zip` package was inspected.

Findings:

- React/Vite/TypeScript/Tailwind app.
- Zustand store and IndexedDB persistence.
- Existing HomeOps screens and concepts are present.
- Build succeeded after dependency installation.
- UI quality remains below the premium product target.
- Demo/mock adapter behavior remains throughout product UI and documentation.

## Web reference context

Use these facts as architectural context:

- Claude Code reads persistent project instructions from `CLAUDE.md` files and project configuration sources. This is why this package includes a `CLAUDE.md` rescue directive.
- Claude Code best-practice guidance emphasizes planning, understanding the codebase, and using project instructions rather than blind edits.
- OAuth 2.0 is the standard delegated authorization model for user-approved third-party app access.
- OpenAPI is the broadly adopted machine-readable standard for describing HTTP APIs, which supports generated clients, documentation, and tool wrappers.
- MCP allows servers to expose named tools with metadata and schemas so models can interact with external systems.
- Real webhooks, OAuth callbacks, token refresh, scheduled jobs, secrets, and browser automation require backend/runtime infrastructure; a frontend-only Vite app cannot safely provide those as production features.

## Design/product context

This product should be treated as a premium family/personal operating system, not an enterprise task manager.

The UI should feel credible beside modern personal productivity, family coordination, and AI assistant products.

The connector layer should feel credible beside modern integration platforms, but tailored to personal/family workflows.
