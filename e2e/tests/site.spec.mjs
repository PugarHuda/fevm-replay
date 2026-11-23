// The front page, the tour, the stateless page, the explorer and the
// upstream page, clicked through.
import { test, expect } from "@playwright/test";

test("front page: every hero button leads where it says", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  const buttons = [
    ["Validate a block in your browser", /verify\.html\?block=live$/],
    ["Check a transaction against Glamsterdam", /glamsterdam\.html$/],
    ["What went back upstream", /upstream\.html$/],
    ["Run it yourself", /docs\.html#quickstart$/],
  ];
  for (const [name, href] of buttons) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await page.getByRole("link", { name: "Check a transaction against Glamsterdam" }).click();
  await expect(page).toHaveURL(/glamsterdam\.html$/);
  await expect(page.locator("h1")).toHaveText("Would this transaction survive Glamsterdam?");
});

test("front page: the numbers are the data's", async ({ page, request }) => {
  const rows = await (await request.get("data/stateless.json")).json();
  const blocks = rows.filter((r) => r.every_root).length;
  await page.goto("index.html", { waitUntil: "networkidle" });
  await expect(page.locator(".hero-facts")).toContainText(`${blocks} / ${blocks}`);
});

test("the tour plays from the site", async ({ page }) => {
  await page.goto("index.html#tour", { waitUntil: "networkidle" });
  const video = page.locator("video.tour");
  await video.scrollIntoViewIfNeeded();
  const played = await video.evaluate(async (v) => {
    v.muted = true;
    await v.play();
    await new Promise((ok) => setTimeout(ok, 3000));
    const t = v.currentTime;
    v.pause();
    return { t, src: v.currentSrc, duration: v.duration };
  });
  expect(played.t).toBeGreaterThan(1);
  expect(played.src).toMatch(/tour\.mp4$/);
  expect(played.duration).toBeGreaterThan(240);
});

test("stateless page: one row per block in the data, every validated block with its times", async ({ page, request }) => {
  const rows = await (await request.get("data/stateless.json")).json();
  await page.goto("stateless.html", { waitUntil: "networkidle" });
  await expect(page.locator("#rows tr")).toHaveCount(rows.length);
  const ok = rows.filter((r) => r.every_root);
  await expect(page.locator("#facts")).toContainText(`${ok.length}`);
  await expect(page.locator("#rows .badge")).toHaveCount(ok.length);
  // Each validated block shows its WebAssembly time and its time with Fe's fix.
  const firstRow = page.locator("#rows tr").filter({ has: page.locator(".badge") }).first();
  await expect(firstRow.locator("td").nth(7)).toHaveText(/^\d+\.\d\d s$/);
  await expect(firstRow.locator("td").nth(8)).toHaveText(/^\d+\.\d\d s$/);
  await expect(page.locator("#glamsterdam .facts")).toContainText("3,718 / 3,718");
  await expect(page.locator("#facts4762")).not.toBeEmpty();
});

test("stateless page: a block's 'again, in your browser' link validates it", async ({ page }) => {
  await page.goto("stateless.html", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "again, in your browser" }).first().click();
  await expect(page).toHaveURL(/verify\.html\?block=0x/);
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.locator("#bverdict")).toHaveText(/^Every root holds/, { timeout: 200_000 });
});

test("explorer: every case loads both call trees", async ({ page }) => {
  await page.goto("explorer.html", { waitUntil: "networkidle" });
  for (const id of ["dirty-address", "code-hash", "builder-tip", "usdt-out-of-gas", "identical"]) {
    await page.locator(`button[data-case="${id}"]`).click();
    await expect(page.locator(`button[data-case="${id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#calls-a li").first()).toBeVisible();
    await expect(page.locator("#calls-b li").first()).toBeVisible();
    await expect(page.locator("#count-a")).toHaveText(/\d+ calls?/);
  }
});

test("upstream page: every item links to its issue or pull request", async ({ page }) => {
  await page.goto("upstream.html", { waitUntil: "networkidle" });
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Fixed");
  await expect(rows.first().getByRole("link", { name: "argotorg/fe#2060" })).toHaveAttribute("href", "https://github.com/argotorg/fe/pull/2060");
});

test("front page: the block header's roots, checked by fevm in the browser at a click @engines", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  const rows = page.locator(".rootcheck .root");
  await expect(rows).toHaveCount(8);
  await expect(rows.first().locator(".state")).toHaveText("not checked yet");
  await page.getByRole("button", { name: "Check these roots in your browser" }).click();
  await expect(page.locator("#rc-say")).toContainText(/8 of 8 fields match, from 71 transactions run in [\d.]+ s in your browser/, { timeout: 200_000 });
  await expect(page.locator(".rootcheck .root.held")).toHaveCount(8);
  await expect(page.locator(".rootcheck .root.differs")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check them again" })).toBeEnabled();
  await expect(page.locator("#rc-say a")).toHaveAttribute("href", "verify.html?block=0x19335e5");
});

test("front page: one digit of receiptsRoot changed, the header is refused before anything runs; unchanged, it holds again", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  await page.getByLabel("Change one digit of receiptsRoot first").check();
  await page.getByRole("button", { name: "Check these roots in your browser" }).click();
  await expect(page.locator("#rc-say")).toContainText("fevm refused the block before running anything", { timeout: 200_000 });
  await expect(page.locator('.root[data-field="receiptsRoot"]')).toHaveClass(/differs/);
  await expect(page.locator(".root.skipped")).toHaveCount(7);
  await expect(page.locator(".root.held")).toHaveCount(0);
  await page.getByLabel("Change one digit of receiptsRoot first").uncheck();
  await page.getByRole("button", { name: "Check them again" }).click();
  await expect(page.locator("#rc-say")).toContainText("8 of 8 fields match", { timeout: 200_000 });
  await expect(page.locator(".root.held")).toHaveCount(8);
});

test("front page: the module that ran is named, and its Sigstore attestation verified @live", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Check these roots in your browser" }).click();
  const line = page.locator("#rc-prov");
  await expect(line).not.toContainText("checking", { timeout: 200_000 });
  test.skip(/answered|limit/.test(await line.textContent()), "GitHub's API limit");
  await expect(line).toHaveClass(/ok/);
  await expect(line).toContainText("its Sigstore attestation verified in your browser");
});

test("front page: the newest block instead, its own header shown and checked, its hash by the light client @live", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Check the newest block instead" }).click();
  const say = page.locator("#rc-say");
  await expect(say).toHaveText(/fields match|did not serve|Could not run/, { timeout: 240_000 });
  test.skip(/did not serve/.test(await say.textContent()), "free nodes refused");
  await expect(page.locator("#rc-block")).toHaveText(/^Block [\d,]+, \d+ behind the head$/);
  await expect(page.locator('.root[data-field="stateRoot"] .val')).not.toHaveText("0x85605dbf…8cf8");
  await expect(say).toContainText("8 of 8 fields match");
  await expect(say).toContainText("of 512 of the sync committee signed it");
  await expect(say).toContainText("the whole chain checked again in Fe by light.fe, inside the module");
  await expect(page.locator(".root.held")).toHaveCount(8);
  await expect(say.getByRole("link")).toHaveAttribute("href", /verify\.html\?block=live&number=\d+$/);
  // Back to the saved block: its own values again.
  await page.getByRole("button", { name: "Check them again" }).click();
  await expect(page.locator("#rc-block")).toHaveText("Block 26,424,805");
  await expect(page.locator('.root[data-field="stateRoot"] .val')).toHaveText("0x85605dbf…8cf8");
  await expect(say).toContainText("8 of 8 fields match, from 71 transactions", { timeout: 200_000 });
});
