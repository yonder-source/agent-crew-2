name: synthetic-agent-handoff
steps:
  - id: coding
    pipeline: openclaw.agent --agent main --session-key agent:main:crew-probe:issue-23 --prompt 'Implement synthetic issue 23 and report result' --timeout 25
  - id: report
    command: node /probe-state/workspace/agent-result.mjs
    stdin: $coding.stdout
