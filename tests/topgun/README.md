# Top Gun Test Harness — FamiliOS

Three runtime lanes, registered for the top-gun plugin's capability-task-matcher in
[runtime-drivers.json](./runtime-drivers.json). Playwright is the **primary** driver;
native iOS runs on cloud runtimes because no iOS simulator/WebDriverAgent exists on Windows.

| Lane | Platform truth | Command | Needs |
|---|---|---|---|
| `web-chromium` / `web-webkit-iphone` | web + PWA approximation of iOS Safari | `npm run topgun:web` / `npm run topgun:web:ios` | Node ≥ 22.13 locally (backend uses `node:sqlite`) |
| PWA production checks | manifest/SW/offline denylist | `npm run topgun:pwa` (set `TOPGUN_PWA_BASEURL`) | `npm run build && npm run preview` → `http://localhost:4173`, or the deployed origin |
| Appetize simulator | iOS simulator smoke/screens/deep links | `npm run topgun:appetize` | Appetize account + simulator build uploaded ([docs/SETUP-CLOUD.md](./docs/SETUP-CLOUD.md)) |
| Appium device cloud | real-device native truth | `npm run topgun:ios` (probe: `npm run topgun:ios:probe`) | BrowserStack (or LambdaTest) account + `.ipa` uploaded |

Evidence lands in `tests/topgun/.artifacts/` (HTML reports, traces, screenshots) plus
cloud session URLs printed as `[evidence]` lines. Blocked lanes exit with an explicit
BLOCKED message and unblock condition — a blocked lane is never a pass.

## First-time setup

1. `copy tests\topgun\.env.topgun.example tests\topgun\.env.topgun` and fill in what you have
   (every value is optional; missing values simply mark that lane blocked).
2. Web lane works immediately: `npm run topgun:web`.
3. Cloud lanes: follow [docs/SETUP-CLOUD.md](./docs/SETUP-CLOUD.md) — account auth is
   always yours; upload scripts and runs are automated from here.

## Safety rule (read this once)

The preview/production iOS builds bake `EXPO_PUBLIC_API_URL=https://homeops-ai.onrender.com`
— the **live household backend**. Cloud device/simulator specs therefore default to
non-mutating flows (sign in as a no-PIN guest profile, look, screenshot, never write).
Mutation cases require `TOPGUN_ALLOW_MUTATIONS=1` **and** a disposable backend/tenant —
see the staging section of SETUP-CLOUD.md.

## Selector conventions

- Web: aria-label / role / visible text only (there are no `data-testid`s; navigation is
  state-based, so tests click nav controls — deep URLs don't exist).
- iOS: accessibility id (`~label`) and `-ios predicate string` from
  [appium/ELEMENT-MAP.md](./appium/ELEMENT-MAP.md) — source-derived; confirm live via
  [docs/INSPECTOR-GUIDE.md](./docs/INSPECTOR-GUIDE.md). No XPath.
- First cloud run is a **calibration run**: tighten matchers from the saved UI dumps,
  then flip `Confirmed` in the element map.

## Lane docs

- [docs/SETUP-CLOUD.md](./docs/SETUP-CLOUD.md) — the exact account/auth/build/upload steps split you-vs-automation.
- [docs/WDA-NOTES.md](./docs/WDA-NOTES.md) — why WebDriverAgent is the cloud's job, not this PC's.
- [docs/INSPECTOR-GUIDE.md](./docs/INSPECTOR-GUIDE.md) — mapping live elements from a cloud session.
- Plugin-side policy: top-gun plugin → `capability-task-matcher/references/runtime-drivers.md`
  (routing) and the `top-gun-ios` skill (iOS mission execution + test-case library).
