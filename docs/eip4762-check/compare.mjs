// fevm-replay's EIP-4762 witness charges (replay_core::gas4762, the Fe the
// native tool runs, here through the WebAssembly module's `witness_gas`)
// against an independent implementation: ethereumjs's BinaryTreeAccessWitness
// (EIP-4762's costs on EIP-7864's tree, with its own key derivation), fed the
// same accesses for every transaction of saved mainnet blocks.
//
//   npm ci && node compare.mjs <block dir or .tar.gz>...
//
// The accesses are those the traces show (fevm-replay's approximations, the
// same on both sides): each account a transaction read, except its sender
// and target, whose headers EIP-4762 makes free; each slot it read; each
// write in its diff (the sender's, and the target's when value moves, free);
// code deposited; and, for the code-chunk path, a fixed sample of chunks of
// the target's code. ethereumjs does not charge EIP-4762's fill cost yet
// (6,200 a leaf written from nothing), so the leaves filled are counted here
// from the diff and charged at that rate.
import fs from "node:fs";
import path from "node:path";
import { BinaryTreeAccessWitness } from "@ethereumjs/evm";
import { createAddressFromString } from "@ethereumjs/util";
import { sha256 } from "@noble/hashes/sha2";
import { instantiate } from "../../site/wasm/host.mjs";
import { bundle, untar } from "../../site/wasm/block.mjs";

const wasmDir = new URL("../../site/wasm/", import.meta.url);
const wasm = new Uint8Array(fs.readFileSync(process.env.WASM ?? new URL("fevm_replay_web.wasm", wasmDir)));
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST ?? new URL("fevm_replay_web.manifest.json", wasmDir), "utf8"));
const FILL = 6200n;
const n = (h) => (h == null ? 0n : BigInt(h));
const precompile = (a) => n(a) >= 1n && n(a) <= 0x11n;

async function load(arg) {
  if (arg.endsWith(".gz")) return JSON.parse(bundle(await untar(fs.readFileSync(arg))));
  const read = (p) => JSON.parse(fs.readFileSync(path.join(arg, p + ".json"), "utf8"));
  return { block: read("block"), receipts: read("receipts"), prestate: read("prestate"), diff: read("diff") };
}

// A fixed sample of the target's code chunks: the first, every 7th, and one
// past 128 if the code is that long (a chunk outside the header's stem).
function sampleChunks(tx, prestate) {
  const target = tx.to && prestate[tx.to.toLowerCase()];
  if (!target || !target.code || target.code.length <= 2) return {};
  const count = Math.ceil((target.code.length - 2) / 2 / 31);
  const chunks = [];
  for (let c = 0; c < count; c += 7) chunks.push(c);
  if (count > 130) chunks.push(130);
  return { [tx.to.toLowerCase()]: chunks };
}

function ethereumjs(tx, receipt, prestate, pre, post, chunks, coinbase) {
  const aw = new BinaryTreeAccessWitness({ hashFunction: sha256 });
  const at = (a) => createAddressFromString(a);
  const origin = tx.from.toLowerCase();
  const target = (receipt.contractAddress ?? tx.to ?? "").toLowerCase();
  let gas = 0n, fills = 0n;
  for (const [address, account] of Object.entries(prestate)) {
    if (precompile(address)) continue;
    if (address !== origin && address !== target) gas += aw.readAccountBasicData(at(address));
    for (const slot of Object.keys(account.storage ?? {})) gas += aw.readAccountStorage(at(address), n(slot));
  }
  for (const [address, list] of Object.entries(chunks)) {
    for (const c of list) gas += aw.readAccountCodeChunks(at(address), c * 31, c * 31);
  }
  const written = new Set();
  const write = (key, cost, fill) => { if (!written.has(key)) { written.add(key); if (fill) fills++; } gas += cost; };
  for (const [address, account] of Object.entries(post)) {
    const existed = address in pre;
    const free = address === origin || (address === target && n(tx.value) !== 0n);
    if (!free && ("balance" in account || "nonce" in account || "code" in account)) write(`${address}/basic`, aw.writeAccountBasicData(at(address)), !existed);
    if ("code" in account) {
      write(`${address}/codehash`, aw.writeAccountCodeHash(at(address)), !existed);
      const count = Math.ceil((account.code.length - 2) / 2 / 31);
      for (let c = 0; c < count; c++) write(`${address}/chunk/${c}`, aw.writeAccountCodeChunks(at(address), c * 31, c * 31), true);
    }
    for (const [slot, value] of Object.entries(account.storage ?? {})) {
      write(`${address}/slot/${n(slot)}`, aw.writeAccountStorage(at(address), n(slot)), n(pre[address]?.storage?.[slot]) === 0n);
    }
  }
  for (const [address, account] of Object.entries(pre)) {
    for (const slot of Object.keys(account.storage ?? {})) {
      if (post[address]?.storage?.[slot] !== undefined) continue;
      write(`${address}/slot/${n(slot)}`, aw.writeAccountStorage(at(address), n(slot)), false);
    }
  }
  return { gas, fills };
}

let txs = 0, same = 0, blocks = 0, filled = 0n, total = 0n;
for (const arg of process.argv.slice(2)) {
  const doc = await load(arg);
  const list = doc.block.result.transactions;
  const chunks = list.map((tx, i) => sampleChunks(tx, doc.prestate.result[i].result));
  const guest = await instantiate(wasm, { manifest, files: { "gas.json": JSON.stringify({ ...doc, chunks: chunks.map((c) => Object.fromEntries(Object.entries(c).map(([a, l]) => [a, l.map((x) => "0x" + x.toString(16))]))) }) } });
  const reply = guest.callReply("witness_gas", "gas.json");
  if (!reply.ok || reply.value !== 1) throw new Error(`${arg}: witness_gas failed: ${JSON.stringify(reply)}`);
  const fe = JSON.parse(guest.host.stdout);
  let diffs = 0;
  list.forEach((tx, i) => {
    const d = doc.diff.result[i].result;
    const js = ethereumjs(tx, doc.receipts.result[i], doc.prestate.result[i].result, d.pre, d.post, chunks[i], doc.block.result.miner.toLowerCase());
    const ours = BigInt(fe[i][0]);
    txs++; total += ours; filled += js.fills;
    if (ours === js.gas + js.fills * FILL) same++;
    else if (diffs++ < 3) console.log(`  DIFF ${arg} tx ${i} ${tx.hash}: Fe ${ours}, ethereumjs ${js.gas} + ${js.fills} fills`);
  });
  blocks++;
  console.log(`${path.basename(arg)}: ${list.length - diffs}/${list.length} transactions, the same witness gas`);
}
console.log(`EIP-4762 witness gas, Fe vs ethereumjs ${JSON.parse(fs.readFileSync(new URL("./node_modules/@ethereumjs/evm/package.json", import.meta.url))).version}: ${same}/${txs} transactions in ${blocks} blocks the same (${total} gas; ${filled} leaves filled, charged here as ethereumjs does not yet)`);
process.exit(same === txs ? 0 : 1);
