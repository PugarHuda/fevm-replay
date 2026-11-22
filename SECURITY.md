# Security policy

## What counts

fevm-replay validates Ethereum blocks and runs a validator in the browser,
so a security vulnerability here is anything that makes it:

- accept a block, transaction or proof it should refuse (a MATCH or "every
  root holds" that is wrong);
- trust a block hash it should not (the light client, the checkpoint in the
  page's address, the nodes' agreement);
- serve or release something other than what this repository builds (a
  release archive or WebAssembly module that does not match its provenance;
  see "Check it without trusting us" in the README).

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting:
https://github.com/PugarHuda/fevm-replay/security/advisories/new
(Security tab, "Report a vulnerability"). Please do not open a public issue.

Include the block, transaction or archive, the command or page, and what you
expected. You can expect an acknowledgement within 3 days and an assessment
within 7.

## Disclosure

We fix the issue, publish a GitHub security advisory crediting the reporter
(unless they prefer otherwise), and make a release. We ask for 30 days from
the report before public disclosure, less if the fix ships sooner.

A bug in fevm itself belongs to the Fe team (fe-lang/fevm) and a bug in the
Fe compiler to argotorg/fe; if one shows up here, we will help report it to
them through their own channels.

## Supported versions

The latest release and `main`.
