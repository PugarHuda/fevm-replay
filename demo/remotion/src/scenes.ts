// The tour, as data. Each scene: where the browser goes, what the narrator
// says, which real elements get a box (and when, by the phrase that starts
// it), and what the "user" does. Every number in a narration line is quoted
// from the page shown or from README.md; `source` says which.
//
// Narration markup: {shown|spoken} shows one text in the captions and sends
// the other to the voice (for URLs and the like).
//
// Pipeline (from demo/remotion): node tts.ts [ids]  ->  node capture/capture.ts [ids]
//   ->  node check.ts  ->  npm run render   (writes ../tour-v2-draft.mp4)

export type Target = {
  sel: string; // Playwright locator
  text?: string; // box only this text inside sel (whitespace-insensitive)
  to?: string; // ...through the end of this text
  line?: number; // cast: box terminal line `line` (0-based)...
  toLine?: number; // ...through line `toLine`
};

export type Cue = {
  at: string; // phrase in the narration that starts the box
  target: Target;
  zoom?: number; // 1 = no zoom; default fits the box
};

export type Action = {
  at: string; // phrase that triggers it ("^" = scene start)
  do: 'click' | 'hover';
  target: Target;
};

export type Scene = {
  id: string;
  kind: 'page' | 'cast' | 'card';
  url?: string; // page: path under BASE
  start?: Target; // page: scrolled to the top of the view before recording
  cast?: string; // cast: asciinema v2 file in demo/casts, played with its real output and timing
  termTitle?: string;
  card?: { title: string; sub?: string; bullets?: string[] };
  narration: string;
  source: string;
  cues?: Cue[];
  actions?: Action[];
};

export const VOICE = 'en-US-AndrewMultilingualNeural';
export const RATE = '+19%';
export const FPS = 30;
export const LEAD = 0.4; // s of picture before the voice starts
export const TAIL = 0.5; // s after it ends
export const TITLE_SECONDS = 2.5;

// Browser: 1536x864 CSS px at DPR 1.25 = 1920x1080 frames.
export const VIEW = { w: 1536, h: 864, dpr: 1.25 };
// Video layout: the capture sits in FRAME, captions in CAPTION below it.
// They never overlap, and boxes/zoom are clipped to FRAME.
export const FRAME = { x: 144, y: 18, w: 1632, h: 918 };
export const CAPTION = { y: 950, h: 120 };

export const scenes: Scene[] = [
  {
    id: 'hero',
    kind: 'page',
    url: 'index.html',
    narration:
      "This is fevm-replay. It runs real Ethereum mainnet transactions inside fevm, the EVM written in Fe, and checks that each one ends exactly as it did on chain.",
    source: 'index.html hero',
    cues: [
      { at: 'This is', target: { sel: 'h1' }, zoom: 1.15 },
      { at: 'exactly as it did', target: { sel: 'p.lede' } },
    ],
  },
  {
    id: 'results',
    kind: 'page',
    url: 'index.html',
    start: { sel: '#results' },
    narration:
      "115,213 mainnet transactions, and no fevm bug: every difference was traced to a cause outside the interpreter.",
    source: 'index.html #results; README "For judges" (115,213, no fevm bug)',
    cues: [
      { at: '115,213', target: { sel: '#results table' } },
      { at: 'Every difference', target: { sel: '#results .causes' } },
    ],
  },
  {
    id: 'proof',
    kind: 'page',
    url: 'index.html',
    start: { sel: '#proven' },
    narration:
      "Now the headline: every root in the header comes out of fevm. The parent's Merkle proofs are a witness: fevm runs the block on it, writes its end state into that partial trie and hashes it again. That must be the header's state root, as a stateless client checks it. Every other root must match too.",
    source: 'index.html #proven ("Every root in the header, out of fevm"); README "Every root in the header"',
    cues: [
      { at: 'every root', target: { sel: '#proven h2' } },
      { at: 'That must be', target: { sel: '#proven pre', text: "state root: fevm's end state", to: "header's stateRoot" } },
      { at: 'Every other root', target: { sel: '#proven table tbody' } },
    ],
  },
  {
    id: 'stateless',
    kind: 'cast',
    cast: 'stateless-block.cast',
    termTitle: 'WSL: fevm-replay, recorded run (asciinema)',
    narration:
      "Here is that run: block 26,424,805, checked by CI on every push. 71 of 71 transactions match, they re-encode to the transactions root, the requests hash matches, and the state root is the header's.",
    source: 'demo/casts/stateless-block.cast (real run); README "Every root in the header" (block 26,424,805, CI)',
    cues: [
      { at: '71 of 71', target: { sel: '#term', line: 5 } },
      { at: 'they re-encode', target: { sel: '#term', line: 7 } },
      { at: 'the requests hash', target: { sel: '#term', line: 10 } },
      { at: 'the state root is', target: { sel: '#term', line: 12 } },
    ],
  },
  {
    id: 'stateless-page',
    kind: 'page',
    url: 'stateless.html',
    start: { sel: '.g-head .intro' },
    narration:
      "Blocks near the chain head, proven and validated as they came. fevm's own chain layer and geth agree on every one. This page lists each block, with the witness per transaction and per million gas, and whose storage weighs the most: the deeper a contract's storage trie, the more each slot it touches costs.",
    source: 'site/stateless.html intro (fevm_chain and geth-block agree on all 51); README "Whole blocks through geth"',
    cues: [
      { at: 'geth agree', target: { sel: '.g-head .intro', text: 'Two other implementations agree' } },
      { at: 'the witness per', target: { sel: '.charts' } },
      { at: 'whose storage', target: { sel: 'h2:has-text("Whose storage weighs the most")' } },
    ],
  },
  {
    id: 'eip4762',
    kind: 'page',
    url: 'stateless.html',
    start: { sel: '#eip4762' },
    narration:
      "And what would stateless Ethereum cost? Priced by the EIP-4762 draft, these blocks would need 25% more gas, and 39% of transactions would run out of gas at the limit they were sent with. Exempting the coinbase saves the transfers, but not the contract calls: 23% still fail. An independent implementation, ethereumjs, charges the same gas on all 18,967 transactions.",
    source: 'site/stateless.html #eip4762 (computed live from data/stateless.json); docs/stateless-findings.md 13 to 15; README (ethereumjs 18,967/18,967)',
    cues: [
      { at: '25% more gas', target: { sel: '#facts4762 > div >> nth=0' } },
      { at: '39% of transactions', target: { sel: '#facts4762 > div >> nth=2' } },
      { at: 'saves the transfers', target: { sel: '#facts4762 > div >> nth=4' } },
      { at: 'not the contract calls', target: { sel: '#facts4762 > div >> nth=5' } },
    ],
  },
  {
    id: 'amsterdam',
    kind: 'cast',
    cast: 'amsterdam.cast',
    termTitle: 'WSL: fevm-replay, recorded run (asciinema)',
    narration:
      "And Glamsterdam, the next fork, whose rules fevm already implements? The same 18,967 transactions, each with the gas limit it was sent with: 6,693 that succeeded would fail, and the rest would use 25% more gas. Over a thousand are plain transfers to new accounts: creating an account now costs state gas.",
    source: 'demo/casts/amsterdam.cast (real run of fevm_replay amsterdam on the 85 blocks); README Glamsterdam section',
    cues: [
      { at: '6,693 that succeeded', target: { sel: '#term', line: 1 } },
      { at: 'Over a thousand', target: { sel: '#term', line: 2 } },
    ],
  },
  {
    id: 'glamcheck',
    kind: 'page',
    url: 'glamsterdam.html#0xd1163b9a4766267495dd7f4989552f22108fc05d1fcfb4b436ce7ecf656999aa',
    start: { sel: '.controls' },
    narration:
      "Any recent transaction can be checked in the browser. This plain transfer to a new account was sent with 21,000 gas. Under Glamsterdam it runs out of gas: it would need 204,600, and 183,600 of that is state gas. geth's own Amsterdam rules agree with fevm's on all 3,398 transactions compared.",
    source: 'glamsterdam.html (live: debug_traceTransaction, then fevm in WebAssembly); README Glamsterdam section (geth-amsterdam 3,398/3,398)',
    cues: [
      { at: 'sent with 21,000', target: { sel: '#out' } },
      { at: 'it would need 204,600', target: { sel: '#verdict' } },
    ],
  },
  {
    id: 'effects',
    kind: 'page',
    url: 'index.html',
    start: { sel: '#fe' },
    narration:
      "Fe functions declare their effects. The function that decides match or diff gets a text buffer and nothing else, so calling the network from it is a type error.",
    source: 'index.html #fe',
    cues: [
      { at: 'declare their effects', target: { sel: '#fe h2 >> nth=0' } },
      { at: 'text buffer', target: { sel: '#fe pre >> nth=0', text: 'uses (text: mut MemBuffer)' } },
    ],
  },
  {
    id: 'browser',
    kind: 'page',
    url: 'verify.html?block=0x19335c4',
    start: { sel: '.controls' },
    narration:
      "That is also why the validator compiles to WebAssembly, with fevm inside. Here it runs in the browser, on a mainnet block with an EIP-7002 withdrawal request: every root in its header holds, and all 286 transactions match, in about two seconds. Or pick a block near the head, and the page fetches it from public nodes itself.",
    source: 'verify.html (block 26,424,772: 286/286, every root, an EIP-7002 request; live option); README Fe highlight',
    actions: [{ at: '^', do: 'click', target: { sel: '#brun' } }],
    cues: [
      { at: 'compiles to WebAssembly', target: { sel: '.controls' } },
      { at: 'every root in its header', target: { sel: '#bverdict' } },
      { at: 'all 286 transactions', target: { sel: '#bout', text: '286/286 transactions MATCH' } },
      { at: 'pick a block near the head', target: { sel: '#bblock' } },
    ],
  },
  {
    id: 'light',
    kind: 'cast',
    cast: 'light-client.cast',
    termTitle: 'WSL: node wasm/cli.mjs, recorded run (asciinema)',
    narration:
      "From a terminal, the same module validates a block three behind the head: 223 of 223 transactions match, every root holds. Its hash is checked as a light client checks it: from a finalized checkpoint, through Ethereum's sync committee, 511 of 512 signed, and each signature is verified twice, the second time by fevm's own BLS12-381 precompiles, written in Fe.",
    source: 'demo/casts/light-client.cast (real run of node wasm/cli.mjs, v0.8.2 release); README "Beside rsp, zeth and light clients"',
    cues: [
      { at: '223 of 223', target: { sel: '#term', line: 1 } },
      { at: 'from a finalized checkpoint', target: { sel: '#term', line: 4 } },
    ],
  },
  {
    id: 'verified',
    kind: 'page',
    url: 'index.html',
    narration:
      "Is a Fe port a drop-in replacement? Ask mainnet. The USDT port ran in 21,230 mainnet transactions, and none behaved differently.",
    source: 'verified.html',
    actions: [{ at: '^', do: 'click', target: { sel: 'nav a:has-text("Verified")' } }],
    cues: [
      { at: 'Ask mainnet', target: { sel: '.v-head p' } },
      { at: '21,230', target: { sel: '.port:has(h2:text-is("USDT")) dl' } },
    ],
  },
  {
    id: 'system',
    kind: 'cast',
    cast: 'system-contracts.cast',
    termTitle: 'WSL: fevm-replay, recorded run (asciinema)',
    narration:
      "Fe can stand in for Ethereum's own code too. All four system contracts the protocol calls in every block are ported from assembly. Here a mainnet block runs its system calls on the Fe ports: two consolidation requests come out, and every root still matches. On 85 blocks it held, after catching one bug in our own port.",
    source: 'demo/casts/system-contracts.cast (real run, block 26,425,142); README section on the system contracts (85 blocks, the EIP-7002 amount bug)',
    cues: [
      { at: 'runs its system calls', target: { sel: '#term', line: 1 } },
      { at: 'two consolidation requests', target: { sel: '#term', line: 3 } },
      { at: 'every root still matches', target: { sel: '#term', line: 4 } },
      { at: 'On 85 blocks', target: { sel: '#term', line: 7 } },
    ],
  },
  {
    id: 'try',
    kind: 'cast',
    cast: 'fixtures.cast',
    termTitle: 'WSL: fevm-replay, recorded run (asciinema)',
    narration:
      "No Fe install needed: the release binary runs the seven saved mainnet fixtures, and all seven match.",
    source: 'demo/casts/fixtures.cast (real run of the v0.2.0 release binary); README "Try it without Fe"',
    cues: [{ at: 'all seven', target: { sel: '#term', line: 1, toLine: 7 }, zoom: 1.3 }],
  },
  {
    id: 'end',
    kind: 'card',
    card: {
      title: 'fevm-replay',
      sub: 'github.com/PugarHuda/fevm-replay  ·  fevm-replay.vercel.app',
      bullets: [
        '115,213 mainnet transactions replayed in fevm, no fevm bug',
        '85 mainnet blocks validated statelessly, every root; fevm_chain and geth agree',
        'The same Fe in your browser, the hash checked by a light client (BLS in fevm)',
        "5 Fe ports certified, and all four of Ethereum's system contracts in Fe",
        'EIP-4762: +25% gas (ethereumjs agrees); Glamsterdam: 35% fail as sent (geth agrees)',
      ],
    },
    narration:
      "fevm-replay: mainnet blocks validated statelessly, natively and in your browser, with a light client, Ethereum's own system code in Fe, and what stateless Ethereum and Glamsterdam would cost. Code on GitHub, results at {fevm-replay.vercel.app|fevm-replay dot vercel dot app}.",
    source: 'README "For judges: one screen"',
  },
];

export const spoken = (s: string) => s.replace(/\{([^|}]*)\|([^}]*)\}/g, '$2');
export const shown = (s: string) => s.replace(/\{([^|}]*)\|([^}]*)\}/g, '$1');
