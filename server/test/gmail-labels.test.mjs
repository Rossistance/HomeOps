// GMAIL LABELS — the inbox-organize capability (Phase: "triage my promotions").
// Pure-module checks: the tools exist in the provider platform with the right
// gating, and the planner catalog exposes them. The live Gmail round-trip needs
// a reconnected account with the gmail.modify scope (user step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findToolGlobal, providerById } from "../providers.mjs";

test("google provider declares the gmail.modify scope", () => {
  const g = providerById("google");
  const scope = g.scopes.find((s) => s.key === "gmail.modify");
  assert.ok(scope, "gmail.modify scope defined");
  assert.equal(scope.oauthScope, "https://www.googleapis.com/auth/gmail.modify");
  assert.deepEqual(scope.enablesTools, ["gmail.listLabels", "gmail.modifyLabels"]);
});

test("label tools exist with honest risk + approval gating", () => {
  const list = findToolGlobal("gmail.listLabels");
  assert.ok(list, "gmail.listLabels registered");
  assert.equal(list.tool.requiresApproval, false, "listing labels is read-only, no approval");
  const mod = findToolGlobal("gmail.modifyLabels");
  assert.ok(mod, "gmail.modifyLabels registered");
  assert.equal(mod.tool.requiresApproval, true, "modifying messages ALWAYS needs approval");
  assert.equal(mod.tool.risk, "High");
  assert.equal(mod.tool.action, "Write");
  const keys = mod.tool.inputs.map((i) => i.key);
  assert.deepEqual(keys, ["messageIds", "addLabels", "removeLabels"]);
});

test("gmail.search accepts maxResults and stays capped", () => {
  const s = findToolGlobal("gmail.search");
  assert.ok(s.tool.inputs.some((i) => i.key === "maxResults"), "maxResults input exposed");
});
