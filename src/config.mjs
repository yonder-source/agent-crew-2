export function parseConfig(value) {
  if (typeof value !== "object" || value === null || !("environment" in value)) {
    throw new Error("Agent Crew configuration requires an environment name.");
  }
  const environment = value.environment;
  if (typeof environment !== "string" || environment.trim().length === 0) {
    throw new Error("Agent Crew configuration requires a non-empty environment name.");
  }
  return { environment: environment.trim() };
}
