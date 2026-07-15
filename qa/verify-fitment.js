import { chromium } from 'playwright';

const MAGNAFLOW_BASE_URL = 'https://www.magnaflow.com';

// Drives MagnaFlow's own "Shop by Vehicle" tool and reads back the SKUs it lists for a
// given vehicle + qualifier combination, so a bad fitment entry gets caught here instead
// of by a customer who ordered the wrong part.
//
// NOTE ON SELECTORS: the flow below (Year -> Make -> Model -> Engine -> qualifier prompts)
// matches what MagnaFlow's tool presents as of when this was written, but the exact field
// roles/labels weren't inspectable from outside a live browser session. Run one case with
// { headless: false } the first time and adjust the locators below if anything doesn't
// match — this is expected maintenance for scraping a third-party site, not a bug.
export async function verifyVehicle({ year, make, model, engineLiters, qualifiers = {}, expectedSkus, headless = true }) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  const foundSkus = new Set();

  try {
    await page.goto(MAGNAFLOW_BASE_URL, { waitUntil: 'domcontentloaded' });

    await page.getByRole('link', { name: /shop by vehicle/i }).click();

    await page.getByRole('combobox', { name: /year/i }).selectOption(String(year));
    await page.getByRole('combobox', { name: /make/i }).selectOption({ label: make });
    await page.getByRole('combobox', { name: /model/i }).selectOption({ label: model });

    if (engineLiters) {
      const engineSelect = page.getByRole('combobox', { name: /engine/i });
      await engineSelect.selectOption({ label: new RegExp(`${engineLiters}\\s*L`, 'i') }).catch(() => {});
    }

    // Answer any qualifier prompts the site itself presents (e.g. rear suspension type,
    // Ram 1500 vs Ram 1500 Classic body style) by clicking the option whose text matches
    // the qualifier value we were given.
    for (const value of Object.values(qualifiers)) {
      const optionText = new RegExp(String(value).replace(/_/g, '.?'), 'i');
      const option = page.getByText(optionText).first();
      if (await option.isVisible().catch(() => false)) await option.click();
    }

    await page.waitForLoadState('networkidle');

    const skuNodes = await page.getByText(/\bSKU\s*[:#]?\s*\d{4,6}\b/i).allTextContents();
    for (const text of skuNodes) {
      const match = text.match(/\d{4,6}/);
      if (match) foundSkus.add(match[0]);
    }

    const expected = new Set(expectedSkus);
    const missing = [...expected].filter((s) => !foundSkus.has(s));
    const unexpected = [...foundSkus].filter((s) => !expected.has(s));

    return {
      match: missing.length === 0 && unexpected.length === 0,
      expected: [...expected],
      found: [...foundSkus],
      missing,
      unexpected,
    };
  } finally {
    await browser.close();
  }
}
