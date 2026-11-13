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

`fixtures/malformed` holds twelve broken fixtures (a missing diff, logs that
are not a list, code that is not a string, and so on). Each one is reported
as `ERROR <file>: <what is wrong>`, not a crash. In a block, a transaction
whose trace the node failed (`execution timeout` on a heavy block) is
reported, and the rest still replay.

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

Shadow replay also measures gas per function. Each shadowed transaction runs
a second time on the deployed code, and a tracer adds up the gas of every
call into WETH by selector. Only transactions the port leaves identical are
counted, so both sides served the same calls. Over blocks 26,394,000 to
26,394,019 (1,631 calls):

| Function | Calls | Deployed Solidity | Fe WETH9 | Change |
| --- | ---: | ---: | ---: | ---: |
| `balanceOf` | 720 | 934 | 806 | −13.7% |
| `transfer` | 441 | 14,207 | 13,745 | −3.2% |
| `transferFrom` | 162 | 11,544 | 11,105 | −3.8% |
| `withdraw` | 140 | 9,619 | 9,360 | −2.6% |
| `deposit` | 104 | 17,237 | 17,109 | −0.7% |
| `approve` | 48 | 16,586 | 16,427 | −0.9% |
| `allowance` | 10 | 2,317 | 2,121 | −8.4% |
| fallback (no calldata) | 4 | 18,956 | 18,972 | +0.1% |

Average gas per call, including the storage and calls each makes. Across the
300-block run, whole transactions that ran Fe WETH9 used 0.42% less gas.

The 454 are mostly MEV bots that size a builder payment from the gas they
used, and ERC-4337 bundles whose `UserOperationEvent` records it. Cheaper
code legitimately changes what they do. This is detected, not guessed: a
`GasWatch` tracer records whether any other code ran `GAS` after the shadow
code first ran. Only a difference without such a reading counts as the port
behaving differently.

As a control, shadowing WETH with its own deployed bytecode matches every
transaction with identical gas.

### Shadow fuzzing

Mainnet only makes the calls it happens to make. `fuzz` makes the rest: random
calls against two copies of one world, one running the deployed code and one
running the port, compared after every call (status, return data, logs and
all state). Callers include contracts that accept and reject ETH, so
withdrawals into fallbacks are exercised. Everything follows from the seed.

```sh
./out/fevm_replay fetch-code 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 weth9.hex
./out/fevm_replay fuzz weth9.hex out/weth9/WETH9.runtime.bin 20000 60 1000
```

| Calls (20,000 runs, 2.1 s) | Calls | Differ |
| --- | ---: | ---: |
| Well-formed | 245,415 | 0 |
| Calldata shorter than the arguments | 26,858 | 10,273 |
| Address arguments with dirty upper bits | 38,965 | 9,343 |

The last two are expected: Fe's ABI decoder rejects what solc 0.4 lets
through, and they are reported apart. Only a well-formed difference fails the
run. Against the port from before the zero-withdrawal fix, `fuzz` finds that
bug in 0.1 s and prints the call to reproduce it:

```
first difference: seed 34, call 23, selector 0x2e1a7d4d withdraw (well-formed): status differs
  from 0x0000000000000000000000000000000000001000 to 0x0000000000000000000000000000000000002000 value 0
  calldata 0x2e1a7d4d0000000000000000000000000000000000000000000000000000000000000000
  deployed success, port revert
```

### Every Uniswap V2 pair at once

[`ports/uniswap-v2-pair`](ports/uniswap-v2-pair) is UniswapV2Pair written in
Fe: the same selectors, events, storage slots 0 to 12 (with `reserve0`,
`reserve1` and `blockTimestampLast` packed in slot 8), revert reasons and
external calls as the deployed solc 0.5.16 code, including its quirks
(`ds-math-*` reasons, wrapping price accumulators, `transfer` that accepts
tokens returning nothing).

Every Uniswap V2 pair on mainnet runs the same 11,293 bytes. So `block` and
`range` also take a file of deployed code in place of an address, and
shadow **every account running that code** in each transaction:

```sh
./out/fevm_replay fetch-code 0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc pair.hex
(cd ports/uniswap-v2-pair && fe build -O 2 --out-dir ../../out/pair .)
./out/fevm_replay range 26400000 200 blocks pair.hex out/pair/UniswapV2Pair.runtime.bin
```

| Fe UniswapV2Pair in place of every V2 pair (blocks 26,400,000 to 26,400,199, 69,643 transactions) | Transactions |
| --- | ---: |
| Ran the Fe pair | 856 |
| Identical logs and state | 806 |
| Differ only where code reads the gas left | 47 |
| Differ only where code reads code hashes | 3 |
| **Differed in behavior** | **0** |

These figures were measured with the port as of commit `4b6e3a2`, before
the revert fix described below, which touches only the path where a pair
reverts with a reason.

The code-hash cases are a MEV bot that checks `EXTCODEHASH` of the
pairs it trades through. The port is other code, so its hash differs and the
bot refuses it. Like gas readings, this is detected (other code ran
`EXTCODEHASH` or `EXTCODECOPY`), not guessed.

| Function | Calls | Deployed Solidity | Fe pair | Change |
| --- | ---: | ---: | ---: | ---: |
| `swap` | 873 | 58,307 | 57,819 | −0.8% |
| `getReserves` | 803 | 2,185 | 2,088 | −4.4% |
| `token0` | 49 | 2,136 | 2,063 | −3.4% |
| `factory` | 43 | 2,402 | 2,329 | −3.0% |
| `token1` | 26 | 2,049 | 1,976 | −3.6% |
| `sync` | 7 | 33,498 | 33,852 | +1.1% |

Whole transactions that ran the Fe pair used 0.52% less gas. A first version
of the port used 28% more on `swap`: it read and wrote ABI words a byte at a
time. Shadow replay's per-function gas pointed straight at it.

Mainnet rarely shows a pair's first deposit, a burn of the whole supply or a
reentrant callee, so `fuzz-pair` builds a pair between two tokens running
WETH9's code, a factory with `feeTo` unset or set, and flash-swap callees
that accept or call back into the pair:

```sh
./out/fevm_replay fuzz-pair pair.hex out/pair/UniswapV2Pair.runtime.bin weth9.hex 20000 60 1000
```

| Calls (20,000 runs, 29 s) | Calls | Differ |
| --- | ---: | ---: |
| Well-formed | 260,738 | 0 |
| Calldata shorter than the arguments | 23,840 | 0 |
| Address arguments with dirty upper bits | 31,668 | 19,594 |

Of the well-formed calls, 2,029 mints, 582 swaps and 109 burns succeeded;
the rest of the run covers the reverts. Fuzzing found two things mainnet had
not shown:

- **Division by zero.** solc 0.5 divides with `INVALID`, which ends the call
  and burns all its gas. The port's first stand-in reverted instead, which a
  caller can tell apart. Fe has no `INVALID`, so the port now grows memory
  until it runs out of gas: the same exceptional halt.
- **solc 0.5 leaks memory into revert reasons.** After a flash swap, the
  deployed pair reverts with `UniswapV2: INSUFFICIENT_INPUT_AMOUNT` padded
  with a stray `0x80` left in memory by the callback's calldata. The port
  pads with zeros. The reasons are equal, so such calls are counted apart
  (300 in this run), not as differences.

A difference is shrunk: the run is regenerated from its seed and every call
it does not need is dropped, down to the shortest sequence that still
differs. Pair runs also check the port against Uniswap V2's invariants
after every call (the lock is released, `k` never falls in a successful
swap, the supply is zero or at least the 1,000 locked); none broke.

### Fuzzing from mainnet

Random calls in a made-up world miss what real traffic does at the edge.
`fuzz-block` starts from real transactions instead: each one that touches
the deployed code runs, mutated, on its own mainnet pre-state, once with the
deployed code and once with the port, gas free so only behavior can differ.
A mutation changes either the transaction's calldata (exercising the router
or bot that sent it) or, **in flight**, one call the pair really received:
the pair's account runs a small proxy that patches one calldata word and
`DELEGATECALL`s the real code, while the transaction runs unchanged. So a
swap's output is changed with its input tokens already in the pair, the real
router as `msg.sender`, and real tokens (fee-on-transfer, USDT, rebasing)
on the other side.

```sh
./out/fevm_replay fuzz-block blocks/* pair.hex out/pair/UniswapV2Pair.runtime.bin 50 7
```

In flight, the changed call's own status and output decide: callers that
react to gas cannot hide a real difference. Two checks that the oracle
works:

| Ten blocks, 200 mutations per transaction (10,600 runs) | Differ |
| --- | ---: |
| The deployed code against itself | 0 |
| The Fe pair | 0 |
| The Fe pair with a planted bug (0.2% fee instead of 0.3% on one side) | 23 |

Random fuzzing missed the planted bug in 2,000 runs; mainnet's own swaps,
computed by routers right at the 0.3% boundary, find it.

It also found a real bug in the port. In block 26,400,014 a swap pays a
token that burns all the gas it is given, 63/64 of what the pair had. The
deployed pair still reverts with `UniswapV2: TRANSFER_FAILED`; the port ran
out of gas building the same reason through `DynString` and the ABI encoder.
The report pointed at it:

```
  deployed returned 0x08c379a0...556e697377617056323a205452414e534645525f4641494c4544...
  port returned     0x
  runs part at the call to 0x0000000000000000000000000000000000fe11ed selector 0x022c0d9f: deployed revert, port out_of_gas
```

The port now writes its reasons straight to memory as constant words and
reverts with them, as solc does. The first run over 200 blocks (42,800
runs) found 32 differences; this one is fixed and that block now has none.

The rest were the other way round: the deployed pair, costlier, ran out of
gas where the port got through. A change can leave a swap with just enough
gas for the port, or a bot can call with a fixed amount. Such a run is
counted apart when, in flight, both agree given twice the gas, or when the
runs part at a call, same calldata, that ran out of gas on the deployed code
alone. The port running out stays a difference, as above.

| All 200 blocks, 50 mutations per transaction (seed 7) | Runs |
| --- | ---: |
| Mutated | 42,800 |
| Identical | 41,411 |
| Differ where other code reads the gas left or code hashes | 1,276 |
| Differ after an address-shaped word got upper bits | 79 |
| Only the deployed code ran out of gas | 34 |
| **Differ** | **0** |

Of the 20,926 in-flight changes, 19,037 got past the pair's own checks. The
planted bug still shows 23 differences under the same rules.

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
| `src/check.fe` | checks the shape of the node's answers before anything reads them |
| `src/compare.fe` | applies the chain's diff, then compares worlds, receipts and logs |
| `src/fuzz.fe` | shadow fuzzing of WETH9 and of a Uniswap V2 pair: random calls against deployed code and its port, compared after each |
| `src/mutate.fe` | mainnet-seeded fuzzing: real transactions mutated on their own pre-state, calls changed in flight through a proxy |
| `src/watch.fe` | `GasWatch`, a tracer that records every call, reads of the gas left after shadow code ran, of code hashes, and `BLOCKHASH`; where two runs part |
| `src/lib.fe` | the CLI: `fetch`, `fetch-block`, `fetch-code`, `fetch-hashes`, `block`, `range`, `fuzz`, `fuzz-pair`, `fuzz-block`, replaying fixture files |
| `src/tests.fe` | unit tests for the helpers |
| `ports/weth9` | WETH9 in Fe, for shadow replay |
| `ports/uniswap-v2-pair` | UniswapV2Pair in Fe, for shadow replay of every V2 pair |

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

- **Block hashes:** `fetch-block` loads only the parent's. `fetch-hashes`
  adds the 256 before a block (86 calls at three a batch), and `range` does
  it by itself for a block whose transactions read one: block 26,400,001
  goes from 446/447 to 447/447.
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
  labeled rather than counted as port bugs. So are transactions where other
  code ran `EXTCODEHASH` or `EXTCODECOPY`, since a port is other code. The
  opcode's target is not checked, so a label can be broader than the cause.
- **The ports decode calldata strictly** where old solc did not: Fe WETH9
  rejects missing arguments Solidity 0.4 read as zero, and both reject
  address arguments with dirty upper bits that solc cleaned. No transaction
  in the replayed blocks relied on either.
- **The Fe pair halts on division by zero by running out of gas**, where
  solc 0.5 runs `INVALID`. Both burn all the call's gas; a tracer sees a
  different reason.
- **Mainnet fuzzing reads untouched state as empty.** Accounts and slots
  the original transaction did not touch are not in its pre-state; a
  mutation that wanders off sees them empty in both runs, which is fair
  but not realistic.
- **Code-hash labels are by opcode, not target.** fevm's tracer does not
  expose the stack, so a label can be broader than its cause.
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
