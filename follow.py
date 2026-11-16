"""Follow the chain head and validate each block statelessly with fevm-replay.

    python3 follow.py <fevm_replay> <work-dir> <out.json> [minutes] [rpc-url]

With 0 minutes it runs `chain` again on every block already recorded (for
a newer tool), keeping the fetch times.

Every round takes the block two behind the head, saves it (fetch-block),
fetches the parent's and the block's proofs (fetch-proofs) and runs
`chain` on it, then appends what `chain` printed to <out.json>: the
transactions that matched, whether every root in the header did, and the
witness. A block that cannot be proven (the node errs, or the block left
the ~100-block proof window) is recorded as such. The verdicts come from
the Fe tool; this script only schedules it and copies numbers from its
output.
"""
import json, re, subprocess, sys, time, urllib.request, os
from datetime import datetime, timezone

tool, work, out = sys.argv[1], sys.argv[2], sys.argv[3]
minutes = float(sys.argv[4]) if len(sys.argv) > 4 else 60
rpc = sys.argv[5] if len(sys.argv) > 5 else "https://ethereum-rpc.publicnode.com"


def head():
    req = urllib.request.Request(rpc, data=b'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
                                 headers={"content-type": "application/json", "user-agent": "fevm-replay"})
    return int(json.load(urllib.request.urlopen(req, timeout=20))["result"], 16)


def run(*args, timeout=1500):
    p = subprocess.run([tool, *args], capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr


def number(pattern, text, default=0):
    m = re.search(pattern, text)
    return int(m.group(1)) if m else default


def analyze(record, d):
    code, text = run("chain", d)
    m = re.search(r"(\d+)/(\d+) transactions MATCH", text)
    b = re.search(r"estimated for the same keys: (\d+) stems, (\d+) values, (\d+) to (\d+) KiB", text)
    record.update({
        "matched": int(m.group(1)) if m else 0,
        "transactions": int(m.group(2)) if m else 0,
        "gas_used": number(r"header: fevm's gas \((\d+)\)", text),
        "every_root": code == 0 and "hashes to the header's stateRoot" in text,
        "witness_nodes": number(r"parent's witness \((\d+) nodes", text),
        "witness_kib": number(r"nodes, (\d+) KiB\) hashes", text),
        "block_proof_nodes": number(r"plus (\d+) nodes the parent's proofs lack", text),
        "block_proof_kib": number(r"lack \((\d+) KiB\)", text),
        "assumed_branches": number(r"taken to be branches: (\d+)", text),
        "binary_stems": int(b.group(1)) if b else None,
        "binary_values": int(b.group(2)) if b else None,
        "binary_kib_low": int(b.group(3)) if b else None,
        "binary_kib_high": int(b.group(4)) if b else None,
    })
    record["result"] = "every root matches" if record["every_root"] else "DIFF: " + " | ".join(
        l for l in text.splitlines() if l[:1].isupper() and not l.startswith("chain"))[:300]


def save(records):
    with open(out + ".tmp", "w") as f:
        json.dump(records, f, indent=1)
    os.replace(out + ".tmp", out)


records = json.load(open(out)) if os.path.exists(out) else []
if minutes == 0:
    for r in records:
        if "matched" in r:
            analyze(r, os.path.join(work, hex(r["number"])))
            print(r, flush=True)
    save(records)
    sys.exit(0)
done = {r["number"] for r in records}
end = time.time() + minutes * 60
os.makedirs(work, exist_ok=True)
while time.time() < end:
    try:
        n = head() - 2
    except Exception as e:
        print("head:", e, flush=True)
        time.sleep(12)
        continue
    if n in done:
        time.sleep(12)
        continue
    d = os.path.join(work, hex(n))
    started = time.time()
    record = {"number": n, "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    code, text = run("fetch-block", hex(n), d)
    if code == 0:
        code, text = run("fetch-proofs", d, rpc)
    record["fetch_seconds"] = round(time.time() - started)
    if code != 0:
        record["result"] = "not proven: " + (text.strip().splitlines() or ["?"])[-1][:160]
    else:
        analyze(record, d)
    done.add(n)
    records.append(record)
    save(records)
    print(record, flush=True)
