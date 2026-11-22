// verify.html, clicked through: every saved block, a tampered receipt, a
// user's own archive, the module from Fe's latest commit, the proof checks,
// and a block fetched live from public nodes with its hash checked by the
// light client.
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAVED = ["block-0x19335e5.tar.gz", "block-0x19335c4.tar.gz", "block-0x1938869.tar.gz", "block-0x193565d.tar.gz"];

async function validate(page) {
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  const verdict = page.locator("#bverdict");
  await expect(verdict).not.toBeEmpty({ timeout: 200_000 });
  return verdict.textContent();
}

test.beforeEach(async ({ page }) => {
  await page.goto("verify.html", { waitUntil: "networkidle" });
});

for (const archive of SAVED) {
  test(`saved block ${archive}: every root holds, every transaction matches${archive === SAVED[0] ? " @engines" : ""}`, async ({ page }) => {
    await page.locator("#bblock").selectOption(archive);
    expect(await validate(page)).toMatch(/^Every root holds/);
    const out = await page.locator("#bout").textContent();
    const [, matched, total] = out.match(/(\d+)\/(\d+) transactions MATCH/);
    expect(matched).toBe(total);
    expect(out).toContain("hashes to the header's stateRoot");
  });
}

test("a receipt claiming one more gas is refused, and the table names the transaction", async ({ page }) => {
  await page.locator("#bblock").selectOption("block-0x19335e5.tar.gz");
  await page.getByLabel("a receipt claims one more gas than the transaction used").check();
  expect(await validate(page)).toMatch(/does not validate/);
  const row = page.locator("#bdiff tbody tr").first();
  await expect(row).toContainText("gas used: chain 66413, fevm 66412");
  await expect(row.getByRole("link")).toHaveAttribute("href", /^https:\/\/etherscan\.io\/tx\/0x58b68a18/);
});

test("the module from Fe's latest commit (#2060, no workarounds) validates the same block", async ({ page }) => {
  await page.locator("#bblock").selectOption("block-0x19335c4.tar.gz");
  await page.locator("#bnext").check();
  expect(await validate(page)).toMatch(/^Every root holds.*Fe's latest commit/);
});

test("a user's own archive, uploaded, is validated in the browser", async ({ page }) => {
  await page.locator("#bfile").setInputFiles(path.join(here, "../../fixtures/proven/0x19335e5.tar.gz"));
  expect(await validate(page)).toMatch(/^Every root holds/);
});

test("an archive saved without the system contracts' code: every transaction matches, and the page says why the state root is not computed", async ({ page }) => {
  await page.locator("#bfile").setInputFiles(path.join(here, "../../fixtures/proven/0x192f56b.tar.gz"));
  const verdict = await validate(page);
  expect(verdict).toMatch(/^Every transaction matches/);
  expect(verdict).not.toMatch(/does not validate/);
  await expect(page.locator("#bout")).toContainText("126/126 transactions MATCH");
  await expect(page.locator("#bout")).toContainText("state root: not computed");
});

for (const which of ["usdt.json", "usdc.json"]) {
  test(`mainnet proof ${which}: holds, and a changed value is refused`, async ({ page }) => {
    const run = page.locator("#run");
    await expect(run).toBeEnabled();
    await page.locator("#which").selectOption(which);
    await run.click();
    await expect(page.locator("#verdict")).toHaveText(/^Every proof holds/);
    await page.locator("#tamper").check();
    await run.click();
    await expect(page.locator("#verdict")).toHaveText(/does not prove what is claimed/);
  });
}

test("?block= picks a saved block from the address", async ({ page }) => {
  await page.goto("verify.html?block=0x1938869", { waitUntil: "networkidle" });
  await expect(page.locator("#bblock")).toHaveValue("block-0x1938869.tar.gz");
});

test("a block near the head, fetched by the browser, its hash checked by the light client @live", async ({ page }) => {
  await page.goto("verify.html?block=live", { waitUntil: "networkidle" });
  const text = await validate(page);
  test.skip(/did not serve a live block/.test(await page.locator("#bout").textContent()), "free nodes refused; the saved fallback ran instead");
  expect(text).toMatch(/^Every root holds/);
  expect(text).toMatch(/signed by \d+ of 512 of Ethereum's sync committee/);
  const out = await page.locator("#bout").textContent();
  expect(out).toMatch(/Light client: from the checkpoint written in lightclient\.mjs/);
  expect(out).toMatch(/checked twice: by noble, and by fevm itself/);
  // The save link gives back the fetched block as an archive.
  const save = page.locator("#bsave a").first();
  await expect(save).toHaveAttribute("download", /^0x[0-9a-f]+\.tar\.gz$/);
  const share = page.locator("#bsave a").nth(1);
  await expect(share).toHaveAttribute("href", /verify\.html\?block=live&number=\d+/);
});

// What runs in the browser is what CI built and tested: the served modules
// are byte for byte the repository's files (the checkout is the deployed
// commit), and the page names the SHA-256 of the one it ran.
for (const dir of ["", "next/"]) {
  test(`the served module wasm/${dir}fevm_replay_web.wasm is the repository's, and the page names it @engines`, async ({ page, request }) => {
    const local = fs.readFileSync(path.join(here, "../../site/wasm", dir, "fevm_replay_web.wasm"));
    const want = createHash("sha256").update(local).digest("hex");
    const served = await (await request.get(`wasm/${dir}fevm_replay_web.wasm`)).body();
    expect(createHash("sha256").update(served).digest("hex")).toBe(want);
    await page.locator("#bblock").selectOption("block-0x19335e5.tar.gz");
    if (dir) await page.locator("#bnext").check();
    expect(await validate(page)).toMatch(/^Every root holds/);
    await expect(page.locator("#bmodule")).toContainText(want);
  });
}

// A checkpoint in the page's address that the beacon nodes do not know is not
// trusted: the light client says it could not confirm the hash, and the
// verdict does not claim the sync committee signed it.
test("a made-up checkpoint in the address is not trusted @live", async ({ page }) => {
  await page.goto(`verify.html?block=live&checkpoint=0x${"11".repeat(32)}`, { waitUntil: "networkidle" });
  const verdict = await validate(page);
  const out = await page.locator("#bout").textContent();
  test.skip(/did not serve a live block/.test(out), "free nodes refused");
  expect(out).toContain("Light client: could not confirm the hash");
  expect(verdict).not.toContain("sync committee");
});

test("on a phone: tap Validate, the saved block validates in the phone's browser @mobile", async ({ page }) => {
  await page.locator("#bblock").selectOption("block-0x19335c4.tar.gz");
  await page.getByRole("button", { name: "Validate", exact: true }).tap();
  await expect(page.locator("#bverdict")).toHaveText(/^Every root holds/, { timeout: 200_000 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client + 1);
});

test("when the module cannot be downloaded (the network drops it), the page says so instead of hanging", async ({ page }) => {
  await page.route("**/wasm/fevm_replay_web.wasm", (route) => route.abort("connectionreset"));
  await page.goto("verify.html", { waitUntil: "load" });
  await expect(page.locator("#out")).toContainText("Could not load the module", { timeout: 30_000 });
  await expect(page.locator("#run")).toBeDisabled();
});
