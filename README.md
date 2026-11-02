# Jersey Shore camera grid

Nine dedicated Cloudflare Workers, deployed in a separate account, with a 3×3 viewer hosted on GitHub Pages.

The original `sea-girt-north1` Worker is neither deployed nor used by this project. The North tile uses its own `beach-wall-sea-girt-north` Worker and the same upstream source and request headers as the original. Deployment checks the destination account’s actual workers.dev subdomain and refuses `wail-dorado7m`.

## Setup

1. Create a dedicated public GitHub repository in the existing GitHub account.
2. In the new Cloudflare account, configure its workers.dev subdomain and create an API token scoped to that account with Workers Scripts Write (the Edit Cloudflare Workers template is supported).
3. In this repository, add Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, both from the new account. Do not reuse the original account’s credentials.
4. In Settings → Pages, set Source to GitHub Actions.
5. Run **Deploy isolated camera grid** under Actions. The workflow verifies the account, runs tests, deploys nine Workers, and publishes the viewer only after all Worker deployments succeed. It discovers the account’s workers.dev subdomain automatically.

API credentials stay in GitHub Actions secrets. Only the public Worker URLs go into the published page. No paid subscription is enabled by this workflow.

## Local checks

```sh
WORKERS_SUBDOMAIN=isolated-preview node scripts/build.mjs
node --test scripts/*.test.mjs
```

`isolated-preview` is a test-only name, not a live deployment. Live camera playback still requires successful deployment and verification of the upstream feeds. Shared upstream camera outages can affect either viewer even though the Cloudflare accounts are separate.
