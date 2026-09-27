// Decides whether the post-deploy smoke can verify a deployment, before Chromium is installed.
//
// #147. Production failed to deploy for eleven days and nothing ran after a deploy to notice. The
// Deployment smoke workflow now runs the production smoke suite against every deployment Vercel
// reports, and this is its first step. Deployments on this project sit behind Vercel Authentication
// unless a setting says otherwise, and a smoke run that meets a login page fails with messages about
// headings and canonical URLs that send the reader the wrong way. So the reachability question is
// answered here, once, with the fix named:
//
//   - A deployment that answers normally is smoked.
//   - One behind Vercel Authentication is smoked through Protection Bypass for Automation when the
//     secret is configured.
//   - A protected preview with no secret is reported as not verified rather than failed: a red
//     check on every pull request for a missing setting teaches people to ignore red checks. The same
//     holds for a preview when no production origin is configured.
//   - A production deployment that cannot be verified fails. Production is the thing visitors load.
//
// "Behind Vercel Authentication" is a 401 or a redirect to Vercel's login. The first version knew only
// the 401, which Vercel sends when the request asks for JSON; a plain request, which is what `fetch`
// sends, gets `302 Location: https://vercel.com/sso-api`. So on 26 September 2026 the first preview
// this workflow saw (bad4f73, #176) was not recognised as protected, fell through to the origin check,
// and put a red "Deployment smoke / preview" on the pull request over a repository variable.
//
// A production deployment's own URL is protected under Vercel's Standard Protection while the
// production domain is public, so a protected deployment URL says nothing about what visitors see;
// the hourly uptime check asks that of the production domain itself.
//
// Usage (as an instance's workflow runs it; writes `action` and `message` to $GITHUB_OUTPUT when set):
//   DEPLOY_URL=https://… DEPLOY_ENV=production|preview <PREFIX>_PRODUCTION_URL=https://… \
//     VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/deploy-smoke-plan.mjs
//
// The production origin variable is named from the instance's environment prefix (`WHICHCAR` gives
// `WHICHCAR_PRODUCTION_URL`), which is why `smokePlan` and `main` take `prefix`.

import { appendFileSync } from 'node:fs';

const SECRET_HELP =
  'Generate one under Vercel → Project → Settings → Deployment Protection → Protection Bypass for ' +
  'Automation, and add it to GitHub as the repository secret VERCEL_AUTOMATION_BYPASS_SECRET.';

export function normaliseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
}

// Vercel Authentication's two answers: 401 to a request that asks for JSON, and a redirect to its
// login (`https://vercel.com/sso-api?...`) to anything else.
export function isVercelLogin(status, location) {
  if (status === 401) return true;
  if (status < 300 || status >= 400 || !location) return false;
  try {
    const url = new URL(location);
    return url.hostname === 'vercel.com' && /^\/(sso-api|login)\b/.test(url.pathname);
  } catch {
    return false;
  }
}

export function smokePlan({ environment, status, location, hasBypass, productionOrigin, prefix = 'WHICH' }) {
  const production = String(environment ?? '').toLowerCase() === 'production';
  if (isVercelLogin(status, location)) {
    if (hasBypass) return { action: 'run', message: '' };
    if (production) {
      return {
        action: 'fail',
        message: `This production deployment's own URL is behind Vercel Authentication, so without a bypass secret the build cannot be verified. (Whether visitors meet a login page is a question about the production domain, which the hourly uptime check asks.) ${SECRET_HELP}`,
      };
    }
    return {
      action: 'skip',
      message: `Not verified: this preview is behind Vercel Authentication and no bypass secret is configured. ${SECRET_HELP}`,
    };
  }
  if (!productionOrigin) {
    return {
      action: production ? 'fail' : 'skip',
      message: `${production ? '' : 'Not verified: '}The smoke checks canonical URLs against the production origin, and none is configured. Set the repository variable ${prefix}_PRODUCTION_URL (Settings → Secrets and variables → Actions → Variables).`,
    };
  }
  return { action: 'run', message: '' };
}

export async function main({ env = process.env, prefix = 'WHICH', fetchImpl = globalThis.fetch } = {}) {
  const url = normaliseUrl(env.DEPLOY_URL);
  if (!url) {
    console.error('DEPLOY_URL is not set: there is no deployment to smoke.');
    return { action: 'fail', message: 'The deployment event carried no URL.' };
  }
  let status = 0;
  let location = '';
  try {
    // Deliberately without the bypass header: the question is what the URL does for a visitor.
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    status = response.status;
    location = response.headers.get('location') ?? '';
  } catch (error) {
    console.error(`Could not reach ${url}: ${error?.message ?? error}`);
  }
  const plan = smokePlan({
    environment: env.DEPLOY_ENV,
    status,
    location,
    hasBypass: Boolean(env.VERCEL_AUTOMATION_BYPASS_SECRET),
    productionOrigin: normaliseUrl(env[`${prefix}_PRODUCTION_URL`]),
    prefix,
  });
  console.log(
    `${url} answered ${status || 'nothing'}${location ? ` (to ${location.split('?')[0]})` : ''}; ` +
      `${plan.action}${plan.message ? `: ${plan.message}` : ''}`,
  );
  return { ...plan, url };
}

// What an instance's `scripts/deploy-smoke-plan.mjs` does at the top level: plan, then hand the plan
// to the workflow through $GITHUB_OUTPUT when there is one.
export async function runDeploySmokePlan({ env = process.env, prefix = 'WHICH', fetchImpl } = {}) {
  const plan = await main({ env, prefix, fetchImpl });
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `action=${plan.action}\nurl=${plan.url ?? ''}\nmessage=${plan.message.replace(/\n/g, ' ')}\n`,
    );
  }
  return plan;
}
