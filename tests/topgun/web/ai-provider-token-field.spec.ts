import { expect, test } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-007 s1 (ISS-006) — local AI providers accept an OPTIONAL API token.
 *
 * LM Studio's 2025+ builds refuse unauthenticated requests (401 invalid_api_key),
 * but FamiliOS's provider metadata marked local providers needsKey:false so the
 * Settings card rendered no key field at all — the local-model path was dead with
 * no way to fix it from the UI. This spec pins the UI half of the fix: the LM
 * Studio card renders an optional token field with honest helper text.
 *
 * The LIVE half of the acceptance ("Test connection green with a real token")
 * is DEFERRED-ON-GATE: LM Studio is not running on this host and the token is
 * user-owned. This spec deliberately makes no network claim about LM Studio.
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test("the LM Studio provider card renders an optional API token field with honest helper text", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signUpDisposableHousehold(page);

  await openScreen(page, "Settings");
  // The AI providers panel lives inside Settings (AIProvidersPanel).
  await expect(page.getByText("LM Studio").first()).toBeVisible({ timeout: 15_000 });

  // NOTE: the ui Field component renders its <label> without htmlFor (a11y gap,
  // logged for a later polish pass), so getByLabel cannot associate — locate the
  // write-only input by its keyOptional placeholder and the label by text.
  const labelText = page.getByText(/API token \(optional\)/).first();
  await labelText.scrollIntoViewIfNeeded();
  await expect(labelText, "the optional token label must render for the keyOptional local provider").toBeVisible();
  const tokenField = page.getByPlaceholder(/Only needed if your local server requires one|saved — leave blank to keep/).first();
  await expect(tokenField, "the optional token field must render for the keyOptional local provider").toBeVisible();
  await expect(
    page.getByText(/Newer LM Studio builds require an API token/i).first(),
    "the helper text must name where the token lives",
  ).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE_DIR}/wp007s1-token-field.png`, fullPage: true });
  errors.assertClean();
});
