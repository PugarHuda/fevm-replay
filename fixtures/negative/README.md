# Negative fixtures

Each file is `../mainnet/usdt-transfer.json` with one fact about the chain's
result changed, so fevm's (correct) replay must disagree with it.
`fevm-replay` has to report DIFF for every one of them; a MATCH means the
comparison missed a class of difference.

| File | Changed |
| --- | --- |
| `gas.json` | receipt `gasUsed` + 1 |
| `status.json` | receipt `status` set to failure |
| `balance.json` | one post-state balance + 1 |
| `storage.json` | one post-state storage slot, lowest bit flipped |
| `logdata.json` | the first log's data, last digit changed |
| `logcount.json` | the last log removed |
| `stray-write.json` | the post-state storage of one account removed, so fevm's write is unexpected |
