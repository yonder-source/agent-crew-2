import { createSign } from "node:crypto";

export type AccessibleRepository = {
  repository: string;
  installationId: number;
  installationAccount: string;
};

type GitHubAppClientOptions = {
  readPrivateKey: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type Installation = { id: number; account: { login: string }; permissions: Record<string, string> };
type Repository = { id: number; full_name: string; default_branch: string };

export class GitHubAppError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GitHubAppError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function parseAppId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) {
    throw new GitHubAppError("GITHUB_APP_ID_INVALID", "GitHub App ID must be a positive integer.");
  }
  return value;
}

function parseInstallation(value: unknown): Installation {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1 ||
      !isRecord(value.account) || typeof value.account.login !== "string") {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid installation.");
  }
  const permissions: Record<string, string> = {};
  if (isRecord(value.permissions)) {
    for (const [name, level] of Object.entries(value.permissions)) {
      if (typeof level === "string") permissions[name] = level;
    }
  }
  return { id: Number(value.id), account: { login: value.account.login }, permissions };
}

function parseRepository(value: unknown): Repository {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1 ||
      typeof value.full_name !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.full_name) ||
      typeof value.default_branch !== "string" || !value.default_branch) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid repository.");
  }
  return { id: Number(value.id), full_name: value.full_name.toLowerCase(), default_branch: value.default_branch };
}

async function readJson(response: Response, maximumBytes = 1_000_000): Promise<unknown> {
  if (!response.body) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new GitHubAppError("GITHUB_RESPONSE_TOO_LARGE", "GitHub App response exceeded its size limit.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned invalid JSON.");
  }
}

export class GitHubAppClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitHubAppClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listAccessibleRepositories(appIdValue: unknown): Promise<AccessibleRepository[]> {
    const appId = parseAppId(appIdValue);
    const jwt = await this.createJwt(appId);
    const installations = await this.listPages<Installation>("/app/installations", jwt, parseInstallation);
    if (installations.length > 100) {
      throw new GitHubAppError("GITHUB_INSTALLATION_LIMIT", "GitHub App has more installations than this setup page can enumerate.");
    }
    const result: AccessibleRepository[] = [];
    for (const installation of installations) {
      const token = await this.createInstallationToken(installation.id, jwt);
      const repositories = await this.listPages<Repository>("/installation/repositories", token, parseRepository);
      for (const repository of repositories) {
        result.push({
          repository: repository.full_name,
          installationId: installation.id,
          installationAccount: installation.account.login,
        });
        if (result.length > 10_000) {
          throw new GitHubAppError("GITHUB_REPOSITORY_LIMIT", "GitHub App has more repositories than this setup page can enumerate.");
        }
      }
    }
    return result.sort((left, right) => left.repository.localeCompare(right.repository) || left.installationId - right.installationId);
  }

  async installationTokenForRepository(
    appIdValue: unknown,
    installationId: unknown,
    repositoryValue: unknown,
  ): Promise<string> {
    const selected = await this.resolveRepository(appIdValue, installationId, repositoryValue);
    return this.createInstallationToken(selected.installation.id, selected.jwt, selected.repository.id);
  }

  async repositoryAccess(appId: unknown, installationId: unknown, repository: unknown): Promise<{
    repository: string; permissions: Record<string, string>;
  }> {
    const selected = await this.resolveRepository(appId, installationId, repository);
    return { repository: selected.repository.full_name, permissions: selected.installation.permissions };
  }

  private async resolveRepository(appIdValue: unknown, installationId: unknown, repositoryValue: unknown): Promise<{
    jwt: string; installation: Installation; repository: Repository;
  }> {
    const appId = parseAppId(appIdValue);
    if (typeof installationId !== "number" || !Number.isSafeInteger(installationId) || installationId < 1 ||
        typeof repositoryValue !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryValue)) {
      throw new GitHubAppError("GITHUB_CONFIGURATION_INVALID", "Repository selection is invalid.");
    }
    const selectedInstallationId = installationId;
    const jwt = await this.createJwt(appId);
    const installations = await this.listPages<Installation>("/app/installations", jwt, parseInstallation);
    const installation = installations.find((item) => item.id === selectedInstallationId);
    if (!installation) {
      throw new GitHubAppError("GITHUB_INSTALLATION_INVALID", "The selected installation is not available to this GitHub App.");
    }
    const token = await this.createInstallationToken(selectedInstallationId, jwt);
    const repositories = await this.listPages<Repository>("/installation/repositories", token, parseRepository);
    const selected = repositories.find((repository) => repository.full_name === repositoryValue.toLowerCase());
    if (!selected) throw new GitHubAppError("GITHUB_REPOSITORY_INACCESSIBLE", "The selected repository is not accessible to this installation.");
    return { jwt, installation, repository: selected };
  }

  private async createJwt(appId: string): Promise<string> {
    let privateKey: string;
    try {
      privateKey = await this.options.readPrivateKey();
    } catch {
      throw new GitHubAppError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub App private key is unavailable.");
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: appId }));
    const input = `${header}.${payload}`;
    try {
      const signer = createSign("RSA-SHA256");
      signer.update(input);
      signer.end();
      return `${input}.${signer.sign(privateKey).toString("base64url")}`;
    } catch {
      throw new GitHubAppError("GITHUB_CREDENTIAL_INVALID", "GitHub App private key could not be used.");
    }
  }

  private async createInstallationToken(installationId: number, jwt: string, repositoryId?: number): Promise<string> {
    const body = repositoryId === undefined
      ? { permissions: { contents: "read" } }
      : { repository_ids: [repositoryId], permissions: { contents: "read" } };
    const value = await this.request(`/app/installations/${installationId}/access_tokens`, jwt, "POST", body);
    if (!isRecord(value) || typeof value.token !== "string" || !value.token || typeof value.expires_at !== "string") {
      throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid installation token response.");
    }
    return value.token;
  }

  private async listPages<T>(path: string, token: string, parse: (value: unknown) => T): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const value = await this.request(`${path}?per_page=100&page=${page}`, token, "GET");
      const items = path === "/installation/repositories" && isRecord(value) ? value.repositories : value;
      if (!Array.isArray(items)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid list response.");
      result.push(...items.map(parse));
      if (items.length < 100) return result;
    }
    throw new GitHubAppError("GITHUB_PAGE_LIMIT", "GitHub App results exceeded the page limit.");
  }

  private async request(path: string, token: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    if (!/^\/(?:app\/installations(?:\?per_page=100&page=[1-9][0-9]*)?|app\/installations\/[1-9][0-9]*\/access_tokens|installation\/repositories\?per_page=100&page=[1-9][0-9]*)$/.test(path)) {
      throw new GitHubAppError("GITHUB_REQUEST_BLOCKED", "GitHub App request path was rejected.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GitHubAppError("GITHUB_REQUEST_REJECTED", "GitHub App request failed; check the App ID, installation and permissions.");
      }
      return readJson(response);
    } catch (error) {
      if (error instanceof GitHubAppError) throw error;
      throw new GitHubAppError("GITHUB_REQUEST_FAILED", "GitHub App request failed or timed out.");
    } finally {
      clearTimeout(timer);
    }
  }
}
