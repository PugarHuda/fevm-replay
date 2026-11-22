// The browser's provenance check (site/wasm/provenance.mjs), against GitHub's
// real attestations for the committed modules, and refused when any part of
// a real bundle is changed.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { provenance, verifyBundle } from "../site/wasm/provenance.mjs";

const file = process.argv[2] ?? "site/wasm/fevm_replay_web.wasm";
const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// In CI, GitHub's token lifts the API's limit of 60 requests an hour.
const auth = process.env.GH_TOKEN ? { headers: { authorization: `Bearer ${process.env.GH_TOKEN}` } } : {};
const get = (url) => fetch(url, auth);
const got = await provenance(digest, get);
console.log(`provenance: ${file} (${digest.slice(0, 12)}…) built by ${got.workflow} at ${got.commit.slice(0, 7)}, Rekor entry ${got.logIndex}`);

const r = await get(`https://api.github.com/repos/PugarHuda/fevm-replay/attestations/sha256:${digest}`);
const bundle = (await r.json()).attestations[0].bundle;
const flip = (b64s, at) => { const u = Buffer.from(b64s, "base64"); u[at] ^= 1; return u.toString("base64"); };
const changed = {
  "another digest": [bundle, "0".repeat(64)],
  "the payload": [{ ...bundle, dsseEnvelope: { ...bundle.dsseEnvelope, payload: flip(bundle.dsseEnvelope.payload, 40) } }, digest],
  "the signature": [{ ...bundle, dsseEnvelope: { ...bundle.dsseEnvelope, signatures: [{ sig: flip(bundle.dsseEnvelope.signatures[0].sig, 20) }] } }, digest],
  "the certificate": [{ ...bundle, verificationMaterial: { ...bundle.verificationMaterial, certificate: { rawBytes: flip(bundle.verificationMaterial.certificate.rawBytes, 300) } } }, digest],
  "the inclusion proof": [{ ...bundle, verificationMaterial: { ...bundle.verificationMaterial, tlogEntries: [{ ...bundle.verificationMaterial.tlogEntries[0], inclusionProof: { ...bundle.verificationMaterial.tlogEntries[0].inclusionProof, hashes: [flip(bundle.verificationMaterial.tlogEntries[0].inclusionProof.hashes[0], 0), ...bundle.verificationMaterial.tlogEntries[0].inclusionProof.hashes.slice(1)] } }] } }, digest],
  "the log's checkpoint": [{ ...bundle, verificationMaterial: { ...bundle.verificationMaterial, tlogEntries: [{ ...bundle.verificationMaterial.tlogEntries[0], inclusionProof: { ...bundle.verificationMaterial.tlogEntries[0].inclusionProof, checkpoint: { envelope: bundle.verificationMaterial.tlogEntries[0].inclusionProof.checkpoint.envelope.replace(/^rekor\.sigstore\.dev/, "rekor.example.org") } } }] } }, digest],
  "the logged time": [{ ...bundle, verificationMaterial: { ...bundle.verificationMaterial, tlogEntries: [{ ...bundle.verificationMaterial.tlogEntries[0], integratedTime: String(Number(bundle.verificationMaterial.tlogEntries[0].integratedTime) + 60) }] } }, digest],
};
for (const [what, [b, d]] of Object.entries(changed)) {
  try { await verifyBundle(b, d); console.error(`FAIL: a changed ${what} was accepted`); process.exit(1); }
  catch (e) { console.log(`refused, ${what} changed: ${e.message}`); }
}
