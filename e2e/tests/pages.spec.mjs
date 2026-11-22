// Every page: it loads, throws nothing, every link and asset on it answers,
// it has no serious accessibility violation, and on a phone nothing spills
// sideways.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  "index.html", "verify.html", "stateless.html", "glamsterdam.html", "upstream.html", "verified.html",
  "explorer.html", "docs.html", "fork.html", "gas.html", "opgas.html",
  "certificate.html", "certificate-usdt.html", "certificate-weth9.html", "certificate-dai.html",
  "certificate-usdc-proxy.html", "certificate-system.html",
];

for (const path of PAGES) {
  test(`${path}: loads without errors, every link and asset answers`, async ({ page, request, baseURL }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(baseURL)) errors.push(`${r.status()} ${r.url()}`); });
    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);

    // Every same-site link and asset, and every outside link, by HEAD (GET when refused).
    const urls = await page.evaluate(() => [...new Set([
      ...[...document.querySelectorAll("a[href]")].map((a) => a.href),
      ...[...document.querySelectorAll("img[src], script[src], source[src], link[href][rel=stylesheet]")].map((e) => e.src || e.href),
    ])].filter((u) => u.startsWith("http") && !u.includes("#") && !u.startsWith("mailto:")));
    const broken = [];
    const limited = [];
    for (const url of urls) {
      // Etherscan and X refuse automated requests; they are checked by hand.
      if (/etherscan\.io|x\.com|twitter\.com/.test(url)) continue;
      let r;
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await request.head(url, { failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
        if (!r || (r.status() >= 400 && r.status() !== 429)) r = await request.get(url, { failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
        if (!r || r.status() !== 429) break;
        await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1)));
      }
      // 429 is a host limiting how fast it is asked, not a broken link.
      if (r && r.status() === 429) limited.push(url);
      else if (!r || r.status() >= 400) broken.push(`${r ? r.status() : "no answer"} ${url}`);
    }
    if (limited.length) test.info().annotations.push({ type: "rate-limited", description: limited.join(" ") });
    expect(broken, broken.join("\n")).toEqual([]);
  });

  test(`${path}: no serious or critical accessibility violation (axe)`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`), "axe").toEqual([]);
  });

  test(`${path}: fits a phone, no sideways scroll @mobile`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client + 1);
  });
}
