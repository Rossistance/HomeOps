// Twelve names, twelve colours — never six oranges again.
//
// BUG-01: "the color options it gives me after that are all similar orange colors." Six
// identity hues were added to the picker and never taught to the resolver; each returned
// null and rendered as the ember fallback. This test walks the WHOLE list through the real
// resolver against the real theme, so the list and the switch can never drift apart again —
// the bug existed precisely because nothing connected them.
import test from "node:test";
import assert from "node:assert/strict";
import { ACCENTS, memberAccent, colorDistance, TOO_CLOSE, heldBy } from "./member-colors.ts";
import { lightColors as light, darkColors as dark } from "../theme/colors-data.ts";

for (const [name, colors] of [["light", light], ["dark", dark]]) {
  test(`every offered accent resolves to a real colour (${name} theme)`, () => {
    for (const a of ACCENTS) {
      assert.notEqual(memberAccent(colors, a), null, `"${a}" fell through the switch — that IS the six-oranges bug`);
    }
  });

  test(`no two accents resolve to the same colour (${name} theme)`, () => {
    const resolved = ACCENTS.map((a) => memberAccent(colors, a));
    assert.equal(new Set(resolved).size, ACCENTS.length, "two names, one swatch — indistinguishable people");
  });
}

test("the pair he named as indistinguishable IS caught by the closeness rule", () => {
  // "Even G-pop and Beanie's are too close together to actually tell what they are."
  // Not amber-vs-coral (those differ) — the real case was two of the six fallback oranges,
  // i.e. literally the same colour. Distance 0 must obviously collide…
  assert.ok(colorDistance("#e8853d", "#e8853d") < TOO_CLOSE);
  // …and near-identical oranges must too:
  assert.ok(colorDistance("#e8853d", "#e2803a") < TOO_CLOSE, "within two deviations = taken");
  // …while genuinely different hues must not:
  assert.ok(colorDistance("#e8853d", "#4a90d9") >= TOO_CLOSE);
});

test("heldBy names the person you'd collide with, and clears when the colour is free", () => {
  const colors = light;
  const others = [{ actorId: "m-1", displayName: "GPop", color: "amber" }];
  assert.equal(heldBy(colors, "amber", others)?.displayName, "GPop");
  assert.equal(heldBy(colors, "sky", others), null);
});
