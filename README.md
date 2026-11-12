# fevm-replay

[![CI](https://github.com/PugarHuda/fevm-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/PugarHuda/fevm-replay/actions/workflows/ci.yml)

**Site and documentation:** https://fevm-replay.vercel.app (mirror: https://pugarhuda.github.io/fevm-replay/)

**Pitch:** Replay real Ethereum mainnet transactions inside
[fevm](https://github.com/fe-lang/fevm), the EVM written in Fe, and prove
that each one ends exactly as it did on chain: status, gas, logs and every
balance, nonce, code and storage slot.

```
$ fevm-replay range 26394000 20 blocks
block 0x192bd90: 267/267 transactions MATCH (100.0%)
...
block 0x192bda3: 320/320 transactions MATCH (100.0%)
20 blocks: 5129/5129 transactions MATCH (100.0%)
```

Replaying is fast: those 5,129 transactions take 5.9 seconds once fetched.

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

- **`BLOCKHASH` of the parent block** (5 in the first run): the prestate
  tracer can't report block hashes, because they are not state. One of these
  transactions even deployed bytecode with the hash baked in, which showed up
  as code of the same size with different bytes. The parent's hash now comes
  from the header.
- **`BLOCKHASH` of an older block** (91): a transaction that differs is run
  a second time under a tracer. If it runs `BLOCKHASH`, it is labeled.
  Given the 256 previous hashes (the `blockHashes` field of a fixture), the
  one checked by hand matches.
- **Answers from different nodes** (3): blocks fetched right at the chain
  head through a load-balanced endpoint. Fetched again, the same block
  matches 391/391. `block` now refuses data whose receipts name another
  block hash than the header.
- **Inconsistent block traces** (37 of the 300-block run): every one of
  them matches when fetched again as a single transaction
  (`debug_traceTransaction`).
- **A gap in the prestate tracer** (seen once): an EIP-7702 transaction
  (`0xbf29…5e33`) calls an account delegated to `0x490a…ca1d`. Running it
  runs that target's code, yet one node's prestate left the target out, so
  fevm found no code and the call did nothing. `fetch` and `fetch-block`
  now add every delegation target missing from the prestate (from the
  authorization list and from `0xef0100` designators), with its code from
  `eth_getCode`, as `delegates`.
  `fixtures/mainnet/eip7702-delegate-missing-from-trace.json` keeps the
  case: it matches with `delegates` and differs without them.
- **A node tracer bug** (1): in transaction
  `0xee56…e697`, a contract deployed with CREATE2 to an address that
  already held ETH destroys itself in the same transaction (EIP-6780).
  `debug_traceBlockByNumber` in `diffMode` reported the account as kept,
  with nonce 1. `debug_traceTransaction` and the chain's own state at that
  block (nonce 0, balance 0, no code) say it was deleted, which is what fevm
  did.

`fixtures/negative` holds seven copies of a real transaction, each with one
fact about the chain's result changed: gas, status, a balance, a storage
slot, log data, the log count, and an unexpected write. All seven are
reported as DIFF, which shows the comparison can fail.

## Shadow replay: is a Fe port a drop-in replacement?

`fevm-replay block <dir> <address> <runtime.bin>` replaces the code at
`address` with other runtime code in every transaction that touches it.
For each such transaction it then requires the same logs, balances, nonces
and storage as on chain. Gas may differ, so the sender's fee and the
coinbase's tip are settled by the gas difference first.

[`ports/weth9`](ports/weth9) is WETH9 written in Fe. It keeps the deployed
contract's selectors, events, storage slots (it reads `name` and `symbol`
from their Solidity short-string slots), payable fallback, empty revert
data and ETH transfer gas.

**Shadow replay found a bug in it that unit tests had missed.** Over 300
blocks, 4,806 transactions ran Fe WETH9. In one of them,
`0x4ac9…0f73`, a contract withdraws zero WETH into its own fallback.
Solidity's `msg.sender.transfer(wad)` compiles to a call with
`wad == 0 ? 2300 : 0` gas: the EVM adds the 2,300 gas stipend only to calls
that move ETH, so for zero solc passes it explicitly. The port passed no gas,
the fallback ran out, and the withdrawal reverted where mainnet's did not.
The port now does what solc does, and
`withdrawing_zero_into_a_fallback_succeeds` fails without the fix and
passes with it. Replayed again, the block's 14 WETH transactions are all
identical.

| Fe WETH9 in place of mainnet WETH (300 blocks) | Transactions |
| --- | ---: |
| Ran Fe WETH9 | 4,806 |
| Identical logs and state | 4,348 |
| Differ only where code reads the gas left | 454 |
| Differed in behavior: the zero-withdrawal bug above (now fixed) | 1 |
| Differed in behavior: inconsistent block traces (match per transaction) | 3 |

Fe WETH9 used 0.42% less gas than the deployed Solidity over those
transactions. That is the gas of whole transactions, so the share WETH itself
saved is larger.

The 454 are mostly MEV bots that size a builder payment from the gas they
used, and ERC-4337 bundles whose `UserOperationEvent` records it. Cheaper
code legitimately changes what they do. This is detected, not guessed: a
`GasWatch` tracer records whether any other code ran `GAS` after the shadow
code first ran. Only a difference without such a reading counts as the port
behaving differently.

As a control, shadowing WETH with its own deployed bytecode matches every
transaction with identical gas.

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

Other Fe pieces doing real work:

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
| `src/fetch.fe` | JSON-RPC through curl (`Spawn`), fixtures and block directories, EIP-4844 blob base fee |
| `src/load.fe` | JSON to fevm: `load_world`, `load_tx`, `load_block` |
| `src/replay.fe` | `replay_tx`: load, `transact`, compare. No host capabilities |
| `src/compare.fe` | applies the chain's diff, then compares worlds, receipts and logs |
| `src/watch.fe` | `GasWatch`, a tracer that records reads of the gas left after shadow code ran, and `BLOCKHASH` |
| `src/lib.fe` | the CLI: `fetch`, `fetch-block`, `block`, `range`, replaying fixture files |
| `src/tests.fe` | unit tests for the helpers |
| `ports/weth9` | WETH9 in Fe, for shadow replay |

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

The recording is [`demo/demo.sh`](demo/demo.sh), made with asciinema and
svg-term. The same steps by hand:

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

## Limitations

- **Block hashes:** `fetch-block` loads only the parent's. A transaction that
  reads an older one through `BLOCKHASH` sees zero, reports DIFF and is
  labeled. A fixture can carry older ones in `blockHashes`. Fetching all 256
  would cost 86 calls per block on a free endpoint that allows three
  requests per batch.
- **Each transaction runs alone**, on its own pre-state from the node.
  Block-level effects (system contracts, withdrawals, the coinbase reward)
  are not replayed.
- **Osaka with mainnet's BPO2 blob schedule only.** Older blocks may follow
  other rules.
- **The node is trusted.** Its traces are the reference, so a node bug shows
  up as a DIFF. That happened once, and the chain's own state settled it (see
  Results). Data fetched near the chain head through a load-balanced
  endpoint can mix nodes. `block` rejects data whose receipts disagree with
  the header, but fetching a few blocks behind the head is safer.
- **Shadow replay sees gas-sensitive code.** Code that reads `GAS` after the
  shadow code ran may legitimately act differently. Such transactions are
  labeled rather than counted as port bugs.
- **Fe WETH9 decodes calldata strictly** where Solidity 0.4 read missing
  arguments as zero. No transaction in the replayed blocks relied on that.
- **Delegates come from the parent block's state.** A delegation target
  whose code changed within the block would be fetched as it was before.
- **Double-counted cleared slots:** a slot the chain cleared and fevm kept
  is counted by both comparison passes. The verdict is correct, but its
  count is one too high.

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
