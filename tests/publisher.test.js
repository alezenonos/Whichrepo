import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_RELEASE_MODE,
  correctionFields,
  correctionMailto as mailto,
  hostReleaseMode,
  missingForRelease,
  placeholdersIn,
  publisherFields,
  readPublisher as read,
  releaseMode as mode,
  releaseModeReason as reason,
  renderPublisherFacts as facts,
} from '../node/publisher.mjs';

// Bound to Whichcar's prefix and noun, the way its own `scripts/publisher.mjs` binds them, so the
// cases below read as the defects they record.
const PREFIX = 'WHICHCAR';
const PUBLISHER_FIELDS = publisherFields(PREFIX);
const CORRECTION_FIELDS = correctionFields('Car');
const releaseMode = (env) => mode(env, PREFIX);
const releaseModeReason = (env) => reason(env, PREFIX);
const readPublisher = (env) => read(env, PREFIX);
const renderPublisherFacts = (publisher) => facts(publisher, PREFIX);
const correctionMailto = (email, fields) =>
  mailto(email, fields, { noun: 'Car', dimensionsHint: 'Space, Safety, Running Costs…' });

// #88. Three pages shipped with `[PUBLISHER NAME]`, `[ADDRESS]`, `[CONTACT EMAIL]` and three
// `[REVIEW BEFORE LAUNCH]` blocks in them, and nothing stopped a public build going out that way. A
// site that publishes scores about named vehicles and cannot say who publishes it, or take a
// correction, has a trust problem no amount of evidence discipline fixes.

describe('the release gate', () => {
  // Rewritten 2026-09-13 by a review finding on PR #93, and the two changed lines are the finding.
  // This test used to assert that a near miss -- `PUBLIC`, `production` -- resolved to `preview`, and
  // called that "a near miss must not publish". It had the direction backwards: nothing here decides
  // whether a build is published, `vercel.json` deploys whatever the build produces, so
  // resolving a typo to `preview` is what lets an unfinished page onto the live site. A mode this
  // file does not recognise is now refused outright, and an unset one asks the host.
  it('defaults to preview, and refuses a mode it does not recognise', () => {
    assert.equal(releaseMode({}), DEFAULT_RELEASE_MODE);
    assert.equal(releaseMode({ WHICHCAR_RELEASE: '' }), 'preview');
    assert.throws(() => releaseMode({ WHICHCAR_RELEASE: 'PUBLIC' }), /Refusing to guess/, 'a near miss must not resolve to anything');
    assert.throws(() => releaseMode({ WHICHCAR_RELEASE: 'production' }), /Refusing to guess/);
    assert.equal(releaseMode({ WHICHCAR_RELEASE: 'public' }), 'public');
  });

  // A build configured with `WHICHCAR_PUBLISHER_NAME=` must fail rather than publish a blank line
  // where a name belongs.
  it('treats an empty or blank value as not set', () => {
    const publisher = readPublisher({ WHICHCAR_PUBLISHER_NAME: '   ', WHICHCAR_PUBLISHER_EMAIL: '' });
    assert.equal(publisher.name, null);
    assert.equal(publisher.email, null);
    assert.deepEqual(missingForRelease(publisher).map((field) => field.key), ['name', 'email']);
  });

  it('trims a configured value rather than publishing the whitespace', () => {
    assert.equal(readPublisher({ WHICHCAR_PUBLISHER_NAME: '  Example Ltd  ' }).name, 'Example Ltd');
  });

  it('requires a name and a mailbox, and nothing else', () => {
    const required = PUBLISHER_FIELDS.filter((field) => field.required).map((field) => field.key);
    // An individual publisher may have no registered office and no company number. What cannot be
    // missing is a name and a way to reach a human.
    assert.deepEqual(required, ['name', 'email']);
    assert.deepEqual(missingForRelease(readPublisher({ WHICHCAR_PUBLISHER_NAME: 'A', WHICHCAR_PUBLISHER_EMAIL: 'a@b.test' })), []);
  });

  it('names the environment variable for every field it can be missing, under the instance prefix', () => {
    for (const field of PUBLISHER_FIELDS) {
      assert.match(field.env, /^WHICHCAR_PUBLISHER_[A-Z]+$/);
    }
    for (const field of publisherFields('WHICHPHONE')) {
      assert.match(field.env, /^WHICHPHONE_PUBLISHER_[A-Z]+$/);
      assert.ok(field.note, `${field.key} does not say what it is for`);
      assert.ok(field.label, `${field.key} has no label`);
    }
  });
});

describe('finding an unresolved placeholder', () => {
  // A shape rather than a list. The three pages carry four different markers, and a gate that knew
  // only about `[PUBLISHER NAME]` would have passed a build whose privacy policy still said it had
  // not been reviewed. A marker added to a page next month is caught without anybody remembering.
  it('catches every marker shape the pages actually use', () => {
    assert.deepEqual(placeholdersIn('<dd>[PUBLISHER NAME]</dd>'), ['[PUBLISHER NAME]']);
    assert.deepEqual(placeholdersIn('<strong>[REVIEW BEFORE LAUNCH]</strong>'), ['[REVIEW BEFORE LAUNCH]']);
    assert.deepEqual(placeholdersIn('<strong>[CONFIRM]</strong>'), ['[CONFIRM]']);
    assert.deepEqual(placeholdersIn('[COMPLETE BEFORE LAUNCH]'), ['[COMPLETE BEFORE LAUNCH]']);
  });

  it('reports each marker once however often it appears', () => {
    assert.deepEqual(placeholdersIn('[ADDRESS] and [ADDRESS] again'), ['[ADDRESS]']);
  });

  // The catalogue's own prose is full of brackets, and a gate that fired on any of them would be
  // switched off within a week.
  it('does not fire on ordinary bracketed prose', () => {
    assert.deepEqual(placeholdersIn('a range [45,931-54,355] and a note [see below] and [a]'), []);
    assert.deepEqual(placeholdersIn(''), []);
    assert.deepEqual(placeholdersIn(null), []);
  });
});

describe('what the contact page says while the details are unset', () => {
  // Not a list of blanks. Printing `[ADDRESS]` at a reader as though it were an address is the defect;
  // saying "no publisher details are configured, so this page cannot tell you who operates the site"
  // is the fix. It no longer calls itself a preview: production is built in this state since
  // 26 September 2026.
  it('says the details are not configured rather than printing empty fields', () => {
    const markup = renderPublisherFacts(readPublisher({}));
    assert.match(markup, /No publisher details are configured yet/);
    assert.doesNotMatch(markup, /preview|cannot be built/i);
    assert.ok(!markup.includes('<dl'), markup);
    assert.deepEqual(placeholdersIn(markup), []);
  });

  it('renders the fields that are set, and names the ones that are not', () => {
    const markup = renderPublisherFacts(readPublisher({ WHICHCAR_PUBLISHER_NAME: 'Example Ltd' }));
    assert.match(markup, /<dt>Published by<\/dt>\s*<dd>Example Ltd<\/dd>/);
    assert.match(markup, /The publisher’s email is not configured yet\./);
  });

  it('drops the note once nothing required is missing', () => {
    const markup = renderPublisherFacts(readPublisher({ WHICHCAR_PUBLISHER_NAME: 'Example Ltd', WHICHCAR_PUBLISHER_EMAIL: 'a@b.test' }));
    assert.ok(!markup.includes('not configured'), markup);
    assert.match(markup, /<dd>a@b\.test<\/dd>/);
  });

  // The publisher's details are the one thing on this page that did not come out of a data file, and
  // they are still substituted into markup.
  it('escapes the details it substitutes', () => {
    const markup = renderPublisherFacts(readPublisher({ WHICHCAR_PUBLISHER_NAME: '<script>alert(1)</script>' }));
    assert.ok(!markup.includes('<script'), markup);
    assert.match(markup, /&lt;script&gt;/);
  });
});

describe('the correction route', () => {
  it('prefills the fields a report cannot be acted on without', () => {
    const link = correctionMailto('hello@example.test', { item: 'Škoda Kodiaq', dimension: 'Running Costs', catalogueVersion: 7 });
    const url = new URL(link);
    assert.equal(url.protocol, 'mailto:');
    const body = decodeURIComponent(url.searchParams.get('body'));
    assert.match(body, /^Car: Škoda Kodiaq$/m);
    assert.match(body, /^Dimension .*: Running Costs$/m);
    // The two that matter most: a figure with no document behind it cannot enter the catalogue, and a
    // report against catalogue 5 may already be fixed by catalogue 7.
    assert.match(body, /Where that can be checked/);
    assert.match(body, /^Catalogue version: 7$/m);
    assert.match(decodeURIComponent(url.searchParams.get('subject')), /^Correction: Škoda Kodiaq — Running Costs$/);
  });

  it('names every field the workflow document lists', () => {
    const body = decodeURIComponent(new URL(correctionMailto('a@b.test')).searchParams.get('body'));
    for (const field of CORRECTION_FIELDS) assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  });

  // No mailbox, no route. A link to nowhere is worse than the page saying it cannot take a correction
  // yet, which is what the page does until a publisher email is configured.
  it('produces no link at all without a mailbox', () => {
    assert.equal(correctionMailto(null), null);
    assert.equal(correctionMailto(''), null);
    assert.equal(correctionMailto(undefined, { item: 'a' }), null);
  });

  it('works with nothing prefilled', () => {
    assert.match(correctionMailto('a@b.test'), /^mailto:a%40b\.test\?subject=/);
  });

  // Another instance binds another noun, and the route reads in that instance's words.
  it('speaks the instance\'s noun', () => {
    const link = mailto('a@b.test', { item: 'Pixel 10' }, { noun: 'Phone', dimensionsHint: 'Camera, Battery' });
    const url = new URL(link);
    assert.match(decodeURIComponent(url.searchParams.get('body')), /^Phone: Pixel 10$/m);
    assert.match(decodeURIComponent(url.searchParams.get('body')), /^Dimension \(Camera, Battery\): $/m);
    assert.match(decodeURIComponent(new URL(mailto('a@b.test', {}, { noun: 'Apartment' })).searchParams.get('subject')), /^Correction: an apartment$/);
  });
});

// Review finding on PR #93. The gate was opt-in and had to be fail-closed.
describe('the release gate does not rely on somebody remembering a variable', () => {
  it('treats a production deployment as a public release without being told', () => {
    // Nothing in this repository decides whether a build is published. `vercel.json` runs
    // the same build for a production deployment and for a preview alike and deploys whatever comes
    // out, so a production deploy that forgot WHICHCAR_RELEASE did not fail -- it succeeded, listed
    // its unresolved placeholders into a build log nobody reads, and put [PUBLISHER NAME] on the live
    // privacy page. The host says which deployment this is; it is now asked.
    assert.equal(releaseMode({ VERCEL_ENV: 'production' }), 'public');
    assert.equal(releaseMode({ VERCEL_ENV: 'preview' }), DEFAULT_RELEASE_MODE);
    assert.equal(releaseMode({}), DEFAULT_RELEASE_MODE);
  });

  it('still lets somebody say preview on purpose', () => {
    // An explicit opt-out is a deliberate act by a person who typed it, which is a different thing
    // from an omission. Building a preview of a production branch has to stay possible.
    assert.equal(releaseMode({ VERCEL_ENV: 'production', WHICHCAR_RELEASE: 'preview' }), 'preview');
    assert.equal(releaseMode({ WHICHCAR_RELEASE: 'public' }), 'public');
  });

  it('says which setting decided the mode, rather than naming one nobody set', () => {
    // The production deploy of 6379432 was refused with "WHICHCAR_RELEASE=public refuses this
    // build" while WHICHCAR_RELEASE was unset: the mode came from VERCEL_ENV, and the log sent the
    // reader to a variable that did not exist. The reason must agree with releaseMode on every input.
    const cases = [
      [{ VERCEL_ENV: 'production' }, 'public', /^VERCEL_ENV=production/],
      [{ VERCEL_ENV: 'production', WHICHCAR_RELEASE: 'preview' }, 'preview', /^WHICHCAR_RELEASE=preview$/],
      [{ WHICHCAR_RELEASE: 'public' }, 'public', /^WHICHCAR_RELEASE=public$/],
      [{ RENDER: 'true' }, 'public', /^RENDER=true/],
      [{ RENDER: 'true', IS_PULL_REQUEST: 'true' }, 'preview', /the default, preview$/],
      [{ VERCEL_ENV: 'preview', WHICHCAR_RELEASE: '' }, 'preview', /the default, preview$/],
    ];
    for (const [env, mode, reason] of cases) {
      assert.equal(releaseMode(env), mode, JSON.stringify(env));
      assert.match(releaseModeReason(env), reason, JSON.stringify(env));
    }
  });

  it('refuses a mode it does not recognise instead of downgrading it', () => {
    // `WHICHCAR_RELEASE=publik` used to mean preview. That is the same failure wearing a typo, and
    // silent: the one setting whose whole job is to be strict became the lax one on a keystroke.
    assert.throws(() => releaseMode({ WHICHCAR_RELEASE: 'publik' }), /Refusing to guess/);
    assert.throws(() => releaseMode({ WHICHCAR_RELEASE: 'PUBLIC' }), /Refusing to guess/);
    // An empty variable is an unset one, not a typo: a CI system that defines every variable and
    // leaves some blank must not fail the build over it.
    assert.equal(releaseMode({ WHICHCAR_RELEASE: '' }), DEFAULT_RELEASE_MODE);
    assert.equal(releaseMode({ WHICHCAR_RELEASE: '  ' }), DEFAULT_RELEASE_MODE);
  });

  it('names one place that answers whether this is the real thing', () => {
    assert.equal(hostReleaseMode({ VERCEL_ENV: 'production' }), 'public');
    assert.equal(hostReleaseMode({ VERCEL_ENV: 'development' }), null);
    assert.equal(hostReleaseMode({}), null);
  });

  // #137. The deployment docs recommended Render for a commercial site, and on Render a production
  // deploy has no VERCEL_ENV: it built as a preview and published its placeholders. Every documented
  // host must have its production marker here.
  it('reads Render\'s production service as a public release, and its pull-request previews as previews', () => {
    assert.equal(hostReleaseMode({ RENDER: 'true' }), 'public');
    assert.equal(hostReleaseMode({ RENDER: 'true', IS_PULL_REQUEST: 'false' }), 'public');
    assert.equal(hostReleaseMode({ RENDER: 'true', IS_PULL_REQUEST: 'true' }), null);
    assert.equal(releaseMode({ RENDER: 'true', WHICHCAR_RELEASE: 'preview' }), 'preview');
  });
});
