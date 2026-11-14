name: crew-feasibility
steps:
  - id: discover
    command: node /probe-state/workspace/crew-prototype.mjs discover
  - id: approval
    command: node /probe-state/workspace/crew-prototype.mjs preview
    approval: required
  - id: implement
    command: node /probe-state/workspace/crew-prototype.mjs implement
    condition: $approval.approved
  - id: publish
    command: node /probe-state/workspace/crew-prototype.mjs publish
    condition: $approval.approved
