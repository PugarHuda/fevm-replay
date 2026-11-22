# Security policy

fevm-replay validates Ethereum blocks and runs a validator in the browser,
so a way to make it accept a block it should refuse, or to make the page
trust a block hash it should not, is a security bug. So is anything that
would let a release archive or the served WebAssembly module differ from
what this repository builds (see "Check it without trusting us" in the
README).

Please report it privately through GitHub's private vulnerability reporting
(Security tab, "Report a vulnerability") rather than a public issue. You
can expect an answer within a few days. Bugs in fevm itself belong to the
Fe team (fe-lang/fevm); if one shows up here, we will help report it there.

Supported: the latest release and `main`.
