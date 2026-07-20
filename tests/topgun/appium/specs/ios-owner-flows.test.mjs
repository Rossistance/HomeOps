// TC-IOS owner flows — PIN-gated on production-mode backends. Runs only when
// TOPGUN_IOS_PIN is set (the render backend PIN-gates Owner/Adult Admin).
// Still non-mutating: navigation + rendering truth only. Mutation cases require
// TOPGUN_ALLOW_MUTATIONS=1 AND a disposable backend/tenant (see docs/SETUP-CLOUD.md).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capsName, createDriver, dashboardHint, probeLane } from "../lib/driver.mjs";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".artifacts", "appium");
const OWNER = "Alex Harper";
const PIN = process.env.TOPGUN_IOS_PIN;
const TABS = ["Today", "Ask", "Agents", "Library", "Settings"];

const lane = probeLane(capsName());
const skip =
  lane.classification !== "use now"
    ? lane.unblock
    : !PIN
      ? "TOPGUN_IOS_PIN not set — owner flows are PIN-gated on production backends"
      : false;

let driver;

before(async () => {
  if (skip) return;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  driver = await createDriver();
  console.log(`[evidence] ${dashboardHint(capsName(), driver.sessionId)}`);
});

after(async () => {
  await driver?.deleteSession().catch(() => {});
});

const shot = async (name) => {
  const file = path.join(ARTIFACTS, `${name}.png`);
  await driver.saveScreenshot(file);
  console.log(`[evidence] screenshot ${file}`);
};

test("TC-IOS-010b owner signs in with PIN", { skip }, async () => {
  const card = driver.$(`-ios predicate string:label BEGINSWITH "Sign in as ${OWNER}"`);
  await card.waitForExist({ timeout: 45_000 });
  await card.click();

  const pinField = driver.$("~Household PIN");
  await pinField.waitForExist({ timeout: 15_000 });
  await pinField.setValue(PIN);
  for (const label of ["Sign in", "Unlock", "Continue"]) {
    const btn = driver.$(`-ios predicate string:label == "${label}" AND type == "XCUIElementTypeButton"`);
    if (await btn.isExisting()) {
      await btn.click();
      break;
    }
  }
  await driver.waitUntil(
    async () => !(await driver.$('-ios predicate string:label BEGINSWITH "Sign in as"').isExisting()),
    { timeout: 30_000, timeoutMsg: "owner sign-in did not complete — wrong PIN or backend unreachable" },
  );
  await shot("tc-ios-010b-owner-in");
});

test("TC-IOS-020b owner tab round-trip (Today/Ask/Agents/Library/Settings)", { skip }, async () => {
  for (const tab of TABS) {
    const el = driver.$(`-ios predicate string:label == "${tab}" AND type == "XCUIElementTypeButton"`);
    await el.waitForExist({ timeout: 15_000 });
    await el.click();
    await shot(`tc-ios-020b-${tab.toLowerCase()}`);
  }
  assert.ok(true);
});

test("TC-IOS-030b Ask surface exposes the composer", { skip }, async () => {
  const ask = driver.$('-ios predicate string:label == "Ask" AND type == "XCUIElementTypeButton"');
  if (await ask.isExisting()) await ask.click();
  const composer = driver.$("~Message");
  await composer.waitForExist({ timeout: 15_000 });
  assert.ok(await composer.isExisting(), 'composer with accessibilityLabel "Message" should exist on Ask');
  await shot("tc-ios-030b-ask");
});
