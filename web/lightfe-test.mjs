// light.fe (the light client's whole check, in Fe, inside the module) on a
// block near the head, then refused when any part of the nodes' answers is
// changed. Needs the network. node web/lightfe-test.mjs [wasm-dir]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { pickBlock, atNumber, fetchBlock, headersBetween } from "../site/wasm/live.mjs";
import { lightClient, lightClientInFe, fevmPrecompiles } from "../site/wasm/lightclient.mjs";

const dir = process.argv[2] ? pathToFileURL(process.argv[2] + "/") : new URL("../site/wasm/", import.meta.url);
const wasm = fs.readFileSync(new URL("fevm_replay_web.wasm", dir));
const manifest = JSON.parse(fs.readFileSync(new URL("fevm_replay_web.manifest.json", dir), "utf8"));
const module = { wasm, manifest };
const picked = await atNumber((await pickBlock(() => {})).head - 3, () => {});
const block = await fetchBlock(picked.number, wasm, manifest, () => {});
const hash = JSON.parse(block.files.block).result.hash;
const light = await lightClient(picked.number, hash, headersBetween, () => {}, undefined, fevmPrecompiles(wasm, manifest), module);
if (!light.inFe?.ok) { console.error("FAIL: light.fe refused the real chain:", light.inFe); process.exit(1); }
console.log(`light.fe holds: block ${picked.number}, ${light.handoffs.length} handoff(s), ${light.signers}/512, ${light.headers} headers`);

const d = light.inFeDoc;
const copy = () => structuredClone(d);
const flip = (h) => h.slice(0, -1) + (h.endsWith("0") ? "1" : "0");
const changed = {
  "the head's signature (another real one)": () => { const c = copy(); c.head.sync_aggregate.sync_committee_signature = (c.updates[0] ?? c.head).sync_aggregate.sync_committee_signature === c.head.sync_aggregate.sync_committee_signature ? c.head.sync_aggregate.sync_committee_signature : c.updates[0].sync_aggregate.sync_committee_signature; return c; },
  "the head's signature (not a point)": () => { const c = copy(); c.head.sync_aggregate.sync_committee_signature = flip(c.head.sync_aggregate.sync_committee_signature); return c; },
  "the head's participation bits": () => { const c = copy(); const b = c.head.sync_aggregate.sync_committee_bits; c.head.sync_aggregate.sync_committee_bits = b.slice(0, 2) + (b[2] === "f" ? "e" : "f") + b.slice(3); return c; },
  "an execution header": () => { const c = copy(); c.headers[0].stateRoot = flip(c.headers[0].stateRoot); return c; },
  "the signed head's execution block hash": () => { const c = copy(); c.head.attested_header.execution.block_hash = flip(c.head.attested_header.execution.block_hash); return c; },
  "a committee key": () => { const c = copy(); c.boot.current_sync_committee.pubkeys[0] = c.boot.current_sync_committee.pubkeys[1]; return c; },
  "the checkpoint": () => { const c = copy(); c.checkpoint = flip(c.checkpoint); return c; },
};
for (const [what, make] of Object.entries(changed)) {
  const r = await lightClientInFe(module, make());
  if (r.ok) { console.error(`FAIL: light.fe accepted a changed ${what}`); process.exit(1); }
  console.log(`refused, ${what} changed: ${r.error.split("\n")[0].slice(0, 120)}`);
}
