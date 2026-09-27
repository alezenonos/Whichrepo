// The one way a crawler reads a page. #103.
//
// Eight network readers had grown seven transports. Six of them called the global `fetch` with no
// timeout, no retry, no `Retry-After` and no pacing, so one stalled socket hung a worker for ever
// while its siblings kept hammering the publisher, and a single 429 surfaced as the data-loss defects
// filed in #98-#101. The two that were bounded were bounded differently: Euro NCAP retried twice and
// told a 404 apart from a failure; the luxury reader retried four times and returned a 404 in the same
// shape as a socket that never answered, which is how a blip demoted the Jeep Avenger to `rejected`.
// And because every one of them called the global from inside a module-private helper, none of the
// write paths those defects live on could be driven by a test.
//
// So this module owns the transport and nothing else. It never throws, and it answers in one of three
// kinds, which are the repository's recurring pair plus the one fact a crawler may act on:
//
//   read          the source answered 2xx and this is its body. Whether the body *says* anything is
//                 the caller's question -- a 200 carrying a holding page is still a failure to read the
//                 car, and only the parser that knows the page can tell.
//   withdrawn     the source answered 404 or 410. A fact about the publication: the page is gone.
//                 Never retried, because retrying a fact only turns it into a delay.
//   http_failure  we could not read the source -- a timeout, a reset, a 429 that would not clear, a
//                 5xx, a 403. Never a fact about the car, so never a reason to change a reading.
//
// What each crawler *does* with each kind stays in the crawler. Only the transport moved here.
//
// `finalUrl` is reported because a redirect is information. Carwow answers an unknown model with its
// make index, and a retired Parkers trim page can 301 to its range: a 200 at the wrong address is not
// a reading of the right one, and only the caller knows which address it asked for on purpose.

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const READ_DEFAULTS = Object.freeze({
  // Long enough for the slowest page any crawler reads (a Parkers range of 200 trims is read one page
  // at a time, and a What Car? versions listing can take several seconds), short enough that the
  // fifty-minute hang recorded in `refresh-luxury-spec.mjs` cannot recur.
  timeoutMs: 30_000,
  retries: 2,
  // Exponential: 1 s, 2 s, 4 s. A publisher shedding load recovers on the scale of seconds; a
  // crawler that retries at once only adds to the load it is shedding.
  baseDelayMs: 1_000,
  // A `Retry-After` longer than this is not honoured by sleeping. It is reported as a failure, so the
  // page keeps its committed reading and the operator decides whether to come back tomorrow, rather
  // than a run sitting silent for an hour because a header said so.
  maxRetryAfterMs: 120_000,
});

// Transient by definition: the same request may succeed later. Everything else outside 2xx is
// answered once -- a 403 from a bot filter does not clear by asking again three times.
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms) =>
  new Promise((resolve) => {
    // Deliberately *not* unref'd. A crawler whose every worker is waiting out a backoff has nothing
    // else keeping the event loop alive, and an unref'd timer lets Node exit mid-run with the
    // snapshot half-merged in memory and an "unsettled top-level await" in place of a report.
    setTimeout(resolve, ms);
  });

// `Retry-After` is either delta-seconds or an HTTP date. Returns milliseconds, or null when the
// header is absent or says nothing parseable -- absence is not "retry immediately".
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

// A per-host pool: at most `maxPerHost` requests in flight to one publisher, and at least
// `minIntervalMs` between the starts of any two of them. The consumption crawler ran six workers of
// up to 31 pages each against auto-data with no delay at all; the luxury crawler capped itself at
// sixteen concurrent Parkers requests by arithmetic in a comment. One pool shared by every reader in a
// run makes the cap a property of the transport instead of a promise each crawler has to keep.
//
// A 429 or 503 that states `Retry-After` defers the whole host, not just the request that received
// it. Otherwise the other workers keep asking and earn their own 429s -- the run slows down, which is
// the point, instead of losing pages.
export function createHostPool({
  maxPerHost = 4,
  minIntervalMs = 250,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  const hosts = new Map();
  const stateFor = (host) => {
    if (!hosts.has(host)) hosts.set(host, { active: 0, queue: [], nextStart: 0 });
    return hosts.get(host);
  };
  return {
    async acquire(url) {
      const state = stateFor(hostOf(url));
      // A released slot is handed straight to the next waiter rather than returned to the count and
      // re-competed for, so a burst of arrivals cannot overtake a request already queued.
      if (state.active < maxPerHost) state.active += 1;
      else await new Promise((resolve) => state.queue.push(resolve));
      const start = Math.max(now(), state.nextStart);
      state.nextStart = start + minIntervalMs;
      const wait = start - now();
      if (wait > 0) await sleep(wait);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = state.queue.shift();
        if (next) next();
        else state.active -= 1;
      };
    },
    defer(url, ms) {
      const state = stateFor(hostOf(url));
      state.nextStart = Math.max(state.nextStart, now() + ms);
    },
    // For tests and for a crawler's end-of-run report: how busy each host is right now.
    inFlight(url) {
      return stateFor(hostOf(url)).active;
    },
  };
}

// One bounded attempt. The deadline covers the headers *and* the body: a server that answers
// promptly and then trickles the body is the stall a headers-only timeout does not catch. The timer
// is a plain ref'd timeout, cleared on every path, for the reason `defaultSleep` gives -- and it is
// raced as well as wired to the signal, so a `fetchImpl` that ignores its signal is bounded too.
async function attempt(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`timed out after ${timeoutMs} ms`);
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        const status = Number(response?.status);
        // Only a 2xx body is read. A 404 or a 503 page is not evidence of anything but its status,
        // and reading a large error page is time spent inside the deadline for nothing.
        // The unread body is cancelled rather than left for the collector, or a keep-alive socket
        // stays pinned to it for the rest of the run.
        const html = status >= 200 && status < 300 ? await response.text() : null;
        if (html === null) await response?.body?.cancel?.().catch(() => {});
        return { response, status, html };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readPage(url, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = READ_DEFAULTS.timeoutMs,
    retries = READ_DEFAULTS.retries,
    baseDelayMs = READ_DEFAULTS.baseDelayMs,
    maxRetryAfterMs = READ_DEFAULTS.maxRetryAfterMs,
    userAgent = USER_AGENT,
    headers = {},
    sleep = defaultSleep,
    pool = null,
    now = Date.now,
  } = options;
  // `null` means "send no User-Agent of our own", which is what the Euro NCAP reader has always done;
  // changing the header a publisher sees is a change in what it may serve, so it is not made silently.
  const init = {
    headers: { ...(userAgent ? { 'user-agent': userAgent } : {}), ...headers },
    redirect: 'follow',
  };
  let failure = { kind: 'http_failure', url, status: 0, reason: 'not attempted', finalUrl: url, attempts: 0 };
  let delay = 0;
  for (let index = 0; index <= retries; index += 1) {
    if (index) await sleep(delay);
    const release = pool ? await pool.acquire(url) : () => {};
    let outcome;
    try {
      outcome = await attempt(url, init, fetchImpl, timeoutMs);
    } catch (error) {
      release();
      // Status 0 is "no HTTP answer at all": a timeout, a reset, a DNS failure. It is never a 404.
      failure = {
        kind: 'http_failure',
        url,
        status: 0,
        reason: String(error?.message ?? error),
        finalUrl: url,
        attempts: index + 1,
      };
      delay = baseDelayMs * 2 ** index;
      continue;
    }
    release();
    const { response, status, html } = outcome;
    const finalUrl = response?.url || url;
    if (status === 404 || status === 410)
      return { kind: 'withdrawn', url, status, finalUrl, attempts: index + 1 };
    if (status >= 200 && status < 300) {
      return {
        kind: 'read',
        url,
        status,
        html: String(html ?? ''),
        finalUrl,
        contentType: response?.headers?.get?.('content-type') ?? null,
        attempts: index + 1,
      };
    }
    failure = { kind: 'http_failure', url, status, reason: `HTTP ${status}`, finalUrl, attempts: index + 1 };
    if (!RETRYABLE.has(status)) return failure;
    const asked =
      status === 429 || status === 503
        ? parseRetryAfter(response?.headers?.get?.('retry-after'), now())
        : null;
    if (asked !== null) {
      if (asked > maxRetryAfterMs) {
        return {
          ...failure,
          reason: `HTTP ${status}; the source asked for ${Math.ceil(asked / 1000)} s before retrying, longer than the ${Math.ceil(maxRetryAfterMs / 1000)} s this reader will wait`,
        };
      }
      pool?.defer?.(url, asked);
      delay = asked;
    } else {
      delay = baseDelayMs * 2 ** index;
    }
  }
  return failure;
}

// One reader per run: the options are fixed once and the pool is shared by every request the run
// makes, which is what makes the per-host cap mean anything.
//
// Pacing is on by default only against the real network. It exists to be polite to a publisher; a
// test serving pages from memory would only be made slower by it, and the orchestration tests that
// replay the whole committed catalogue would take minutes. A test that wants to exercise the pool
// passes `pacing` explicitly.
export const DEFAULT_PACING = Object.freeze({ maxPerHost: 4, minIntervalMs: 250 });

export function createPageReader(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    pacing = fetchImpl === globalThis.fetch ? DEFAULT_PACING : null,
    ...rest
  } = options;
  const pool = pacing
    ? createHostPool({
        ...pacing,
        ...(rest.sleep ? { sleep: rest.sleep } : {}),
        ...(rest.now ? { now: rest.now } : {}),
      })
    : null;
  return (url, overrides = {}) => readPage(url, { fetchImpl, pool, ...rest, ...overrides });
}

// The message a crawler prints for an outcome that is not a reading. One wording across every crawler
// so the operator reads one vocabulary: which kind, which status, why.
export function describeFailure(outcome) {
  if (!outcome) return 'not attempted';
  if (outcome.kind === 'withdrawn') return `withdrawn by the source (HTTP ${outcome.status})`;
  if (outcome.kind === 'http_failure')
    return outcome.status ? (outcome.reason ?? `HTTP ${outcome.status}`) : `no response (${outcome.reason})`;
  return outcome.kind;
}

// Whether a redirect landed somewhere other than where the caller asked. Trailing slashes, the
// scheme and letter case of the host are not a different page; a different path is. The query string
// is ignored because every crawler here addresses pages by path.
export function redirectedAway(requestedUrl, finalUrl) {
  if (!finalUrl || finalUrl === requestedUrl) return false;
  try {
    const a = new URL(requestedUrl);
    const b = new URL(finalUrl);
    const path = (value) => value.pathname.replace(/\/+$/, '').toLowerCase();
    return (
      a.host.toLowerCase().replace(/^www\./, '') !== b.host.toLowerCase().replace(/^www\./, '') ||
      path(a) !== path(b)
    );
  } catch {
    return requestedUrl !== finalUrl;
  }
}
