"""The headline numbers in the README and on the site, against the data.

site/data/stateless.json is the record of every block validated statelessly;
the README, the front page and the badge quote how many blocks and
transactions it holds. This fails if one of them was left behind when blocks
were added.

    python3 docs/check-numbers.py
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
rows = json.load(open(os.path.join(ROOT, "site", "data", "stateless.json"), encoding="utf-8"))
ok = [r for r in rows if r.get("every_root")]
blocks, txs = len(ok), sum(r["transactions"] for r in ok)
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()
readme, index, badge = read("README.md"), read("site", "index.html"), read("site", "data", "stateless.svg")

problems = []
def need(text, where, phrase):
    if phrase not in text:
        problems.append(f"{where}: missing {phrase!r}")

need(readme, "README", f"{blocks} of {blocks} whole blocks ({txs:,} transactions)")
need(readme, "README", f"Measured on {blocks} mainnet blocks")
need(readme, "README", f"all {blocks} stateless blocks validate in the module")
need(readme, "README", f"agree on all {blocks} mainnet blocks validated statelessly")
need(index, "site/index.html", f"<b>{blocks} / {blocks}</b>")
need(badge, "site/data/stateless.svg", f"{blocks} mainnet blocks, every root")
# Any "<n> mainnet blocks" in the README's one-screen table must be the current count.
table = readme[readme.index("### For judges"):readme.index("The rest of this README")]
for n in re.findall(r"(\d+) (?:of \d+ whole |mainnet |stateless )?blocks", table):
    if int(n) not in (blocks, 1, 290, 20, 51) and int(n) > 50:
        problems.append(f"README judges table: {n} blocks where the data has {blocks}")

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"numbers: README, front page and badge quote {blocks} blocks and {txs:,} transactions, as the data holds")
