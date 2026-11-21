// The browser page's check, from a terminal, with nothing but Node.js (22 or
// later): the same WebAssembly module (fevm and fevm-replay's validation,
// compiled from Fe) and the same fetcher.
//
//   node site/wasm/cli.mjs                 a block near the chain's head
//   node site/wasm/cli.mjs 26461751        that block (within ~100 of the head)
//   node site/wasm/cli.mjs block.tar.gz    a saved block (fetch + fetch-proofs)
//   ... --save                             also write the fetched block as <0xnumber>.tar.gz
//   ... --checkpoint 0x<beacon block root> the light client starts from this finalized root
//
// Exits 0 if every transaction matched and every root in the header held.
import fs from "node:fs";
import { bundle, untar, validate } from "./block.mjs";
import { anchor, archive, atNumber, fetchBlock, headersBetween, olderHashes, pickBlock } from "./live.mjs";
import { lightClient } from "./lightclient.mjs";

const here = new URL("./", import.meta.url);
const wasm = fs.readFileSync(new URL("fevm_replay_web.wasm", here));
const manifest = JSON.parse(fs.readFileSync(new URL("fevm_replay_web.manifest.json", here), "utf8"));
const args = process.argv.slice(2);
const save = args.includes("--save");
const at = args.indexOf("--checkpoint");
const checkpoint = at >= 0 ? args[at + 1] : undefined;
const arg = args.find((a, i) => a !== "--save" && a !== "--checkpoint" && args[i - 1] !== "--checkpoint");
const step = (text) => process.stderr.write(text + "\n");
const PARTS = ["chain", "block", "receipts", "prestate", "diff", "delegates", "proofs"];
const joined = (files) => `{${PARTS.map((p) => `"${p}":${files[p]}`).join(",")}}`;

let text, live;
if (arg && arg.endsWith(".gz")) {
  text = bundle(await untar(fs.readFileSync(arg)));
} else {
  const picked = arg ? await atNumber(Number(arg), step) : await pickBlock(step);
  const fetched = await fetchBlock(picked.number, wasm, manifest, step);
  live = { ...picked, files: fetched.files };
  text = joined(fetched.files);
}
step(`Running fevm on ${(text.length / 1e6).toFixed(1)} MB of block, traces and proofs…`);
let result = await validate(wasm, manifest, text);
if (live && /a hash before the parent's is not in the node's traces/.test(result.out)) {
  const delegates = JSON.parse(live.files.delegates);
  delegates.blockHashes = await olderHashes(live.number, step);
  live.files.delegates = JSON.stringify(delegates);
  result = await validate(wasm, manifest, joined(live.files));
}
process.stdout.write(result.out);
const ok = result.reply.ok && result.reply.value === 1;
if (live) {
  const hash = JSON.parse(live.files.block).result.hash;
  const a = await anchor(live.number, hash);
  console.log(`block ${live.number} (${live.head - live.number} behind the head${a.finalized != null && a.finalized >= live.number ? ", finalized" : ""}): hash ${hash} given by eth.drpc.org${a.agree.map((n) => ", " + n).join("")}` +
    (a.differ.length ? `; DIFFERENT at ${a.differ.join(", ")}` : ""));
  let light;
  try {
    light = await lightClient(live.number, hash, headersBetween, step, checkpoint);
    console.log(`light client: from checkpoint ${light.checkpoint.root.slice(0, 10)}… (slot ${light.checkpoint.slot}), ${light.handoffs.length} sync committee handoff(s), ${light.signers}/512 signed slot ${light.slot} (execution block ${light.top}), ${light.headers} headers hashed back to this block: its hash is the chain's`);
  } catch (e) {
    console.log(`light client: could not confirm the hash (${e.message})`);
  }
  if (save) {
    const name = "0x" + live.number.toString(16);
    fs.writeFileSync(`${name}.tar.gz`, Buffer.from(await (await archive(name, live.files)).arrayBuffer()));
    console.log(`saved ${name}.tar.gz (tar xzf ${name}.tar.gz && fevm_replay chain ${name})`);
  }
  if (a.differ.length) process.exit(1);
}
console.log(ok ? `every root holds (${(result.ms / 1000).toFixed(2)} s in WebAssembly)` : "the block does NOT validate as given");
process.exit(ok ? 0 : 1);
