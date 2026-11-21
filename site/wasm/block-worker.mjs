// Validates a block off the page's thread: fetches the module and the saved
// block (or, with `live`, a block near the head straight from public
// nodes), and posts back progress, then the module's verdict and output.
import { bundle, tamper, untar, validate } from "./block.mjs";
import { archive, fetchBlock, olderHashes, pickBlock } from "./live.mjs";

const PARTS = ["chain", "block", "receipts", "prestate", "diff", "delegates", "proofs"];
const joined = (files) => `{${PARTS.map((p) => `"${p}":${files[p]}`).join(",")}}`;

onmessage = async ({ data }) => {
  const step = (text) => postMessage({ step: text });
  try {
    step(data.live ? "Loading fevm (WebAssembly)…" : "Downloading the block and its parent's proofs…");
    const [bytes, manifest] = await Promise.all([
      fetch("fevm_replay_web.wasm").then((r) => r.arrayBuffer()),
      fetch("fevm_replay_web.manifest.json").then((r) => r.json()),
    ]);
    let text;
    let live;
    if (data.live) {
      const picked = await pickBlock(step);
      const fetched = await fetchBlock(picked.number, bytes, manifest, step);
      live = { ...picked, accounts: fetched.accounts, slots: fetched.slots, files: fetched.files };
      text = joined(fetched.files);
    } else {
      const archived = data.bytes ?? await fetch(data.archive).then((r) => {
        if (!r.ok) throw new Error(`${data.archive}: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      step("Unpacking…");
      text = bundle(await untar(archived));
    }
    if (data.tamper) {
      // One transaction's recorded gas used, raised by one: fevm's own
      // receipt no longer matches the node's.
      text = tamper(text);
    }
    step(`Running fevm on ${(text.length / 1e6).toFixed(1)} MB of block, traces and proofs…`);
    let result = await validate(bytes, manifest, text);
    if (live && /a hash before the parent's is not in the node's traces/.test(result.out)) {
      const delegates = JSON.parse(live.files.delegates);
      delegates.blockHashes = await olderHashes(live.number, step);
      live.files.delegates = JSON.stringify(delegates);
      text = joined(live.files);
      step("Running fevm again, with the older hashes…");
      result = await validate(bytes, manifest, text);
    }
    const { reply, out, ms } = result;
    let saved;
    if (live) saved = await archive(hex(live.number), live.files);
    postMessage({ done: true, reply, out, ms, size: bytes.byteLength, live: live && { number: live.number, head: live.head, transactions: live.transactions, accounts: live.accounts, slots: live.slots }, saved });
  } catch (e) {
    postMessage({ done: true, error: `${e.name}: ${e.message}` });
  }
};
const hex = (n) => "0x" + n.toString(16);
