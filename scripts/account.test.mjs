import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAccount, validateSubdomain} from './account.mjs';
const env = {CLOUDFLARE_API_TOKEN: 'test-only-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32)};

test('the original account and missing or malformed subdomains are rejected', () => {
  for (const value of ['wail-dorado7m', 'WAIL-DORADO7M', '', undefined, 'example.com', 'x\nsubdomain=wail-dorado7m']) {
    assert.throws(() => validateSubdomain(value));
  }
  assert.equal(validateSubdomain('separate-grid'), 'separate-grid');
});
test('account preflight checks the actual token target without modifying Cloudflare', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`);
    assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    return Response.json({success: true, result: {subdomain: 'wail-dorado7m'}});
  };
  await assert.rejects(resolveAccount(env, fetcher), /original Sea Girt account/);
  assert.equal(calls, 1);
  assert.equal(await resolveAccount(env, async () => Response.json({success:true,result:{subdomain:'separate-grid'}})), 'separate-grid');
});
test('missing credentials and failed API responses cannot proceed', async () => {
  const never = () => assert.fail('Invalid credentials must fail before any request');
  await assert.rejects(resolveAccount({}, never), /CLOUDFLARE_API_TOKEN/);
  await assert.rejects(resolveAccount({...env, CLOUDFLARE_ACCOUNT_ID: 'bad'}, never), /CLOUDFLARE_ACCOUNT_ID/);
  await assert.rejects(resolveAccount(env, async () => Response.json({success:false}, {status:403})), /HTTP 403/);
  await assert.rejects(resolveAccount(env, async () => Response.json({success:true,result:{}})), /subdomain/);
});
