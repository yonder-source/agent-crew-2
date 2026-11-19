export function parseConfig(value) {
  if (typeof value !== "object" || value === null || !("environment" in value)) {
    throw new Error("Agent Crew configuration requires an environment name.");
  }
  const environment = value.environment;
  if (typeof environment !== "string" || environment.trim().length === 0) {
    throw new Error("Agent Crew configuration requires a non-empty environment name.");
  }
  const config = { environment: environment.trim() };
  if (value.github === undefined) return config;
  const github = value.github;
  if (typeof github !== "object" || github === null || Array.isArray(github)) {
    throw new Error("Agent Crew GitHub configuration is invalid.");
  }
  const repository = github.repository;
  const pollIntervalMs = github.pollIntervalMs ?? 60_000;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      typeof pollIntervalMs !== "number" || !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < 10_000 || pollIntervalMs > 3_600_000) {
    throw new Error("Agent Crew GitHub configuration is invalid.");
  }
  return { ...config, github: { repository: repository.toLowerCase(), pollIntervalMs } };
}
