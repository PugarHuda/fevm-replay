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

// A whole mainnet block, validated statelessly by fevm in the module: the
// fixture CI validates natively, with the same verdict and every root.
import { bundle, tamper, untar, validate } from "../site/wasm/block.mjs";
const archive = fs.readFileSync(new URL("../fixtures/proven/0x19335e5.tar.gz", import.meta.url));
const block = bundle(await untar(archive));
const good = await validate(wasm, manifest, block);
assert.deepEqual(good.reply, { ok: true, value: 1 }, good.out);
for (const line of [
  "71/71 transactions MATCH",
  "receipts: fevm's 71 receipts hash to the header's receiptsRoot",
  "hash to the header's requestsHash",
  "end state: 213 accounts and 521 slots proven against the block's state root, 0 differ",
  "hashes to the header's stateRoot",
]) {
  assert.ok(good.out.includes(line), `missing "${line}" in:\n${good.out}`);
}
const bad = await validate(wasm, manifest, tamper(block));
assert.deepEqual(bad.reply, { ok: true, value: 0 }, bad.out);
assert.match(bad.out, /70\/71 transactions MATCH/);
console.log(`block 26,424,805: every root holds (${(good.ms / 1000).toFixed(2)} s); a receipt claiming one more gas is caught`);

// A block whose transactions run long stretches of opcodes: fevm's handlers
// tail-call each other, and each one still takes a frame of the module's own
// stack, so this one needs more than Fe's default 1 MiB (--wasm-stack-size).
const deep = bundle(await untar(fs.readFileSync(new URL("block-0x19335c4.tar.gz", dir))));
const big = await validate(wasm, manifest, deep);
assert.deepEqual(big.reply, { ok: true, value: 1 }, big.out);
assert.ok(big.out.includes("286/286 transactions MATCH"), big.out);
assert.ok(big.out.includes("hashes to the header's stateRoot"), big.out);
console.log(`block 26,424,772: every root holds (${(big.ms / 1000).toFixed(2)} s), on a 64 MiB stack`);

// What to prove: the module's witness_keys picks the same accounts and slots
// as the native fetch-proofs did for the fixture (its saved proofs).
{
  const files = await untar(archive);
  const text = (name) => new TextDecoder().decode(files[`${name}.json`]);
  const proofs = JSON.parse(text("proofs"));
  const queue = (address, slot) => {
    const account = proofs.pre.find((a) => a.address.toLowerCase() === address);
    return account.storageProof.find((s) => BigInt(s.key) === BigInt(slot)).value;
  };
  const requests = ["0x00000961ef480eb55e80d19ad83579a64c007002", "0x0000bbddc7ce488642fb579f8b00f3a590007251"];
  const queues = requests.flatMap((a) => [queue(a, 2), queue(a, 3)]);
  const doc = `{"block":${text("block")},"prestate":${text("prestate")},"diff":${text("diff")},"queues":${JSON.stringify(queues)}}`;
  const guest = await instantiate(wasm, { manifest, files: { "keys.json": doc } });
  assert.deepEqual(guest.callReply("witness_keys", "keys.json"), { ok: true, value: 1 });
  const keys = JSON.parse(guest.host.stdout);
  const set = (entries) => new Set(entries.flatMap(([a, slots]) => [a.toLowerCase(), ...slots.map((s) => `${a.toLowerCase()}:${BigInt(s)}`)]));
  const mine = set(keys.accounts);
  const native = set(proofs.pre.map((a) => [a.address, a.storageProof.map((s) => s.key)]));
  assert.equal(mine.size, native.size);
  for (const key of native) assert.ok(mine.has(key), key);
  console.log(`witness_keys: the same ${keys.accounts.length} accounts and ${mine.size - keys.accounts.length} slots as fetch-proofs`);
}

// What the page saves for `fevm_replay chain`: a gzipped tar that unpacks to
// the same files (the browser writes it with no library).
{
  const { archive } = await import("../site/wasm/live.mjs");
  const files = { chain: '{"result":"0x1"}', block: "x".repeat(1000), proofs: "" };
  const blob = await archive("0x10", files);
  const back = await untar(new Uint8Array(await blob.arrayBuffer()));
  for (const [name, text] of Object.entries(files)) {
    assert.equal(new TextDecoder().decode(back[`${name}.json`]), text, name);
  }
  console.log("live.mjs archive: a gzipped tar that untars to the same files");
}
