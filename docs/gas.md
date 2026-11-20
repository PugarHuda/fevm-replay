# Gas: the Fe ports against the deployed Solidity

Every number here is from mainnet traffic, not a benchmark. `certify`
replays 200 consecutive mainnet blocks (26,400,000 to 26,400,199; the USDC proxy on the first 20) with the
Fe port in place of every account holding the deployed code, and for each
transaction that behaves identically (status, logs, every balance, nonce
and slot) records the gas of each call into the contract on both codes.
The per-function rows below are the certificates' tables
([USDT](https://fevm-replay.vercel.app/certificate-usdt.html),
[pair](https://fevm-replay.vercel.app/certificate.html),
[WETH9](https://fevm-replay.vercel.app/certificate-weth9.html),
[DAI](https://fevm-replay.vercel.app/certificate-dai.html),
[USDC proxy](https://fevm-replay.vercel.app/certificate-usdc-proxy.html)),
weighted by how often mainnet called each function. All ports are built
with Fe 26.7.0 (`fe build -O 2`); the deployed code is what solc produced
in 2017 to 2019, optimizer as each project shipped it.

| Port | Original | Mainnet calls | Gas, deployed | Gas, Fe port | Change | Functions cheaper |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| USDT | solc 0.4.17 | 24,746 | 532,981,385 | 509,354,601 | -4.4% | 11 of 11 |
| Uniswap V2 pair | solc 0.5.16 | 1,817 | 53,481,696 | 52,898,102 | -1.1% | 14 of 15 |
| WETH9 | solc 0.4.19 | 16,146 | 119,320,541 | 114,550,815 | -4.0% | 11 of 12 |
| DAI | solc 0.5.12 | 11,486 | 295,516,924 | 290,678,989 | -1.6% | 9 of 9 |
| USDC proxy | solc 0.4.24 | 2,839 | 50,694,171 | 50,181,105 | -1.0% | 14 of 14 |
| **All five** | | **57,034** | **1,051,994,717** | **1,017,663,612** | **-3.3%** | |

### USDT (solc 0.4.17)

| Function | Mainnet calls | Deployed | Fe port | Change |
| --- | ---: | ---: | ---: | ---: |
| Transfer | 15,969 | 28,124 | 26,968 | -4.1% |
| BalanceOf | 5,138 | 2,034 | 1,555 | -23.5% |
| TransferFrom | 2,378 | 22,768 | 21,860 | -4.0% |
| Approve | 867 | 20,905 | 20,553 | -1.7% |
| Allowance | 342 | 3,081 | 2,417 | -21.6% |
| Decimals | 41 | 1,898 | 1,708 | -10.0% |
| (other selector) | 6 | 773 | 226 | -70.8% |
| IsBlackListed | 2 | 3,033 | 2,436 | -19.7% |
| Name | 1 | 3,110 | 2,633 | -15.3% |
| Symbol | 1 | 3,550 | 2,631 | -25.9% |
| Paused | 1 | 2,714 | 2,354 | -13.3% |

### Uniswap V2 pair (solc 0.5.16)

| Function | Mainnet calls | Deployed | Fe port | Change |
| --- | ---: | ---: | ---: | ---: |
| Swap | 873 | 58,308 | 57,747 | -1.0% |
| GetReserves | 803 | 2,185 | 2,091 | -4.3% |
| Token0 | 49 | 2,136 | 2,063 | -3.4% |
| Factory | 43 | 2,402 | 2,329 | -3.0% |
| Token1 | 26 | 2,049 | 1,976 | -3.6% |
| TotalSupply | 7 | 2,388 | 2,315 | -3.1% |
| Sync | 7 | 33,498 | 33,884 | +1.2% |
| Price0CumulativeLast | 2 | 2,387 | 2,315 | -3.0% |
| KLast | 1 | 2,388 | 2,316 | -3.0% |
| Approve | 1 | 7,342 | 7,190 | -2.1% |
| TransferFrom | 1 | 35,449 | 34,939 | -1.4% |
| Burn | 1 | 172,325 | 167,327 | -2.9% |
| Mint | 1 | 57,304 | 51,542 | -10.1% |
| Price1CumulativeLast | 1 | 2,409 | 2,337 | -3.0% |
| Transfer | 1 | 29,840 | 29,614 | -0.8% |

### WETH9 (solc 0.4.19)

| Function | Mainnet calls | Deployed | Fe port | Change |
| --- | ---: | ---: | ---: | ---: |
| BalanceOf | 7,557 | 1,005 | 834 | -17.0% |
| Transfer | 4,279 | 13,257 | 12,752 | -3.8% |
| TransferFrom | 1,363 | 13,262 | 12,767 | -3.7% |
| Withdraw | 1,264 | 9,740 | 9,448 | -3.0% |
| Deposit | 955 | 16,126 | 15,998 | -0.8% |
| Approve | 508 | 16,915 | 16,713 | -1.2% |
| Allowance | 179 | 2,325 | 2,078 | -10.6% |
| Decimals | 18 | 2,332 | 2,143 | -8.1% |
| fallback | 17 | 8,866 | 8,882 | +0.2% |
| TotalSupply | 4 | 343 | 248 | -27.7% |
| (other selector) | 1 | 4,096 | 3,980 | -2.8% |
| (other selector) | 1 | 4,096 | 3,980 | -2.8% |

### DAI (solc 0.5.12)

| Function | Mainnet calls | Deployed | Fe port | Change |
| --- | ---: | ---: | ---: | ---: |
| Transfer | 10,551 | 27,453 | 27,017 | -1.6% |
| BalanceOf | 571 | 1,299 | 1,137 | -12.5% |
| TransferFrom | 166 | 14,411 | 13,835 | -4.0% |
| Approve | 93 | 18,697 | 18,459 | -1.3% |
| Allowance | 38 | 2,308 | 2,134 | -7.5% |
| Mint | 30 | 17,308 | 17,033 | -1.6% |
| Burn | 29 | 9,421 | 9,050 | -3.9% |
| Decimals | 6 | 240 | 172 | -28.3% |
| Permit | 2 | 52,976 | 52,267 | -1.3% |

### USDC proxy (solc 0.4.24)

| Function | Mainnet calls | Deployed | Fe port | Change |
| --- | ---: | ---: | ---: | ---: |
| transfer | 1,305 | 24,984 | 24,809 | -0.7% |
| balanceOf | 784 | 2,812 | 2,634 | -6.3% |
| transferFrom | 365 | 24,247 | 24,051 | -0.8% |
| approve | 143 | 26,156 | 25,960 | -0.7% |
| allowance | 81 | 3,330 | 3,155 | -5.3% |
| (other selector) | 70 | 6,409 | 6,208 | -3.1% |
| (other selector) | 23 | 34,214 | 34,018 | -0.6% |
| decimals | 21 | 2,354 | 2,152 | -8.6% |
| permit | 18 | 48,066 | 47,891 | -0.4% |
| (other selector) | 14 | 11,795 | 11,596 | -1.7% |
| (other selector) | 5 | 67,606 | 67,431 | -0.3% |
| (other selector) | 5 | 5,594 | 5,416 | -3.2% |
| (other selector) | 3 | 61,890 | 61,715 | -0.3% |
| (other selector) | 2 | 79,138 | 78,963 | -0.2% |


## Where Fe costs more

- **Uniswap V2 `sync`** (+1.1%, 7 calls) and **WETH9's fallback** (+0.1%,
  17 calls): the only two functions of 61 that cost more.
- **Ethereum's system contracts** are the other way round: the deployed
  ones are hand-written assembly, and the Fe ports cost 24 to 55 gas more a
  call at the start of a block, and 133 to 2,026 more for the request
  contracts, which build their outputs in Fe's `MemBuffer`
  ([details](../README.md#ethereums-own-system-contracts-in-fe)).
- **USDC's proxy** used to cost 40 to 60 gas a call *more*, through
  `MemBuffer`; that report ([argotorg/fe#2004](https://github.com/argotorg/fe/pull/2004))
  became `Call::forward_delegatecall` in Fe's std, and the port now costs
  175 to 200 less.

Why Fe is cheaper is in [where Fe saves gas](details.md#where-fe-saves-gas),
which charges every opcode its gas on both codes: Fe moves fewer values
around the stack and does less arithmetic for the same work (`swap`
−2.6%, USDT `transfer` −3.8% in opcode gas), and pays some of it back in
memory.

Regenerate: the tables come from `site/certificate*.html`, which
`fevm_replay certify` writes.
