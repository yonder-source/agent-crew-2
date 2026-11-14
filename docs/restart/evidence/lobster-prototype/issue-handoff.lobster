name: synthetic-issue-to-agent
steps:
  - id: issue
    command: node /probe-state/workspace/synthetic-issue.mjs
  - id: coding
    pipeline: openclaw.agent --agent main --session-key agent:main:crew-probe:issue-47 --prompt 'Implement the attached issue' --timeout 25
    stdin: $issue.stdout
  - id: report
    command: node /probe-state/workspace/agent-result.mjs
    stdin: $coding.stdout
