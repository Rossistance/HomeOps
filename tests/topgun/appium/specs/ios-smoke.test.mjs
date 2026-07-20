// TC-IOS smoke lane (library: top-gun plugin → top-gun-ios/references/ios-test-case-library.md)
// Non-mutating by design: the preview/production .ipa targets the LIVE backend
// (https://homeops-ai.onrender.com). Sign-in uses a no-PIN guest/child profile.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capsName, createDriver, dashboardHint, probeLane } from "../lib/driver.mjs";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".artifacts", "appium");
// The built app talks to its baked-in backend, whose roster is the REAL household —
// set TOPGUN_IOS_PROFILE to a no-PIN member (child/guest) of that household. Unset →
// the spec taps the first profile card and skips if it turns out to be PIN-gated.
const PROFILE = process.env.TOPGUN_IOS_PROFILE || "";
const TABS = ["Today", "Ask", "Agents", "Library", "Settings"];

const lane = probeLane(capsName());
const blocked = lane.classification !== "use now";

let driver;

before(async () => {
  if (blocked) return;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  driver = await createDriver();
  console.log(`[evidence] ${dashboardHint(capsName(), driver.sessionId)}`);
});

after(async () => {
  await driver?.deleteSession().catch(() => {});
});

async function shot(name) {
  const file = path.join(ARTIFACTS, `${name}.png`);
  await driver.saveScreenshot(file);
  console.log(`[evidence] screenshot ${file}`);
}

test("TC-IOS-001 cold start reaches the profile lock screen", { skip: blocked && lane.unblock }, async () => {
  const profileCard = driver.$('-ios predicate string:label BEGINSWITH "Sign in as"');
  await profileCard.waitForExist({ timeout: 45_000 });
  await shot("tc-ios-001-lock");
  assert.ok(await profileCard.isExisting(), "lock screen should list at least one profile");
});

test(`TC-IOS-010 sign in as no-PIN profile (${PROFILE || "first card"})`, { skip: blocked && lane.unblock }, async (t) => {
  const selector = PROFILE
    ? `-ios predicate string:label BEGINSWITH "Sign in as ${PROFILE}"`
    : '-ios predicate string:label BEGINSWITH "Sign in as"';
  const card = driver.$(selector);
  await card.waitForExist({ timeout: 20_000 });
  await card.click();

  // PIN sheet means this member is elevated on a production backend.
  const pinField = driver.$("~Household PIN");
  const gotPin = await pinField.waitForExist({ timeout: 5_000 }).catch(() => false);
  if (gotPin) {
    if (process.env.TOPGUN_IOS_PIN) {
      await pinField.setValue(process.env.TOPGUN_IOS_PIN);
    } else {
      await shot("tc-ios-010-pin-gated");
      t.skip("Tapped profile is PIN-gated — set TOPGUN_IOS_PROFILE to a child/guest member of this household, or set TOPGUN_IOS_PIN.");
      return;
    }
  }
  // Post-auth truth: profile cards leave; some root surface appears.
  await driver.waitUntil(
    async () => !(await driver.$('-ios predicate string:label BEGINSWITH "Sign in as"').isExisting()),
    { timeout: 30_000, timeoutMsg: "profile cards should disappear after sign-in" },
  );
  await shot("tc-ios-010-signed-in");
});

test("TC-IOS-002 background/foreground resume keeps the session", { skip: blocked && lane.unblock }, async () => {
  await driver.execute("mobile: backgroundApp", { seconds: 3 });
  const backToLock = await driver.$('-ios predicate string:label BEGINSWITH "Sign in as"').isExisting();
  await shot("tc-ios-002-resume");
  assert.equal(backToLock, false, "resume must not bounce the session back to the lock screen");
});

test("TC-IOS-020 root tabs are reachable (owner-scoped tabs need TOPGUN_IOS_PIN — see ios-owner-flows)", { skip: blocked && lane.unblock }, async () => {
  // Role-scoped roots differ per profile; assert whichever known tabs this role exposes,
  // and require at least one — a crash or blank shell fails here.
  let reached = 0;
  for (const tab of TABS) {
    const el = driver.$(`-ios predicate string:label == "${tab}" AND type == "XCUIElementTypeButton"`);
    if (await el.isExisting()) {
      await el.click();
      reached += 1;
      await shot(`tc-ios-020-tab-${tab.toLowerCase()}`);
    }
  }
  assert.ok(reached >= 1, `expected at least one root tab from [${TABS.join(", ")}] for profile "${PROFILE}"`);
  console.log(`[coverage] tabs reached for "${PROFILE}": ${reached}/${TABS.length} (role-scoped; not a failure below 5)`);
});
