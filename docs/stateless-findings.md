# What 47 mainnet blocks say about stateless Ethereum

*Measured by fevm-replay over 47 mainnet blocks between 26,424,722 and 26,445,956 (10,549 transactions, 1,345 million gas, taken on 3 days: 2026-11-16, 2026-11-17, 2026-11-19), each one validated statelessly by fevm: every root in its header computed from the parent's witness. The live numbers, with every block, are on the [stateless blocks page](https://fevm-replay.vercel.app/stateless.html). This file is written by [`docs/findings.py`](findings.py) from the page's data.*

## How it was measured

For each block, `chain` takes the parent's Merkle proofs (EIP-1186) of every account and slot the block touched as the witness, runs the block's system calls and transactions in fevm, writes fevm's end state into that partial trie and hashes it again; the result is the header's `stateRoot` in every block here. The witness is what that took: the parent's distinct proof nodes, account and storage, plus the few nodes a deletion moved up that the parent's proofs lack. Contract code is counted apart (finding 12): a second run through fevm's own block layer (`fevm::Block`) notes the 31-byte chunks each contract's code runs, as EIP-7864 would carry them. A transaction's witness "alone" is the distinct proof bytes of the accounts and slots it touched, as if it were the only transaction in its block. The binary-tree figures are estimates for EIP-7864's unified tree over the same keys: stems and values exact, stems placed by keccak (the EIP has not fixed its hash), the tree taken to be 28 to 31 levels deep above them.

## Findings

1. **A transaction needs about 14.9 KiB of witness.** Median per block 14.9 KiB, mean 16.4 KiB, from 8.2 to 112.3 KiB. A block needed 0.73 to 7.83 MiB.
2. **What a transaction needs depends on what it does.** Alone in a block, on average:
   - ETH transfer: 10.2 KiB (4,171 transactions, the largest 27.8 KiB)
   - contract call: 45.6 KiB (6,069 transactions, the largest 2104.7 KiB)
   - contract creation: 64.3 KiB (22 transactions, the largest 303.8 KiB)
   - blob transaction: 29.1 KiB (100 transactions, the largest 93.2 KiB)
   - set-code transaction: 55.1 KiB (187 transactions, the largest 211.7 KiB)
3. **Transactions in a block share their witness.** Each on its own, a block's transactions would need 1.99 times the block's witness (median; 1.36 to 2.56): they touch the same tokens, pools and trie nodes near the root.
4. **Per gas, the cost varies about 4-fold.** Median 142 KiB of witness per million gas, from 48 to 215. The busier half of the blocks by gas needs more witness per transaction (15.6 against 14.5 KiB) but less per gas (129 against 150 KiB per million).
5. **Blobs do not weigh on the witness.** Blocks carried 0 to 19 blobs; the half with more needed 14.4 KiB a transaction, the half with fewer 15.6. Blob data never enters the state; a blob transaction's witness is that of the accounts it touches.
6. **Storage is most of the witness: 59.2% of its bytes.** A few contracts carry it: XEN Crypto, USDT, USDC account for 45.4% of all storage witness bytes.
7. **Deep storage tries make each slot expensive.** Nodes on a slot's proof path, on average: XEN Crypto 8.2; USDT 7.4; USDC 7.4; Uniswap v4's PoolManager 6.7; WETH 7.2. That is about 2.0 KiB of witness for every slot a transaction touches in the largest tries.
8. **An account proof is the size EIP-7864 expects.** The account proofs of the heaviest contracts weigh 3,847 bytes (median of 235); the EIP's rationale puts one branch of a hexary tree of 2^32 leaves at 15 × 32 × log16(2^32) = 3,840 bytes ([EIP-7864](https://eips.ethereum.org/EIPS/eip-7864)).
9. **A binary tree would shrink the witness 1.9 to 3.8 times** (median 2.4) on these blocks, less than the 3.75 times the EIP's rationale gives for a single branch (2,880 bytes at 16 children against 768 at 2, for 2^24 leaves): a block's branches share their upper nodes in either tree, and a binary tree also carries each stem and its values. Deep storage tries gain most: XEN Crypto's 19.5 MiB becomes an estimated 2.7 to 3.0 MiB.
10. **But not every contract gains.** A contract with a small storage trie can grow: in the unified tree each of its slots sits on its own path from the root, where its own trie kept them close. 1 of the 28 heaviest contracts grows; 0xf02d…3c58 (85 slots, 4.2 nodes a slot) from 32 KiB to an estimated 80 KiB.
11. **eth_getProof is almost a full witness.** A deletion that leaves a branch with one child moves that child up, and the child may belong to a key no transaction touched, which `eth_getProof` cannot name. Such nodes were 1.28% of the nodes and 1.52% of the bytes; they were taken from the block's own proofs, each checked by the hash its parent names. 19 times over the 47 blocks such a node was in neither proof and was taken to be a branch; every state root still matched.
12. **Code is 43% of a full witness, and a block runs a quarter of it.** `eth_getProof` carries no code, but a stateless client needs every contract it runs. A block ran 321 contracts (median) holding 2.6 MiB of code, which a Merkle-Patricia witness carries whole: 18% to 51% of the witness with code added. The 31-byte chunks it ran come to 25% of those bytes (17% to 29%), and EIP-7864 carries only those: with code, the binary tree shrinks the witness 2.0 to 3.3 times (median 2.33). Code read by `CODECOPY` and `EXTCODECOPY` is not counted.
13. **Under EIP-4762 the same blocks would cost 23% more gas.** EIP-4762 (Draft) charges for the witness: per transaction 1,900 a new stem read, 200 a leaf, 3,000 a stem written, 500 a leaf written, 6,200 a leaf filled; it drops EIP-2929's cold charges, EIP-2200's SSTORE costs and the 200 a byte of code deposited. Counted from each transaction's traces and the chunks fevm ran, its charges come to 1.60 times today's for the same accesses and writes: 23.0% of the blocks' gas (median per block 28%, from 1% to 45%). Code chunks, free today, are 47% of the charges and writes 28%. By kind, ETH transfers +27%, contract calls +23%, contract creations +14%, blob transactions +21%, set-code transactions +37% of their gas. An ETH transfer pays 5,774 gas of witness, nearly all for the coinbase it pays its priority fee to (a read and a write of its basic data, 5,600), which the draft does not exempt. Estimates: every touched account counts one basic-data read, and a slot the parent holds as zero counts as filled.

14. **What the draft's choices cost, and who would run out of gas.** Over 47 blocks, the coinbase alone is 7% of EIP-4762's witness charges; exempting it, as the draft exempts the sender and target, takes the increase from 23.0% to 18.7% of the blocks' gas. Sent with the same gas limit, 3,665 of 10,549 transactions (34.7%) would not cover their gas plus the witness charges less today's, and would run out of gas; with the coinbase exempt, 1,400 (13.3%). Wallets that estimate gas before sending would add the margin; contracts and bots that hard-code a gas limit would not. Blocks fill their gas limit 43% today (median) and would fill it 57%; 5 of 47 would not fit their limit as built. Estimates: gas used is after refunds, which a transaction's limit must cover before them, so the shortfall count is a lower bound.

## Reproduce

```sh
./out/fevm_replay follow blocks stateless.json 3     # takes, proves and validates 3 head blocks
mkdir proven && tar xzf fixtures/proven/0x19335e5.tar.gz -C proven
./out/fevm_replay chain proven/0x19335e5             # one block: witness, per-kind, heaviest tries
python3 docs/findings.py                             # this file, from the page's data
```

Each block's numbers are in its `summary.json`, written by `chain`; the page's data is [site/data/stateless.json](../site/data/stateless.json).
