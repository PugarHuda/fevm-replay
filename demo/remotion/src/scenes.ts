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
      "Here is that run: block 26,424,805, checked by CI on every push. 71 of 71 transactions match. They re-encode to the transactions root, the requests hash matches, and the state root is the header's. It also estimates EIP-7864's binary-tree witness: about half{ (stems and values exact, depth and positions assumed)|}, 505 to 557 KiB against 1,002.",
    source: 'demo/casts/stateless-block.cast (real run); README "Every root in the header" (block 26,424,805, CI)',
    cues: [
      { at: '71 of 71', target: { sel: '#term', line: 5 } },
      { at: 'They re-encode', target: { sel: '#term', line: 7 } },
      { at: 'the requests hash', target: { sel: '#term', line: 10 } },
      { at: 'the state root is', target: { sel: '#term', line: 12 } },
      { at: 'binary-tree', target: { sel: '#term', line: 13 } },
    ],
  },
  {
    id: 'chain',
    kind: 'cast',
    cast: 'chain-of-three.cast',
    termTitle: 'WSL: fevm-replay, recorded run (asciinema)',
    narration:
      "Three consecutive mainnet blocks, in one run. Block one: 230 transactions, all matching. Block two: 256. Block three: 186. And the links hold: each block's parent is the one before it, its pre-state proven against the state root fevm computed.",
    source: 'demo/casts/chain-of-three.cast (real run, blocks 26,424,861 to 26,424,863); README "Consecutive blocks as one chain"',
    cues: [
      { at: 'Block one', target: { sel: '#term', line: 1, toLine: 3 } },
      { at: 'Block two', target: { sel: '#term', line: 4, toLine: 6 } },
      { at: 'Block three', target: { sel: '#term', line: 7, toLine: 9 } },
      { at: 'the links hold', target: { sel: '#term', line: 10 } },
    ],
  },
  {
    id: 'stateless-page',
    kind: 'page',
    url: 'stateless.html',
    start: { sel: '.g-head .intro' },
    narration:
      "A follower takes the block two behind the chain head, proves it and validates it. This page lists every block it took, with the witness per transaction and per million gas. It also shows whose storage weighs the most: the deeper a contract's storage trie, the more each slot it touches costs.",
    source: 'site/stateless.html; README "Following the chain" (follow.py)',
    cues: [
      { at: 'every block it took', target: { sel: '#facts' } },
      { at: 'the witness per', target: { sel: '.charts' } },
      { at: 'whose storage', target: { sel: 'h2:has-text("Whose storage weighs the most")' } },
    ],
  },
  {
    id: 'one-wei',
    kind: 'page',
    url: 'index.html',
    start: { sel: '#proven table' },
    narration:
      "Change one withdrawal by one wei, and the withdrawals root, the end-state proof and the computed state root all fail. A clean run rests on one 32-byte block hash.",
    source: 'index.html #proven last paragraph; README "Every root in the header" (One wei breaks it)',
    cues: [
      { at: 'Change one withdrawal', target: { sel: '#proven table + p' } },
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
    id: 'certificate',
    kind: 'page',
    url: 'verified.html',
    start: { sel: '.port:has(h2:text-is("DAI"))' },
    narration:
      "DAI's certificate: 10,562 mainnet transactions, 211,240 mutated runs, none different, all 21 planted mutants caught.",
    source: 'certificate-dai.html; verified.html',
    actions: [{ at: '^', do: 'click', target: { sel: '.port:has(h2:text-is("DAI")) a:has-text("Certificate")' } }],
    cues: [
      { at: '10,562', target: { sel: 'tr:has(th:text-is("Transactions that ran the port"))' } },
      { at: '211,240', target: { sel: 'tr:has(th:text-is("Runs"))' } },
      { at: 'all 21', target: { sel: 'h2:has-text("How sharp the checks are") ~ table' } },
    ],
  },
  {
    id: 'explorer',
    kind: 'page',
    url: 'explorer.html',
    narration:
      "The explorer shows where two runs part: before its fix, the Fe port reverted on a bot's packed address. After the fix, they no longer part.",
    source: 'explorer.html, case "A bug the port had"',
    actions: [{ at: 'After the fix', do: 'click', target: { sel: 'button[data-file="dirty-address-fixed"]' } }],
    cues: [
      { at: 'before its fix', target: { sel: 'section:has(h2:has-text("Fe port"))' } },
      { at: 'no longer part', target: { sel: 'section:has(h2:has-text("Fe port"))' } },
    ],
  },
  {
    id: 'opgas',
    kind: 'page',
    url: 'opgas.html',
    narration:
      "Opcode by opcode, Fe spends 44% less gas than solc on stack shuffling, but 25% more on memory.",
    source: 'opgas.html "What it shows"',
    actions: [{ at: '^', do: 'hover', target: { sel: '.chart .bar >> nth=0' } }],
    cues: [
      { at: '44% less', target: { sel: '.why p >> nth=0' } },
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
        'Whole mainnet blocks validated statelessly: every root in the header from fevm',
        '5 Fe ports certified against mainnet',
        'Found: 3 bugs in the Fe ports, 2 node tracer bugs, what Osaka changed',
      ],
    },
    narration:
      'fevm-replay validates whole mainnet blocks statelessly. It found three bugs in the Fe ports, two node tracer bugs, and what the Osaka fork changed. Code on GitHub, results at {fevm-replay.vercel.app|fevm-replay dot vercel dot app}.',
    source: 'README "For judges: one screen" (Found, Trust, Fe ports); README "Every root in the header"',
  },
];

export const spoken = (s: string) => s.replace(/\{([^|}]*)\|([^}]*)\}/g, '$2');
export const shown = (s: string) => s.replace(/\{([^|}]*)\|([^}]*)\}/g, '$1');
