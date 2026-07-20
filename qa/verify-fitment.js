import { chromium } from 'playwright';

const MAGNAFLOW_BASE_URL = 'https://www.magnaflow.com';

const PART_TYPE_TO_SITE_CATEGORY = {
  'cat-back': 'Performance Exhaust',
  'axle-back': 'Performance Exhaust',
  'universal-cat': 'Catalytic Converter',
  'direct-fit-cat': 'Catalytic Converter',
  'replacement-exhaust': 'Replacement Exhaust',
};

function engineSlugFragment(engineLiters) {
  // MagnaFlow product URL slugs encode displacement like "3-5l", "5-7l"
  return `${String(engineLiters).replace('.', '-')}l`;
}

// The results page shows performance exhaust AND catalytic converters together regardless
// of which "part" category was selected in the widget. Our catalog only ever contains
// cat-back/axle-back/replacement-exhaust parts (no catalytic converters), so excluding any
// catalytic-converter product is enough to get an apples-to-apples comparison without
// needing exact per-part-type matching.
function isCatalyticConverterSlug(slug) {
  return slug.includes('catalytic-converter');
}

async function clickOption(page, container, text) {
  const btn = page.locator(`[data-ymm-el-container="${container}"] [data-ymm-option-btn]`).filter({ hasText: text }).first();
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  await btn.click();
}

// Drives MagnaFlow's real "Shop By Vehicle" widget — a multi-step accordion (year -> make
// -> model -> engine -> part type -> then a variable set of additional fields depending on
// the vehicle, e.g. body type + bed length for trucks) implemented as a custom
// <vehicle-menu> element, not plain <select> inputs. Selecting a step's option calls
// vehicle-menu.setOption(...) and auto-opens the next step; the final "Shop By Vehicle"
// submit link only becomes enabled once every required field (including any dynamically
// added ones) has a value, at which point it has a real href to the results page.
//
// The results page does NOT filter by engine in its URL/content — it shows every engine
// variant's parts for that year/make/model. We filter the found products down to ones
// whose product-page URL slug mentions the engine's displacement to correct for this.
export async function verifyVehicle({
  year,
  make,
  model,
  submodel,
  engineLiters,
  bodyStyle,
  partType,
  expectedSkus,
  headless = true,
}) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    await page.goto(MAGNAFLOW_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-vehicle-menu-summary]').first().click({ timeout: 8000 });

    await page.locator(`[data-ymm-option-btn="${year}"]`).first().click({ timeout: 8000 });
    await clickOption(page, 'make', make);
    await clickOption(page, 'model', model);
    await clickOption(page, 'engine_base', engineSlugFragment(engineLiters).replace('-', '.').replace('l', 'L'));
    await clickOption(page, 'part', PART_TYPE_TO_SITE_CATEGORY[partType] ?? 'Performance Exhaust');
    await page.waitForTimeout(500); // let any dynamically-added next field (body_type, etc.) render

    // Optionally narrow by trim if the site's next step offers it and we were given one.
    if (submodel) {
      const trimBtn = page
        .locator('[data-ymm-el-container="vehicle_details"] [data-ymm-option-btn], [data-ymm-el-container="sub_model"] [data-ymm-option-btn]')
        .filter({ hasText: submodel })
        .first();
      if (await trimBtn.count().then((c) => c > 0).catch(() => false)) {
        await trimBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // Body style (cab/body configuration) can genuinely gate fitment (e.g. a Regular Cab
    // F-150 cat-back that doesn't fit a SuperCrew) — match the site's body_type step to our
    // catalog's own body_style instead of letting the generic fallback below pick blindly.
    if (bodyStyle) {
      const bodyBtn = page
        .locator('[data-ymm-el-container="body_type"] [data-ymm-option-btn], [data-ymm-el-container="vehicle_details"] [data-ymm-option-btn]')
        .filter({ hasText: bodyStyle })
        .first();
      if (await bodyBtn.count().then((c) => c > 0).catch(() => false)) {
        await bodyBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // Any remaining required fields (varies per vehicle, e.g. body type / bed length for
    // trucks) get a best-effort first-option pick — we're verifying the exhaust SKU, not
    // every trim/body permutation, and the submit link won't enable until all are filled.
    for (let i = 0; i < 6; i++) {
      const submit = page.locator('[data-vehicle-menu-submit]');
      const isDisabled = await submit.evaluate((el) => el.classList.contains('disabled'));
      if (!isDisabled) break;

      // Find the first option group whose hidden input is still empty and click its first option.
      const groups = await page.locator('input[data-ymm-option]').evaluateAll((els) => els.map((e) => e.name).filter((n) => n));
      let clicked = false;
      for (const groupName of groups) {
        // "vehicle_details" is a non-functional outer wrapper whose buttons are duplicates
        // of a nested real field (e.g. body_type, sub_model) — its own hidden input never
        // gets set directly, so treating it as fillable spins forever re-clicking the same
        // nested button without ever reaching the field after it.
        if (groupName === 'vehicle_details') continue;
        const val = await page.locator(`input[data-ymm-option="${groupName}"]`).inputValue().catch(() => '');
        if (val) continue;
        const firstOpt = page.locator(`[data-ymm-el-container="${groupName}"] [data-ymm-option-btn]`).first();
        if (await firstOpt.count().then((c) => c > 0).catch(() => false)) {
          await firstOpt.click({ timeout: 5000 }).catch(() => {});
          clicked = true;
          await page.waitForTimeout(500);
          break;
        }
      }
      if (!clicked) break;
    }

    const submit = page.locator('[data-vehicle-menu-submit]');
    const href = await submit.evaluate((el) => el.href || null).catch(() => null);
    if (!href) {
      return { match: false, expected: expectedSkus, found: [], error: 'Submit link never became enabled — could not reach results page' };
    }

    // Fetch the results page in a brand-new browser context (separate cookie jar), not the
    // page that just ran the widget. Confirmed empirically: navigating to the same href from
    // the widget-interaction page returns a narrowed ~2-product result (something about the
    // widget flow leaves cookie/localStorage state that filters the collection), while a
    // cold fetch of the identical URL returns the full, correct product set every time.
    const resultsContext = await browser.newContext();
    const resultsPage = await resultsContext.newPage();
    await resultsPage.goto(href, { waitUntil: 'domcontentloaded' });
    await resultsPage.waitForLoadState('networkidle').catch(() => {});
    await resultsPage.waitForTimeout(1000);

    const productLinks = await resultsPage.locator('.collection__grid a[href*="/products/"]').evaluateAll((els) => [...new Set(els.map((e) => e.href))]);
    await resultsContext.close();

    const engineFrag = engineSlugFragment(engineLiters); // e.g. "3-5l"
    const foundSkus = new Set();
    for (const link of productLinks) {
      const slug = link.split('/products/')[1] ?? '';
      if (!slug.includes(engineFrag)) continue;
      if (isCatalyticConverterSlug(slug)) continue;
      const match = slug.match(/^([a-z0-9]+(?:-[a-z0-9]+)?)-magnaflow-/i);
      if (match) foundSkus.add(match[1].toUpperCase());
    }

    const expected = new Set(expectedSkus.map((s) => s.toUpperCase()));
    const missing = [...expected].filter((s) => !foundSkus.has(s));
    const unexpected = [...foundSkus].filter((s) => !expected.has(s));

    return {
      match: missing.length === 0 && unexpected.length === 0,
      expected: [...expected],
      found: [...foundSkus],
      missing,
      unexpected,
      resultsUrl: href,
    };
  } finally {
    await browser.close();
  }
}
