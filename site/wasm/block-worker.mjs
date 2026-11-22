// Validates a block off the page's thread: fetches the module and the saved
// block (or, with `live`, a block near the head straight from public
// nodes), and posts back progress, then the module's verdict and output.
import { bundle, tamper, untar, validate } from "./block.mjs";
import { anchor, archive, atNumber, fetchBlock, headersBetween, olderHashes, pickBlock } from "./live.mjs";
import { fevmPrecompiles, lightClient } from "./lightclient.mjs";

// The saved block the page validates when the public nodes will not serve a live one.
const FALLBACK = "block-0x19335c4.tar.gz";

const PARTS = ["chain", "block", "receipts", "prestate", "diff", "delegates", "proofs"];
const joined = (files) => `{${PARTS.map((p) => `"${p}":${files[p]}`).join(",")}}`;

onmessage = async ({ data }) => {
  const step = (text) => postMessage({ step: text });
  try {
    step(data.live ? "Loading fevm (WebAssembly)…" : "Downloading the block and its parent's proofs…");
    const [bytes, manifest] = await Promise.all([
      // `next/`: the module built with Fe's latest commit (argotorg/fe#2060), no workarounds.
      fetch((data.module ?? "") + "fevm_replay_web.wasm").then((r) => r.arrayBuffer()),
      fetch((data.module ?? "") + "fevm_replay_web.manifest.json").then((r) => r.json()),
    ]);
    let text;
    let live;
    let fallback;
    if (data.live) {
      try {
        const picked = data.number ? await atNumber(data.number, step) : await pickBlock(step);
        const fetched = await fetchBlock(picked.number, bytes, manifest, step);
        live = { ...picked, accounts: fetched.accounts, slots: fetched.slots, files: fetched.files };
        text = joined(fetched.files);
      } catch (e) {
        // A free public node refused (rate limits come and go): say so, and
        // validate a saved mainnet block instead of showing nothing.
        fallback = e.message;
        step(`The public nodes did not serve a live block (${e.message}). Validating a saved mainnet block instead…`);
      }
    }
    if (!data.live || fallback) {
      const archived = data.bytes ?? await fetch(fallback ? FALLBACK : data.archive).then((r) => {
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
    let saved, anchored;
    if (live) {
      step("Asking independent nodes for the block's hash…");
      const hash = JSON.parse(live.files.block).result.hash;
      anchored = { hash, ...await anchor(live.number, hash) };
      try {
        anchored.light = await lightClient(live.number, hash, headersBetween, step, data.checkpoint, fevmPrecompiles(bytes, manifest));
      } catch (e) {
        anchored.light = { error: e.message };
      }
      saved = await archive(hex(live.number), live.files);
    }
    // The module's SHA-256, so the page can say which build ran (the same as
    // the repository's file at the deployed commit; the E2E test checks it).
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    postMessage({ done: true, reply, out, ms, sha256, size: bytes.byteLength, live: live && { number: live.number, head: live.head, transactions: live.transactions, accounts: live.accounts, slots: live.slots }, anchored, saved, fallback });
  } catch (e) {
    postMessage({ done: true, error: `${e.name}: ${e.message}` });
  }
};
const hex = (n) => "0x" + n.toString(16);
