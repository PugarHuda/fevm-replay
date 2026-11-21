// Validates a block off the page's thread: fetches the module and the saved
// block, and posts back progress, then the module's verdict and output.
import { bundle, tamper, untar, validate } from "./block.mjs";

onmessage = async ({ data }) => {
  try {
    postMessage({ step: "Downloading the block and its parent's proofs…" });
    const [bytes, manifest, archive] = await Promise.all([
      fetch("fevm_replay_web.wasm").then((r) => r.arrayBuffer()),
      fetch("fevm_replay_web.manifest.json").then((r) => r.json()),
      data.bytes ?? fetch(data.archive).then((r) => {
        if (!r.ok) throw new Error(`${data.archive}: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    postMessage({ step: "Unpacking…" });
    let text = bundle(await untar(archive));
    if (data.tamper) {
      // One transaction's recorded gas used, raised by one: fevm's own
      // receipt no longer matches the node's.
      text = tamper(text);
    }
    postMessage({ step: `Running fevm on ${(text.length / 1e6).toFixed(1)} MB of block, traces and proofs…` });
    const { reply, out, ms } = await validate(bytes, manifest, text);
    postMessage({ done: true, reply, out, ms, size: bytes.byteLength });
  } catch (e) {
    postMessage({ done: true, error: `${e.name}: ${e.message}` });
  }
};
