"""Builds the tour's scenes: one 1280x720 HTML page each, caption on top.
Terminal text is real output from fevm-replay runs in this repository."""
from PIL import Image
import html, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def crop(src, box, out):
    Image.open(src).crop(box).save(out)

crop("cert-dai-full.png", (0, 0, 1265, 500), "cert-top.png")
crop("cert-dai-full.png", (0, 1000, 1265, 1460), "cert-gas.png")
crop("opgas-full.png", (0, 300, 1265, 780), "opgas-chart.png")
crop("opgas-full.png", (0, 1600, 1265, 1930), "opgas-why.png")

CSS = """
*{box-sizing:border-box;margin:0}
body{width:1280px;height:720px;overflow:hidden;background:#101418;color:#e8ecef;
 font-family:'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column}
.cap{padding:28px 48px 18px;background:#0b0e11;border-bottom:3px solid #2e8b6e}
.cap h1{font-size:34px;font-weight:700;line-height:1.2}
.cap p{font-size:20px;color:#a9b4bd;margin-top:8px;line-height:1.35}
.body{flex:1;display:flex;align-items:center;justify-content:center;padding:22px 48px;overflow:hidden}
pre{background:#05080a;border:1px solid #26313a;border-radius:8px;padding:20px 24px;
 font:17px/1.5 Consolas,'Courier New',monospace;color:#d6e2ea;white-space:pre;width:100%;overflow:hidden}
.ok{color:#5fd39a}.bad{color:#ff8a7a}.dim{color:#7b8a96}.kw{color:#8ab4ff}
img{max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 0 0 1px #26313a}
.title{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
.title h1{font-size:64px}.title p{font-size:26px;color:#a9b4bd;margin-top:18px;line-height:1.4}
.title .tag{color:#5fd39a;font-size:20px;margin-top:30px}
ul{font-size:24px;line-height:1.7;width:100%}li{margin-left:28px}
"""

def page(name, caption, sub, body):
    sub_html = f"<p>{sub}</p>" if sub else ""
    doc = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS}</style></head><body>"
    if caption is None:
        doc += body
    else:
        doc += f"<div class=cap><h1>{caption}</h1>{sub_html}</div><div class=body>{body}</div>"
    doc += "</body></html>"
    open(f"scene-{name}.html", "w", encoding="utf-8").write(doc)

def term(text):
    return "<pre>" + text + "</pre>"

def esc(t):
    return html.escape(t)

scenes = []

page("01", None, None, """<div class=title>
<h1>fevm-replay</h1>
<p>Real Ethereum mainnet history, replayed in fevm, the EVM written in Fe.<br>
Proven against the chain's state roots. Fe ports checked against real traffic.</p>
<p class=tag>Fe Builders Challenge 2026 &middot; FE-050</p></div>""")

page("02", "Does an EVM written in Fe run real Ethereum?",
     "fevm passes 14,693 synthetic tests. fevm-replay asks mainnet: fetch what a transaction saw and changed, replay it, compare everything.",
     term(esc("""$ fevm-replay range 26394000 20 blocks
block 0x192bd90: 267/267 transactions MATCH (100%)
...
block 0x192bda3: 320/320 transactions MATCH (100%)
20 blocks: 5129/5129 transactions MATCH (100%)""").replace("MATCH (100%)", "<span class=ok>MATCH (100%)</span>")
          + "\n\n<span class=dim>status, gas, logs, and every balance, nonce, code and storage slot.\n115,213 mainnet transactions so far: no fevm bug.</span>"))

page("03", "Proven against the state root, not the node",
     "fetch-proofs saves eth_getProof proofs; chain checks the header hashes, the pre-state and fevm's end state against the state roots, offline.",
     term(esc("""$ fevm-replay fetch-block 0x192f3cb blocks/0x192f3cb
$ fevm-replay fetch-proofs blocks/0x192f3cb
$ fevm-replay chain blocks/0x192f3cb
headers: block 0x19f04411...696b and its parent hash to themselves
pre-state: 206 accounts and 673 slots proven against the parent's state root, 0 differ
chain blocks/0x192f3cb: 122/122 transactions MATCH (100%)
end state: 207 accounts and 673 slots proven against the block's state root, 0 differ""").replace("0 differ", "<span class=ok>0 differ</span>")))

page("04", "Change one wei, or one byte of a proof, and it fails",
     "A clean run rests on one 32-byte block hash. The verifier is Fe: std's RLP, core's Keccak, a walk down the trie.",
     term("<span class=dim># one balance in the saved prestate, plus one wei</span>\n"
          + "<span class=bad>" + esc("DIFF  balance 0x2271adcc...6f92: proven 0x...21db88ec4fe3dd, fevm 0x...21db88ec4fe3de") + "</span>\n\n"
          + "<span class=dim># one byte of one proof node changed</span>\n"
          + "<span class=bad>BROKEN account proof 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48</span>"))

page("05", "The compiler proves the verdict is offline",
     "Fe functions declare their effects. Only main and the fetcher may start curl or touch files; the replay and the proof verifier get a text buffer.",
     term(esc("""pub fn replay_tx(
    _ block: BlockEnv,
    ...
    shadow_code: MemSpan,
) -> Mismatches
uses (text: mut MemBuffer)          // no Spawn, no Fs: calling the network is a type error

pub fn check(_ world: WorldState, state_root: u256, _ proofs: Value, ...) -> Checked
uses (text: mut MemBuffer)""").replace("uses", "<span class=kw>uses</span>")))

page("06", "The compiler checks the blob fee against mainnet",
     "EIP-4844's fee is a const fn typed with std's units (Timestamp in, Wei out); static_assert runs it at compile time on a real block.",
     term(esc("""pub const fn blob_base_fee(excess: u256, fraction: u256) -> Wei { ... }

// Block 26,393,604 priced its blobs at 0xb58b03 wei.
static_assert(blob_base_fee(excess: 0xb58bccf, fraction: BPO2_UPDATE_FRACTION).as_wei() == 0xb58b03)

$ fe build     # with the price off by one wei:
error[8-0081]: static assertion failed
   = left: `11897603`
   = right: `11897604`""").replace("error[8-0081]: static assertion failed", "<span class=bad>error[8-0081]: static assertion failed</span>")))

page("07", "Is a Fe port a drop-in replacement? Ask mainnet.",
     "Shadow replay puts a Fe port in place of the deployed contract in every transaction that touches it. Five ports, five solc versions.",
     "<img src=verified.png>")

page("08", "One command, one certificate",
     "certify replays 200 blocks with the port, mutates every transaction, fuzzes it, and plants mutants to score its own checks.",
     "<img src=cert-top.png>")

page("09", "DAI in Fe: 10,562 mainnet transactions, 0 behave differently",
     "Each function points at its recv arm in the Fe source. Fe writes no source map, so the tool follows the selector through msg and recv.",
     "<img src=cert-gas.png>")

page("10", "Where Fe saves gas, opcode by opcode",
     "Six functions of four ports: less stack shuffling, arithmetic and control flow than solc, more memory, in every function.",
     "<img src=opgas-chart.png>")

page("11", "What it found",
     None,
     """<ul>
<li>3 bugs in the Fe ports, from mainnet and mainnet-seeded fuzzing (a zero-withdraw stipend, an out-of-gas revert path, a bot's dirty address)</li>
<li>2 node tracer bugs, one reported to the provider</li>
<li>48 Prague transactions the Osaka fork changes, each by its EIP</li>
<li>Reported upstream: fe-lang/fevm#26 and argotorg/fe#2002 (memory is where Fe costs more)</li>
</ul>""")

page("12", "Try it without installing Fe",
     "github.com/PugarHuda/fevm-replay &middot; fevm-replay.vercel.app",
     term(esc("""$ curl -sL https://github.com/PugarHuda/fevm-replay/releases/latest/download/\
      fevm-replay-v0.1.0-x86_64-linux.tar.gz | tar xz
$ cd fevm-replay-v0.1.0-x86_64-linux
$ ./fevm_replay fixtures/mainnet/*.json
MATCH fixtures/mainnet/eip7702-delegate-missing-from-trace.json
MATCH fixtures/mainnet/eth-transfer-legacy.json
MATCH fixtures/mainnet/mev-bot.json
...""").replace("MATCH", "<span class=ok>MATCH</span>")))
print("ok")
