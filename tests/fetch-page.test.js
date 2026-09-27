// The one transport every crawler reads through (#103).
//
// Before it existed, six of eight crawlers called the global `fetch` with no timeout, no retry and no
// `Retry-After` handling. The failures this file pins each happened, or were one step from happening:
// a `--verify` over eleven luxury records sat for fifty minutes on one stalled page and printed
// nothing; a batch that did return demoted the Jeep Avenger from matched to rejected because a 404
// and a socket that never answered came back in the same shape; and a 429 anywhere in the
// consumption, dimensions, Parkers or luxury crawls became a deleted reading (#98-#101).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createHostPool,
  createPageReader,
  describeFailure,
  parseRetryAfter,
  readPage,
  redirectedAway,
} from '../node/fetch-page.mjs';

const URL_A = 'https://www.parkers.co.uk/skoda/kodiaq/estate-2024/specs/';
const ok = (body, headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } });
const status = (code, headers = {}) => new Response('', { status: code, headers });
const noSleep = async () => {};

// A fetch that plays back a script of responses, one per call, and records how it was called.
const scripted = (...steps) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === 'function' ? step(url, init) : step;
  };
  return { fetchImpl, calls };
};

describe('readPage bounds every request', () => {
  // The fifty-minute hang. `fetch` has no default timeout, so a stalled socket was unbounded.
  it('turns a request that never answers into a failure within the timeout', async () => {
    const fetchImpl = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const started = Date.now();
    const outcome = await readPage(URL_A, { fetchImpl, timeoutMs: 30, retries: 1, sleep: noSleep });
    assert.equal(outcome.kind, 'http_failure');
    assert.equal(outcome.status, 0, 'no HTTP answer is status 0, never a 404');
    assert.match(outcome.reason, /timed out/);
    assert.equal(outcome.attempts, 2);
    assert.ok(Date.now() - started < 2000, 'the run must not outlive its timeout by more than scheduling noise');
  });

  // A fetch implementation that ignores its signal -- a test double, a proxy, a polyfill -- must be
  // bounded all the same. The deadline is raced, not only signalled.
  it('bounds a fetch that ignores its abort signal', async () => {
    const outcome = await readPage(URL_A, { fetchImpl: () => new Promise(() => {}), timeoutMs: 20, retries: 0 });
    assert.equal(outcome.kind, 'http_failure');
    assert.equal(outcome.status, 0);
  });

  // The server that answers its headers promptly and then trickles the body. A headers-only timeout
  // reports success and then waits for ever inside `response.text()`.
  it('bounds a body that never finishes arriving', async () => {
    const fetchImpl = async () => ({ status: 200, url: URL_A, headers: new Headers(), text: () => new Promise(() => {}) });
    const outcome = await readPage(URL_A, { fetchImpl, timeoutMs: 20, retries: 0 });
    assert.equal(outcome.kind, 'http_failure');
  });

  it('never throws, even when the fetch implementation does so synchronously', async () => {
    const outcome = await readPage(URL_A, {
      fetchImpl: () => {
        throw new TypeError('fetch failed');
      },
      retries: 0,
    });
    assert.deepEqual([outcome.kind, outcome.status, outcome.reason], ['http_failure', 0, 'fetch failed']);
  });
});

describe('readPage separates a fact about the page from a failure to read it', () => {
  // The Jeep Avenger demotion: a 404 and a transport failure were one shape, so a failure to read
  // became a finding that the car had no specification pages.
  it('reports a 404 and a 410 as withdrawn, and does not retry them', async () => {
    for (const code of [404, 410]) {
      const { fetchImpl, calls } = scripted(status(code));
      const outcome = await readPage(URL_A, { fetchImpl, retries: 3, sleep: noSleep });
      assert.equal(outcome.kind, 'withdrawn');
      assert.equal(outcome.status, code);
      assert.equal(calls.length, 1, 'retrying a fact only turns it into a delay');
    }
  });

  it('reports a 5xx that does not clear as a failure, after retrying it', async () => {
    const { fetchImpl, calls } = scripted(status(503));
    const outcome = await readPage(URL_A, { fetchImpl, retries: 2, sleep: noSleep });
    assert.deepEqual([outcome.kind, outcome.status], ['http_failure', 503]);
    assert.equal(calls.length, 3);
  });

  // A bot filter's 403 does not clear by asking three more times; it only earns a longer block.
  it('answers a non-transient refusal once', async () => {
    const { fetchImpl, calls } = scripted(status(403));
    const outcome = await readPage(URL_A, { fetchImpl, retries: 3, sleep: noSleep });
    assert.deepEqual([outcome.kind, outcome.status], ['http_failure', 403]);
    assert.equal(calls.length, 1);
  });

  it('reads a 200 and reports its body and content type', async () => {
    const { fetchImpl } = scripted(ok('<html>specs</html>'));
    const outcome = await readPage(URL_A, { fetchImpl });
    assert.equal(outcome.kind, 'read');
    assert.equal(outcome.html, '<html>specs</html>');
    assert.equal(outcome.contentType, 'text/html');
    assert.equal(outcome.finalUrl, URL_A);
  });

  // Carwow answers an unknown model with its make index and a retired Parkers trim page can land on
  // its range. The reader cannot know which address was meant, so it reports where it landed.
  it('reports the address a redirect settled on', async () => {
    const landed = 'https://www.parkers.co.uk/skoda/kodiaq/specs/';
    const { fetchImpl, calls } = scripted({ status: 200, url: landed, headers: new Headers(), text: async () => 'index' });
    const outcome = await readPage(URL_A, { fetchImpl });
    assert.equal(outcome.finalUrl, landed);
    assert.equal(calls[0].init.redirect, 'follow');
    assert.equal(redirectedAway(URL_A, outcome.finalUrl), true);
  });
});

describe('a 429 slows the run instead of losing the page', () => {
  it('waits the Retry-After the source asked for, then reads', async () => {
    const waits = [];
    const { fetchImpl, calls } = scripted(status(429, { 'retry-after': '3' }), ok('page'));
    const outcome = await readPage(URL_A, { fetchImpl, retries: 2, sleep: async (ms) => waits.push(ms) });
    assert.equal(outcome.kind, 'read');
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [3000]);
  });

  it('backs off exponentially when the source states no wait', async () => {
    const waits = [];
    const { fetchImpl } = scripted(status(502), status(502), ok('page'));
    const outcome = await readPage(URL_A, { fetchImpl, retries: 2, baseDelayMs: 100, sleep: async (ms) => waits.push(ms) });
    assert.equal(outcome.kind, 'read');
    assert.deepEqual(waits, [100, 200]);
  });

  // An hour-long Retry-After is honoured by giving up and saying so, not by a run that sits silent
  // for an hour. The page keeps its committed reading either way.
  it('refuses to sleep past its cap and reports why', async () => {
    const waits = [];
    const { fetchImpl, calls } = scripted(status(429, { 'retry-after': '3600' }));
    const outcome = await readPage(URL_A, { fetchImpl, retries: 2, maxRetryAfterMs: 60_000, sleep: async (ms) => waits.push(ms) });
    assert.deepEqual([outcome.kind, outcome.status], ['http_failure', 429]);
    assert.match(outcome.reason, /asked for 3600 s/);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it('reads Retry-After as seconds or as a date, and absence as nothing', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    assert.equal(parseRetryAfter('120', now), 120_000);
    assert.equal(parseRetryAfter('Fri, 25 Sep 2026 12:00:30 GMT', now), 30_000);
    assert.equal(parseRetryAfter('Fri, 25 Sep 2026 11:00:00 GMT', now), 0, 'a date in the past means now, not a negative wait');
    // Absence must not become zero: "no header" is not "retry immediately".
    assert.equal(parseRetryAfter(null, now), null);
    assert.equal(parseRetryAfter('', now), null);
    assert.equal(parseRetryAfter('soon', now), null);
  });
});

describe('one pool per run caps what a crawl puts on a publisher', () => {
  // The consumption crawler ran six workers against auto-data with no delay at all; the luxury crawler
  // capped itself at sixteen Parkers requests only by arithmetic in a comment.
  it('never has more than the cap in flight to one host', async () => {
    const pool = createHostPool({ maxPerHost: 2, minIntervalMs: 0 });
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ok('page');
    };
    const outcomes = await Promise.all(Array.from({ length: 7 }, () => readPage(URL_A, { fetchImpl, pool })));
    assert.ok(outcomes.every((outcome) => outcome.kind === 'read'));
    assert.equal(peak, 2);
    assert.equal(pool.inFlight(URL_A), 0, 'every slot is returned');
  });

  it('keeps hosts independent', async () => {
    const pool = createHostPool({ maxPerHost: 1, minIntervalMs: 0 });
    const releaseA = await pool.acquire('https://www.parkers.co.uk/a');
    // A second publisher must not queue behind the first one's slot.
    const releaseB = await pool.acquire('https://www.whatcar.com/b');
    assert.equal(pool.inFlight('https://www.parkers.co.uk/'), 1);
    assert.equal(pool.inFlight('https://www.whatcar.com/'), 1);
    releaseA();
    releaseB();
  });

  it('spaces the starts of requests to one host', async () => {
    let clock = 0;
    const waits = [];
    const pool = createHostPool({
      maxPerHost: 4,
      minIntervalMs: 250,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    for (let index = 0; index < 3; index += 1) (await pool.acquire(URL_A))();
    assert.deepEqual(waits, [250, 500]);
  });

  // A Retry-After is about the host, not the one request that received it. Without deferring the
  // host, the other workers keep asking and earn 429s of their own.
  it('defers every request to a host that asked for a wait', async () => {
    let clock = 1_000;
    const waits = [];
    const pool = createHostPool({ maxPerHost: 4, minIntervalMs: 0, now: () => clock, sleep: async (ms) => waits.push(ms) });
    pool.defer(URL_A, 5_000);
    (await pool.acquire(URL_A))();
    (await pool.acquire('https://www.whatcar.com/x'))();
    assert.deepEqual(waits, [5_000], 'only the host that asked is deferred');
  });
});

describe('createPageReader', () => {
  it('shares one configuration across a run and lets a call override it', async () => {
    const { fetchImpl, calls } = scripted(status(503), ok('page'));
    const read = createPageReader({ fetchImpl, retries: 0, userAgent: 'whichrepo-test' });
    assert.equal((await read(URL_A)).kind, 'http_failure');
    assert.equal((await read(URL_A, { retries: 1, sleep: noSleep })).kind, 'read');
    assert.equal(calls[0].init.headers['user-agent'], 'whichrepo-test');
  });

  // The Euro NCAP reader has always sent no User-Agent of its own. Changing the header a publisher
  // sees can change what it serves, so it is not changed by moving the transport.
  it('sends no User-Agent when asked not to', async () => {
    const { fetchImpl, calls } = scripted(ok('page'));
    await createPageReader({ fetchImpl, userAgent: null })(URL_A);
    assert.equal(calls[0].init.headers['user-agent'], undefined);
  });
});

describe('what a failure is called', () => {
  it('names the kind, the status and the reason in one vocabulary', () => {
    assert.equal(describeFailure({ kind: 'withdrawn', status: 410 }), 'withdrawn by the source (HTTP 410)');
    assert.equal(describeFailure({ kind: 'http_failure', status: 503, reason: 'HTTP 503' }), 'HTTP 503');
    assert.equal(describeFailure({ kind: 'http_failure', status: 0, reason: 'timed out after 30000 ms' }), 'no response (timed out after 30000 ms)');
  });

  // A trailing slash or a www. prefix is the same page; a different path is a different document.
  it('does not mistake a normalised address for a redirect away', () => {
    assert.equal(redirectedAway(URL_A, URL_A.replace(/\/$/, '')), false);
    assert.equal(redirectedAway(URL_A, URL_A.replace('www.', '')), false);
    assert.equal(redirectedAway(URL_A, 'https://www.parkers.co.uk/skoda/kodiaq/'), true);
    assert.equal(redirectedAway(URL_A, ''), false);
  });
});
