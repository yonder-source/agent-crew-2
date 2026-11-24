import type { SlackSettings } from "./slack-settings.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function connectionConfig(snapshot: unknown, connection: {
  repository: string; appId: string; installationId: number;
  agentId: string; repositoryPath: string; tokenBudget?: number | undefined; slack?: SlackSettings;
}): { baseHash: string; raw: string } {
  if (!record(snapshot) || typeof snapshot.hash !== "string" || !record(snapshot.config) ||
      !record(snapshot.config.plugins) || !record(snapshot.config.plugins.entries)) {
    throw new Error("Current configuration snapshot is incomplete.");
  }
  const plugins = snapshot.config.plugins;
  const entries = snapshot.config.plugins.entries;
  const entry = entries["agent-crew"];
  if (!record(entry) || !record(entry.config)) throw new Error("Agent Crew configuration is unavailable.");
  const current = entry.config;
  return {
    baseHash: snapshot.hash,
    raw: JSON.stringify({ ...snapshot.config, plugins: { ...plugins, entries: { ...entries,
      "agent-crew": { ...entry, config: { ...current,
        ...(connection.slack === undefined ? {} : { slack: connection.slack }),
        github: { ...(record(current.github) ? current.github : {}), repository: connection.repository,
          appId: connection.appId, installationId: connection.installationId },
        coding: { ...(record(current.coding) ? current.coding : {}), agentId: connection.agentId,
          repositoryPath: connection.repositoryPath, tokenBudget: connection.tokenBudget },
      } },
    } } }),
  };
}
