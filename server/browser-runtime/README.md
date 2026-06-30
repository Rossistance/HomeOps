# HomeOps Browser Automation runtime (optional)

A small Playwright-powered headless-browser service that the **Browser Automation**
connector calls to actually open pages and download files. It runs as its **own
process** with its own dependency (Playwright + a Chromium binary), so the main
HomeOps backend stays dependency-free.

## Why it's separate

The main backend (`server/`) deliberately has **zero npm dependencies**. A real
headless browser needs Playwright and a ~few-hundred-MB Chromium download, so it
lives here and is entirely opt-in. If you don't run it, the Browser Automation
connector honestly reports **"Runtime not connected"** and its tools refuse to run
(no fakery).

## Run it

```bash
cd server/browser-runtime
npm install          # installs Playwright
npm run setup        # downloads the Chromium browser binary
npm start            # starts the runtime on http://localhost:9223
```

Then point the backend at it — add to `homeops-ai/.env`:

```
BROWSER_RUNTIME_URL=http://localhost:9223
```

Restart the backend (`npm run dev`). In **Connections → Browser Automation**, the
status flips to **Connected** once the backend's health probe reaches the runtime.

## Endpoints (called by the backend, not the browser)

| Method | Path        | Body                                   | Returns |
| ------ | ----------- | -------------------------------------- | ------- |
| GET    | `/` `/health` | —                                    | `{ ok, name, version }` (used for the health probe) |
| POST   | `/open`     | `{ url, extract? }`                    | `{ ok, title, url, text, links }` |
| POST   | `/download` | `{ url, selector? }`                   | `{ ok, filename, sizeBytes, savedTo }` |

## Safety

- Headless Chromium; no credentials are ever sent here — sign-in happens inside the
  browser session (login handoff), consistent with the rest of HomeOps.
- `browser.download` is an approval-gated tool: the backend requires a consumed
  server-side approval before it will call `/download`.
- The backend only reaches this runtime over loopback (the SSRF guard allows
  loopback for this connector specifically).
- Configurable port via `BROWSER_RUNTIME_PORT` (default `9223`).
