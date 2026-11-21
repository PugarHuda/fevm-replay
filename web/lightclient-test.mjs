// The light client on a recorded mainnet run (fixtures/lightclient.json):
// it must accept the run as recorded, and reject it after any one change a
// lying beacon or RPC node could make.
//
//   node web/lightclient-test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { fevmHashToG2, fevmPrecompiles, fevmVerifies, lightClient, nobleHashToG2, signingRoot } from "../site/wasm/lightclient.mjs";

const rec = JSON.parse(fs.readFileSync(new URL("../fixtures/lightclient.json", import.meta.url), "utf8"));

async function run(change = () => {}, fevm) {
  const beacon = structuredClone(rec.beacon);
  const headers = structuredClone(rec.headers);
  const bootstrap = Object.keys(beacon).find((p) => p.includes("/bootstrap/"));
  change({ boot: beacon[bootstrap].data, update: beacon[Object.keys(beacon).find((p) => p.includes("/updates"))][0].data, head: beacon["/eth/v1/beacon/light_client/optimistic_update"].data, headers });
  // A node answers every bootstrap with the recorded one, whatever root is asked.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    const body = path.includes("/bootstrap/") ? beacon[bootstrap] : beacon[path];
    return { ok: !!body, status: body ? 200 : 404, json: async () => body };
  };
  return lightClient(rec.number, rec.hash, async () => headers, () => {}, rec.result.checkpoint.root, fevm);
}

const flip = (h, at = 10) => h.slice(0, at) + (h[at] === "0" ? "1" : "0") + h.slice(at + 1);

const ok = await run();
assert.equal(ok.signers, rec.result.signers);
assert.equal(ok.top, rec.result.top);
console.log(`recorded run: ${ok.handoffs.length} handoff(s), ${ok.signers}/512 signed slot ${ok.slot}, ${ok.headers} headers back to ${rec.number}`);

const lies = {
  "head's signature (a valid one, over another header)": ({ head, update }) => { head.sync_aggregate.sync_committee_signature = update.sync_aggregate.sync_committee_signature; },
  "head's signature (not a curve point)": ({ head }) => { head.sync_aggregate.sync_committee_signature = flip(head.sync_aggregate.sync_committee_signature, 40); },
  "a signer left out of the head's bits": ({ head }) => { const b = head.sync_aggregate.sync_committee_bits; const i = b.search(/[1-9a-f]/i); head.sync_aggregate.sync_committee_bits = b.slice(0, i) + (parseInt(b[i], 16) & (parseInt(b[i], 16) - 1)).toString(16) + b.slice(i + 1); },
  "the signed head's slot": ({ head }) => { head.attested_header.beacon.slot = String(Number(head.attested_header.beacon.slot) + 1); },
  "the signed head's execution block hash": ({ head }) => { head.attested_header.execution.block_hash = flip(head.attested_header.execution.block_hash); },
  "the signed head's execution block number": ({ head }) => { head.attested_header.execution.block_number = String(Number(head.attested_header.execution.block_number) + 1); },
  "a header's gasUsed": ({ headers }) => { headers[0].gasUsed = "0x" + (Number(headers[0].gasUsed) + 1).toString(16); },
  "a header's parentHash": ({ headers }) => { headers[1].parentHash = flip(headers[1].parentHash); },
  "the handoff's signature (a valid one, over another header)": ({ update }) => { update.sync_aggregate.sync_committee_signature = rec.beacon["/eth/v1/beacon/light_client/optimistic_update"].data.sync_aggregate.sync_committee_signature; },
  "a key of the next committee": ({ update }) => { update.next_sync_committee.pubkeys[7] = update.next_sync_committee.pubkeys[8]; },
  "the finalized header in the handoff": ({ update }) => { update.finalized_header.beacon.slot = String(Number(update.finalized_header.beacon.slot) + 32); },
  "a key of the checkpoint's committee": ({ boot }) => { boot.current_sync_committee.pubkeys[3] = boot.current_sync_committee.pubkeys[4]; },
  "the checkpoint header": ({ boot }) => { boot.header.beacon.proposer_index = String(Number(boot.header.beacon.proposer_index) + 1); },
};
for (const [what, change] of Object.entries(lies)) {
  const e = await run(change).then(() => null, (e) => e);
  assert.ok(e, `accepted with a changed ${what}`);
  console.log(`rejected: ${what} (${e.message})`);
}

// fevm's BLS12-381 precompiles (EIP-2537, in Fe, in the module) on the same
// signatures: the recorded run holds with both checked by fevm too, and fevm
// alone refuses a valid signature over another header and a key set with one
// signer left out.
const wasmDir = new URL("../site/wasm/", import.meta.url);
const fevm = fevmPrecompiles(
  fs.readFileSync(process.env.WASM ?? new URL("fevm_replay_web.wasm", wasmDir)),
  JSON.parse(fs.readFileSync(process.env.MANIFEST ?? new URL("fevm_replay_web.manifest.json", wasmDir), "utf8")),
);
const both = await run(() => {}, fevm);
assert.equal(both.byFevm, 2);
const head = rec.beacon["/eth/v1/beacon/light_client/optimistic_update"].data;
const update = rec.beacon[Object.keys(rec.beacon).find((p) => p.includes("/updates"))][0].data;
const bits = Uint8Array.from(head.sync_aggregate.sync_committee_bits.slice(2).match(/../g), (b) => parseInt(b, 16));
const keys = update.next_sync_committee.pubkeys.filter((_, i) => (bits[i >> 3] >> (i & 7)) & 1);
const signed = { keys, signingRoot: signingRoot(head.attested_header.beacon, head.signature_slot), signature: head.sync_aggregate.sync_committee_signature };
assert.equal(await fevmVerifies(fevm, signed), true);
assert.equal(await fevmVerifies(fevm, { ...signed, signature: update.sync_aggregate.sync_committee_signature }), false);
assert.equal(await fevmVerifies(fevm, { ...signed, keys: keys.slice(1) }), false);
// Hashing to G2: fevm (MAP_FP2_TO_G2 twice, G2 add) and noble (checked by its
// authors against RFC 9380's vectors) must give the same point, for the
// recorded signing roots and a few other messages.
const messages = [signed.signingRoot, signingRoot(update.attested_header.beacon, update.signature_slot), new Uint8Array(0), new TextEncoder().encode("abc"), new Uint8Array(200).fill(0x61)];
for (const m of messages) assert.equal(await fevmHashToG2(fevm, m), nobleHashToG2(m));
console.log(`hash to G2: fevm and noble give the same point for ${messages.length} messages`);
console.log(`fevm's BLS12-381 precompiles: both recorded signatures verify; another header's signature and a missing signer are refused`);
console.log(`light client: the recorded run holds, all ${Object.keys(lies).length} changes rejected`);
