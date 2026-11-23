export function parseSlackSettings(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "coding" && key !== "designer")) {
    throw new Error("Slack settings are invalid.");
  }
  const settings = {};
  for (const role of ["coding", "designer"]) {
    const entry = value[role];
    if (entry === undefined) continue;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) ||
        Object.keys(entry).some((key) => !["agentId", "channelId", "userIds"].includes(key)) ||
        typeof entry.agentId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(entry.agentId) ||
        typeof entry.channelId !== "string" || !/^[CG][A-Z0-9]+$/.test(entry.channelId) ||
        !Array.isArray(entry.userIds) || entry.userIds.length === 0 || entry.userIds.length > 100 ||
        entry.userIds.some((id) => typeof id !== "string" || !/^[UW][A-Z0-9]+$/.test(id))) {
      throw new Error("Slack settings require an agent, channel ID and authorized user IDs.");
    }
    settings[role] = { agentId: entry.agentId, channelId: entry.channelId, userIds: [...new Set(entry.userIds)].sort() };
  }
  return settings;
}

export function parseConfig(value) {
  if (typeof value !== "object" || value === null || !("environment" in value)) {
    throw new Error("Agent Crew configuration requires an environment name.");
  }
  const environment = value.environment;
  if (typeof environment !== "string" || environment.trim().length === 0) {
    throw new Error("Agent Crew configuration requires a non-empty environment name.");
  }
  const config = { environment: environment.trim(),
    ...(value.slack === undefined ? {} : { slack: parseSlackSettings(value.slack) }) };
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
  const result = { ...config, github: { repository: repository.toLowerCase(), pollIntervalMs } };
  if (github.appId !== undefined || github.installationId !== undefined) {
    if (typeof github.appId !== "string" || !/^[1-9][0-9]{0,15}$/.test(github.appId) ||
        typeof github.installationId !== "number" || !Number.isSafeInteger(github.installationId) || github.installationId < 1) {
      throw new Error("GitHub App ID and installation ID must be configured together.");
    }
    result.github = { ...result.github, appId: github.appId, installationId: github.installationId };
  }
  if (value.coding !== undefined) {
    const coding = value.coding;
    if (typeof coding !== "object" || coding === null || Array.isArray(coding)) {
      throw new Error("Agent Crew coding configuration is invalid.");
    }
    const agentId = coding.agentId ?? "coding";
    if (typeof agentId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(agentId) ||
        (coding.tokenBudget !== undefined && (typeof coding.tokenBudget !== "number" || !Number.isSafeInteger(coding.tokenBudget) || coding.tokenBudget < 1)) ||
        typeof coding.repositoryPath !== "string" || !coding.repositoryPath.startsWith("/")) {
      throw new Error("Agent Crew coding configuration is invalid.");
    }
    return { ...result, coding: { agentId, repositoryPath: coding.repositoryPath, ...(coding.tokenBudget === undefined ? {} : { tokenBudget: coding.tokenBudget }) } };
  }
  if (result.github) throw new Error("Agent Crew coding configuration is required when GitHub discovery is enabled.");
  return result;
}
