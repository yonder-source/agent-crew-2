import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig } from "./config.mjs";

export default definePluginEntry({
  id: "agent-crew",
  name: "Agent Crew",
  description: "Agent Crew status and session metadata integration",
  register(api) {
    const config = parseConfig(api.pluginConfig);
    api.session.state.registerSessionExtension({
      namespace: "agent-crew-job",
      description: "Synthetic Agent Crew session metadata",
    });
    api.registerTool({
      name: "agent_crew_status",
      label: "Agent Crew status",
      description: "Read Agent Crew plugin status",
      parameters: Type.Object({}, { additionalProperties: false }),
      outputSchema: Type.Object({
        status: Type.String(),
        environment: Type.String(),
      }, { additionalProperties: false }),
      async execute() {
        const details = { status: "ready", environment: config.environment };
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      },
    });
  },
});
