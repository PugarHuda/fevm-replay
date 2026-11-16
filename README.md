# fevm-replay

[![CI](https://github.com/PugarHuda/fevm-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/PugarHuda/fevm-replay/actions/workflows/ci.yml)

**Site and documentation:** https://fevm-replay.vercel.app (mirror: https://pugarhuda.github.io/fevm-replay/)

**Pitch:** Replay real Ethereum mainnet transactions inside
[fevm](https://github.com/fe-lang/fevm), the EVM written in Fe, and prove
that each one ends exactly as it did on chain: status, gas, logs and every
balance, nonce, code and storage slot.

```
$ fevm-replay range 26394000 20 blocks
block 0x192bd90: 267/267 transactions MATCH (100%)
...
block 0x192bda3: 320/320 transactions MATCH (100%)
20 blocks: 5129/5129 transactions MATCH (100%)
```

Replaying is fast: those 5,129 transactions take 5.9 seconds once fetched.

### For judges: one screen

| | |
| --- | --- |
| **What** | fevm-replay replays real mainnet history in fevm, validates whole blocks statelessly against every root in their headers, and checks Fe ports of Solidity contracts against real traffic. All Fe, from the HTTP call to the verdict. |
| **fevm on mainnet** | 115,213 transactions replayed, 290 blocks as chains, no fevm bug |
| **Stateless** | With the parent's proofs as a witness, fevm runs a block's system calls and transactions and *computes* its `stateRoot`; `transactionsRoot`, `receiptsRoot`, `withdrawalsRoot`, `requestsHash`, `logsBloom` and `gasUsed` come out of fevm too. 6 mainnet blocks (3 of them consecutive) match every root; one is checked in CI on every push. A MATCH rests on the block hash, not the node ([details](#every-root-in-the-header)) |
| **Fe ports** | 5 ports (USDT, every Uniswap V2 pair, WETH9, DAI, USDC's proxy) certified by mainnet replay, mainnet mutations, fuzzing and mutation testing ([verified page](https://fevm-replay.vercel.app/verified.html)) |
| **Fe-specific** | Effects prove the verdict and the proof verifier offline; `const fn` + `static_assert` check the blob fee against a real block; std units, `core::fixed`, `msg`/`recv` ([Fe highlight](#fe-highlight)) |
| **Found** | 3 bugs in the Fe ports, 2 node tracer bugs, the transactions the Osaka fork changed, and where Fe's code costs more than solc's ([argotorg/fe#2002](https://github.com/argotorg/fe/issues/2002)) |
| **Watch** | [3-minute narrated tour](demo/tour-narrated.mp4) |
| **Try** | No Fe needed: [three commands](#try-it-without-fe) with the release binary |

The rest of this README is the full account: [problem](#the-problem),
[approach](#approach), [results](#results), [Fe highlight](#fe-highlight),
[architecture](#architecture), [build](#build-and-test),
[security assumptions](#security-assumptions),
[limitations](#limitations) and [declaration](#declaration).

## The problem

fevm passes all 14,693 runnable Osaka state tests. State tests are
synthetic, though: each one is written to exercise a rule. The way an
execution client earns trust is by replaying real history, where contracts,
bots and wallets combine the rules in ways nobody wrote a test for. fevm had
no way to do that.

The same gap holds for every Fe contract. The Fe team ports Solidity
contracts to Fe (Uniswap v4, Seaport, Liquity v2) to show that Fe can
replace Solidity. The strongest evidence that a port is a drop-in
replacement is real mainnet traffic producing identical results.

## Approach

fevm-replay asks a JSON-RPC node for everything one transaction saw and
did, runs the transaction in fevm, and compares:

1. **Fetch** (`fetch`, `fetch-block`): the transaction, its block and
   receipt, and two `prestateTracer` traces: the accounts and slots the
   transaction read (its pre-state), and in `diffMode` everything it
   changed. A whole block takes five calls: `eth_chainId`, `eth_getBlockByNumber`,
   `eth_getBlockReceipts` and two `debug_traceBlockByNumber`.
2. **Load**: the pre-state becomes an fevm `WorldState`, the transaction a
   `TxRequest` (all five envelope kinds, access lists, blob hashes,
   EIP-7702 authorizations), the header a `BlockEnv`.
3. **Run**: `fevm::transact` executes it under Osaka rules.
4. **Compare**: the expected world is the pre-state with the chain's diff
   applied. fevm-replay compares it with fevm's world **in both
   directions**, so a wrong value and a write the chain never made are both
   caught. It also compares status, gas used and every log.

Everything was built during the contest window; see the declaration below.

## Results

| Run | Transactions | MATCH |
| --- | ---: | ---: |
| 6 hand-picked fixtures (`fixtures/mainnet`) | 6 | 6 |
| Blocks 26,394,000 to 26,394,019 | 5,129 | 5,129 |
| Blocks 26,394,100 to 26,394,199 (99 fetched) | 24,991 | 24,982 |
| Blocks 26,380,000 to 26,380,299 | 85,087 | 84,964 |
| **Total** | **115,213** | **115,081** |

**No transaction exposed a bug in fevm.** Every one of the 132
differences was traced to a cause outside the interpreter, and fevm-replay
now names each cause itself:

| Cause | Differences |
| --- | ---: |
| `BLOCKHASH` of an older block, which the traces cannot carry (labeled) | 91 |
| Inconsistent block traces, matching when fetched again one by one | 37 |
| Answers from different nodes behind one endpoint at the chain head | 3 |
| A node tracer bug (`diffMode` kept an account EIP-6780 deleted) | 1 |
| **Total** | **132** |

Two more causes were fixed in the tool itself: the parent's `BLOCKHASH`
(now from the header) and a delegation target missing from the prestate
(now fetched).
Each cause is explained in [docs/details.md](docs/details.md#every-difference-explained).

`fixtures/negative` holds seven copies of a real transaction, each with one
fact about the chain's result changed: gas, status, a balance, a storage
slot, log data, the log count, and an unexpected write. All seven are
reported as DIFF, which shows the comparison can fail.

`fixtures/malformed` holds twelve broken fixtures (a missing diff, logs that
are not a list, code that is not a string, and so on). Each one is reported
as `ERROR <file>: <what is wrong>`, not a crash. In a block, a transaction
whose trace the node failed (`execution timeout` on a heavy block) is
reported, and the rest still replay.

## Every root in the header

`chain` replays a saved block the way a node does, each transaction on the
state the one before it left. With the block's Merkle proofs saved beside
it (`fetch-proofs`), it validates the block statelessly: fevm starts from
the parent's state root, runs the block's system calls and transactions,
and every commitment in the header has to come out of fevm. Block
26,424,805, saved in [`fixtures/proven`](fixtures/proven) and checked by CI
on every push:

```
$ tar xzf fixtures/proven/0x19335e5.tar.gz -C proven
$ ./out/fevm_replay chain proven/0x19335e5
headers: block 0x633b9caee6ca3358cd64e5f7a20a277125c1a71de9fd2cf855bcb600aed2ccd6 and its parent hash to themselves
pre-state: 210 accounts and 513 slots proven against the parent's state root, 0 differ
system calls: fevm ran EIP-4788 (beacon root) and EIP-2935 (parent hash) before the first transaction
chain proven/0x19335e5: 71/71 transactions MATCH (100%)
receipts: fevm's 71 receipts hash to the header's receiptsRoot
transactions: 71 re-encoded, each hashes to its hash, and they hash to the header's transactionsRoot
withdrawals: 16 hash to the header's withdrawalsRoot
header: fevm's gas (9743588), the blob gas and fevm's logs bloom are the header's gasUsed, blobGasUsed and logsBloom
requests: fevm's 0 deposits, 0 withdrawal and 0 consolidation requests hash to the header's requestsHash
end state: 213 accounts and 521 slots proven against the block's state root, 0 differ
state root: fevm's end state (149 accounts and 521 slots written) on the parent's witness (2969 nodes, 992 KiB) hashes to the header's stateRoot
  plus 26 nodes the parent's proofs lack (9 KiB), siblings a deletion moved up, taken from the block's proofs by the hashes the parent's nodes name
withdrawals: 16 credited, their recipients checked by the end state's proofs
```

| Header field | What fevm-replay matches it with |
| --- | --- |
| `stateRoot` | Computed ([`src/stateless.fe`](src/stateless.fe)): fevm's end state written into the partial trie the parent's proofs witness, then hashed. Also checked key by key against the block's own proofs |
| `transactionsRoot` | Every transaction re-encoded (EIP-2718: legacy, access list, fee market, blob, set code), each hashing to its own hash ([`src/roots.fe`](src/roots.fe)) |
| `receiptsRoot` | fevm's receipts: status, cumulative gas, bloom, every log ([`src/receipts.fe`](src/receipts.fe)) |
| `withdrawalsRoot` | The withdrawals fevm credits |
| `requestsHash` | Deposits cut from fevm's logs, and the EIP-7002 and EIP-7251 system calls run in fevm ([`src/requests.fe`](src/requests.fe)) |
| `parentBeaconBlockRoot`, `parentHash` | Stored by the EIP-4788 and EIP-2935 system calls, run in fevm before the first transaction |
| `gasUsed`, `blobGasUsed`, `logsBloom` | fevm's gas, the blobs, fevm's logs |
| The block hash | The header's RLP, and the parent's, which carries the state root fevm starts from |

**Stateless.** The parent's proofs (EIP-1186) are a witness: the trie
nodes from the parent's state root to every account and slot the block
touched, each checked by its hash. fevm's end state is written into that
partial trie (insertions, changes and deletions, accounts and their storage
tries) and hashed again, the way a stateless client validates a block. The
result must be the header's `stateRoot`, so fevm's value for every touched
key is the chain's. One case needs nodes the parent's proofs do not hold:
a deletion that leaves a branch with one child moves that child up, and
the child belongs to a key no transaction touched, which `eth_getProof`
cannot name (an execution witness would carry it, but no free endpoint
serves `debug_executionWitness`). Such a node is taken from the block's own
proofs, found by the hash a parent's node names, so it too hashes into the
parent's state root; `chain` counts these nodes and their bytes (26 nodes,
9 KiB, in the block above). The block's proofs serve as a source of nodes,
not as the answer.

| Block | Transactions | Witness nodes | Witness size | |
| ---: | ---: | ---: | ---: | --- |
| 26,424,722 | 313 | 12,765 | 4,198 KiB | |
| 26,424,772 | 286 | 8,794 | 3,025 KiB | one EIP-7002 withdrawal request, matched with `requestsHash` |
| 26,424,805 | 71 | 2,969 | 992 KiB | the CI fixture |
| 26,424,861 | 230 | 9,514 | 3,278 KiB | three consecutive blocks: each one's parent hash is the hash of the one before |
| 26,424,862 | 256 | 22,178 | 7,855 KiB | |
| 26,424,863 | 186 | 7,506 | 2,530 KiB | |

Every block in the table: all transactions MATCH and every row of the
header table matches. The witness counts the parent's distinct proof
nodes, account and storage; contract code comes on top, checked against
the proven code hashes. Earlier blocks proven before the stateless step
(state roots checked key by key, receipts and requests) are in
[docs/details.md](docs/details.md#proven-against-the-state-root).

**Consecutive blocks as one chain.** Given several block directories,
`chain` validates each and then links them: a block's parent must be the
block before it, and the state root its pre-state was proven against must
be the one fevm computed for that block.

```
$ ./out/fevm_replay chain 0x193361d 0x193361e 0x193361f
...
chain of 3 blocks: 2 of 2 links hold (each block's parent is the block before it, and its pre-state was proven against the state root fevm computed for that block)
```

**One wei breaks it.** CI also changes one withdrawal's amount by one wei
in a copy of the fixture: the withdrawals root, the end state's proof and
the computed state root all fail. A node that lied about any balance, slot,
log or transaction would need a keccak collision to pass, so a clean run
rests on one 32-byte block hash that anyone can compare with any source.

Proofs come from a node within about 100 blocks of the head
(`ethereum-rpc.publicnode.com` serves them for free; `fetch-proofs` asks
again when a node behind it errs, and asks for an account's slots 200 at a
time).

## Fe ports, shadow-replayed

Shadow replay runs real mainnet transactions with a Fe port in place of
every account holding the deployed contract's code, and compares
everything, as above. Five Solidity contracts from five compiler versions
are ported; `certify` writes a one-page certificate for each
([verified ports](https://fevm-replay.vercel.app/verified.html)):

| Port | Original | Mainnet txs that ran it | Behaved differently | Mutated mainnet runs that differ | Random calls that differ | Port code reached | Mutants caught | Gas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| USDT | solc 0.4.17 | 21,230 | 0 | 0 of 324,340 | 0 of 1.2M | 97% | 45 of 49 | transfer −4.1% |
| Uniswap V2 pair (every pair) | solc 0.5.16 | 1,687 | 0 | 0 of 513,600 | 0 of 1.2M | 95% | 61 of 74 | swap −0.9% |
| WETH9 | solc 0.4.19 | 6,235 | 0 | 0 of 79,000 | 0 of 1.2M | 89% | 12 of 13 | balanceOf −17.0% |
| DAI | solc 0.5.12 | 10,562 | 0 | 0 of 211,240 | 0 of 120,000 | 95% | 21 of 21 | transfer −1.5% |
| USDC proxy | solc 0.4.24 | 16,597 | 2 | 0 of 27,800 | 0 of 120,000 | 92% | 9 of 12 | transfer +0.3% |

The two USDC proxy differences are callers whose gas allowance is so
tight that the deployed proxy fits and the port, 40 to 60 gas costlier per
call, runs out ([argotorg/fe#2002](https://github.com/argotorg/fe/issues/2002)).

The full account is in [docs/details.md](docs/details.md): shadow fuzzing,
[every Uniswap V2 pair at once](docs/details.md#every-uniswap-v2-pair-at-once),
[fuzzing from mainnet](docs/details.md#fuzzing-from-mainnet),
[a bug only mainnet callers showed](docs/details.md#a-bug-only-mainnet-callers-showed),
each port, [every label, explained](docs/details.md#every-label-explained),
[where Fe saves gas](docs/details.md#where-fe-saves-gas),
[across the year](docs/details.md#across-the-year),
[a block as one chain](docs/details.md#a-block-as-one-chain),
[how sharp the checks are](docs/details.md#how-sharp-are-the-checks),
[certificates](docs/details.md#one-command-a-port-certificate),
[the GitHub Action](docs/details.md#verified-ports-and-a-github-action)
and the [explorer](docs/details.md#explorer).


## Fe highlight

**The compiler proves the replay cannot touch the network or the disk.**
Fe functions declare the capabilities they use, and native I/O is a
capability like any other. Only `main` and the `fetch` module ask for
`Spawn` (which starts curl) and `Fs`. `replay_tx`, which produces the
verdict, asks only for a text buffer to write its report to:

```fe
pub fn replay_tx(
    _ block: BlockEnv,
    parent_hash: u256,
    older_hashes: Value,
    _ tx: Value,
    _ receipt: Value,
    _ prestate: Value,
    _ diff: Value,
    shadow_address: u256,
    shadow_code: MemSpan,
) -> Mismatches
uses (text: mut MemBuffer)
```

Calling `fetch` from inside it would be a type error. So the verdict
provably depends on the node's answers alone, and a fixture replays the same
way on any machine, offline. In most languages that is a convention. In Fe
the type checker enforces it.

**The compiler checks the blob fee schedule against mainnet.** EIP-4844's
blob base fee is a `const fn`, typed with std's units: a `Timestamp` picks
the fork's update fraction and the fee comes out in `Wei`. `static_assert`s
next to it run the fee formula at compile time on a real block, so a wrong
constant or a broken formula does not build:

```fe
pub const fn blob_base_fee(excess: u256, fraction: u256) -> Wei { ... }
pub const fn update_fraction(_ at: Timestamp) -> u256 { ... }

// Block 26,393,604 (BPO2) had 0xb58bccf excess blob gas, and the node
// priced its blobs at 0xb58b03 wei.
static_assert(blob_base_fee(excess: 0xb58bccf, fraction: BPO2_UPDATE_FRACTION).as_wei() == 0xb58b03)
static_assert(update_fraction(BPO1) == BPO1_UPDATE_FRACTION)
```

```
error[8-0081]: static assertion failed
   = left: `11897603`
   = right: `11897604`
```

(what the build says when the expected price is off by one wei).

Other Fe pieces doing real work:

- Every percentage the tool prints (match rates, mutants killed, gas
  changes) is a `core::fixed` number: `UFixed<1>` for shares, `Fixed<1>`
  for signed gas changes. The scale is in the type, so tenths of a percent
  cannot be mixed with whole percents or raw counts.
- A certificate's checks implement one trait, `certify::Check`: each kind
  of result (a replay's totals, mutated runs, random calls, mutation
  testing) says itself what in it fails the port, and the verdict is the
  sum, so a check cannot be left out of it. The certificate opens with a
  line per check.
- Per-function gas is a `Gas` unit of its own (as std's `Wei` is for
  ether): gas adds to gas and divides by a count of calls, and a count
  cannot stand in for gas.
- The ports speak `msg`/`recv`: each declares its ABI as a `msg` with
  selectors, and the contract's `recv` blocks answer it. The ports'
  tests call them through the same `msg` types.
- fevm's `transact` is generic over a `Tracer`. Passing `()` compiles to an
  interpreter without hooks, so plain replays pay nothing for tracing.
- Fe's `#[cfg(target_family = "unix")]` keeps the host-dependent code
  (`std::fs`, `std::process`) out of the library, which type-checks for any
  target.
- Parsing uses [fe-lang/json](https://github.com/fe-lang/json). Execution
  uses fevm's `WorldState`, `TxRequest` and `Receipt`. The whole pipeline,
  from the HTTP call to the verdict, is Fe.

## Architecture

| Module | Role |
| --- | --- |
| `src/fetch.fe` | JSON-RPC through curl (`Spawn`), fixtures, block directories and proofs, EIP-4844 blob base fee |
| `src/load.fe` | JSON to fevm: `load_world`, `load_tx`, `load_block` |
| `src/replay.fe` | `replay_tx`: load, `transact`, compare; `trace_tx`; finding the account whose code hash a bot checked. No host capabilities |
| `src/check.fe` | checks the shape of the node's answers before anything reads them |
| `src/compare.fe` | applies the chain's diff, then compares worlds, receipts and logs |
| `src/proof.fe` | Merkle-Patricia proofs (EIP-1186) against a state root, block header hashes, a world checked account by account and slot by slot. No host capabilities |
| `src/receipts.fe` | receipts encoded as the chain encodes them, and a Merkle-Patricia trie built from them, for the header's `receiptsRoot`. No host capabilities |
| `src/roots.fe` | transactions re-encoded (EIP-2718) and withdrawals, for the header's `transactionsRoot` and `withdrawalsRoot`. No host capabilities |
| `src/stateless.fe` | the end-state root computed from the parent's witness and fevm's end state: inserts, changes and deletions in a partial Merkle-Patricia trie. No host capabilities |
| `src/requests.fe` | the system calls (EIP-4788, EIP-2935, EIP-7002, EIP-7251), deposits from fevm's logs (EIP-6110), and the EIP-7685 requests hash, for the header's `requestsHash`. No host capabilities |
| `src/fuzz.fe` | shadow fuzzing of WETH9 and of a Uniswap V2 pair: random calls against deployed code and its port, compared after each |
| `src/mutate.fe` | mainnet-seeded fuzzing: real transactions mutated on their own pre-state, calls changed in flight through a proxy |
| `src/watch.fe` | `GasWatch`, a tracer that records every call (caller, account it runs as, value, gas, calldata and output), reads of the gas left after shadow code ran, of code hashes, `BLOCKHASH`, and the port's program counters; where two runs part and which gas reading explains it |
| `src/mutants.fe` | mutation sites in a port's source and the mutants planted there |
| `src/certify.fe` | the certificate page |
| `src/source.fe` | a selector's `msg` variant and `recv` arm in a port's source, for lack of a source map |
| `src/lib.fe` | the CLI: `fetch`, `fetch-block`, `fetch-code`, `fetch-hashes`, `fetch-proofs`, `block`, `range`, `chain`, `trace`, `opgas`, `fuzz`, `fuzz-pair`, `fuzz-usdt`, `fuzz-dai`, `fuzz-proxy`, `fuzz-block`, `mutants`, `certify`, replaying fixture files |
| `src/tests.fe`, `src/proof_tests.fe` | unit tests for the helpers; the proof tests run on a real proof and header from mainnet |
| `ports/weth9` | WETH9 in Fe, for shadow replay |
| `ports/uniswap-v2-pair` | UniswapV2Pair in Fe, for shadow replay of every V2 pair |
| `ports/usdt` | TetherToken (USDT) in Fe |
| `ports/usdc-proxy` | FiatTokenProxy, USDC's upgradeable proxy, in Fe |
| `ports/dai` | DAI (MakerDAO) in Fe, with `permit` and `LibNote` |

## Try it without Fe

Each release carries the executable for x86-64 Linux (or WSL), the ports'
bytecode and the fixtures:

```sh
curl -sL https://github.com/PugarHuda/fevm-replay/releases/latest/download/fevm-replay-v0.2.0-x86_64-linux.tar.gz | tar xz
cd fevm-replay-v0.2.0-x86_64-linux
./fevm_replay fixtures/mainnet/*.json            # 7 real transactions, all MATCH
mkdir proven && tar xzf fixtures/proven/0x19335e5.tar.gz -C proven
./fevm_replay chain proven/0x19335e5             # a mainnet block, every root in its header
```

Then fetch a live block, prove it and replay it as a chain (needs `curl`):

```sh
B=$(printf '0x%x' $(( $(curl -s -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' https://eth.drpc.org | grep -o '0x[0-9a-f]*') - 2 )))
./fevm_replay fetch-block $B block && ./fevm_replay fetch-proofs block && ./fevm_replay chain block
```

## Build and test

Native Fe programs build on x86-64 Linux and AArch64 macOS (on Windows, use
WSL). fevm needs `std::native::sha256_compress`, which landed on Fe master
just after 26.6.0, so this project pins Fe master
[`4608e5fdf`](https://github.com/argotorg/fe/commit/4608e5fdfa3783ec78347f297ad0fced8928fcc7),
the commit fevm itself pins. The Fe team confirmed that pinning master is
fine for the contest.

```sh
# Fe at the pinned commit (needs rustup and a C compiler)
rustup toolchain install 1.99.0 --profile minimal
cargo +1.99.0 install --locked --root ~/fe \
  --git https://github.com/argotorg/fe --rev 4608e5fdfa3783ec78347f297ad0fced8928fcc7 --features cranelift fe
export PATH="$HOME/fe/bin:$PATH"

fe --version
fe test --backend native .
fe build --backend native -O 2 --emit executable --out-dir out .

./out/fevm_replay fixtures/mainnet/*.json        # all MATCH
./out/fevm_replay fixtures/negative/gas.json     # DIFF, exit 1
```

Fetching needs `curl` and a node with the `debug` namespace. The default is
the free `https://eth.drpc.org`; pass another URL as the last argument.

## Demo

![fevm-replay fetching and replaying a mainnet transaction, a negative fixture, a whole block and a shadow replay of Fe WETH9](demo/demo.svg)

The recording is [`demo/demo.sh`](demo/demo.sh) (asciinema, svg-term).
Videos: [`demo/tour-narrated.mp4`](demo/tour-narrated.mp4), a 3-minute
narrated tour (narration in [`demo/narration.txt`](demo/narration.txt),
neural voice through `edge-tts`; scenes are HTML pages with real output,
[`demo/make_tour.py`](demo/make_tour.py)); [`demo/tour.mp4`](demo/tour.mp4),
the same captioned only; [`demo/explorer-tour.mp4`](demo/explorer-tour.mp4),
[the explorer](https://fevm-replay.vercel.app/explorer.html) in 25 seconds.
The same steps by hand:

```sh
./out/fevm_replay fetch 0x9a0970fbbf5df6a17277bc94bf2d96e117d504bd36e341a7ca5230998f916184 usdt.json
./out/fevm_replay usdt.json
./out/fevm_replay fetch-block 0x192bd90 blocks/26394000
./out/fevm_replay block blocks/26394000

# Shadow replay: the same block with Fe WETH9 in place of mainnet WETH
(cd ports/weth9 && fe build -O 2 --out-dir ../../out/weth9 .)
./out/fevm_replay block blocks/26394000 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 out/weth9/WETH9.runtime.bin

# Many blocks: fetches what is missing (five calls a block), replays, totals.
# Run it again to resume; saved blocks are not fetched twice.
./out/fevm_replay range 26394000 20 blocks
./out/fevm_replay range 26394000 20 blocks 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 out/weth9/WETH9.runtime.bin
```

## Security assumptions

What a MATCH or a clean certificate rests on:

- **The node's traces are the reference, unless the block has proofs.**
  Pre-state, receipts and state diffs come from one RPC endpoint. A node
  bug shows up as a DIFF, as several did (see Results); a node that lies
  consistently in its prestate and its diff would go unnoticed by `block`
  and `range`. With `fetch-proofs`, `chain` proves the pre-state and the
  end state against the state roots of headers whose hashes it checks
  and computes the end state's root ([Every root in the
  header](#every-root-in-the-header)), so what it reports rests on the
  block hash alone. fevm's receipts, logs and gas, the transactions and the
  withdrawals are checked against the header for every saved block, with
  or without proofs.
- **A load-balanced endpoint can mix nodes** near the chain head. Fetch a
  few blocks behind it.
- **Fixtures are trusted input.** A replay reads only the fixture file, and
  the compiler enforces it: the functions that decide MATCH or DIFF do not
  declare the `Spawn` or `Fs` effects (see [Fe highlight](#fe-highlight)).
  A fixture edited by hand replays what it says; malformed ones are rejected
  with a message, not a panic.
- **fevm is the reference EVM for shadow replay and fuzzing.** Both codes
  run in the same fevm, so a fevm bug that hits both the same way is not
  seen there. Plain replays compare fevm with the chain, which is how fevm
  itself is checked.
- **A certificate is evidence, not proof.** It covers the blocks, calls and
  mutants it names. Behavior no transaction, random call or mutation
  reached is not covered; the coverage line says how much of the port ran.
- **Gas- and code-hash-labeled differences are excluded from the verdict**
  only when the call tree shows other code reading the gas left or a code
  hash where the runs part. A port bug that hides behind such a reading
  would be labeled, not counted.
- **The fetcher runs `curl`** with arguments it builds itself from the URL
  and hashes on the command line. It does not run a shell.

## Limitations

- **Block hashes:** `fetch-block` loads only the parent's. `fetch-hashes`
  adds the 256 before a block (86 calls at three a batch), and `range` does
  it by itself for a block whose transactions read one: block 26,400,001
  goes from 446/447 to 447/447.
- **`block` and `range` run each transaction alone**, on its own pre-state
  from the node. `chain` carries state from one transaction to the next,
  credits withdrawals and, with proofs, runs the block's system calls.
- **Stateless validation needs fresh proofs.** Nodes serve `eth_getProof`
  for about 100 blocks back, so `fetch-proofs` must follow the chain head.
  A deletion that moves up a node the parent's proofs lack takes it from
  the block's own proofs (checked by its hash); failing that, the node is
  taken to be a branch and the output counts it (once each in blocks
  26,424,862 and 26,424,863, whose roots still matched). Proofs saved
  before the first system contracts' code was saved fall back to checking
  the end state key by key.
- **Osaka with mainnet's BPO2 blob schedule only.** Older blocks may follow
  other rules.
- Shadow replay and fuzzing have limits of their own, listed in
  [docs/details.md](docs/details.md#limitations-of-shadow-replay-and-fuzzing).
- **Only Osaka.** fevm implements Osaka rules, so exact replays cover blocks
  from December 2025 on. Older blocks replay under Osaka rules as a
  measurement of the fork, not a check of fevm (see
  [Across the year](docs/details.md#across-the-year)).
- **Delegates come from the parent block's state.** A delegation target
  whose code changed within the block would be fetched as it was before.

## Declaration

- **Pre-existing work:** none. The repository starts from
  [fe-lang/builders-challenge-starter](https://github.com/fe-lang/builders-challenge-starter)
  at `f9d9aa9`. Everything after that commit was written during the
  contest.
- **Third-party code:** none copied. Dependencies are referenced, not
  vendored:
  - [fe-lang/fevm](https://github.com/fe-lang/fevm): the Fe team states it
    will be Apache-2.0.
  - [fe-lang/json](https://github.com/fe-lang/json) (Apache-2.0).
- **AI assistance:** written with Claude (Anthropic) as a pair programmer.
  It drafted the code, which was then checked against the compiler, the
  mainnet results and the negative fixtures. All design choices and results
  were reviewed by the author.

## Team

Pugar Huda Mantoro ([@PugarHuda](https://github.com/PugarHuda)), solo.

## License

Apache-2.0, see [LICENSE](LICENSE).
