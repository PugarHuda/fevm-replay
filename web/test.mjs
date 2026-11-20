// Runs the WebAssembly build of web/ on the real proofs the site serves, as
// the browser page does:  node web/test.mjs [module.wasm]
// Every proof must hold, and a tampered slot value must not.
import fs from "node:fs";
import assert from "node:assert/strict";
import { instantiate } from "../site/wasm/host.mjs";

const dir = new URL("../site/wasm/", import.meta.url);
const wasm = fs.readFileSync(process.argv[2] ?? new URL("fevm_replay_web.wasm", dir));
const manifest = JSON.parse(fs.readFileSync(new URL("fevm_replay_web.manifest.json", dir), "utf8"));

async function verify(name, text) {
  const guest = await instantiate(wasm, { manifest, files: { [name]: text } });
  const reply = guest.callReply("verify", name);
  return { reply, out: guest.host.stdout };
}

for (const name of ["usdt.json", "usdc.json"]) {
  const text = fs.readFileSync(new URL(name, dir), "utf8");
  const ok = await verify(name, text);
  assert.deepEqual(ok.reply, { ok: true, value: 1 }, ok.out);
  assert.equal((ok.out.match(/  proven/g) ?? []).length, 3, ok.out);
  const doc = JSON.parse(text);
  doc.storageProof[0].value = "0x1234";
  const bad = await verify(name, JSON.stringify(doc));
  assert.deepEqual(bad.reply, { ok: true, value: 0 }, bad.out);
  doc.stateRoot = "0x" + "11".repeat(32);
  const wrong = await verify(name, JSON.stringify(doc));
  assert.match(wrong.out, /does NOT hold/);
  console.log(`${name}: proven; a tampered value and a wrong state root are refused`);
}
