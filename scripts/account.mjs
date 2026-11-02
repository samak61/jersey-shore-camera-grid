import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function validateSubdomain(value) {
  const subdomain = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    throw new Error('Configure a workers.dev subdomain in the new Cloudflare account first.');
  }
  if (subdomain === 'wail-dorado7m') {
    throw new Error('Deployment stopped: this is the original Sea Girt account. Use the new grid account credentials.');
  }
  return subdomain;
}

export async function resolveAccount(env, fetcher = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token) throw new Error('Add CLOUDFLARE_API_TOKEN to this repository’s Actions secrets.');
  if (!account || !/^[a-f0-9]{32}$/i.test(account)) {
    throw new Error('Add the new account’s 32-character CLOUDFLARE_ACCOUNT_ID to this repository’s Actions secrets.');
  }
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, {
    headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) {
    throw new Error(`Cloudflare account verification failed (HTTP ${response.status}). Check the new account ID, token permissions, and workers.dev setup.`);
  }
  return validateSubdomain(data.result?.subdomain);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const subdomain = await resolveAccount(process.env);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `subdomain=${subdomain}\n`);
    console.log(`Verified separate grid account: ${subdomain}.workers.dev`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
