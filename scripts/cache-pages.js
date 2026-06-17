/**
 * Pre-cache MagnaFlow product pages into Cloudflare Workers KV.
 * Run locally before the demo: node scripts/cache-pages.js
 */
import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });

const PAGES_TO_CACHE = [
  { key: 'sku-19293', url: 'https://www.magnaflow.com/products/19293-magnaflow-2016-2023-toyota-tacoma-street-series-cat-back-performance-exhaust-system' },
  { key: 'sku-19291', url: 'https://www.magnaflow.com/products/19291-performance-exhaust-magnaflow-toyota-tacoma-street-series-cat-back-performance-exhaust-system' },
  { key: 'sku-19583', url: 'https://www.magnaflow.com/products/19583-magnaflow-2016-2023-toyota-tacoma-3-5l-overland-series-cat-back-performance-exhaust-system' },
  { key: 'sku-19835', url: 'https://www.magnaflow.com/products/19835-magnaflow-2021-2023-ford-f-150-2-7l-2021-2026-ford-f-150-5-0l-speq-series-cat-back-performance-exhaust-system-19835' },
];

const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
const CF_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values`;

for (const { key, url } of PAGES_TO_CACHE) {
  const page = await fetch(url);
  const html = await page.text();
  await fetch(`${CF_URL}/${key}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'text/html' },
    body: html,
  });
  console.log(`Cached: ${key}`);
}
