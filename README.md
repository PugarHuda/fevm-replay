# fevm-replay

**Pitch:** Replay real Ethereum mainnet transactions inside
[fevm](https://github.com/fe-lang/fevm), the EVM written in Fe, and prove
that each one ends exactly as it did on chain: status, gas, logs and every
balance, nonce, code and storage slot.

```
$ fevm-replay fetch-block 0x192bc04 blocks/26393604
saved block 0x192bc04 in blocks/26393604
$ fevm-replay block blocks/26393604
block 0x192bc04: 248/248 transactions MATCH (100.0%)
```

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
   changed. A whole block takes four calls: `eth_getBlockByNumber`,
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

The first block run found five transactions that did not match. All five
read `BLOCKHASH` of the parent block. The prestate tracer can't report it,
because block hashes are not state. One of them even deployed bytecode with
the hash baked in, which showed up as code of the same size with different
bytes. The parent's hash now comes from the header, and all 5,129 match.

`fixtures/negative` holds seven copies of a real transaction, each with one
fact about the chain's result changed: gas, status, a balance, a storage
slot, log data, the log count, and an unexpected write. All seven are
reported as DIFF, which shows the comparison can fail.

## Fe highlight

**The compiler proves the replay cannot touch the network or the disk.**
Fe functions declare the capabilities they use, and native I/O is a
capability like any other. Only `main` and the `fetch` module ask for
`Spawn` (which starts curl) and `Fs`. `replay_tx`, which produces the
verdict, asks only for a text buffer to write its report to:

```fe
pub fn replay_tx(_ block: BlockEnv, parent_hash: u256, _ tx: Value, _ receipt: Value, _ prestate: Value,
                 _ diff: Value) -> Mismatches uses (text: mut MemBuffer)
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
| `src/lib.fe` | the CLI: `fetch`, `fetch-block`, `block`, replaying fixture files |
| `src/tests.fe` | unit tests for the helpers |

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
  --git https://github.com/argotorg/fe --rev 4608e5fdfa3783ec78347f297ad0fced8928fcc7 fe
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

```sh
./out/fevm_replay fetch 0x9a0970fbbf5df6a17277bc94bf2d96e117d504bd36e341a7ca5230998f916184 usdt.json
./out/fevm_replay usdt.json
./out/fevm_replay fetch-block 0x192bd90 blocks/26394000
./out/fevm_replay block blocks/26394000
```

## Limitations

- **Block hashes:** only the parent's is loaded. A transaction that reads
  an older one through `BLOCKHASH` sees zero and reports DIFF.
- **Each transaction runs alone**, on its own pre-state from the node.
  Block-level effects (system contracts, withdrawals, the coinbase reward)
  are not replayed.
- **Osaka with mainnet's BPO2 blob schedule only.** Older blocks may follow
  other rules.
- **The node is trusted.** Its traces are the reference, and a buggy node
  would produce a false DIFF.
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
