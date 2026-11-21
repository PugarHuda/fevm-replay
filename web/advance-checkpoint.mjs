// The light client's own way to a newer checkpoint: from the one written in
// site/wasm/lightclient.mjs, through every sync committee handoff (each
// signature checked by noble and by fevm's BLS12-381 precompiles), to the
// finalized header of the latest finality update. The result is then
// compared with what public checkpoint sync providers (checkpointz) call
// finalized, as Helios cross-checks a checkpoint.
//
//   node web/advance-checkpoint.mjs            report only
//   node web/advance-checkpoint.mjs --write    also write it into lightclient.mjs
import fs from "node:fs";
import { CHECKPOINT, advance, fevmPrecompiles } from "../site/wasm/lightclient.mjs";

const PROVIDERS = ["https://sync-mainnet.beaconcha.in", "https://beaconstate.ethstaker.cc", "https://mainnet-checkpoint-sync.attestant.io"];
const wasmDir = new URL("../site/wasm/", import.meta.url);
const fevm = fevmPrecompiles(fs.readFileSync(new URL("fevm_replay_web.wasm", wasmDir)), JSON.parse(fs.readFileSync(new URL("fevm_replay_web.manifest.json", wasmDir), "utf8")));

let r, agree = [];
for (let attempt = 1; attempt <= 3; attempt++) {
  r = await advance(CHECKPOINT.root, (s) => console.error(s), fevm);
  const roots = await Promise.all(PROVIDERS.map(async (p) => {
    try { return "0x" + (await (await fetch(p + "/eth/v1/beacon/blocks/finalized/root")).json()).data.root.replace(/^0x/, ""); } catch { return null; }
  }));
  agree = PROVIDERS.filter((_, i) => roots[i] === r.next.root).map((p) => new URL(p).host);
  if (agree.length >= 2) break;
  console.error(`finality moved on while asking (${agree.length} of ${PROVIDERS.length} agree); again in a minute`);
  await new Promise((ok) => setTimeout(ok, 60000));
}
const days = ((r.next.slot - r.from.slot) * 12 / 86400).toFixed(1);
console.log(`checkpoint ${r.from.root.slice(0, 10)}… (slot ${r.from.slot}) -> ${r.next.root} (slot ${r.next.slot}, ${days} days on): ` +
  `${r.handoffs.length} handoff(s), ${r.signers}/512 signed the finality update, ${r.byFevm} signature(s) also checked by fevm; ` +
  `${agree.length} of ${PROVIDERS.length} checkpoint sync providers give the same finalized root (${agree.join(", ")})`);
if (agree.length < 2) process.exit(1);
if (process.argv.includes("--write")) {
  const file = new URL("lightclient.mjs", wasmDir);
  const date = new Date().toISOString().slice(0, 10);
  const text = fs.readFileSync(file, "utf8").replace(
    /\/\/ A finalized epoch-boundary block, [^\n]*\nexport const CHECKPOINT = \{[^\n]*\};/,
    `// A finalized block, ${date}, reached by web/advance-checkpoint.mjs from the one before (slot ${r.next.slot.toLocaleString("en")}).\nexport const CHECKPOINT = { root: "${r.next.root}", slot: ${r.next.slot} };`,
  );
  fs.writeFileSync(file, text);
  console.log("written to site/wasm/lightclient.mjs");
}
