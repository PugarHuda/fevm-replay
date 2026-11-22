// A saved block (`fevm_replay fetch` and `fetch-proofs`, as a .tar.gz) as the
// one JSON document `validate_block` reads, and the call itself. Used by the
// page's worker and by web/test.mjs.
import { instantiate } from "./host.mjs";

const PARTS = ["chain", "block", "receipts", "prestate", "diff", "delegates", "proofs"];

/** The files of a gzipped tar archive, by name without its directory. */
export async function untar(gzipped) {
  const head = new Uint8Array(gzipped, 0, Math.min(2, gzipped.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    throw new Error("this file is not a .tar.gz (it does not start as gzip does); save a block with fevm_replay fetch and fetch-proofs, then tar czf");
  }
  const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip"));
  let tar;
  try {
    tar = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new Error(`this .tar.gz does not decompress (${e.message}): it is cut short or damaged`);
  }
  const files = {};
  const text = (bytes) => new TextDecoder().decode(bytes).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = text(tar.subarray(at, at + 100));
    if (name === "") break;
    const size = parseInt(text(tar.subarray(at + 124, at + 136)).trim() || "0", 8);
    const type = String.fromCharCode(tar[at + 156]);
    if (type === "0" || type === "\0") {
      files[name.split("/").pop()] = tar.subarray(at + 512, at + 512 + size);
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The document `validate_block` reads: each saved response under its name. */
export function bundle(files) {
  const decoder = new TextDecoder();
  const body = PARTS.map((part) => {
    const file = files[`${part}.json`];
    if (file === undefined) throw new Error(`the archive has no ${part}.json`);
    return `"${part}":${decoder.decode(file)}`;
  });
  return `{${body.join(",")}}`;
}

/**
 * `text` with the first transaction's receipt claiming one more gas used than
 * it did: fevm runs the transaction and its own receipt no longer matches.
 */
export function tamper(text) {
  const at = text.indexOf('"receipts":');
  const rest = text.slice(at).replace(/("gasUsed":"0x)([0-9a-f]+)"/, (_, head, hex) => `${head}${(BigInt("0x" + hex) + 1n).toString(16)}"`);
  return text.slice(0, at) + rest;
}

/** Runs `validate_block` on `text`: the reply and what the module printed. */
export async function validate(bytes, manifest, text) {
  const guest = await instantiate(new Uint8Array(bytes), { manifest, files: { "block.json": text } });
  const started = performance.now();
  const reply = guest.callReply("validate_block", "block.json");
  return { reply, out: guest.host.stdout, ms: performance.now() - started };
}
