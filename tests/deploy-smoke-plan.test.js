import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isVercelLogin, normaliseUrl, smokePlan } from '../node/deploy-smoke-plan.mjs';

// #147. Every deployment on this project sits behind Vercel Authentication unless a setting says
// otherwise, so a smoke run pointed at one meets a login page and fails with messages about missing
// headings and canonical URLs, which send whoever reads them to the wrong file. The plan answers "can
// this deployment be verified at all" first, and names the setting when it cannot.
describe('whether a deployment can be smoked', () => {
  const origin = 'https://whichcar.example';
  // What a protected deployment actually answered a plain GET on 26 September 2026.
  const SSO = 'https://vercel.com/sso-api?url=https%3A%2F%2Fwhichcar-7tczne8g7-alezenonos-projects.vercel.app%2F';

  // The first preview this workflow saw (bad4f73, #176) answered `302 Location: vercel.com/sso-api`,
  // not the 401 the plan knew. It was not recognised as protected, fell through to the origin check,
  // and put a red "Deployment smoke / preview" on the pull request over a repository variable.
  it('recognises the redirect to Vercel\'s login as protection, not only the 401', () => {
    assert.equal(isVercelLogin(302, SSO), true);
    assert.equal(isVercelLogin(307, 'https://vercel.com/login?next=%2F'), true);
    assert.equal(isVercelLogin(401, ''), true);
    // An ordinary redirect is not a login page, and neither is a look-alike host.
    assert.equal(isVercelLogin(308, 'https://whichcar.example/prices'), false);
    assert.equal(isVercelLogin(302, 'https://vercel.com.evil.test/sso-api'), false);
    assert.equal(isVercelLogin(302, ''), false);
    assert.equal(isVercelLogin(200, SSO), false);
    const plan = smokePlan({ environment: 'preview', status: 302, location: SSO, hasBypass: false, productionOrigin: '' });
    assert.equal(plan.action, 'skip');
    assert.match(plan.message, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  });

  it('smokes a deployment that answers normally', () => {
    assert.deepEqual(smokePlan({ environment: 'preview', status: 200, hasBypass: false, productionOrigin: origin }), {
      action: 'run',
      message: '',
    });
  });

  // The first version told production "visitors meet a login page" whenever the deployment's own URL
  // was protected. Under Standard Protection that URL is protected while the production domain is
  // public (whichcar.vercel.app answered 200 on 26 September 2026 while every deployment URL
  // redirected to the login), so the claim was false for the configuration this project runs.
  it('smokes a protected deployment through the bypass secret, without claiming visitors are locked out', () => {
    assert.equal(smokePlan({ environment: 'preview', status: 401, hasBypass: true, productionOrigin: origin }).action, 'run');
    const production = smokePlan({ environment: 'production', status: 302, location: SSO, hasBypass: true, productionOrigin: origin });
    assert.deepEqual(production, { action: 'run', message: '' });
  });

  it('reports a protected preview with no secret as not verified, rather than a red check on every PR', () => {
    const plan = smokePlan({ environment: 'preview', status: 401, hasBypass: false, productionOrigin: origin });
    assert.equal(plan.action, 'skip');
    assert.match(plan.message, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  });

  it('fails a production deployment it cannot verify: production is what visitors load', () => {
    const plan = smokePlan({ environment: 'Production', status: 302, location: SSO, hasBypass: false, productionOrigin: origin });
    assert.equal(plan.action, 'fail');
    assert.match(plan.message, /own URL is behind Vercel Authentication/);
    assert.match(plan.message, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  });

  // A missing repository variable is a missing setting like the bypass secret: red on every pull
  // request for it teaches people to ignore red checks. Production still fails, with the setting.
  it('names the setting when there is no production origin, failing production and skipping a preview', () => {
    const preview = smokePlan({ environment: 'preview', status: 200, hasBypass: false, productionOrigin: '', prefix: 'WHICHCAR' });
    assert.equal(preview.action, 'skip');
    assert.match(preview.message, /^Not verified: .*WHICHCAR_PRODUCTION_URL/);
    const production = smokePlan({ environment: 'production', status: 200, hasBypass: false, productionOrigin: '', prefix: 'WHICHCAR' });
    assert.equal(production.action, 'fail');
    assert.match(production.message, /WHICHCAR_PRODUCTION_URL/);
  });
});

// The variable is named from the instance's prefix, so the operator of whichphone is told to set
// WHICHPHONE_PRODUCTION_URL and not a variable no workflow of theirs reads.
describe('the production origin variable follows the instance prefix', () => {
  it('names the prefix it was given, and a generic one otherwise', () => {
    assert.match(smokePlan({ environment: 'preview', status: 200, hasBypass: false, productionOrigin: '', prefix: 'WHICHPHONE' }).message, /WHICHPHONE_PRODUCTION_URL/);
    assert.match(smokePlan({ environment: 'preview', status: 200, hasBypass: false, productionOrigin: '' }).message, /WHICH_PRODUCTION_URL/);
  });
});

describe('deployment URLs', () => {
  it('adds the scheme a dispatch payload may leave off, and drops a trailing slash', () => {
    assert.equal(normaliseUrl('whichcar-abc.vercel.app'), 'https://whichcar-abc.vercel.app');
    assert.equal(normaliseUrl('https://whichcar.example/'), 'https://whichcar.example');
    assert.equal(normaliseUrl(''), '');
  });
});
