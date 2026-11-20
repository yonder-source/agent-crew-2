export type CrewConfig = {
  environment: string;
  github?: { repository: string; pollIntervalMs: number; appId?: string; installationId?: number };
  coding?: { agentId: string; repositoryPath: string };
};
export function parseConfig(value: unknown): CrewConfig;
