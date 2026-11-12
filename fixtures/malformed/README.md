# Malformed fixtures

Each file is `../mainnet/usdt-transfer.json` broken in one way (named by the
file). `fevm-replay` must report every one as `ERROR <file>: <what is wrong>`
with exit status 1, never crash. CI checks this.
