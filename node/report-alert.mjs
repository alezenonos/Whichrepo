// One alert issue per condition, opened when it starts failing and closed when it stops.
//
// #140. Three scheduled workflows each carried their own copy of this logic, and the copies had
// drifted: the canary matched on exact title over every issue and replaced the body (so a week's
// history was lost, and a retitled issue produced a duplicate), while freshness and uptime matched on
// label over open issues and commented. None of them ever closed anything. #95 stayed open for a week
// after the failure it reported was fixed, so the next real failure would have been a comment on a
// stale thread that everybody had learned to ignore.
//
// One behaviour now, for every caller: match the open issue by label; while failing, comment on it
// or create it; on the first passing run, comment once and close it. An issue closed by hand while
// the condition persists is reopened as a new issue by the next failing run, which is right: the
// condition is still true.
//
// Called from actions/github-script, which passes its authenticated `github` client and `context`:
//
//   const { reportAlert } = await import(`${process.env.GITHUB_WORKSPACE}/scripts/report-alert.mjs`);
//   await reportAlert({ github, context, label, title, summary, report, failing });

export function runUrl(context) {
  return `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
}

export function alertBody({ summary = [], report = '', advice = [], context }) {
  const lines = [...[summary].flat()];
  if (String(report).trim()) lines.push('', '```', String(report).trim(), '```');
  if ([advice].flat().length) lines.push('', ...[advice].flat());
  if (context) lines.push('', `Run: ${runUrl(context)}`);
  return lines.join('\n');
}

// Returns what it did, so a workflow log says so and the tests can assert it.
export async function reportAlert({
  github,
  context,
  label,
  title,
  summary,
  report,
  advice,
  failing,
  labelColor = 'B60205',
  labelDescription = 'Raised by a scheduled check; closed automatically when it passes again',
  now = new Date(),
}) {
  if (!label || !title) throw new Error('reportAlert needs a label and a title');
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const open = await github.rest.issues.listForRepo({ ...repo, state: 'open', labels: label, per_page: 10 });
  // Pull requests come back from the issues endpoint too; an alert is never one.
  const existing = open.data.find((issue) => !issue.pull_request);
  const date = now.toISOString().slice(0, 10);

  if (!failing) {
    if (!existing) return { action: 'none' };
    await github.rest.issues.createComment({
      ...repo,
      issue_number: existing.number,
      body: `Recovered on ${date}: the check passed again.\n\nRun: ${runUrl(context)}`,
    });
    await github.rest.issues.update({
      ...repo,
      issue_number: existing.number,
      state: 'closed',
      state_reason: 'completed',
    });
    return { action: 'closed', number: existing.number };
  }

  const body = alertBody({ summary, report, advice, context });
  if (existing) {
    await github.rest.issues.createComment({
      ...repo,
      issue_number: existing.number,
      body: `Still failing as of ${date}.\n\n${body}`,
    });
    return { action: 'commented', number: existing.number };
  }

  // The label may not exist on a fresh repository, and createLabel answers 422 when it already does.
  // Created first and tolerated, so the issue is never lost to a labelling error.
  try {
    await github.rest.issues.createLabel({
      ...repo,
      name: label,
      color: labelColor,
      description: labelDescription,
    });
  } catch (error) {
    if (error?.status !== 422) throw error;
  }
  const created = await github.rest.issues.create({ ...repo, title, labels: [label], body });
  return { action: 'created', number: created.data.number };
}
