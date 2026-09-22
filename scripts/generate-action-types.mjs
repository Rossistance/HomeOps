// Writes the clients' generated action types from the server's declarations (ADR-003).
//   npm run generate:actions        (an explicit step — NOT part of `npm run build`, see below)
// Both copies in GENERATED_TARGETS are written from one render; CI's
// action-types-generated.test.mjs fails if either committed copy drifts from a fresh render.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The registry reaches the store at import time — store.mjs mkdirs the data dir and opens
// the tenant engine as it loads. This generator ALWAYS points that at a throwaway dir,
// even when HOMEOPS_DATA_DIR is set, and the reason is a production outage: Render puts
// the service's HOMEOPS_DATA_DIR=/data into the BUILD environment too, the disk behind
// /data is not mounted while building, and a `??=` here kept the real value — so five
// deploys in a row died ~40s in, at mkdir. Rendering types must never touch real data,
// on any machine; overriding is the only honest setting.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-gen-"));
process.env.HOMEOPS_SECRET_KEY = "generate-action-types-throwaway-key-32";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ACTIONS } = await import("../server/actions/registry.mjs");
const { renderActionsTs, GENERATED_TARGETS } = await import("../server/actions/emit-ts.mjs");

const ts = renderActionsTs(ACTIONS);
for (const rel of GENERATED_TARGETS) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const before = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  fs.writeFileSync(p, ts, "utf8");
  console.log(`${before === ts ? "unchanged" : before === null ? "created  " : "updated  "} ${rel}`);
}
