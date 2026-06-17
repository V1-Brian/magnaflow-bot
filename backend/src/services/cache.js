/**
 * Cloudflare Workers KV cache client.
 * Used to fetch pre-cached MagnaFlow product pages without hitting their servers live.
 */
export async function getCachedPage(sku) {
  const { CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN } = process.env;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/sku-${sku}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  });

  if (!res.ok) return null;
  return res.text();
}
