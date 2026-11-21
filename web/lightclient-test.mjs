// The light client on a recorded mainnet run (fixtures/lightclient.json):
// it must accept the run as recorded, and reject it after any one change a
// lying beacon or RPC node could make.
//
//   node web/lightclient-test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { lightClient } from "../site/wasm/lightclient.mjs";

const rec = JSON.parse(fs.readFileSync(new URL("../fixtures/lightclient.json", import.meta.url), "utf8"));

async function run(change = () => {}) {
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
  return lightClient(rec.number, rec.hash, async () => headers, () => {}, rec.result.checkpoint.root);
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
console.log(`light client: the recorded run holds, all ${Object.keys(lies).length} changes rejected`);
