// The hero mosaic: mainnet block 26,393,604, one cell per transaction, each
// as wide as the gas it used. The data is the block's real receipts
// (data/block-26393604.json); fevm-replay replayed all 248 and matched each.

const TYPES = ["legacy", "access list", "fee market", "blob", "set code"];

function describe(tx, index) {
  const [hash, gas, type, ok] = tx;
  return `tx ${index}  ${hash.slice(0, 10)}…${hash.slice(-6)}  ${gas.toLocaleString("en-US")} gas  ${TYPES[type] ?? "type " + type}${ok ? "" : "  reverted on chain"}`;
}

async function main() {
  const mosaic = document.querySelector(".mosaic");
  const tally = document.querySelector(".tally");
  const picked = document.querySelector(".picked");
  if (!mosaic) return;

  let block;
  try {
    const res = await fetch("data/block-26393604.json");
    if (!res.ok) throw new Error(res.status);
    block = await res.json();
  } catch {
    tally.textContent = "Block data did not load. Open the page through a web server, not as a file.";
    return;
  }

  const txs = block.txs;
  const total = txs.length;
  const cells = txs.map((tx, i) => {
    const b = document.createElement("button");
    b.type = "button";
    // Square root keeps a 21,000-gas transfer visible next to a 1.4M-gas swap.
    b.style.flexBasis = `${Math.max(6, Math.sqrt(tx[1]) / 9)}px`;
    b.setAttribute("aria-label", describe(tx, i));
    const show = () => { picked.textContent = describe(tx, i); };
    b.addEventListener("mouseenter", show);
    b.addEventListener("focus", show);
    b.addEventListener("click", () => {
      window.open(`https://etherscan.io/tx/${tx[0]}`, "_blank", "noopener");
    });
    mosaic.append(b);
    return b;
  });

  const ok = document.createElement("span");
  ok.className = "ok";
  const rest = document.createTextNode("");
  tally.replaceChildren(ok, rest);
  const finish = (n) => {
    ok.textContent = String(n);
    rest.textContent = `/${total} transactions MATCH`;
  };

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    cells.forEach((c) => c.classList.add("done"));
    finish(total);
    return;
  }

  // One orchestrated moment: the block replays in order, about 2.4 seconds.
  let i = 0;
  const step = Math.max(1, Math.round(total / 120));
  const timer = setInterval(() => {
    for (let k = 0; k < step && i < total; k++, i++) cells[i].classList.add("done");
    finish(i);
    if (i >= total) clearInterval(timer);
  }, 20);
}

main();

// The header check on the front page: the same worker as verify.html runs
// fevm (WebAssembly) on the saved block, and each root is marked from the
// validator's own output line for it, never assumed.
const rc = document.getElementById("rc-run");
if (rc) {
  const say = document.getElementById("rc-say");
  const LINES = {
    stateRoot: /hashes to the header's stateRoot/,
    transactionsRoot: /hash to the header's transactionsRoot/,
    receiptsRoot: /hash to the header's receiptsRoot/,
    withdrawalsRoot: /hash to the header's withdrawalsRoot/,
    requestsHash: /hash to the header's requestsHash/,
    logsBloom: /are the header's gasUsed, blobGasUsed and logsBloom/,
    gasUsed: /are the header's gasUsed, blobGasUsed and logsBloom/,
    blobGasUsed: /are the header's gasUsed, blobGasUsed and logsBloom/,
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  rc.addEventListener("click", () => {
    rc.disabled = true;
    document.querySelectorAll(".root").forEach((r) => { r.className = "root"; r.querySelector(".state").textContent = "waiting for fevm"; });
    const worker = new Worker("wasm/block-worker.mjs", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.step) { say.textContent = data.step; return; }
      worker.terminate();
      rc.disabled = false;
      rc.textContent = "Check them again";
      if (data.error) { say.textContent = `Could not run fevm here: ${data.error}`; return; }
      const lines = data.out.split("\n").filter((l) => !/^(DIFF|STATE|ERROR|REQUESTS)/.test(l));
      const rows = [...document.querySelectorAll(".root")];
      let held = 0;
      rows.forEach((r, i) => setTimeout(() => {
        const ok = lines.some((l) => LINES[r.dataset.field].test(l));
        held += ok ? 1 : 0;
        r.classList.add(ok ? "held" : "differs");
        r.querySelector(".state").textContent = ok ? "fevm got the same" : "fevm got something else";
        if (i === rows.length - 1) {
          const tx = data.out.match(/(\d+)\/(\d+) transactions MATCH/);
          say.replaceChildren(`${held} of ${rows.length} fields match, from ${tx ? tx[2] : "its"} transactions run in ${(data.ms / 1000).toFixed(2)} s in your browser. `,
            Object.assign(document.createElement("a"), { href: "verify.html?block=0x19335e5", textContent: "The whole output" }), ".");
        }
      }, still ? 0 : 90 * i));
    };
    worker.postMessage({ archive: "block-0x19335e5.tar.gz" });
  });
}
