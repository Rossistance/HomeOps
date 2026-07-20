# Cloud Runtime Setup — you do the auth, the harness does the rest

Split of responsibilities: **you** create accounts and supply credentials/builds
(billable, identity-bound actions); **the harness/agent** uploads artifacts, probes
lanes, and runs the suites.

Put every value in `tests/topgun/.env.topgun` (copy from `.env.topgun.example`; it's
gitignored).

## 1. Device cloud — BrowserStack App Automate (primary)

**You:**
1. Create/sign in: https://www.browserstack.com/app-automate (a free trial exists; App
   Automate is the product you want — not Live/Automate-web).
2. Copy Username + Access Key (Account → Settings → Access keys) into
   `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`.
3. Produce a device build (`.ipa`) — requires your Expo account (`eas login`):
   ```
   cd apps\mobile
   eas build -p ios --profile preview
   ```
   Download the `.ipa` from the EAS build page when it finishes. (Internal distribution,
   Release config, API URL baked to the render backend — see eas.json.)

**Then automated:**
```
node tests\topgun\appium\upload-browserstack.mjs path\to\FamiliOS.ipa   # writes BROWSERSTACK_APP_ID
npm run topgun:ios:probe                                                # should say "use now"
npm run topgun:ios                                                      # smoke lane
```

Owner flows (PIN-gated on the production backend): set `TOPGUN_IOS_PIN` to the household
owner PIN and rerun — otherwise those specs skip with a reason.

## 2. Simulator — Appetize.io (light lane)

**You:**
1. Create/sign in: https://appetize.io (free tier includes limited minutes).
2. Account page → copy the **API token** into `APPETIZE_API_TOKEN`.
3. Produce a **simulator** build (not the `.ipa`):
   ```
   cd apps\mobile
   eas build -p ios --profile simulator
   ```
   (`simulator` profile added to apps/mobile/eas.json by this harness.) Download the
   `.tar.gz` artifact.

**Then automated:**
```
node tests\topgun\appetize\upload-appetize.mjs path\to\build.tar.gz   # writes APPETIZE_PUBLIC_KEY
npm run topgun:appetize
```

## 3. Alternate device cloud — LambdaTest (optional)

Same shape: account → `LT_USERNAME`/`LT_ACCESS_KEY`; upload the `.ipa` at
https://manual-api.lambdatest.com/app/upload/realDevice (or their UI) → `LT_APP_ID`;
run with `TOPGUN_CAPS=lambdatest` (`node tests\topgun\appium\run.mjs --caps lambdatest`).

## 4. Expo/EAS (build pipeline)

`eas login` once on this PC (or authorize the Expo connector in Claude). Builds run on
Expo's macOS cloud — no Mac needed here. If Apple credentials are requested for the
`preview` profile, follow the EAS prompts (Apple Developer account; the app already has
ASC app id 6789297381).

## 5. Staging backend for mutation tests (strongly recommended before any write-path iOS tests)

The baked API URL points at the **live** household server. Options, best first:
1. **Second Render service**: duplicate the `homeops-ai` service from render.yaml with its
   own disk + `HOMEOPS_*` env, then build a one-off `.ipa`/simulator build whose profile
   env sets `EXPO_PUBLIC_API_URL` to that staging URL (copy the `simulator`/`preview`
   profile in apps/mobile/eas.json and change the env).
2. **Tunnel to a local dev backend**: `ngrok http 8787` (or similar) and bake the tunnel
   URL the same way — dev mode also removes the owner PIN gate.
Only after one of these: set `TOPGUN_ALLOW_MUTATIONS=1` for write-path specs.

## Quick verification checklist

- [ ] `npm run topgun:web` — green locally (no accounts needed)
- [ ] `npm run topgun:ios:probe` — prints `"use now"` (else it names exactly what's missing)
- [ ] `npm run topgun:ios` — smoke passes; session video visible in the vendor dashboard
- [ ] `npm run topgun:appetize` — sim smoke passes; screenshots in `tests/topgun/.artifacts/appetize/`
