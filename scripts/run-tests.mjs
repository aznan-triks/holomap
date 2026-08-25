// Runs every test/test-*.mjs suite in a child process (each already calls
// bilan(), which process.exit(1)s on failure) and reports a combined summary.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testDir = join(here, "..", "test");
const suites = readdirSync(testDir).filter(f => /^test-.*\.mjs$/.test(f)).sort();

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const res = spawnSync(process.execPath, [join(testDir, suite)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log(`\n${suites.length - failed}/${suites.length} suites ok`);
if (failed > 0) process.exit(1);
