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
    pipeline: openclaw.agent --agent "$LOBSTER_ARG_AGENT_ID" --session-key "$LOBSTER_ARG_SESSION_KEY" --prompt "$LOBSTER_ARG_PROMPT" --timeout "$LOBSTER_ARG_TIMEOUT_SECONDS"
  - id: result
    command: exec --json node /app/extensions/agent-crew/workflows/coding-result.mjs "$LOBSTER_ARG_WORKSPACE_PATH" "$LOBSTER_ARG_WORKSPACE_BRANCH"
    stdin: $coding.stdout
