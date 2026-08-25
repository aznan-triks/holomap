// This is a standalone working copy of the plugin, developed OUTSIDE any
// vault it's meant to be tested in — auto-copying into whatever ".obsidian"
// folder happens to sit next to it would be a guess, and could land in the
// wrong vault (this folder's parent isn't necessarily the one used for
// testing). So this step never auto-installs: it just points at the build
// output, ready to be copied into a vault's .obsidian/plugins/holomap/ by
// hand.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..");

const files = ["main.js", "manifest.json"];
const stylesPath = join(pluginRoot, "styles.css");
if (existsSync(stylesPath)) files.push("styles.css");

console.log(`Build output ready in ${pluginRoot}:`);
for (const f of files) console.log(`  ${f}`);
console.log(`Copy those files into <your vault>/.obsidian/plugins/holomap/ to test.`);
