// Where the WebAssembly this page runs came from, checked in the browser: the
// module's SHA-256 is looked up in GitHub's attestations for this repository
// (public, no sign-in), and the Sigstore bundle found is verified here with
// WebCrypto alone, no library and no server of ours:
//
//   1. the attestation's subject is this module's digest;
//   2. the DSSE envelope is signed by the key in the Fulcio certificate;
//   3. that certificate chains to Sigstore's Fulcio root (pinned below);
//   4. the certificate names this repository, the workflow that built the site
//      (pages.yml on main) and the commit;
//   5. the signature was logged in Rekor while the certificate was valid (the
//      time is Rekor's signed entry timestamp, checked with its key): the
//      entry is the envelope's, it is included in the log's tree (RFC 6962
//      inclusion proof) and the tree's checkpoint is signed by Rekor's key.
//
// Trust roots: Sigstore's public-good instance, from
// github.com/sigstore/root-signing targets/trusted_root.json (Fulcio CA valid
// from 2022-04-13, Rekor log wNI9atQG…). Usable in Node.js 22+ too.

const REPO = "PugarHuda/fevm-replay";
const WORKFLOW = `https://github.com/${REPO}/.github/workflows/pages.yml@refs/heads/main`;
const FULCIO = [
  // sigstore-intermediate
  "MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMwKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV77LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYBBQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjpKFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZIzj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJRnZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsPmygUY7Ii2zbdCdliiow=",
  // sigstore (root)
  "MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMwKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMTEwMDcxMzU2NTlaFw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjERMA8GA1UEAxMIc2lnc3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7XeFT4rb3PQGwS4IajtLk3/OlnpgangaBclYpsYBr5i+4ynB07ceb3LP0OIOZdxexX69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2GHE7SXrk1EC5m1Tr19L9gg92jYzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRYwB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6zJChkyLQKsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCMWP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9TNMea7Ix/stJ5TfcLLeABLE4BNJOsQ4vnBHJ",
];
const REKOR_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw==";
const REKOR_KEY_ID = "wNI9atQGlz+VWfO6LRygH4QUfY/8W4RFwiT5i5WRgB0=";

const subtle = globalThis.crypto.subtle;
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => new TextEncoder().encode(s);
const text = (u) => new TextDecoder().decode(u);
const sha256 = async (u) => new Uint8Array(await subtle.digest("SHA-256", u));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// DER, as much of it as certificates need: tag, contents, the whole element.
function tlv(u, at) {
  const tag = u[at];
  let len = u[at + 1];
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + u[at + 2 + i];
    head = 2 + n;
  }
  return { tag, body: u.subarray(at + head, at + head + len), all: u.subarray(at, at + head + len), end: at + head + len };
}
function children(u) {
  const out = [];
  for (let at = 0; at < u.length; ) { const t = tlv(u, at); out.push(t); at = t.end; }
  return out;
}
function oid(u) {
  const parts = [Math.floor(u[0] / 40), u[0] % 40];
  let v = 0;
  for (const b of u.subarray(1)) { v = v * 128 + (b & 0x7f); if (!(b & 0x80)) { parts.push(v); v = 0; } }
  return parts.join(".");
}
function time(t) {
  const s = text(t.body);
  const full = t.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? "20" : "19") + s : s; // UTCTime or GeneralizedTime
  return Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14));
}

/** The parts of an X.509 certificate the checks use. */
export function parseCert(der) {
  const [tbs, alg, sig] = children(tlv(der, 0).body);
  const f = children(tbs.body);
  const i = f[0].tag === 0xa0 ? 1 : 0; // [0] version
  const [notBefore, notAfter] = children(f[i + 3].body).map(time);
  const ext = {};
  const exts = f.slice(i + 6).find((e) => e.tag === 0xa3);
  if (exts) {
    for (const e of children(tlv(exts.body, 0).body)) {
      const parts = children(e.body);
      ext[oid(parts[0].body)] = parts[parts.length - 1].body;
    }
  }
  return {
    tbs: tbs.all, alg: oid(children(alg.body)[0].body), sig: sig.body.subarray(1),
    issuer: f[i + 2].all, subject: f[i + 4].all, spki: f[i + 5].all, notBefore, notAfter, ext,
  };
}

const CURVES = { "1.2.840.10045.3.1.7": ["P-256", 32], "1.3.132.0.34": ["P-384", 48] };
const HASHES = { "1.2.840.10045.4.3.2": "SHA-256", "1.2.840.10045.4.3.3": "SHA-384" };

async function ecKey(spki) {
  const [algo] = children(tlv(spki, 0).body);
  const [curve, size] = CURVES[oid(children(algo.body)[1].body)];
  return { key: await subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: curve }, false, ["verify"]), size };
}
// An ECDSA signature as DER (r, s) to WebCrypto's fixed-width r || s.
function raw(sig, size) {
  const [r, s] = children(tlv(sig, 0).body).map((t) => t.body);
  const pad = (x) => { const v = x.subarray(Math.max(0, x.length - size)); const o = new Uint8Array(size); o.set(v, size - v.length); return o; };
  return concat(pad(r), pad(s));
}
async function ecVerify(spki, hash, sig, data) {
  const { key, size } = await ecKey(spki);
  return subtle.verify({ name: "ECDSA", hash }, key, raw(sig, size), data);
}
// The value of a Fulcio extension (a DER UTF8String inside the octet string).
const fulcio = (cert, n) => {
  const v = cert.ext[`1.3.6.1.4.1.57264.1.${n}`];
  return v && text(tlv(v, 0).body);
};

// RFC 6962 inclusion proof (RFC 9162, 2.1.3.2): does the leaf at `index`, with
// these sibling hashes, give the tree's root?
async function included(leaf, index, size, hashes, root) {
  if (index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of hashes) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = await sha256(concat([1], p, r));
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else {
      r = await sha256(concat([1], r, p));
    }
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(r, root);
}

/**
 * Verifies one Sigstore bundle (v0.3, DSSE) for a module with this SHA-256.
 * Returns what it established; throws, naming the step, when a check fails.
 */
export async function verifyBundle(bundle, digest) {
  const env = bundle.dsseEnvelope;
  const payload = b64(env.payload);
  const statement = JSON.parse(text(payload));
  // 1. The subject.
  if (!statement.subject.some((s) => s.digest?.sha256 === digest)) throw new Error("the attestation is not for this module's digest");
  // 2. The envelope's signature, by the certificate's key (DSSE's PAE).
  const cert = parseCert(b64(bundle.verificationMaterial.certificate.rawBytes));
  const pae = concat(utf8(`DSSEv1 ${utf8(env.payloadType).length} ${env.payloadType} ${payload.length} `), payload);
  if (!(await ecVerify(cert.spki, "SHA-256", b64(env.signatures[0].sig), pae))) throw new Error("the envelope's signature does not verify with the certificate's key");
  // 3. The certificate chain, up to the pinned Fulcio root.
  const chain = FULCIO.map((c) => parseCert(b64(c)));
  let child = cert;
  for (const ca of chain) {
    if (!equal(child.issuer, ca.subject)) throw new Error("the certificate was not issued by Sigstore's Fulcio CA");
    if (!(await ecVerify(ca.spki, HASHES[child.alg], child.sig, child.tbs))) throw new Error("a certificate in the chain does not verify");
    child = ca;
  }
  // 4. Who built it: this repository, the site's workflow, a commit.
  const repo = fulcio(cert, 12), signer = fulcio(cert, 9), commit = fulcio(cert, 13), trigger = fulcio(cert, 20);
  if (repo !== `https://github.com/${REPO}`) throw new Error(`built from ${repo}, not ${REPO}`);
  if (signer !== WORKFLOW) throw new Error(`signed by ${signer}, not the site's workflow`);
  // 5. Rekor: the entry is this envelope's, it is in the log, and the log's
  // checkpoint is signed by Rekor; the certificate was valid when it was logged.
  const entry = bundle.verificationMaterial.tlogEntries[0];
  if (entry.logId.keyId !== REKOR_KEY_ID) throw new Error("the entry is in a log this page does not know");
  const proof = entry.inclusionProof;
  // entry.logIndex is the global index (in the signed timestamp below);
  // proof.logIndex is the index in the log's current shard (in its tree).
  // The time it was logged is only Rekor's word if Rekor signed it: the signed
  // entry timestamp covers the body, the time, the log and the index
  // (canonical JSON, keys in order).
  const set = JSON.stringify({
    body: entry.canonicalizedBody,
    integratedTime: Number(entry.integratedTime),
    logID: hex(b64(entry.logId.keyId)),
    logIndex: Number(entry.logIndex),
  });
  if (!(await ecVerify(b64(REKOR_KEY), "SHA-256", b64(entry.inclusionPromise.signedEntryTimestamp), utf8(set)))) {
    throw new Error("the log entry's timestamp is not signed by Rekor");
  }
  const when = Number(entry.integratedTime) * 1000;
  if (when < cert.notBefore || when > cert.notAfter) throw new Error("the signature was logged outside the certificate's ten minutes");
  const body = b64(entry.canonicalizedBody);
  const logged = JSON.parse(text(body));
  // The logged entry is this envelope, signed by this certificate.
  if (logged.spec?.payloadHash?.value !== hex(await sha256(payload))) throw new Error("the log entry is not this envelope's");
  const loggedSigs = logged.spec?.signatures ?? [];
  const certPem = (der) => `-----BEGIN CERTIFICATE-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const ourCert = b64(bundle.verificationMaterial.certificate.rawBytes);
  if (!loggedSigs.some((s) => s.signature === env.signatures[0].sig && text(b64(s.verifier)) === certPem(ourCert))) {
    throw new Error("the log entry was signed by another certificate");
  }

  const root = b64(proof.rootHash);
  if (!(await included(await sha256(concat([0], body)), Number(proof.logIndex), Number(proof.treeSize), proof.hashes.map(b64), root))) {
    throw new Error("the entry is not included in the log's tree");
  }
  const [note, signature] = proof.checkpoint.envelope.split("\n\n");
  const [, size, rootB64] = note.split("\n");
  if (size !== proof.treeSize || rootB64 !== proof.rootHash) throw new Error("the checkpoint is for another tree");
  const sig = b64(signature.trim().split(" ").pop()).subarray(4); // a 4-byte key hint, then the signature
  if (!(await ecVerify(b64(REKOR_KEY), "SHA-256", sig, utf8(note + "\n")))) throw new Error("the log's checkpoint is not signed by Rekor");
  return { repo, workflow: signer, commit, trigger, logIndex: Number(entry.logIndex), logged: new Date(when) };
}

/** Finds this module's attestations on GitHub and verifies them; the first that holds wins. */
export async function provenance(digest, fetcher = fetch) {
  const r = await fetcher(`https://api.github.com/repos/${REPO}/attestations/sha256:${digest}`);
  if (r.status === 404) throw new Error("GitHub has no attestation for this module's digest");
  if (!r.ok) throw new Error(`GitHub's attestation API answered ${r.status}${r.status === 403 ? " (its limit is 60 requests an hour without sign-in)" : ""}`);
  const { attestations } = await r.json();
  let last;
  for (const a of attestations) {
    try { return await verifyBundle(a.bundle, digest); } catch (e) { last = e; }
  }
  throw last ?? new Error("no attestation");
}
