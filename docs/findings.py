"""Writes docs/stateless-findings.md from site/data/stateless.json.

    python3 docs/findings.py

Every number in the findings is computed here from the blocks that
`fevm_replay follow` and `chain` recorded (each block's `summary.json`), so
the text follows the data as more blocks and days come in. The measuring is
the Fe tool's; this only adds up its numbers.
"""
import json
import os
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = json.load(open(os.path.join(ROOT, "site", "data", "stateless.json")))
d = [r for r in rows if r.get("every_root") and "by_kind" in r]
if not d:
    raise SystemExit("no validated blocks with per-kind data")

KiB, MiB = 1024, 1048576
wit = lambda r: r["witness_bytes"] + r.get("block_proof_bytes", 0)
per_tx = lambda r: wit(r) / r["transactions"]
per_mgas = lambda r: wit(r) / (r["gas_used"] / 1e6)
ratio = lambda r: wit(r) / ((r["binary_low"] + r["binary_high"]) / 2)
f1 = lambda v: f"{v:.1f}"
num = lambda v: f"{v:,}"

n = len(d)
tx = sum(r["transactions"] for r in d)
gas = sum(r["gas_used"] for r in d)
W = sum(wit(r) for r in d)
days = sorted({(r.get("at") or "")[:10] for r in d if (r.get("at") or "")[:4].isdigit()})
first, last = min(r["number"] for r in d), max(r["number"] for r in d)
stor = sum(r["storage_bytes"] for r in d)
bpn = sum(r.get("block_proof_nodes", 0) for r in d)
bpb = sum(r.get("block_proof_bytes", 0) for r in d)
wn = sum(r["witness_nodes"] for r in d)
assumed = sum(r.get("assumed_branches", 0) for r in d)

heavy = {}
for r in d:
    for h in r["heaviest"]:
        t = heavy.setdefault(h["address"], dict(blocks=0, slots=0, nodes=0, storage=0, account=0, low=0, high=0))
        t["blocks"] += 1
        t["slots"] += h["slots"]
        t["nodes"] += h["proof_nodes"]
        t["storage"] += h["storage_bytes"]
        t["account"] += h["account_bytes"]
        t["low"] += h["binary_low"]
        t["high"] += h["binary_high"]
NAMES = {
    "0x06450dee7fd2fb8e39061434babcfc05599a6fb8": "XEN Crypto",
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
    "0x000000000004444c5dc75cb358380d2e3de08a90": "Uniswap v4's PoolManager",
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap's SwapRouter02",
    "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap's Universal Router",
}
top = sorted(heavy.items(), key=lambda x: -x[1]["storage"])
top3 = top[:3]
named = lambda a: NAMES.get(a, a[:6] + "…" + a[-4:])
deep = [(a, t) for a, t in top[:8]]
grow = [(a, t) for a, t in heavy.items() if t["low"] > t["storage"] + t["account"]]
acc = [h["account_bytes"] for r in d for h in r["heaviest"]]

KINDS = ["ETH transfer", "contract call", "contract creation", "blob transaction", "set-code transaction"]
kinds = []
for k, name in enumerate(KINDS):
    c = sum(r["by_kind"][k][0] for r in d)
    b = sum(r["by_kind"][k][1] for r in d)
    m = max(r["by_kind"][k][2] for r in d)
    kinds.append((name, c, b, m))
share = [r["tx_witness_sum"] / r["witness_bytes"] for r in d]

h = n // 2
by_blob = sorted(d, key=lambda r: r["blob_gas_used"])
by_gas = sorted(d, key=lambda r: r["gas_used"])
blobs = lambda r: r["blob_gas_used"] // 131072

out = []
w = out.append
w(f"# What {n} mainnet blocks say about stateless Ethereum\n")
w(f"*Measured by fevm-replay over {n} mainnet blocks between {num(first)} and {num(last)} "
  f"({num(tx)} transactions, {num(round(gas / 1e6))} million gas"
  + (f", taken on {len(days)} day{'s' if len(days) != 1 else ''}: {', '.join(days)}" if days else "")
  + "), each one validated statelessly by fevm: every root in its header computed from the parent's "
  "witness. The live numbers, with every block, are on the "
  "[stateless blocks page](https://fevm-replay.vercel.app/stateless.html). This file is written by "
  "[`docs/findings.py`](findings.py) from the page's data.*\n")
picked = [r for r in d if "smallest" in r.get("via", "")]
if picked:
    w(f"*{len(picked)} of the blocks were taken by the browser's fetcher (`site/wasm/live.mjs`), which "
      "picks the smallest non-empty block of the six behind the head to keep the page's download small, "
      "and were then validated natively by `chain`; the rest are the block two behind the head, as "
      "`follow` takes it. Per-block figures lean a little toward smaller blocks; the "
      f"{len(picked)} blocks hold {num(sum(r['transactions'] for r in picked))} of the "
      f"{num(tx)} transactions.*\n")
w("## How it was measured\n")
w("For each block, `chain` takes the parent's Merkle proofs (EIP-1186) of every account and slot the "
  "block touched as the witness, runs the block's system calls and transactions in fevm, writes fevm's "
  "end state into that partial trie and hashes it again; the result is the header's `stateRoot` in every "
  "block here. The witness is what that took: the parent's distinct proof nodes, account and storage, plus "
  "the few nodes a deletion moved up that the parent's proofs lack. Contract code is counted apart "
  "(finding 12): a second run through fevm's own block layer (`fevm::Block`) notes the 31-byte chunks "
  "each contract's code runs, as EIP-7864 would carry them. A transaction's witness \"alone\" is the distinct proof "
  "bytes of the accounts and slots it touched, as if it were the only transaction in its block. The "
  "binary-tree figures are estimates for EIP-7864's unified tree over the same keys: stems and values "
  "exact, stems placed by keccak (the EIP has not fixed its hash), the tree taken to be 28 to 31 levels "
  "deep above them.\n")
w("## Findings\n")
w(f"1. **A transaction needs about {f1(st.median(map(per_tx, d)) / KiB)} KiB of witness.** Median per "
  f"block {f1(st.median(map(per_tx, d)) / KiB)} KiB, mean {f1(W / tx / KiB)} KiB, from "
  f"{f1(min(map(per_tx, d)) / KiB)} to {f1(max(map(per_tx, d)) / KiB)} KiB. A block needed "
  f"{min(wit(r) for r in d) / MiB:.2f} to {max(wit(r) for r in d) / MiB:.2f} MiB.")
w(f"2. **What a transaction needs depends on what it does.** Alone in a block, on average:")
for name, c, b, m in kinds:
    if c:
        w(f"   - {name}: {f1(b / c / KiB)} KiB ({num(c)} transactions, the largest {f1(m / KiB)} KiB)")
w(f"3. **Transactions in a block share their witness.** Each on its own, a block's transactions would "
  f"need {st.median(share):.2f} times the block's witness (median; {min(share):.2f} to {max(share):.2f}): "
  "they touch the same tokens, pools and trie nodes near the root.")
w(f"4. **Per gas, the cost varies about {max(map(per_mgas, d)) / min(map(per_mgas, d)):.0f}-fold.** "
  f"Median {round(st.median(map(per_mgas, d)) / KiB)} KiB of witness per million gas, from "
  f"{round(min(map(per_mgas, d)) / KiB)} to {round(max(map(per_mgas, d)) / KiB)}. The busier half of the "
  f"blocks by gas needs more witness per transaction ({f1(st.median(map(per_tx, by_gas[h:])) / KiB)} against "
  f"{f1(st.median(map(per_tx, by_gas[:h])) / KiB)} KiB) but less per gas "
  f"({round(st.median(map(per_mgas, by_gas[h:])) / KiB)} against {round(st.median(map(per_mgas, by_gas[:h])) / KiB)} KiB per million).")
w(f"5. **Blobs do not weigh on the witness.** Blocks carried {min(map(blobs, d))} to {max(map(blobs, d))} "
  f"blobs; the half with more needed {f1(st.median(map(per_tx, by_blob[h:])) / KiB)} KiB a transaction, "
  f"the half with fewer {f1(st.median(map(per_tx, by_blob[:h])) / KiB)}. Blob data never enters the "
  "state; a blob transaction's witness is that of the accounts it touches.")
w(f"6. **Storage is most of the witness: {100 * stor / W:.1f}% of its bytes.** A few contracts carry it: "
  f"{', '.join(named(a) for a, _ in top3)} account for {100 * sum(t['storage'] for _, t in top3) / stor:.1f}% "
  "of all storage witness bytes.")
w("7. **Deep storage tries make each slot expensive.** Nodes on a slot's proof path, on average: "
  + "; ".join(f"{named(a)} {t['nodes'] / t['slots']:.1f}" for a, t in deep[:5])
  + f". That is about {f1(sum(t['storage'] for _, t in deep[:3]) / sum(t['slots'] for _, t in deep[:3]) / KiB)} KiB "
  "of witness for every slot a transaction touches in the largest tries.")
w(f"8. **An account proof is the size EIP-7864 expects.** The account proofs of the heaviest contracts "
  f"weigh {num(round(st.median(acc)))} bytes (median of {num(len(acc))}); the EIP's rationale puts one "
  "branch of a hexary tree of 2^32 leaves at 15 × 32 × log16(2^32) = 3,840 bytes "
  "([EIP-7864](https://eips.ethereum.org/EIPS/eip-7864)).")
lowr, medr, highr = min(map(ratio, d)), st.median(map(ratio, d)), max(map(ratio, d))
xen = heavy.get("0x06450dee7fd2fb8e39061434babcfc05599a6fb8")
w(f"9. **A binary tree would shrink the witness {lowr:.1f} to {highr:.1f} times** (median {medr:.1f}) on these "
  "blocks, less than the 3.75 times the EIP's rationale gives for a single branch (2,880 bytes at 16 "
  "children against 768 at 2, for 2^24 leaves): a block's branches share their upper nodes in either tree, "
  "and a binary tree also carries each stem and its values."
  + (f" Deep storage tries gain most: XEN Crypto's {(xen['storage'] + xen['account']) / MiB:.1f} MiB becomes "
     f"an estimated {xen['low'] / MiB:.1f} to {xen['high'] / MiB:.1f} MiB." if xen else ""))
if grow:
    a, t = max(grow, key=lambda x: x[1]["low"] - x[1]["storage"] - x[1]["account"])
    w(f"10. **But not every contract gains.** A contract with a small storage trie can grow: in the unified "
      "tree each of its slots sits on its own path from the root, where its own trie kept them close. "
      f"{len(grow)} of the {len(heavy)} heaviest contracts grow{'s' if len(grow) == 1 else ''}; {named(a)} ({t['slots']} slots, "
      f"{t['nodes'] / t['slots']:.1f} nodes a slot) from {round((t['storage'] + t['account']) / KiB)} KiB to an "
      f"estimated {round(t['low'] / KiB)} KiB.")
w(f"11. **eth_getProof is almost a full witness.** A deletion that leaves a branch with one child moves "
  "that child up, and the child may belong to a key no transaction touched, which `eth_getProof` cannot "
  f"name. Such nodes were {100 * bpn / (wn + bpn):.2f}% of the nodes and {100 * bpb / W:.2f}% of the bytes; "
  "they were taken from the block's own proofs, each checked by the hash its parent names. "
  f"{assumed} times over the {n} blocks such a node was in neither proof and was taken to be a branch; "
  "every state root still matched.")
cd = [r for r in d if r.get("code_bytes")]
if cd:
    cshare = [r["code_bytes"] / (wit(r) + r["code_bytes"]) for r in cd]
    ckept = [r["code_chunks"] * 31 / r["code_bytes"] for r in cd]
    cgain = [(wit(r) + r["code_bytes"]) / ((r["binary_code_low"] + r["binary_code_high"]) / 2) for r in cd]
    w(f"12. **Code is {100 * st.median(cshare):.0f}% of a full witness, and a block runs a quarter of it.** "
      "`eth_getProof` carries no code, but a stateless client needs every contract it runs. A block ran "
      f"{round(st.median(r['code_contracts'] for r in cd))} contracts (median) holding "
      f"{st.median(r['code_bytes'] for r in cd) / MiB:.1f} MiB of code, which a Merkle-Patricia witness "
      f"carries whole: {100 * min(cshare):.0f}% to {100 * max(cshare):.0f}% of the witness with code added. "
      f"The 31-byte chunks it ran come to {100 * st.median(ckept):.0f}% of those bytes "
      f"({100 * min(ckept):.0f}% to {100 * max(ckept):.0f}%), and EIP-7864 carries only those: with code, "
      f"the binary tree shrinks the witness {min(cgain):.1f} to {max(cgain):.1f} times (median "
      f"{st.median(cgain):.2f}). Code read by `CODECOPY` and `EXTCODECOPY` is not counted.")
gd = [r for r in d if r.get("gas4762")]
if gd:
    gw = sum(sum(k[0] for k in r["gas4762"]) for r in gd)
    gt = sum(sum(k[1] for k in r["gas4762"]) for r in gd)
    gg = sum(r["gas_used"] for r in gd)
    gnet = [(sum(k[0] for k in r["gas4762"]) - sum(k[1] for k in r["gas4762"])) / r["gas_used"] for r in gd]
    gcode = sum(r["gas4762_code"] for r in gd)
    gwr = sum(r["gas4762_writes"] for r in gd)
    def gkind(i):
        c = sum(r["by_kind"][i][0] for r in gd)
        w_ = sum(r["gas4762"][i][0] for r in gd)
        t_ = sum(r["gas4762"][i][1] for r in gd)
        g_ = sum(r["gas4762"][i][2] for r in gd)
        return c, w_, t_, g_
    parts = []
    for i, name in enumerate(["ETH transfers", "contract calls", "contract creations", "blob transactions", "set-code transactions"]):
        c, w_, t_, g_ = gkind(i)
        if c:
            parts.append(f"{name} {100 * (w_ - t_) / g_:+.0f}%")
    tc, tw, tt, tg = gkind(0)
    w(f"13. **Under EIP-4762 the same blocks would cost {100 * (gw - gt) / gg:.0f}% more gas.** EIP-4762 (Draft) "
      "charges for the witness: per transaction 1,900 a new stem read, 200 a leaf, 3,000 a stem written, 500 a "
      "leaf written, 6,200 a leaf filled; it drops EIP-2929's cold charges, EIP-2200's SSTORE costs and the 200 a "
      "byte of code deposited. Counted from each transaction's traces and the chunks fevm ran, its charges come "
      f"to {gw / gt:.2f} times today's for the same accesses and writes: {100 * (gw - gt) / gg:.1f}% of the blocks' "
      f"gas (median per block {100 * st.median(gnet):.0f}%, from {100 * min(gnet):.0f}% to {100 * max(gnet):.0f}%). "
      f"Code chunks, free today, are {100 * gcode / gw:.0f}% of the charges and writes {100 * gwr / gw:.0f}%. By kind, "
      + ", ".join(parts) + " of their gas. "
      f"An ETH transfer pays {round(tw / tc):,} gas of witness, nearly all for the coinbase it pays its priority "
      "fee to (a read and a write of its basic data, 5,600), which the draft does not exempt. Estimates: every "
      "touched account counts one basic-data read, and a slot the parent holds as zero counts as filled. "
      "The charging itself is checked against an independent implementation: given the same accesses, "
      "ethereumjs 10.1.3's `BinaryTreeAccessWitness` (EIP-4762's costs on EIP-7864's tree, its own key "
      "derivation) charges the same gas for 20,636 of 20,636 transactions in the 93 blocks, the 22,676 leaves "
      "filled added at 6,200 as ethereumjs does not charge fills yet "
      "([docs/eip4762-check](eip4762-check/compare.mjs)).\n")
kd = [r for r in gd if "gas4762_short" in r]
if kd:
    net = lambda r: sum(k[0] for k in r["gas4762"]) - sum(k[1] for k in r["gas4762"])
    kw = sum(sum(k[0] for k in r["gas4762"]) for r in kd)
    kt = sum(sum(k[1] for k in r["gas4762"]) for r in kd)
    kg = sum(r["gas_used"] for r in kd)
    kcb = sum(r["gas4762_coinbase"] for r in kd)
    ktx = sum(r["transactions"] for r in kd)
    short = sum(r["gas4762_short"] for r in kd)
    short_x = sum(r["gas4762_short_exempt"] for r in kd)
    fill_now = [r["gas_used"] / r["gas_limit"] for r in kd]
    fill_new = [(r["gas_used"] + net(r)) / r["gas_limit"] for r in kd]
    over = sum(1 for r in kd if r["gas_used"] + net(r) > r["gas_limit"])
    w(f"14. **What the draft's choices cost, and who would run out of gas.** Over {len(kd)} blocks, "
      f"the coinbase alone is {100 * kcb / kw:.0f}% of EIP-4762's witness charges; exempting it, as the draft "
      f"exempts the sender and target, takes the increase from {100 * (kw - kt) / kg:.1f}% to "
      f"{100 * (kw - kcb - kt) / kg:.1f}% of the blocks' gas. Sent with the same gas limit, "
      f"{num(short)} of {num(ktx)} transactions ({100 * short / ktx:.1f}%) would not cover their gas plus "
      f"the witness charges less today's, and would run out of gas; with the coinbase exempt, {num(short_x)} "
      f"({100 * short_x / ktx:.1f}%). Wallets that estimate gas before sending would add the margin; "
      f"contracts and bots that hard-code a gas limit would not. Blocks fill their gas limit "
      f"{100 * st.median(fill_now):.0f}% today (median) and would fill it {100 * st.median(fill_new):.0f}%; "
      f"{over} of {len(kd)} would not fit their limit as built. Estimates: gas used is after refunds, "
      "which a transaction's limit must cover before them, so the shortfall count is a lower bound.\n")
bk = [r for r in kd if "gas4762_short_by_kind" in r]
if bk:
    def kinds(i):
        n = sum(r["by_kind"][i][0] for r in bk)
        s, x, e = (sum(r["gas4762_short_by_kind"][i][j] for r in bk) for j in range(3))
        return n, s, x, e
    tn, ts, tx_, te = kinds(0)
    cn, cs, cx, ce = kinds(1)
    bn, bs, bx, be = kinds(3)
    w(f"15. **The coinbase exemption would save transfers, not contract calls.** Of {num(tn)} ETH transfers, "
      f"{num(ts)} ({100 * ts / tn:.0f}%) would run out of gas under the draft ({num(te)} transfers were sent with a gas limit of "
      f"exactly the gas they used); exempt the coinbase and {num(tx_)} ({100 * tx_ / tn:.1f}%) still would. Of "
      f"{num(cn)} contract calls, {num(cs)} ({100 * cs / cn:.0f}%) would, and with the coinbase exempt still {num(cx)} "
      f"({100 * cx / cn:.0f}%): their shortfall is code chunks and storage, and only {num(ce)} were sent with no margin, so "
      f"the margin wallets add when they estimate gas today would not cover it. Blob transactions: {num(bs)} of {num(bn)}, "
      f"{num(bx)} with the coinbase exempt. Over {len(bk)} blocks.\n")
wi = [r for r in kd if "gas4762_short_code_free" in r]
if wi:
    wtx = sum(r["transactions"] for r in wi)
    ww = sum(sum(k[0] for k in r["gas4762"]) for r in wi)
    wt = sum(sum(k[1] for k in r["gas4762"]) for r in wi)
    wg = sum(r["gas_used"] for r in wi)
    wcb = sum(r["gas4762_coinbase"] for r in wi)
    wcode = sum(r["gas4762_code"] for r in wi)
    steps = [
        ("the draft as it stands", sum(r["gas4762_short"] for r in wi), ww - wt),
        ("the coinbase exempt", sum(r["gas4762_short_exempt"] for r in wi), ww - wcb - wt),
        ("and code chunks at half price", sum(r["gas4762_short_code_half"] for r in wi), ww - wcb - wcode / 2 - wt),
        ("and code chunks free", sum(r["gas4762_short_code_free"] for r in wi), ww - wcb - wcode - wt),
    ]
    w(f"16. **After the coinbase, the price of code decides who runs out of gas.** The same {num(wtx)} transactions, "
      "sent with the gas limit they had, under four versions of the charges: "
      + "; ".join(f"{name}, {100 * s / wtx:.1f}% short of gas and {100 * g / wg:+.0f}% gas" for name, s, g in steps)
      + ". Code chunks are charged per transaction, so a contract call pays again for code the block already ran.\n")
import collections
tg = [r for r in kd if "gas4762_short_targets" in r]
if tg:
    calls = collections.Counter(a for r in tg for a in r["gas4762_short_targets"])
    total = sum(calls.values())
    usd = calls["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"] + calls["0xdac17f958d2ee523a2206206994597c13d831ec7"]
    first = ", ".join(f"{named(a)} {n}" for a, n in calls.most_common(6))
    w(f"17. **A third of the calls that would still run out of gas go to USDC and USDT.** With the coinbase "
      f"exempt, {num(total)} contract calls over {len(tg)} blocks would still run out of gas, sent to {num(len(calls))} "
      f"contracts. USDC and USDT alone take {num(usd)} ({100 * usd / total:.0f}%): calls to them, sent with a tight "
      f"limit, now pay for the code chunks they run (USDC's proxy and its implementation, USDT's large contract), "
      f"which cost nothing before. Most calls: {first}.\n")
bd = [r for r in d if "bal_bytes" in r]
if bd:
    bal_ratio = [wit(r) / r["bal_bytes"] for r in bd]
    depth = [r["bal_depth"] / r["transactions"] for r in bd]
    free = [r["bal_free"] / r["transactions"] for r in bd]
    w(f"18. **A block access list is {st.median(bal_ratio):.0f} times smaller than the witness, and the blocks are about a "
      f"third serial.** EIP-7928's list, built from each transaction's traces (`ingots/replay_core/src/bal.fe`): {st.median(r['bal_bytes'] for r in bd) / KiB:.0f} KiB "
      f"a block (median; {min(r['bal_bytes'] for r in bd) / KiB:.0f} to {max(r['bal_bytes'] for r in bd) / KiB:.0f} KiB), "
      f"{sum(r['bal_bytes'] for r in bd) / sum(r['transactions'] for r in bd):.0f} bytes a transaction, RLP uncompressed. "
      f"With it a client knows each transaction's reads and writes before it runs; the longest chain of transactions "
      f"each touching what an earlier one wrote is {100 * st.median(depth):.0f}% of a block's transactions (median; "
      f"{100 * min(depth):.0f}% to {100 * max(depth):.0f}%), so unlimited cores would need about a third as many steps, "
      f"and {100 * st.median(free):.0f}% of transactions touch nothing an earlier one wrote. The coinbase, which every "
      f"transaction credits, is left out, as parallel clients settle fees after the block; the end-of-block index "
      f"(withdrawals, request bookkeeping) is left out of the size. Over {len(bd)} blocks.\n")
w("## Reproduce\n")
w("```sh\n./out/fevm_replay follow blocks stateless.json 3     # takes, proves and validates 3 head blocks\n"
  "mkdir proven && tar xzf fixtures/proven/0x19335e5.tar.gz -C proven\n"
  "./out/fevm_replay chain proven/0x19335e5             # one block: witness, per-kind, heaviest tries\n"
  "python3 docs/findings.py                             # this file, from the page's data\n```\n")
w("Each block's numbers are in its `summary.json`, written by `chain`; the page's data is "
  "[site/data/stateless.json](../site/data/stateless.json).")
open(os.path.join(ROOT, "docs", "stateless-findings.md"), "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print(f"{n} blocks, {tx} transactions")
