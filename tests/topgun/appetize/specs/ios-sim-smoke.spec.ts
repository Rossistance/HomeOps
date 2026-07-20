import { expect, test } from "@appetize/playwright";
import fs from "node:fs";
import path from "node:path";

// TC-IOS simulator smoke on Appetize (library: top-gun-ios/references/ios-test-case-library.md).
// Requires a SIMULATOR build uploaded first:
//   cd apps/mobile && eas build -p ios --profile simulator
//   node tests/topgun/appetize/upload-appetize.mjs <downloaded .tar.gz>
// First run is a calibration run: if an element match misses, read the printed UI
// dump, tighten the attribute matchers, and update appium/ELEMENT-MAP.md.

const TOKEN = process.env.APPETIZE_API_TOKEN;
const KEY = process.env.APPETIZE_PUBLIC_KEY;
// A real member of the backend the BUILD talks to (see .env.topgun.example).
const PROFILE = process.env.TOPGUN_IOS_PROFILE || "";
const ARTIFACTS = path.join(__dirname, "..", "..", ".artifacts", "appetize");

test.skip(
  !TOKEN || !KEY,
  "BLOCKED (not a pass): set APPETIZE_API_TOKEN and APPETIZE_PUBLIC_KEY in tests/topgun/.env.topgun — see docs/SETUP-CLOUD.md.",
);

test.use({
  config: {
    publicKey: KEY!,
    device: process.env.TOPGUN_SIM_DEVICE || "iphone15pro",
    osVersion: process.env.TOPGUN_SIM_OS || "17",
  },
});

async function uiContains(session: any, pattern: RegExp, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastDump = "";
  while (Date.now() < deadline) {
    try {
      lastDump = JSON.stringify(await session.getUI());
      if (pattern.test(lastDump)) return true;
    } catch {
      /* session still settling */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, "last-ui-dump.json"), lastDump || "<empty>");
  return false;
}

async function shot(page: any, name: string) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`), fullPage: false });
}

test("TC-IOS-001 (sim) cold start reaches the lock screen", async ({ session, page }) => {
  const ok = await uiContains(session, /Sign in as|FamiliOS/i);
  await shot(page, "sim-001-cold-start");
  expect(ok, "expected the profile lock screen (UI dump saved to .artifacts/appetize/last-ui-dump.json)").toBeTruthy();
});

test(`TC-IOS-010 (sim) no-PIN profile sign-in (${PROFILE || "unset"})`, async ({ session, page }) => {
  test.skip(!PROFILE, "Set TOPGUN_IOS_PROFILE to a no-PIN member (child/guest) of the build's backend household.");
  await uiContains(session, /Sign in as/i);
  try {
    await session.tap({
      element: { attributes: { text: new RegExp(`^Sign in as ${PROFILE}`) as any } },
    });
  } catch {
    // Attribute matcher shape varies by SDK version — calibrate from the UI dump.
    await uiContains(session, /$^/, 1);
    throw new Error(
      `Could not tap the "${PROFILE}" profile card. Read .artifacts/appetize/last-ui-dump.json, ` +
        "adjust the attributes matcher (docs.appetize.io/sdk), and update appium/ELEMENT-MAP.md.",
    );
  }
  const signedIn = await uiContains(session, /Today|Ask|Agents|Library|Settings/i, 45_000);
  await shot(page, "sim-010-signed-in");
  expect(signedIn, "expected a root surface after sign-in").toBeTruthy();
});

test("TC-IOS-021 (sim) deep link familios:// keeps the app foregrounded", async ({ session, page }) => {
  await session.openUrl("familios://");
  const alive = await uiContains(session, /Sign in as|Today|Ask|FamiliOS/i, 30_000);
  await shot(page, "sim-021-deeplink");
  expect(alive, "app should handle its URL scheme without crashing").toBeTruthy();
});
