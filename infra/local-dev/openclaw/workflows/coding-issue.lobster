name: assigned-issue-coding
args:
  agentId:
    default: "coding"
  sessionKey:
    default: ""
  workspacePath:
    default: ""
  workspaceBranch:
    default: ""
  prompt:
    default: ""
  timeoutSeconds:
    default: "1200"
steps:
  - id: coding
    command: >-
      "${LOBSTER_OPENCLAW_BIN:-openclaw}" agent --json --agent "$LOBSTER_ARG_AGENTID" --session-key "$LOBSTER_ARG_SESSIONKEY" --message "$LOBSTER_ARG_PROMPT" --timeout "$LOBSTER_ARG_TIMEOUTSECONDS"
  - id: result
    command: node /app/extensions/agent-crew/workflows/coding-result.mjs "$LOBSTER_ARG_WORKSPACEPATH" "$LOBSTER_ARG_WORKSPACEBRANCH"
    stdin: $coding.stdout
