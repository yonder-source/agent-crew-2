import type { SlackSettings } from "./slack-settings.js";

export type CrewConfig = {
  environment: string;
  slack?: SlackSettings;
  github?: { repository: string; pollIntervalMs: number; appId?: string; installationId?: number };
  coding?: { agentId: string; repositoryPath: string; tokenBudget?: number };
};
export function parseConfig(value: unknown): CrewConfig;
export function parseSlackSettings(value: unknown): SlackSettings;
