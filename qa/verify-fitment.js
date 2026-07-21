import { chromium } from 'playwright';

const MAGNAFLOW_BASE_URL = 'https://www.magnaflow.com';

const PART_TYPE_TO_SITE_CATEGORY = {
  'cat-back': 'Performance Exhaust',
  'axle-back': 'Performance Exhaust',
  'universal-cat': 'Catalytic Converter',
  'direct-fit-cat': 'Catalytic Converter',
  'replacement-exhaust': 'Replacement Exhaust',
};

function engineDisplayText(engineLiters) {
  // JS stringifies whole numbers without the trailing zero (String(5.0) === "5"), which
  // would make the engine search text "5L" instead of "5.0L" — and "5L" is a substring of
  // "V6 3.5L" too, so a naive substring match can silently select the wrong engine entirely.
  return `${Number(engineLiters).toFixed(1)}L`;
}

function engineSlugFragment(engineLiters) {
  // MagnaFlow product URL slugs encode displacement like "3-5l", "5-7l"
  return engineDisplayText(engineLiters).toLowerCase().replace('.', '-');
}

// The results page shows performance exhaust AND catalytic converters together regardless
// of which "part" category was selected in the widget. Our catalog only ever contains
// cat-back/axle-back/replacement-exhaust parts (no catalytic converters), so excluding any
// catalytic-converter product is enough to get an apples-to-apples comparison without
// needing exact per-part-type matching.
function isCatalyticConverterSlug(slug) {
  return slug.includes('catalytic-converter');
}

// The site formats HD truck models with a space ("Silverado 2500 HD") where our catalog
// doesn't ("Silverado 2500HD") — normalize for the site lookup only, not our own data.
function siteModelText(model) {
  return model.replace(/(\d)(HD)\b/i, '$1 $2');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exact (trimmed) text match, not substring — substring matching is genuinely dangerous
// here: "1500" is a substring of "1500 Classic", "XL" is a substring of "XLT", and
// "5L"/"4L"/"0L" are substrings of almost every other engine's displacement text.
function exactOptionLocator(page, containers, text) {
  const selector = containers.map((c) => `[data-ymm-el-container="${c}"] [data-ymm-option-btn]`).join(', ');
  const exact = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`, 'i');
  return page.locator(selector).filter({ hasText: exact }).first();
}

async function clickOption(page, container, text) {
  const btn = exactOptionLocator(page, [container], text);
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  await btn.click();
}

// Engine buttons include a config prefix we don't always know precisely (e.g. "V6 3.5L"),
// so substring matching is intentional here — safe now that engineDisplayText always
// includes the decimal, which is what previously made short numbers collide.
async function clickOptionContaining(page, container, text) {
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
    await clickOption(page, 'model', siteModelText(model));
    await clickOptionContaining(page, 'engine_base', engineDisplayText(engineLiters));

    // Part options can take a second or two to populate after selecting engine — actively
    // wait for the condition instead of checking immediately. Confirmed empirically: an
    // instant zero count isn't necessarily final and previously caused false "no part step"
    // results on a vehicle that reliably had options moments later.
    const partsAppeared = await page
      .locator('[data-ymm-el-container="part"] [data-ymm-option-btn]')
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (!partsAppeared) {
      return {
        match: false,
        expected: expectedSkus,
        found: [],
        error: `Site's vehicle picker offers no part-type step at all for this engine — it may not sell/list anything for ${year} ${make} ${model} ${engineDisplayText(engineLiters)} via this tool. Check the SKU's own product page directly.`,
      };
    }
    // Not every vehicle offers every part category — e.g. Jeep Wrangler 3.0L EcoDiesel
    // only has "Performance Exhaust", with no "Replacement Exhaust" option at all, even
    // though a real DPF-back product exists for it. Fall back to whatever's actually
    // offered rather than failing outright on an exact category that isn't there.
    const desiredCategory = PART_TYPE_TO_SITE_CATEGORY[partType] ?? 'Performance Exhaust';
    const desiredBtn = exactOptionLocator(page, ['part'], desiredCategory);
    const desiredAvailable = await desiredBtn.count().then((c) => c > 0).catch(() => false);
    if (desiredAvailable) {
      await desiredBtn.click();
    } else {
      await page.locator('[data-ymm-el-container="part"] [data-ymm-option-btn]').first().click();
    }
    await page.waitForTimeout(1000); // let any dynamically-added next field (body_type, etc.) render

    // Optionally narrow by trim if the site's next step offers it and we were given one.
    // Exact match — trim names in practice are short standalone labels ("XL" vs "XLT",
    // "1500" vs "1500 Classic") where substring matching would risk clicking the wrong one.
    if (submodel) {
      const trimBtn = exactOptionLocator(page, ['vehicle_details', 'sub_model'], submodel);
      const trimAppeared = await trimBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
      if (trimAppeared) await trimBtn.click({ timeout: 5000 }).catch(() => {});
    }

    // Body style (cab/body configuration) can genuinely gate fitment (e.g. a Regular Cab
    // F-150 cat-back that doesn't fit a SuperCrew) — match the site's body_type step to our
    // catalog's own body_style instead of letting the generic fallback below pick blindly.
    // Exact match: our stored values don't always match the site's fuller label wording
    // (e.g. our "Crew Cab" vs the site's "Crew Cab Pickup"), so this often won't find a hit
    // and falls through to the generic fallback below — but that's safer than a substring
    // match risking a wrong body style (e.g. "Cab" matching several unrelated options).
    if (bodyStyle) {
      const bodyBtn = exactOptionLocator(page, ['body_type', 'vehicle_details'], bodyStyle);
      const bodyAppeared = await bodyBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
      if (bodyAppeared) await bodyBtn.click({ timeout: 5000 }).catch(() => {});
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

    // Not every product's slug encodes the engine displacement — some (e.g. SKU 15363) are
    // named generically ("15363-magnaflow-street-series-cat-back-...") with no year/model/
    // engine info at all. Requiring the engine fragment to be present would wrongly exclude
    // those. Collect every real SKU on the page regardless, and only use engine info to
    // flag an "unexpected" SKU as a genuine cross-listing when its slug explicitly names a
    // *different* engine — a slug with no engine info at all is too ambiguous to flag.
    const engineFrag = engineSlugFragment(engineLiters); // e.g. "3-5l"
    const skuToSlug = new Map();
    for (const link of productLinks) {
      const slug = link.split('/products/')[1] ?? '';
      if (isCatalyticConverterSlug(slug)) continue;
      const match = slug.match(/^([a-z0-9]+(?:-[a-z0-9]+)?)-magnaflow-/i);
      if (match) skuToSlug.set(match[1].toUpperCase(), slug);
    }
    const foundSkus = new Set(skuToSlug.keys());

    const expected = new Set(expectedSkus.map((s) => s.toUpperCase()));
    const missing = [...expected].filter((s) => !foundSkus.has(s));
    // The collection grid always shows every engine's products together (confirmed
    // empirically — the site doesn't filter by engine at all), so a SKU whose slug clearly
    // names a *different* engine isn't relevant to this vehicle at all and isn't worth
    // surfacing. Only flag SKUs that could plausibly apply (matches our engine, or has no
    // engine info) but aren't in our catalog — those are genuine completeness gaps.
    const unexpected = [...foundSkus].filter((s) => {
      if (expected.has(s)) return false;
      const slug = skuToSlug.get(s);
      const hasEngineInfo = /\d-\dl\b/i.test(slug);
      return !hasEngineInfo || slug.includes(engineFrag);
    });

    return {
      // Whether OUR claimed SKUs are confirmed to exist for this vehicle is the
      // safety-critical check. `unexpected` is informational only (possible completeness
      // gaps worth a manual look) and never fails the check on its own — a customer is
      // never shown a SKU we haven't verified, only ones we claim, so a MISSING claimed
      // SKU is the only thing that risks recommending something that doesn't exist.
      match: missing.length === 0,
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
