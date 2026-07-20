# Appium Inspector — live element mapping for FamiliOS iOS

Purpose: confirm the source-derived locators in `../appium/ELEMENT-MAP.md` against the
real rendered tree, and mine locators for new test cases. The device runs in the cloud;
Inspector runs on this PC and attaches to it.

## Setup (once)

1. Download Appium Inspector for Windows: https://github.com/appium/appium-inspector/releases
2. Have `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`, `BROWSERSTACK_APP_ID`
   (from `tests/topgun/.env.topgun` after the upload step in SETUP-CLOUD.md).

## Attach to a BrowserStack session

1. Open Inspector → select the **BrowserStack** cloud provider tab (or set Remote Host
   `hub-cloud.browserstack.com`, Remote Path `/wd/hub`, SSL on).
2. Enter the username/access key.
3. Paste the JSON from `../appium/caps/appium-inspector.browserstack.json` into the
   JSON representation panel — **replace the `${…}` placeholders with the real values**
   (Inspector does not read env vars) and delete the `_usage` key.
4. Start Session. The FamiliOS lock screen appears in the mirrored view.

## Mapping workflow

1. Navigate the app in the mirror (tap profile card → explore each tab).
2. For each element of interest, click it in the tree and record from the right panel:
   - accessibility id (name) — best; comes from `testID` or the accessibility label
   - label / value, element type
   - the suggested locator (prefer accessibility id, then predicate; ignore XPath)
3. Update `../appium/ELEMENT-MAP.md`: fill the locator, flip `Confirmed` to `yes (YYYY-MM-DD)`.
4. Duplicate/ambiguous matches, dynamic labels, scroll-only elements → note them in the
   map and prefer adding a `testID` in `apps/mobile/src/…` (file a work package).
5. Quit the session when done — cloud minutes are metered (`appium:newCommandTimeout`
   is set to 600s for mapping sessions, so idle time still burns the clock).

## Reading the tree without Inspector

Any running spec can dump the tree: `console.log(await driver.getPageSource())` — useful
when a locator misses mid-run (the Appetize lane saves `last-ui-dump.json` the same way).
