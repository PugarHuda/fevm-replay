// A block near the chain's head, fetched by the browser itself: what the
// native `fetch-block` and `fetch-proofs` save, asked of public nodes that
// allow it (traces from one, proofs from another). Which accounts and slots
// to prove is not decided here: the module's `witness_keys`, the same Fe as
// `fetch-proofs`, reads the traces and says.
import { instantiate } from "./host.mjs";

export const TRACES = "https://eth.drpc.org";
// Proofs: the first that answers; a batch a node refuses goes to the next.
export const PROOF_NODES = ["https://ethereum-rpc.publicnode.com", "https://eth.rpc.blxrbdn.com", "https://eth.drpc.org"];
export const PROOFS = PROOF_NODES[0];
// Independent nodes asked for the block's hash: the one hash the check rests on.
export const WITNESSES = ["https://ethereum-rpc.publicnode.com", "https://rpc.flashbots.net", "https://mainnet.gateway.tenderly.co"];
const SYSTEM = [
  "0x00000961ef480eb55e80d19ad83579a64c007002",
  "0x0000bbddc7ce488642fb579f8b00f3a590007251",
  "0x000f3df6d732807ef1319fb7b8bb8522d0beac02",
  "0x0000f90827f1c53a10cb7a02335b175320002935",
];
const SLOTS_PER_PROOF = 200; // nodes refuse more than 1,024
const hex = (n) => "0x" + BigInt(n).toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The response text of one call or batch, retried on rate limits and errors.
 * `url` may be a list: each retry goes to the next node in it.
 */
async function post(url, body, tries = 10) {
  const urls = Array.isArray(url) ? url : [url];
  let last = "";
  for (let t = 1; ; t++) {
    const at = urls[(t - 1) % urls.length];
    try {
      const r = await fetch(at, { method: "POST", headers: { "content-type": "application/json" }, body });
      const text = await r.text();
      if (r.ok && !/"error"\s*:/.test(text.slice(0, 400))) return text;
      last = `${new URL(at).host}: HTTP ${r.status} ${text.slice(0, 120)}`;
    } catch (e) {
      last = `${new URL(at).host}: ${e.message}`;
    }
    if (t >= tries) throw new Error(last);
    await sleep(Math.min(400 * t, 3000));
  }
}
const call = (url, method, params) => post(url, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
async function batch(url, calls) {
  const body = JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params })));
  const answers = JSON.parse(await post(url, body));
  if (!Array.isArray(answers) || answers.some((a) => !("result" in a))) throw new Error(`${url}: a batch came back incomplete`);
  return answers.sort((a, b) => a.id - b.id).map((a) => a.result);
}
/** Runs `work` on each item, `width` at a time. */
async function pool(items, width, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(items[i], i); }
  }));
  return out;
}

/** The smallest non-empty block of the few before the head (small blocks have small traces). */
export async function pickBlock(step) {
  step("Asking a node for the chain's head…");
  const head = Number(JSON.parse(await call(PROOF_NODES, "eth_blockNumber", [])).result);
  const numbers = Array.from({ length: 6 }, (_, i) => head - 2 - i);
  const headers = [];
  for (let i = 0; i < numbers.length; i += 3) {
    headers.push(...await batch(PROOF_NODES, numbers.slice(i, i + 3).map((n) => ["eth_getBlockByNumber", [hex(n), false]])));
  }
  const usable = headers.filter((h) => h && h.transactions.length > 0);
  usable.sort((a, b) => a.transactions.length - b.transactions.length);
  return { head, number: Number(usable[0].number), transactions: usable[0].transactions.length };
}

/** Everything `validate_block` reads about block `number`, as the native fetchers save it. */
export async function fetchBlock(number, wasm, manifest, step) {
  const at = hex(number), parent = hex(number - 1);
  step(`Block ${number.toLocaleString("en")}: the block, its receipts and both prestate traces (${TRACES})…`);
  const trace = (diff) => ["debug_traceBlockByNumber", [at, { tracer: "prestateTracer", timeout: "600s", ...(diff ? { tracerConfig: { diffMode: true } } : {}) }]];
  const [chain, block, receipts, prestate, diff] = await Promise.all([
    call(TRACES, "eth_chainId", []),
    call(TRACES, "eth_getBlockByNumber", [at, true]),
    call(TRACES, "eth_getBlockReceipts", [at]),
    call(TRACES, ...trace(false)),
    call(TRACES, ...trace(true)),
  ]);
  step("The request queues at the parent, and the parent's header…");
  const [queues, [parentHeader]] = await Promise.all([
    batch(PROOF_NODES, [[ "eth_getStorageAt", [SYSTEM[0], "0x2", parent]], ["eth_getStorageAt", [SYSTEM[0], "0x3", parent]], ["eth_getStorageAt", [SYSTEM[1], "0x2", parent]]])
      .then(async (three) => [...three, ...await batch(PROOF_NODES, [["eth_getStorageAt", [SYSTEM[1], "0x3", parent]]])]),
    batch(PROOF_NODES, [["eth_getBlockByNumber", [parent, false]]]),
  ]);
  step("fevm-replay's witness_keys (Fe, in this module) reads the traces: what must be proven…");
  const keysDoc = `{"block":${block},"prestate":${prestate},"diff":${diff},"queues":${JSON.stringify(queues)}}`;
  const guest = await instantiate(new Uint8Array(wasm), { manifest, files: { "keys.json": keysDoc } });
  const reply = guest.callReply("witness_keys", "keys.json");
  if (!reply.ok || reply.value !== 1) throw new Error("witness_keys failed: " + JSON.stringify(reply));
  const keys = JSON.parse(guest.host.stdout);
  const pieces = [];
  for (const [address, slots] of keys.accounts) {
    for (let from = 0; ; from += SLOTS_PER_PROOF) {
      pieces.push([address, slots.slice(from, from + SLOTS_PER_PROOF)]);
      if (from + SLOTS_PER_PROOF >= slots.length) break;
    }
  }
  const slotCount = keys.accounts.reduce((n, [, s]) => n + s.length, 0);
  const proofsAt = async (blockTag, label) => {
    const groups = [];
    for (let i = 0; i < pieces.length; i += 3) groups.push(pieces.slice(i, i + 3));
    let done = 0;
    const answers = await pool(groups, 4, async (group) => {
      const results = await batch(PROOF_NODES, group.map(([a, s]) => ["eth_getProof", [a, s, blockTag]]));
      done += group.length;
      step(`Proofs of ${keys.accounts.length} accounts and ${slotCount} slots at ${label} (${PROOFS}): ${Math.min(done, pieces.length)} of ${pieces.length}…`);
      return results;
    });
    return answers.flat();
  };
  const pre = await proofsAt(parent, "the parent");
  const post = await proofsAt(at, "the block");
  step("The system contracts' and delegation targets' code…");
  const codeOf = async (addresses) => {
    const out = {};
    for (let i = 0; i < addresses.length; i += 3) {
      const codes = await batch(PROOF_NODES, addresses.slice(i, i + 3).map((a) => ["eth_getCode", [a, parent]]));
      addresses.slice(i, i + 3).forEach((a, k) => { out[a] = codes[k]; });
    }
    return out;
  };
  const code = await codeOf(SYSTEM);
  const delegates = { delegates: await codeOf(keys.delegates) };
  const proofs = { parent: parentHeader, pre, post, code };
  return {
    files: { chain, block, receipts, prestate, diff, delegates: JSON.stringify(delegates), proofs: JSON.stringify(proofs) },
    accounts: keys.accounts.length,
    slots: slotCount,
  };
}

/** The 256 hashes before the parent, for a block that reads an older one. */
export async function olderHashes(number, step) {
  step("A transaction read an older block's hash: fetching the 256 before the parent…");
  const numbers = Array.from({ length: 256 }, (_, i) => number - 257 + i);
  const groups = [];
  for (let i = 0; i < numbers.length; i += 3) groups.push(numbers.slice(i, i + 3));
  const headers = (await pool(groups, 4, (g) => batch(PROOF_NODES, g.map((n) => ["eth_getBlockByNumber", [hex(n), false]])))).flat();
  return Object.fromEntries(headers.map((h) => [h.number, h.hash]));
}

/** `files` as a gzipped tar of `dir/<name>.json`, the layout `fevm_replay chain <dir>` reads. */
export async function archive(dir, files) {
  const enc = new TextEncoder();
  const parts = [];
  const header = (name, size) => {
    const h = new Uint8Array(512);
    const put = (text, at) => h.set(enc.encode(text), at);
    put(name, 0); put("0000644\0", 100); put("0000000\0", 108); put("0000000\0", 116);
    put(size.toString(8).padStart(11, "0") + "\0", 124); put("00000000000\0", 136);
    put("        ", 148); h[156] = 0x30; put("ustar\0", 257); put("00", 263);
    const sum = h.reduce((a, b) => a + b, 0);
    put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return h;
  };
  for (const [name, text] of Object.entries(files)) {
    const body = enc.encode(text);
    parts.push(header(`${dir}/${name}.json`, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * What the block's hash rests on: the hash each independent node gives for
 * `number`, and how far the block is from the head and from finality.
 * Validation proves the block against its header, and the header against
 * this hash; agreeing nodes are what a light client would have instead.
 */
export async function anchor(number, hash) {
  const asked = await Promise.all(WITNESSES.map(async (url) => {
    try {
      const h = JSON.parse(await call(url, "eth_getBlockByNumber", [hex(number), false])).result;
      return { node: new URL(url).host, hash: h && h.hash };
    } catch (e) {
      return { node: new URL(url).host, hash: null };
    }
  }));
  let finalized = null;
  try {
    finalized = Number(JSON.parse(await call(PROOF_NODES, "eth_getBlockByNumber", ["finalized", false])).result.number);
  } catch (e) { /* only shown when known */ }
  return {
    agree: asked.filter((a) => a.hash === hash).map((a) => a.node),
    differ: asked.filter((a) => a.hash && a.hash !== hash).map((a) => a.node),
    silent: asked.filter((a) => !a.hash).map((a) => a.node),
    finalized,
  };
}
