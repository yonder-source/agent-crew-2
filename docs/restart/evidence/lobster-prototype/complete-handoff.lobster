name: synthetic-complete-handoff
steps:
  - id: issue
    command: node /probe-state/workspace/controller-call.mjs issue
  - id: coding
    pipeline: openclaw.agent --agent main --session-key agent:main:crew-probe:issue-47 --prompt 'Implement the attached issue' --timeout 25
    stdin: $issue.stdout
  - id: publish
    command: node /probe-state/workspace/controller-call.mjs publish
    stdin: $coding.stdout
