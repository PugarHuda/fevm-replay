# What 22 mainnet blocks say about stateless Ethereum

*Measured by fevm-replay on 16 November 2026, over 22 mainnet blocks between
26,424,722 and 26,425,846 (4,727 transactions, 671 million gas), each one
validated statelessly by fevm: every root in its header computed from the
parent's witness. The live numbers, with every block, are on the
[stateless blocks page](https://fevm-replay.vercel.app/stateless.html).*

## How it was measured

For each block, `chain` takes the parent's Merkle proofs (EIP-1186) of every
account and slot the block touched as the witness, runs the block's system
calls and transactions in fevm, writes fevm's end state into that partial
trie and hashes it again; the result is the header's `stateRoot` in all 22
blocks. The witness below is what that took: the parent's distinct proof
nodes, account and storage, plus the few nodes a deletion moved up that the
parent's proofs lack. Contract code is left out (it comes on top, checked
against the proven code hashes). The binary-tree figures are estimates for
EIP-7864's unified tree over the same accounts and slots: the stems and
values are exact, the stems are placed by keccak (the EIP has not fixed its
hash) and the tree is taken to be 28 to 31 levels deep above them.

## Findings

1. **A transaction needs about 15 KiB of witness.** Median 14.8 KiB, mean
   18.5 KiB, from 10.7 to 42.2 KiB per block. A block needed 0.98 to
   7.83 MiB (85.5 MiB over the 22).
2. **Per gas, the cost varies threefold.** Median 141 KiB of witness per
   million gas, from 48 to 215: blocks of the same gas can touch very
   different amounts of state.
3. **Storage is most of the witness: 61.6% of its bytes.** Accounts are the
   rest.
4. **A few contracts carry it.** Among each block's five heaviest storage
   tries, three contracts (XEN Crypto, USDT, USDC) account for 53.5% of all
   storage witness bytes.
5. **Deep storage tries make each slot expensive.** A slot proven in XEN
   Crypto's trie needs 8.2 nodes on average, in USDT's or USDC's 7.4, in
   WETH's 7.1: about 2 KiB of witness for every slot a transaction touches.
6. **A binary tree would shrink the witness 1.9 to 3.8 times** (median
   2.5) on these blocks. Deep storage tries gain most: XEN Crypto's
   17.1 MiB of witness becomes an estimated 2.4 to 2.6 MiB.
7. **But not every contract gains.** A contract with a small storage trie
   can grow: in the unified tree each of its slots sits on its own path
   from the root, where its own trie kept them close. One contract among the
   17 heaviest, 0xf02d…3c58 (85 slots, 4.2 nodes a slot), grows from 32 KiB
   to an estimated 80 KiB.
8. **eth_getProof is almost a full witness.** A deletion that leaves a
   branch with one child moves that child up, and the child may belong to a
   key no transaction touched, which `eth_getProof` cannot name. Such nodes
   were 1.4% of the nodes and 1.6% of the bytes; they were taken from the
   block's own proofs, each checked by the hash its parent names. Thirteen
   times over the 22 blocks such a node was in neither proof and was taken
   to be a branch; every state root still matched.

## Reproduce

```sh
./out/fevm_replay follow blocks stateless.json 3     # takes, proves and validates 3 head blocks
mkdir proven && tar xzf fixtures/proven/0x19335e5.tar.gz -C proven
./out/fevm_replay chain proven/0x19335e5             # one block, with its witness and heaviest tries
```

Each block's numbers are in its `summary.json`, written by `chain`; the
page's data is [site/data/stateless.json](../site/data/stateless.json).
