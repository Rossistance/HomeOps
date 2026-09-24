# Verifying calendar privacy on the iOS Simulator (Mac VPS)

This runbook checks the ADR-005 calendar rules in the real iOS app, running in the iOS Simulator on the rented Mac. The rules are Work calendars, hidden events, the eye toggle, Connections by role and a Limited Member's scope.

The app runs against a local FamiliOS server that holds a seeded demo household. Five Maestro flows drive the app and save screenshots as they go.

| Piece | Where |
|---|---|
| Demo household seed | `scripts/seed-calendar-demo.mjs` (fixtures in `scripts/fixtures/calendar-demo/`) |
| Simulator build profile | `simulator-local` in `apps/mobile/eas.json`, with `apps/mobile/app.config.js` |
| Flows | `apps/mobile/.maestro/*.yaml` (subflows and the API helper live in subfolders) |
| Web counterpart | `npm run test:calendar-privacy` (Playwright, see the end of this page) |

## The demo household

No profile has a PIN, so each one signs in with one tap on the Lock screen.

| Profile | Role | What they have |
|---|---|---|
| Alex | Owner | "Harper family" calendar. App event "Alex dentist". |
| Gpop | Adult Admin | App event "Gpop golf with Frank". One hidden event, which others see as "Gpop busy". |
| Beannie | Adult Member | **Work** calendar "Beannie work": on today and every weekday for two weeks, 9:00–12:00 and 13:00–15:30, back-to-back meetings with a lunch gap. "Beannie personal" calendar, which holds "Mom's birthday dinner". App event "Beannie pottery class". |
| Sam | Limited Member | Calendar "Sam school". The Owner set his scope to Beannie's app events only and nothing of Gpop's. |
| Noah | Child View | Nothing of his own. He has no Connections. |

What each person should see:

- **Everyone except Beannie** sees her Work time as two "Beannie working" blocks a day and never a meeting title. The exception is Sam, who sees no blocks at all because his scope excludes that calendar.
- **Beannie** sees her own meetings as blurred cards with an eye-slash button.
- **Sam** sees "Beannie pottery class", his own calendar and Alex's events. He sees nothing of Gpop's and not "Mom's birthday dinner".

## 1. Prerequisites (once)

1. **Xcode** from the App Store, then:
   ```sh
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -downloadPlatform iOS          # the iOS Simulator runtime
   xcrun simctl list devices available | grep iPhone
   ```
2. **Node 24.** The server needs Node 22.13 or newer for `node:sqlite`, and 24 is what we run.
   ```sh
   brew install node@24 && brew link --overwrite node@24
   node --version
   ```
3. **Java 17 or newer**, which Maestro needs:
   ```sh
   brew install openjdk@17
   sudo ln -sfn "$(brew --prefix)/opt/openjdk@17/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk-17.jdk
   java -version
   ```
4. **Maestro:**
   ```sh
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   export PATH="$PATH:$HOME/.maestro/bin"     # add to ~/.zshrc
   maestro --version
   ```
5. **The repo**, with dependencies installed at the root (for the server) and in `apps/mobile` (only if you build locally):
   ```sh
   git clone <repo> ~/familios && cd ~/familios && npm ci
   ```
6. For the cloud build only: `npm i -g eas-cli && eas login`, using the account that owns the Expo project (`owner` in `apps/mobile/app.json`).

## 2. Start the server and seed the household

Run everything from the repo root, in a terminal you keep open:

```sh
node scripts/seed-calendar-demo.mjs --serve --port 8787 --data-dir ~/familios-demo-data --check
```

This command:
- Starts `server/index.mjs` in **development** mode on port 8787, with `HOMEOPS_DATA_DIR=~/familios-demo-data`. It never uses `server/.data`.
- Seeds the household through the server's own HTTP routes, signed in as each member in turn. The Connections matrix, the Work flag, the Limited Member's one-calendar cap and the scope validation all run for real.
- Renders the `.ics` templates relative to **today in the Mac's time zone**. Set `TZ=America/Denver` in front of the command to choose another zone. The Simulator follows the Mac's zone.
- Prints, for each member, what `GET /api/events` gives them: titles, their own hidden events, blocks, and the Connections rows with their `can` flags. Read it before touching the app. The last line should say "Nobody but Beannie sees a Work meeting title."

To start over, press Ctrl-C, delete `~/familios-demo-data`, and run the command again. Seeding an already seeded household is skipped, not repeated.

The dates are fixed at seed time. Re-seed on the day you test: after two weeks the Work meetings run out.

You can seed a server you started yourself, but it must be on a scratch data dir:

```sh
HOMEOPS_DATA_DIR=/tmp/fam PORT=8787 node server/index.mjs &
node scripts/seed-calendar-demo.mjs --url http://127.0.0.1:8787 --check
node scripts/seed-calendar-demo.mjs --url http://127.0.0.1:8787 --check-only   # later: just look
```

## 3. Build the Simulator app

The `simulator-local` profile builds a **Release** app for the Simulator with `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787` baked in. Inside the Simulator, 127.0.0.1 is the Mac itself.

Plain http is normally blocked by App Transport Security. `app.config.js` therefore adds `NSAllowsLocalNetworking`, and only for this profile (or when `EXPO_PUBLIC_API_URL` is a loopback http URL). Production builds are unchanged, and you can confirm it:

```sh
cd apps/mobile
npx expo config --type public | grep -c NSAppTransportSecurity                                  # 0
EAS_BUILD_PROFILE=simulator-local npx expo config --type public | grep -A2 NSAppTransportSecurity # present
```

**Option A: EAS cloud build (recommended; nothing native on the VPS)**

```sh
cd apps/mobile
eas build --profile simulator-local --platform ios
# When it finishes, download the .tar.gz from the build page (or: eas build:list → artifact URL)
mkdir -p ~/familios-build && tar -xzf ~/Downloads/*.tar.gz -C ~/familios-build
ls ~/familios-build        # FamiliOS.app
```

`expo-blur` is a native module, so the app must be a build made after it was added. An older TestFlight or simulator build will not draw the blocks correctly.

**Option B: local build on the Mac**

This needs Xcode, CocoaPods and fastlane (`brew install cocoapods fastlane`), plus several GB of disk and memory. Build in a scratch copy, so the generated `ios/` folder never ends up in a commit:

```sh
cd apps/mobile
EAS_BUILD_PROFILE=simulator-local EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 \
  eas build --local --profile simulator-local --platform ios --output ~/familios-build/app.tar.gz
tar -xzf ~/familios-build/app.tar.gz -C ~/familios-build
```

You can also run `npx expo run:ios --configuration Release` with the same two env vars. It prebuilds `ios/` inside `apps/mobile`, so delete that folder afterwards.

## 4. Boot the Simulator, install and launch

```sh
xcrun simctl boot "iPhone 16"            # any available iPhone; see `xcrun simctl list devices available`
open -a Simulator
xcrun simctl install booted ~/familios-build/FamiliOS.app
xcrun simctl launch booted ai.familios.app
```

The Lock screen should show Alex, Gpop, Beannie, Sam and Noah. If it shows Morgan, Lily or Elaine, the server was never seeded. If it shows a different household, or nothing, the app is not talking to the demo server: check that the server is running and that the build is `simulator-local`.

## 5. Run the flows

Run the flows from a scratch evidence folder so the screenshots land there:

```sh
mkdir -p ~/familios-evidence/$(date +%F) && cd ~/familios-evidence/$(date +%F)
maestro test ~/familios/apps/mobile/.maestro --test-output-dir . --format junit --output report.xml
# one at a time:
maestro test ~/familios/apps/mobile/.maestro/owner-calendar.yaml
```

`apps/mobile/.maestro/config.yaml` runs the flows in this order: owner-calendar, limited-scope, child-no-connections, connections-by-role, beannie-eye-toggle. The eye-toggle flow runs last because it shares an event. The owner-calendar and eye-toggle flows hide that event again when they start, so a re-run starts clean.

| Flow | Checks |
|---|---|
| `owner-calendar` | Alex sees "Beannie working" blocks (`event-block`) and none of the seven meeting titles. Tapping a block opens nothing. Through the API, Alex receives 0 Work titles and 2 blocks on the day. |
| `limited-scope` | Sam sees "Beannie pottery class", his own "Sam chemistry study group" and "Alex dentist". He sees no blocks, nothing of Gpop's and not "Mom's birthday dinner". The API check agrees. |
| `child-no-connections` | Noah's calendar shows the blocks. There is no Settings tab and no Connect shortcut, and `familios://connections` does not show `connections-screen`. |
| `connections-by-role` | Gpop has `calendar-sync-<id>` but no `calendar-remove-<id>` on Beannie's calendars, no Sync or Remove on Alex's, and Remove on Sam's. Alex has Remove, Sync and Edit on every calendar, and `calendar-add-card`. |
| `beannie-eye-toggle` | Beannie's "Q3 roadmap review" is blurred with `eye-toggle-<id>`. Tapping the eye unblurs it and leaves an open eye, and tapping the card opens her event form (`event-form-hide-switch`). Alex then sees the title, and the morning block splits: the API reports 3 blocks that day instead of 2. |

Ids are dynamic. `scripts/demo-api.js` looks them up from the server when a flow starts, signed in with a bearer session. The flow shares the **next** "Q3 roadmap review" still ahead: today's before 9:30, the next workday's after.

If the server is not on `127.0.0.1:8787`, pass `-e API_URL=http://127.0.0.1:<port>`.

Each flow signs in on a clean app (`clearKeychain` and `clearState`) and clicks through the first-run onboarding.

## 6. Collect the evidence

- Screenshots are named after what they show, for example `owner-calendar-01-beannie-working-blocks.png` and `alex-04-sees-shared-title-and-split-blocks.png`. They are in the evidence folder, next to `report.xml` and Maestro's per-flow logs.
- Copy the folder off the Mac, for example `scp -r mac:~/familios-evidence/<date> .`. Do **not** commit it into `.top-gun/` or `tests/`.
- Add the `--check` printout from step 2 to the evidence: it is the server-side view the screenshots should match.

## 7. Cautions

- **Never sign the Simulator into an Apple ID.** The flows need none, and this Mac's Apple ID is a person's own.
- **BlueBubbles runs on this Mac** (ports **1234** and **45671**, as a Launch Agent). Leave it alone: do not restart it, and do not use those ports. The demo server uses 8787, and the Playwright stack uses 8797 and 5197. Do not run `killall node` either; stop the demo server with Ctrl-C.
- **Watch memory.** The VPS is small, and Simulator + Maestro (JVM) + Node + Xcode can exhaust it. Boot one simulator only, and close Xcode while the flows run. Afterwards run `xcrun simctl shutdown all` and quit Simulator. Check with `memory_pressure` or Activity Monitor before starting.
- The demo server runs in **development** mode on purpose, because production mode refuses elevated sign-in without a PIN. Never expose port 8787 beyond the Mac.
- Session sign-ins are rate-limited (20 a minute per IP). A full run stays well under that. If a flow reports `429`, wait a minute.

## Web counterpart (any machine)

```sh
npm run test:calendar-privacy
```

This command starts its own seeded backend (port 8797, a temp data dir) and Vite (port 5197), then checks two things:
- Signed in as Alex, "Beannie working" is on the web calendar, and none of Beannie's Work meeting titles appear anywhere in the page HTML, in the list or the month view.
- Signed in as Beannie, her titles are there.

It never reuses a running stack, and never touches `server/.data` or committed screenshots. Artifacts go to `tests/topgun/.artifacts/calendar/`, which git ignores. On Windows, the temp data dir may be left behind in `%TEMP%\familios-calendar-demo-*`, because Playwright kills the server hard.
