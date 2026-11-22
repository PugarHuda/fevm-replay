// glamsterdam.html, clicked through: an example transaction, a link to the
// result, a malformed hash, and a whole block near the head.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("glamsterdam.html", { waitUntil: "networkidle" });
});

test("a malformed hash is refused with a reason", async ({ page }) => {
  await page.getByLabel("Transaction").fill("0x1234");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator("#out")).toHaveText(/Could not check it: a transaction hash is 0x and 64 hex digits/);
});

test("the transfer to a new account, sent with 21,000: needs 204,600 under Glamsterdam @live", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("link", { name: /a transfer to a new account/ }).click();
  await expect(page.locator("#verdict")).toHaveText("Would fail under Glamsterdam as sent: it needs a gas limit of 204,600, not 21,000.", { timeout: 120_000 });
  await expect(page.locator("#out")).toContainText("183,600 of it state gas (EIP-8037)");
  await page.getByRole("button", { name: "Copy a link to this result" }).click();
  await expect(page.locator("#shared")).toContainText("glamsterdam.html#0xd1163b9a");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/glamsterdam\.html#0xd1163b9a4766267495dd7f4989552f22108fc05d1fcfb4b436ce7ecf656999aa$/);
  // The link opens the same result.
  await page.goto(copied);
  await expect(page.locator("#verdict")).toContainText("204,600", { timeout: 120_000 });
});

test("a whole block near the head, every transaction under both forks @live", async ({ page }) => {
  await page.getByRole("button", { name: "Check a whole block near the head" }).click();
  // Done when the summary line or an error is shown, not while it is still running.
  await expect(page.locator("#out")).toHaveText(/transactions; of the \d+ that succeeded|^Could not check the block/, { timeout: 220_000 });
  const out = await page.locator("#out").textContent();
  test.skip(out.startsWith("Could not check the block"), `free nodes refused: ${out}`);
  const [, count, ok, failing, invalid] = out.match(/: (\d+) transactions; of the \d+ that succeeded under Osaka, (\d+) survive Glamsterdam as sent, (\d+) would fail and (\d+) would no longer be valid/);
  expect(Number(ok) + Number(failing) + Number(invalid)).toBeLessThanOrEqual(Number(count));
  const rows = await page.locator("#failing tbody tr").count();
  expect(rows).toBe(Number(failing) + Number(invalid));
  // A row opens that transaction's own check.
  if (rows) {
    await page.locator("#failing tbody tr").first().getByRole("link").click();
    await expect(page.locator("#verdict")).toHaveText(/Glamsterdam/, { timeout: 120_000 });
  }
});

test("the contracts the failing calls go to: six rows, the two stablecoins first, the shares adding up", async ({ page }) => {
  const rows = page.locator("#bycontract ~ .scroll tbody tr, section:has(#bycontract) tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("USDT");
  await expect(rows.nth(1)).toContainText("USDC");
  const counts = await rows.locator("td:nth-child(3)").allTextContents();
  const n = counts.map((c) => Number(c.replace(/,/g, "")));
  expect(n).toEqual([...n].sort((a, b) => b - a));
  expect(n.reduce((a, b) => a + b)).toBeLessThanOrEqual(6191);
});
