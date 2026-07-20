#!/usr/bin/env node
// Top Gun iOS device-cloud runner.
//   node tests/topgun/appium/run.mjs --probe               → classify the lane (matcher hook)
//   node tests/topgun/appium/run.mjs --caps browserstack   → run specs via node --test
// Exit codes: probe always 0 (prints JSON classification); run forwards node --test's code.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTopgunEnv } from "./lib/env.mjs";
import { probeLane } from "./lib/driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

loadTopgunEnv();
const caps = value("--caps", process.env.TOPGUN_CAPS || "browserstack");
process.env.TOPGUN_CAPS = caps;

if (flag("--probe")) {
  const result = probeLane(caps);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const probe = probeLane(caps);
if (probe.classification !== "use now") {
  console.error(`[topgun:ios] lane "${caps}" is ${probe.classification.toUpperCase()}`);
  console.error(`[topgun:ios] unblock: ${probe.unblock ?? probe.error}`);
  console.error("[topgun:ios] Nothing was executed — this is a blocked lane, not a pass.");
  process.exit(2);
}

const specDir = path.join(here, "specs");
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", "--test-reporter=spec", specDir],
  { stdio: "inherit", env: { ...process.env, TOPGUN_CAPS: caps } },
);
child.on("exit", (code) => process.exit(code ?? 1));
