// Who publishes this site, and how somebody tells us we are wrong.
//
// #88. Three pages shipped with launch placeholders in them -- `[PUBLISHER NAME]`, `[ADDRESS]`,
// `[CONTACT EMAIL]` and three `[REVIEW BEFORE LAUNCH]` blocks -- and nothing stopped a public build
// going out with them still there. A site that publishes scores about named vehicles and cannot say
// who publishes it, or take a correction, has a trust problem that no amount of evidence discipline
// fixes.
//
// The details are **not** in this file and are not in the repository. They are the owner's business
// details; inferring them from a git config or a commit address would be inventing a fact about a
// person, which is the one thing this project refuses to do about the things it compares and must
// equally refuse to do about its publisher. They are supplied at build time through the environment,
// the same way the site origin already is. Until they are, the contact page says so in words and every build
// lists them as outstanding. (A public build used to be refused without them; on 26 September 2026 the
// owner decided that should not block a deploy -- see the note in scripts/build.mjs.)
//
// What this file does contain is the shape: which fields exist, which a launch needs, and what the
// page says while they are unset.

// Each field names the environment variable that supplies it and what it is for. `required` means the
// build lists it as outstanding until it is set. The address and the registration fields are not
// required because an individual publisher may have neither -- what a launch needs is a name and a
// way to reach a human.
//
// The variables are named from the instance's environment prefix: `publisherFields('WHICHCAR')` gives
// `WHICHCAR_PUBLISHER_NAME` and so on. Every function below takes the same `prefix`, so an instance
// binds it once in its own `scripts/publisher.mjs` and nothing here knows which site it serves.
export const DEFAULT_PREFIX = 'WHICH';

export const publisherFields = (prefix = DEFAULT_PREFIX) => [
  {
    key: 'name',
    env: `${prefix}_PUBLISHER_NAME`,
    label: 'Published by',
    required: true,
    note: 'An individual’s name, or a company’s registered legal name.',
  },
  {
    key: 'email',
    env: `${prefix}_PUBLISHER_EMAIL`,
    label: 'Email',
    required: true,
    note: 'A mailbox somebody reads. It is also where corrections arrive.',
  },
  {
    key: 'address',
    env: `${prefix}_PUBLISHER_ADDRESS`,
    label: 'Address',
    required: false,
    note: 'A registered office, or a postal address for a rights-holder notice.',
  },
  {
    key: 'registration',
    env: `${prefix}_PUBLISHER_REGISTRATION`,
    label: 'Company registration',
    required: false,
    note: 'Registration number and jurisdiction, where the publisher is a company.',
  },
  {
    key: 'vat',
    env: `${prefix}_PUBLISHER_VAT`,
    label: 'VAT number',
    required: false,
    note: 'Where the publisher is VAT-registered.',
  },
];

// Two release modes, and the difference is what is allowed to be unfinished.
//
// The first version of this defaulted to `preview` and called that the safe direction, on the
// reasoning that forgetting to set the mode cannot publish a placeholder. That reasoning was wrong,
// and the way it was wrong is worth keeping written down: nothing in this repository decides whether
// a build is published. `vercel.json` runs the same build for a production deployment and for a
// preview alike, and deploys whatever it produces. So a production deploy that forgot
// `WHICHCAR_RELEASE=public` did not fail -- it succeeded, printed its list of unresolved
// placeholders to a build log nobody reads, and put `[PUBLISHER NAME]` on the live privacy page. The
// gate was opt-in where it had to be fail-closed.
//
// Two changes fix that. The host is asked first: Vercel sets `VERCEL_ENV` on every deployment
// without anybody configuring it, and `production` there means a public release whatever the
// repository was told. And an unrecognised mode is now an error rather than a silent downgrade --
// `WHICHCAR_RELEASE=publik` used to mean `preview`, which is the same failure wearing a typo.
export const RELEASE_MODES = new Set(['preview', 'public']);
export const DEFAULT_RELEASE_MODE = 'preview';

// Read rather than inferred. If another host is ever used, its own production marker is added here
// and nowhere else, so there is one place that answers "is this the real thing".
//
// #137. This knew Vercel only, while docs/deployment.md recommended Render for a commercial site: a
// Render production deploy was a preview, printed its placeholders to a log nobody reads, and
// published them. Render marks every build with `RENDER=true` and a pull-request preview with
// `IS_PULL_REQUEST=true`, so anything else it builds is the production service.
export function hostReleaseMode(env = process.env) {
  if (env.VERCEL_ENV === 'production') return 'public';
  if (env.RENDER === 'true' && env.IS_PULL_REQUEST !== 'true') return 'public';
  return null;
}

export function releaseMode(env = process.env, prefix = DEFAULT_PREFIX) {
  const mode = env[`${prefix}_RELEASE`];
  if (typeof mode === 'string' && mode.trim() !== '' && !RELEASE_MODES.has(mode)) {
    throw new Error(
      `${prefix}_RELEASE is ${JSON.stringify(mode)}, which is neither ${[...RELEASE_MODES].join(' nor ')}. ` +
        'Refusing to guess: a misspelled mode used to mean "preview", which is how an unfinished page reaches production.',
    );
  }
  if (RELEASE_MODES.has(mode)) return mode;
  return hostReleaseMode(env) ?? DEFAULT_RELEASE_MODE;
}

// Which setting decided the mode, in the words a person would search a dashboard for.
//
// The refusal used to open with "WHICHCAR_RELEASE=public refuses this build" and end with "Build
// without WHICHCAR_RELEASE for a preview". The production deploy of 6379432 (26 September 2026) printed
// both while WHICHCAR_RELEASE was unset: the mode came from VERCEL_ENV, so the log named a variable
// nobody had set and advised the very configuration it had just refused. A gate whose error sends the
// reader the wrong way gets removed rather than satisfied.
export function releaseModeReason(env = process.env, prefix = DEFAULT_PREFIX) {
  const variable = `${prefix}_RELEASE`;
  if (RELEASE_MODES.has(env[variable])) return `${variable}=${env[variable]}`;
  if (env.VERCEL_ENV === 'production') return 'VERCEL_ENV=production: a Vercel production deployment';
  if (hostReleaseMode(env) === 'public') return 'RENDER=true: a Render production service';
  return `no ${variable} and no host production marker, so the default, ${DEFAULT_RELEASE_MODE}`;
}

// A value is present only if somebody set it to something. An empty string and a string of spaces are
// both "not set": a build configured with `WHICHCAR_PUBLISHER_NAME=` must fail the gate rather than
// publish a blank line where a name belongs.
const value = (env, key) => {
  const raw = env[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
};

export function readPublisher(env = process.env, prefix = DEFAULT_PREFIX) {
  return Object.fromEntries(publisherFields(prefix).map((field) => [field.key, value(env, field.env)]));
}

// The fields a launch is still missing. Returned as the field definitions rather than as keys, so a
// caller can print which environment variable to set without keeping its own copy of the mapping.
export function missingForRelease(publisher, prefix = DEFAULT_PREFIX) {
  return publisherFields(prefix).filter((field) => field.required && !publisher[field.key]);
}

// Every unresolved placeholder in the built pages, whatever its shape. The three pages carry four
// different markers -- `[PUBLISHER NAME]`, `[REVIEW BEFORE LAUNCH]`, `[CONFIRM]`,
// `[COMPLETE BEFORE LAUNCH]` -- and a gate that knew only about the first would have passed a build
// whose privacy policy still said it had not been reviewed.
//
// Deliberately a shape rather than a list: a new placeholder added to a page next month is caught
// without anybody remembering to add it here, which is the only way a check like this survives.
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z ]{2,}\]/g;

export function placeholdersIn(html) {
  return [...new Set(String(html ?? '').match(PLACEHOLDER_PATTERN) ?? [])];
}

// What the contact page shows. With the details set it is a definition list of facts; without them it
// says plainly that they are not configured yet and names what is missing, rather than printing
// `[ADDRESS]` at a reader as though it were an address.
//
// It no longer says "preview build" or that "a public release cannot be built in this state": since
// 26 September 2026 the production site is built in exactly this state, and the page must not claim
// otherwise about itself.
export function renderPublisherFacts(publisher, prefix = DEFAULT_PREFIX) {
  const set = publisherFields(prefix).filter((field) => publisher[field.key]);
  if (!set.length) {
    return [
      '<p class="page-note">',
      '          No publisher details are configured yet, so this page cannot tell you who operates the site',
      '          or take a correction by email.',
      '        </p>',
    ].join('\n');
  }
  const rows = set
    .map(
      (field) => `          <dt>${field.label}</dt>\n          <dd>${escapeHtml(publisher[field.key])}</dd>`,
    )
    .join('\n');
  const missing = missingForRelease(publisher, prefix);
  const warning = missing.length
    ? `\n        <p class="page-note">\n          The publisher’s ${missing
        .map((field) => field.key)
        .join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not configured yet.\n        </p>`
    : '';
  return `<dl class="page-facts">\n${rows}\n        </dl>${warning}`;
}

// The publisher's own details are the one thing on this page that did not come out of a data file,
// and they are still substituted into markup, so they are escaped like everything else.
export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------------------------
// The correction route
// ---------------------------------------------------------------------------------------------
// #88 asks for a route that identifies the item, the dimension, the source, the catalogue version and
// the claimed error. There is no backend to post a form to, and inventing one to receive a handful of
// corrections a month would be the wrong trade -- so the route is a mailto with the structure
// prefilled, which needs no server, no storage and no third party.
//
// The catalogue version matters more than it looks: a correction against catalogue 5 may already have
// been fixed by catalogue 7, and without it every report has to be re-checked against a catalogue the
// reporter was not looking at.
// `noun` is the instance's item noun as a heading ("Car", "Phone"), and `dimensionsHint` names a few of
// its sliders so the reporter knows what "dimension" means on this site.
export const correctionFields = (noun = 'Item') => [
  noun,
  'What the site says',
  'What it should say',
  'Where that can be checked',
  'Catalogue version',
];

export function correctionMailto(
  email,
  { item = '', dimension = '', catalogueVersion = '' } = {},
  { noun = 'Item', dimensionsHint = '' } = {},
) {
  if (!email) return null;
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a';
  const subject = `Correction: ${item || `${article} ${noun.toLowerCase()}`}${dimension ? ` — ${dimension}` : ''}`;
  const body = [
    `${noun}: ${item}`,
    `Dimension${dimensionsHint ? ` (${dimensionsHint})` : ''}: ${dimension}`,
    'What the site says: ',
    'What it should say: ',
    'Where that can be checked (a link to the page that publishes the correct figure): ',
    `Catalogue version: ${catalogueVersion}`,
  ].join('\n');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
