export type CrewConfig = {
  environment: string;
  github?: { repository: string; pollIntervalMs: number };
};
export function parseConfig(value: unknown): CrewConfig;
