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
