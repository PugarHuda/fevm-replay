// What a live block's hash rests on, checked as a light client checks it
// (the Altair light client protocol, as Helios and Lodestar implement it):
//
//   checkpoint (one finalized beacon block root, written below)
//     -> its sync committee, proven against that block's state root
//     -> each later committee, signed by the one before (BLS, 2/3 or more)
//     -> a recent beacon header signed by the current committee, and the
//        execution block in it, proven against its body root
//     -> back from that execution block to ours, header by header: each
//        header's keccak256 is the next one's parentHash.
//
// Beacon nodes and RPC nodes only supply data here; every piece is checked.
// The one thing trusted is the checkpoint, as in any light client.
import { bls12_381, keccak_256, sha256 } from "./noble.mjs";

export const BEACONS = ["https://ethereum-beacon-api.publicnode.com", "https://lodestar-mainnet.chainsafe.io"];
// A finalized epoch-boundary block, 21 Nov 2026 (slot 15,704,032, epoch 490,751).
export const CHECKPOINT = { root: "0xa4faecb4aa3a30ee8eb0a1c76dc29cb68d2031fad53aa84dc706cd4d4de477d8", slot: 15704032 };
const GENESIS_VALIDATORS_ROOT = "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95";
// Fork versions by activation epoch, newest first; signatures since Fulu.
const FORKS = [[411392, "0x06000000"]];
const DOMAIN_SYNC_COMMITTEE = "0x07000000";
const DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
const SLOTS_PER_PERIOD = 8192;
const WEAK_SUBJECTIVITY_SLOTS = 14 * 7200; // about two weeks
// Generalized indices since Electra (the state has 64 leaves); the body's is older.
const CURRENT_SYNC_COMMITTEE = 86, NEXT_SYNC_COMMITTEE = 87, FINALIZED_ROOT = 169, EXECUTION_PAYLOAD = 25;

const bytes = (h) => Uint8Array.from((h.startsWith("0x") ? h.slice(2) : h).match(/../g) ?? [], (b) => parseInt(b, 16));
const hex = (b) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const period = (slot) => Math.floor(Number(slot) / SLOTS_PER_PERIOD);

// --- SSZ hash_tree_root, only what these containers need ---
const pad32 = (b) => { const c = new Uint8Array(32); c.set(b); return c; };
const uint = (n, size = 8) => { let v = BigInt(n); const b = new Uint8Array(32); for (let i = 0; i < size; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
function merkleize(chunks, leaves = chunks.length) {
  let width = 1;
  while (width < leaves) width *= 2;
  let layer = chunks.slice();
  while (layer.length < width) layer.push(new Uint8Array(32));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(sha256(cat(layer[i], layer[i + 1])));
    layer = next;
  }
  return layer[0];
}
const pack = (b) => { const out = []; for (let i = 0; i < Math.max(b.length, 1); i += 32) out.push(pad32(b.slice(i, i + 32))); return out; };
const vectorRoot = (b) => merkleize(pack(b));
const byteListRoot = (b, limit) => sha256(cat(merkleize(pack(b), Math.ceil(limit / 32)), uint(b.length)));

export const headerRoot = (h) => merkleize([uint(h.slot), uint(h.proposer_index), bytes(h.parent_root), bytes(h.state_root), bytes(h.body_root)]);
export const executionRoot = (e) => merkleize([
  bytes(e.parent_hash), pad32(bytes(e.fee_recipient)), bytes(e.state_root), bytes(e.receipts_root), vectorRoot(bytes(e.logs_bloom)),
  bytes(e.prev_randao), uint(e.block_number), uint(e.gas_limit), uint(e.gas_used), uint(e.timestamp),
  byteListRoot(bytes(e.extra_data), 32), uint(e.base_fee_per_gas, 32), bytes(e.block_hash), bytes(e.transactions_root),
  bytes(e.withdrawals_root), uint(e.blob_gas_used), uint(e.excess_blob_gas),
]);
const committeeRoot = (c) => sha256(cat(merkleize(c.pubkeys.map((k) => vectorRoot(bytes(k)))), vectorRoot(bytes(c.aggregate_pubkey))));

function branchHolds(leaf, branch, gindex, root) {
  if (branch.length !== Math.floor(Math.log2(gindex))) return false;
  let node = leaf;
  for (let i = 0; i < branch.length; i++) {
    node = (gindex >> i) & 1 ? sha256(cat(bytes(branch[i]), node)) : sha256(cat(node, bytes(branch[i])));
  }
  return hex(node) === root;
}

/** The execution block a light client header carries, proven against its body root. */
function execution(header) {
  if (!branchHolds(executionRoot(header.execution), header.execution_branch, EXECUTION_PAYLOAD, header.beacon.body_root)) {
    throw new Error(`the execution payload at slot ${header.beacon.slot} is not under its body root`);
  }
  return header.execution;
}

/** How many of the committee signed `header` at `signatureSlot`, after checking the aggregate signature. */
function signed(committee, aggregate, header, signatureSlot) {
  const bits = bytes(aggregate.sync_committee_bits);
  const keys = committee.pubkeys.filter((_, i) => (bits[i >> 3] >> (i & 7)) & 1);
  if (keys.length * 3 < committee.pubkeys.length * 2) throw new Error(`only ${keys.length} of ${committee.pubkeys.length} of the sync committee signed slot ${header.slot}`);
  const epoch = Math.floor((Math.max(Number(signatureSlot), 1) - 1) / 32);
  const fork = FORKS.find(([at]) => epoch >= at);
  if (!fork) throw new Error(`no fork version for epoch ${epoch}`);
  const forkDataRoot = merkleize([pad32(bytes(fork[1])), bytes(GENESIS_VALIDATORS_ROOT)]);
  const domain = cat(bytes(DOMAIN_SYNC_COMMITTEE), forkDataRoot.slice(0, 28));
  const signingRoot = merkleize([headerRoot(header), domain]);
  const sigs = bls12_381.longSignatures;
  const ok = sigs.verify(sigs.Signature.fromHex(aggregate.sync_committee_signature.slice(2)), sigs.hash(signingRoot, DST), sigs.aggregatePublicKeys(keys.map((k) => k.slice(2))));
  if (!ok) throw new Error(`the sync committee's signature over slot ${header.slot} does not verify`);
  return keys.length;
}

// --- execution headers: keccak256(rlp(header)) ---
const HEADER = [
  ["parentHash"], ["sha3Uncles"], ["miner"], ["stateRoot"], ["transactionsRoot"], ["receiptsRoot"], ["logsBloom"],
  ["difficulty", 1], ["number", 1], ["gasLimit", 1], ["gasUsed", 1], ["timestamp", 1], ["extraData"], ["mixHash"], ["nonce"],
  ["baseFeePerGas", 1], ["withdrawalsRoot"], ["blobGasUsed", 1], ["excessBlobGas", 1], ["parentBeaconBlockRoot"], ["requestsHash"],
];
const quantity = (h) => { const v = BigInt(h); if (v === 0n) return new Uint8Array(); let s = v.toString(16); if (s.length % 2) s = "0" + s; return bytes(s); };
const rlpLength = (n, base) => { if (n < 56) return Uint8Array.of(base + n); const l = quantity("0x" + n.toString(16)); return cat(Uint8Array.of(base + 55 + l.length), l); };
const rlpBytes = (b) => (b.length === 1 && b[0] < 0x80 ? b : cat(rlpLength(b.length, 0x80), b));
export function blockHash(h) {
  const fields = HEADER.filter(([name]) => h[name] !== undefined).map(([name, isQuantity]) => rlpBytes(isQuantity ? quantity(h[name]) : bytes(h[name])));
  const body = cat(...fields);
  return hex(keccak_256(cat(rlpLength(body.length, 0xc0), body)));
}

async function get(path) {
  let last;
  for (let t = 0; t < 2 * BEACONS.length; t++) {
    const at = BEACONS[t % BEACONS.length];
    try {
      const r = await fetch(at + path);
      if (r.ok) return { body: await r.json(), node: new URL(at).host };
      last = `${new URL(at).host}: HTTP ${r.status}`;
    } catch (e) { last = `${new URL(at).host}: ${e.message}`; }
  }
  throw new Error(last);
}

/**
 * Checks that block `number` with hash `hash` is on the chain the sync
 * committee signs, from the beacon block root `checkpoint` (any finalized
 * root the caller trusts; by default the one above). `headers(from, to)` gives execution
 * headers `from..to` (eth_getBlockByNumber results).
 */
export async function lightClient(number, hash, headers, step = () => {}, root = CHECKPOINT.root) {
  root = root.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(root)) throw new Error(`a checkpoint is a beacon block root (0x and 64 hex digits), not ${root}`);
  step(`Light client: the sync committee at checkpoint ${root.slice(0, 10)}…`);
  const boot = (await get(`/eth/v1/beacon/light_client/bootstrap/${root}`)).body.data;
  const checkpoint = { root, slot: Number(boot.header.beacon.slot) };
  if (hex(headerRoot(boot.header.beacon)) !== root) throw new Error("the bootstrap header is not the checkpoint");
  if (!branchHolds(committeeRoot(boot.current_sync_committee), boot.current_sync_committee_branch, CURRENT_SYNC_COMMITTEE, boot.header.beacon.state_root)) {
    throw new Error("the checkpoint's sync committee is not in its state");
  }
  let committee = boot.current_sync_committee;
  let at = period(boot.header.beacon.slot);
  const optimistic = await get("/eth/v1/beacon/light_client/optimistic_update");
  const now = period(optimistic.body.data.signature_slot);
  const handoffs = [];
  if (now > at) {
    step(`Light client: ${now - at} sync committee handoff${now - at > 1 ? "s" : ""} since the checkpoint…`);
    const updates = (await get(`/eth/v1/beacon/light_client/updates?start_period=${at}&count=${now - at}`)).body;
    for (const { data: u } of updates) {
      if (period(u.signature_slot) !== at) throw new Error(`an update for period ${period(u.signature_slot)} where ${at} was expected`);
      const n = signed(committee, u.sync_aggregate, u.attested_header.beacon, u.signature_slot);
      if (!branchHolds(committeeRoot(u.next_sync_committee), u.next_sync_committee_branch, NEXT_SYNC_COMMITTEE, u.attested_header.beacon.state_root)) {
        throw new Error(`the next sync committee is not in the state at slot ${u.attested_header.beacon.slot}`);
      }
      if (!branchHolds(headerRoot(u.finalized_header.beacon), u.finality_branch, FINALIZED_ROOT, u.attested_header.beacon.state_root)) {
        throw new Error(`the finalized header is not in the state at slot ${u.attested_header.beacon.slot}`);
      }
      handoffs.push({ period: at, signers: n });
      committee = u.next_sync_committee;
      at++;
    }
    if (at !== now) throw new Error(`the nodes gave updates up to period ${at}, not ${now}`);
  }
  const u = optimistic.body.data;
  // A checkpoint other than the one written above must be recent: past the
  // weak subjectivity period (about two weeks), validators who have since
  // left could have signed another history.
  if (root !== CHECKPOINT.root && Number(u.signature_slot) - checkpoint.slot > WEAK_SUBJECTIVITY_SLOTS) {
    throw new Error(`checkpoint ${root.slice(0, 10)}… (slot ${checkpoint.slot}) is older than about two weeks; use a recent finalized root`);
  }
  const signers = signed(committee, u.sync_aggregate, u.attested_header.beacon, u.signature_slot);
  const top = execution(u.attested_header);
  const topNumber = Number(top.block_number);
  if (topNumber < number) throw new Error(`the signed head (${topNumber}) is behind block ${number}; try again in a few seconds`);
  step(`Light client: ${signers} of 512 signed slot ${u.attested_header.beacon.slot} (execution block ${topNumber}); hashing the ${topNumber - number + 1} headers back to block ${number}…`);
  const chain = await headers(number, topNumber);
  let expect = top.block_hash;
  for (let i = chain.length - 1; i >= 0; i--) {
    const h = chain[i];
    if (Number(h.number) !== number + i) throw new Error(`header ${number + i} came back as ${Number(h.number)}`);
    if (blockHash(h) !== expect) throw new Error(`block ${number + i}'s header does not hash to ${expect.slice(0, 10)}…, which the next block (or the signed head) names`);
    expect = h.parentHash;
  }
  if (blockHash(chain[0]) !== hash) throw new Error(`block ${number}'s header does not hash to the validated block's hash`);
  return { checkpoint, builtIn: root === CHECKPOINT.root, handoffs, slot: Number(u.attested_header.beacon.slot), signers, top: topNumber, headers: chain.length, node: optimistic.node };
}
