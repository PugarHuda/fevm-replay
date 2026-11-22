// Every control a visitor can touch, used as a visitor would: hovering and
// tabbing through the block on the front page, clicking a transaction,
// filtering the fork table, switching the opcode chart, opening calls in the
// explorer, validating a block with the keyboard alone, and every page in
// dark mode.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("front page: hovering, tabbing to and clicking a transaction of the block", async ({ page, context }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  const cells = page.locator(".mosaic button");
  const n = await cells.count();
  expect(n).toBeGreaterThan(100);
  await expect(page.locator(".tally")).toContainText(String(n));
  // Hover describes it.
  await cells.nth(8).hover();
  await cells.nth(8).focus();
  await expect(page.locator(".picked")).toContainText("21,000");
  // The keyboard reaches the next one.
  await page.keyboard.press("Tab");
  await expect(page.locator(".picked")).toContainText("tx 9");
  // A click opens that transaction on Etherscan, in a new tab.
  const label = await cells.nth(8).getAttribute("aria-label") ?? await cells.nth(8).textContent();
  const hashStart = label.match(/0x[0-9a-f]{8}/)[0];
  const [popup] = await Promise.all([context.waitForEvent("page"), cells.nth(8).click()]);
  expect(popup.url()).toMatch(new RegExp(`^https://etherscan\\.io/tx/${hashStart}[0-9a-f]{56}$`));
  await popup.close();
});

test("fork table: every EIP filter shows as many rows as it says, and All brings them back", async ({ page }) => {
  await page.goto("fork.html", { waitUntil: "networkidle" });
  const buttons = page.locator(".filters button");
  const rows = page.locator("#rows tr");
  const total = Number((await buttons.first().textContent()).match(/\d+$/)[0]);
  await expect(rows).toHaveCount(total);
  for (let i = 1; i < await buttons.count(); i++) {
    const b = buttons.nth(i);
    const want = Number((await b.textContent()).match(/(\d+)$/)[1]);
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.first()).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(want);
    const eip = (await b.textContent()).match(/EIP-\d+/)[0];
    for (const cause of await rows.locator("td:nth-child(3)").allTextContents()) expect(cause).toContain(eip);
  }
  await buttons.first().click();
  await expect(rows).toHaveCount(total);
});

test("opcode chart: every contract's tab, its headline's percentage worked out from its own numbers", async ({ page }) => {
  await page.goto("opgas.html", { waitUntil: "networkidle" });
  const tabs = page.locator("#tabs button");
  const count = await tabs.count();
  expect(count).toBe(6);
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    const head = page.locator("#headline");
    await expect(head).toContainText((await tab.textContent()).trim());
    const [fe, sol, pct] = (await head.textContent()).match(/Fe spent ([\d,]+) gas where solc spent ([\d,]+), ([\d.]+)% less/).slice(1);
    const f = Number(fe.replace(/,/g, "")), s = Number(sol.replace(/,/g, ""));
    expect(Number(pct)).toBeCloseTo((100 * (s - f)) / s, 1);
    expect(await page.locator("#chart .name").count()).toBeGreaterThan(0);
  }
});

test("explorer: a call opens to its calldata and closes again; the port before and after the fix", async ({ page }) => {
  await page.goto("explorer.html", { waitUntil: "networkidle" });
  const call = page.locator("#calls-a li button").nth(1);
  await expect(call).toHaveAttribute("aria-expanded", "false");
  await call.click();
  await expect(call).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator("#calls-a li.open .detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("calldata");
  await expect(detail).toContainText(/to 0x[0-9a-f]{40}/);
  await call.click();
  await expect(call).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#calls-a li.open")).toHaveCount(0);

  // The bug the port had: the trees part before the fix, and agree after it.
  const before = page.getByRole("button", { name: "Port before the fix" });
  const after = page.getByRole("button", { name: "Port after the fix" });
  await before.click();
  await expect(before).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calls li.part")).not.toHaveCount(0);
  await after.click();
  await expect(after).toHaveAttribute("aria-pressed", "true");
  await expect(before).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".calls li.part")).toHaveCount(0);
});

test("verify page with the keyboard alone: choose a block, tick the tamper box, validate, read the refusal", async ({ page }) => {
  await page.goto("verify.html", { waitUntil: "networkidle" });
  await page.locator("#bblock").focus();
  await page.keyboard.press("End"); // the last saved block in the list
  const chosen = await page.locator("#bblock").inputValue();
  expect(chosen).toMatch(/\.tar\.gz$/);
  // Tab forward to the tamper box and tick it with Space.
  for (let i = 0; i < 6 && !(await page.locator("#btamper").evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(page.locator("#btamper")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator("#btamper")).toBeChecked();
  for (let i = 0; i < 6 && !(await page.locator("#brun").evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(page.locator("#brun")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#bverdict")).toHaveText(/does not validate/, { timeout: 200_000 });
  await expect(page.locator("#bdiff a").first()).toHaveAttribute("href", /etherscan\.io\/tx\//);
});

const PAGES = [
  "index.html", "verify.html", "stateless.html", "glamsterdam.html", "upstream.html", "verified.html",
  "explorer.html", "docs.html", "fork.html", "gas.html", "opgas.html", "certificate.html",
  "certificate-usdt.html", "certificate-weth9.html", "certificate-dai.html", "certificate-usdc-proxy.html", "certificate-system.html",
];
for (const path of PAGES) {
  test(`${path} in dark mode: no serious or critical accessibility violation`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(path, { waitUntil: "networkidle" });
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target} ${v.nodes[0]?.any[0]?.message?.slice(0, 120)}`)).toEqual([]);
    await context.close();
  });
}

test("explorer: a case's own address opens that case, and clicking a case puts it in the address", async ({ page }) => {
  await page.goto("explorer.html#usdt-out-of-gas", { waitUntil: "networkidle" });
  await expect(page.locator('.cases button[data-case="usdt-out-of-gas"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('.cases button[data-case="identical"]').click();
  await expect(page).toHaveURL(/#identical$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('.cases button[data-case="identical"]')).toHaveAttribute("aria-pressed", "true");
});

test("opcode chart: a contract's own address opens its tab, and a click puts it in the address", async ({ page }) => {
  await page.goto("opgas.html#transfer", { waitUntil: "networkidle" });
  await expect(page.locator("#headline")).toContainText("USDT transfer");
  await page.getByRole("button", { name: "WETH9 deposit" }).click();
  await expect(page).toHaveURL(/#deposit$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#headline")).toContainText("WETH9 deposit");
});

test("stateless table: sort by transactions with a click, reverse it, and by keyboard", async ({ page }) => {
  await page.goto("stateless.html", { waitUntil: "networkidle" });
  const table = page.locator("table.map").first();
  const head = table.getByRole("button", { name: "Transactions" });
  const column = async () => (await table.locator("tbody tr td:nth-child(2)").allTextContents()).map((t) => Number(t.replace(/[^\d]/g, "")));
  const n = (await column()).length;
  expect(n).toBeGreaterThan(90);
  await head.click();
  await expect(table.locator("thead th").nth(1)).toHaveAttribute("aria-sort", "descending");
  let c = await column();
  expect(c).toEqual([...c].sort((a, b) => b - a));
  await head.click();
  await expect(table.locator("thead th").nth(1)).toHaveAttribute("aria-sort", "ascending");
  c = await column();
  expect(c).toEqual([...c].sort((a, b) => a - b));
  expect(c.length).toBe(n);
  // The keyboard: focus the Block header and press Enter.
  await table.getByRole("button", { name: "Block", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(table.locator("thead th").first()).toHaveAttribute("aria-sort", "descending");
  await expect(table.locator("thead th").nth(1)).not.toHaveAttribute("aria-sort", /./);
});

// The shared sortable.js on every page with a data table: a click sorts a
// numeric column as numbers (including "−1,024", with a Unicode minus).
for (const [path, header, col] of [["opgas.html", "Fe − Solidity", 4], ["glamsterdam.html", "Calls that would fail", 3], ["gas.html", "Transactions", 2]]) {
  test(`${path}: sorting by "${header}" orders the rows as numbers, both ways`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const table = page.locator("table[data-sortable]").first();
    await expect(table.locator("tbody tr").first()).toBeVisible();
    const values = async () => (await table.locator(`tbody tr td:nth-child(${col})`).allTextContents()).map((t) => Number(t.replace(/−/g, "-").replace(/[^\d.-]/g, "")));
    const head = table.getByRole("button", { name: header });
    await head.click();
    let v = await values();
    expect(v).toEqual([...v].sort((a, b) => b - a));
    await head.click();
    v = await values();
    expect(v).toEqual([...v].sort((a, b) => a - b));
  });
}

test("fork.html: sorting by block keeps every row, and the filters still work after", async ({ page }) => {
  await page.goto("fork.html", { waitUntil: "networkidle" });
  const rows = page.locator("#rows tr");
  const n = await rows.count();
  await page.locator("table[data-sortable]").getByRole("button", { name: "Block" }).click();
  await expect(rows).toHaveCount(n);
  const eip = page.locator(".filters button").nth(1);
  const want = Number((await eip.textContent()).match(/(\d+)$/)[1]);
  await eip.click();
  await expect(rows).toHaveCount(want);
});

test("front page: with the tamper box ticked, the row shows the digit that was changed", async ({ page }) => {
  await page.goto("index.html", { waitUntil: "networkidle" });
  await page.getByLabel("Change one digit of receiptsRoot first").check();
  await page.getByRole("button", { name: "Check these roots in your browser" }).click();
  const mark = page.locator('.root[data-field="receiptsRoot"] .val mark');
  await expect(mark).toHaveText("0");
  await expect(mark).toHaveAttribute("title", "was d");
  await expect(page.locator("#rc-say")).toContainText("refused", { timeout: 200_000 });
  await page.getByLabel("Change one digit of receiptsRoot first").uncheck();
  await page.getByRole("button", { name: "Check them again" }).click();
  await expect(mark).toHaveCount(0);
  await expect(page.locator('.root[data-field="receiptsRoot"] .val')).toHaveText("0xc037a4c2…8bcd");
});
