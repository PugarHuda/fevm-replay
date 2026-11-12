#!/bin/bash
# The recording in demo.svg. Run from the repository root with
# `fevm-replay` on PATH and block 0x192bc04 fetched into blocks/0x192bc04:
#   asciinema rec -c "bash demo/demo.sh" demo/demo.cast
#   svg-term --in demo/demo.cast --out demo/demo.svg --window
set -e

type_cmd() {
    printf '\033[1;32m$\033[0m '
    for ((i = 0; i < ${#1}; i++)); do printf '%s' "${1:i:1}"; sleep 0.02; done
    printf '\n'
    sleep 0.4
}

say() { printf '\033[1;36m# %s\033[0m\n' "$1"; sleep 1.2; }

say "Fetch a real mainnet USDT transfer and replay it in fevm, the EVM written in Fe"
type_cmd "fevm-replay fetch 0x9a0970fbbf5df6a17277bc94bf2d96e117d504bd36e341a7ca5230998f916184 usdt.json"
fevm-replay fetch 0x9a0970fbbf5df6a17277bc94bf2d96e117d504bd36e341a7ca5230998f916184 /tmp/usdt.json | sed 's|/tmp/||'
type_cmd "fevm-replay usdt.json"
fevm-replay /tmp/usdt.json | sed 's|/tmp/||'
sleep 1

say "Change one fact about the chain's result, and the replay must disagree"
type_cmd "fevm-replay fixtures/negative/storage.json"
fevm-replay fixtures/negative/storage.json || true
sleep 1.5

say "A whole block: 248 transactions"
type_cmd "fevm-replay block blocks/0x192bc04"
fevm-replay block blocks/0x192bc04
sleep 1

say "Shadow replay: the same block with WETH9 written in Fe in place of mainnet WETH"
type_cmd "fevm-replay block blocks/0x192bc04 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 out/weth9/WETH9.runtime.bin | tail -2"
fevm-replay block blocks/0x192bc04 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 out/weth9/WETH9.runtime.bin | tail -2 || true
sleep 3
