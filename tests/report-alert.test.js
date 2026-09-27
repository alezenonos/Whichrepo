import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertBody, reportAlert } from '../node/report-alert.mjs';

const context = { serverUrl: 'https://github.com', repo: { owner: 'o', repo: 'r' }, runId: 42 };

// A stand-in for the Octokit client github-script passes, recording every call.
function stubGithub(openIssues = []) {
  const calls = [];
  const record = (name, result = {}) => async (args) => {
    calls.push([name, args]);
    if (name === 'createLabel' && args.name === 'exists') throw Object.assign(new Error('exists'), { status: 422 });
    return result;
  };
  return {
    calls,
    rest: {
      issues: {
        listForRepo: record('listForRepo', { data: openIssues }),
        createComment: record('createComment'),
        update: record('update'),
        createLabel: record('createLabel'),
        create: record('create', { data: { number: 7 } }),
      },
    },
  };
}

const names = (github) => github.calls.map(([name]) => name);

// #140. Three workflows opened alert issues and none ever closed one. #95 ("A source canary cannot
// read its page") stayed open a week after its cause was fixed on 19 September, and the copies of the
// logic had drifted: the canary replaced the issue body each week, losing the history, while the
// other two commented. These are the four cases the one shared behaviour has to get right.
describe('an alert issue follows its condition', () => {
  const base = { context, label: 'site-down', title: 'Deployed site is not serving correctly', report: 'FAIL homepage' };

  it('creates one issue, labelled, when a check starts failing', async () => {
    const github = stubGithub([]);
    const result = await reportAlert({ ...base, github, failing: true });
    assert.deepEqual(result, { action: 'created', number: 7 });
    assert.deepEqual(names(github), ['listForRepo', 'createLabel', 'create']);
    const [, created] = github.calls.at(-1);
    assert.deepEqual(created.labels, ['site-down']);
    assert.match(created.body, /FAIL homepage/);
    assert.match(created.body, /actions\/runs\/42/);
  });

  it('comments on the open issue rather than opening a second one, and never rewrites its body', async () => {
    const github = stubGithub([{ number: 95 }]);
    const result = await reportAlert({ ...base, github, failing: true });
    assert.deepEqual(result, { action: 'commented', number: 95 });
    assert.deepEqual(names(github), ['listForRepo', 'createComment']);
  });

  it('comments and closes the open issue as completed on the first passing run', async () => {
    const github = stubGithub([{ number: 95 }]);
    const result = await reportAlert({ ...base, github, failing: false, now: new Date('2026-09-28T07:00:00Z') });
    assert.deepEqual(result, { action: 'closed', number: 95 });
    const [, comment] = github.calls.find(([name]) => name === 'createComment');
    assert.match(comment.body, /^Recovered on 2026-09-28/);
    const [, update] = github.calls.find(([name]) => name === 'update');
    assert.deepEqual({ state: update.state, state_reason: update.state_reason }, { state: 'closed', state_reason: 'completed' });
  });

  it('does nothing when the check passes and nothing is open', async () => {
    const github = stubGithub([]);
    assert.deepEqual(await reportAlert({ ...base, github, failing: false }), { action: 'none' });
    assert.deepEqual(names(github), ['listForRepo']);
  });

  it('ignores a pull request that happens to carry the label', async () => {
    const github = stubGithub([{ number: 3, pull_request: {} }]);
    assert.deepEqual(await reportAlert({ ...base, github, failing: false }), { action: 'none' });
  });

  it('tolerates a label that already exists, and fails loudly on any other labelling error', async () => {
    const github = stubGithub([]);
    const result = await reportAlert({ ...base, label: 'exists', github, failing: true });
    assert.equal(result.action, 'created');
    const broken = stubGithub([]);
    broken.rest.issues.createLabel = async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    };
    await assert.rejects(reportAlert({ ...base, github: broken, failing: true }), /forbidden/);
  });
});

describe('the alert body', () => {
  it('fences the report, keeps the advice and links the run', () => {
    const body = alertBody({ summary: 'Something broke.', report: '  out  ', advice: ['Do this.'], context });
    assert.equal(body, 'Something broke.\n\n```\nout\n```\n\nDo this.\n\nRun: https://github.com/o/r/actions/runs/42');
  });
});
