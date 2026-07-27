// One category, one colour, everywhere it's spelled differently.
//
// "Each category gets its own colour… to accomplish this we're going to need to expand the
//  colour palette across the app."
//
// The failure this prevents is subtle and was already happening: the same category arrives as
// "Bills" on an agent, "Bills & Receipts" in the Library, and "bills-receipts" as a stored tag.
// Three spellings resolving to three colours means a green chip filtering a yellow card, and
// nobody would file that as a bug — they'd just quietly stop trusting the colours.
import test from "node:test";
import assert from "node:assert/strict";
import { categoryLook, titleCase } from "../theme/categories.ts";

const tone = (s) => categoryLook(s).tone;

test("the same category is the same colour however it's spelled", () => {
  for (const group of [
    ["Bills", "Bills & Receipts", "bills-receipts", "BILLS AND RECEIPTS", "receipts"],
    ["Medical", "Medical & IDs", "medical-ids", "Health", "doctor visits"],
    ["Meals", "Meals & Groceries", "grocery list", "Recipes"],
    ["School", "School & activities", "Homework Helper", "daycare"],
  ]) {
    const tones = group.map(tone);
    assert.equal(new Set(tones).size, 1, `${group[0]}: split across ${[...new Set(tones)].join(", ")}`);
  }
});

test("different categories are DIFFERENT colours — the whole point", () => {
  // The reported state was every one of these rendering ember.
  const names = ["Household", "Meals", "Briefing", "Bills & Receipts", "Subscriptions", "Medical", "Caregiving"];
  const tones = names.map(tone);
  assert.ok(new Set(tones).size >= 5, `only ${new Set(tones).size} distinct colours across ${names.length} categories`);
  // Specifically the four he named as all-orange on the New Agent screen.
  const four = ["Bills & Receipts", "Subscriptions", "Medical", "Caregiving"].map(tone);
  assert.ok(!four.every((t) => t === "ember"), "the four New Agent categories must not all be ember");
});

test("an unknown category still gets a colour of its own, and the SAME one every time", () => {
  // The alternative is falling back to ember, which recreates the pile this file exists to
  // break up — a category we've never seen is still a category.
  const a = tone("Summer Camp Logistics");
  const b = tone("Summer Camp Logistics");
  assert.equal(a, b, "stable across calls, or a card changes colour when you scroll past it");
  assert.ok(a, "an unknown category still resolves");
});

test("every category gets an icon that isn't the generic one", () => {
  // "They actually share just this playbook icon, whereas the icon should be more geared
  // towards the title of these categories."
  const icons = ["Medical", "Bills", "Meals", "School", "Documents", "Caregiving", "Home Maintenance"]
    .map((n) => categoryLook(n).icon);
  assert.equal(new Set(icons).size, icons.length, `icons repeat: ${icons.join(", ")}`);
});

test("specific beats general — School supplies is School, not Errands", () => {
  assert.equal(tone("School supplies"), tone("School"));
  assert.notEqual(tone("Medical records"), tone("Documents"));
});

test("titleCase capitalises titles without shouting or flattening", () => {
  assert.equal(titleCase("assign chore"), "Assign Chore");
  assert.equal(titleCase("new age"), "New Age");
  // Small words stay small in the middle, never at the edges.
  assert.equal(titleCase("family and events"), "Family and Events");
  assert.equal(titleCase("errands & shopping"), "Errands & Shopping");
  assert.equal(titleCase("and then"), "And Then");
  // Deliberate caps survive: "IDs" must not become "Ids".
  assert.equal(titleCase("Medical & IDs"), "Medical & IDs");
  // …but a whole string in caps is shouting, and gets normalised rather than preserved.
  assert.equal(titleCase("BILLS AND RECEIPTS"), "Bills and Receipts");
  assert.equal(titleCase(""), "");
  assert.equal(titleCase(null), "");
});
