import { appendFileSync } from 'node:fs';
const stage = process.argv[2];
const output = {
  discover: { issue: 17, revision: 'synthetic-r1', ready: true },
  preview: { question: 'Approve synthetic issue 17 for coding?' },
  implement: { candidate: 'synthetic-commit', checks: 'passed' },
  publish: { pullRequest: 'synthetic-pr-1', status: 'draft' },
}[stage];
if (!output) throw new Error('unknown stage');
appendFileSync('/probe-state/workspace/crew-prototype-events.log', `${stage}\n`);
process.stdout.write(JSON.stringify(output));
