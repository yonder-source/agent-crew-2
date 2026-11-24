name: retained-delivery-publication
args:
  sessionKey:
    default: ""
  agentId:
    default: "coding"
steps:
  - id: publication
    command: >-
      node /app/extensions/agent-crew/scripts/publication-call.mjs "$LOBSTER_ARG_SESSIONKEY" "$LOBSTER_ARG_AGENTID"
