import { Octokit } from "@octokit/rest";

export type GitHubIssue = {
  repository: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
};

export type GitHubIssueProviderOptions = {
  getInstallationToken: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumPages?: number;
};

export class GitHubIssueError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GitHubIssueError";
  }
}

const READY_LABEL = "ready for agent";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 1_000_000;
const DEFAULT_MAXIMUM_PAGES = 100;

function parseRepository(repository: string): { owner: string; name: string; fullName: string; path: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match) throw new GitHubIssueError("GITHUB_CONFIGURATION_INVALID", "GitHub repository must use owner/name format.");
  const owner = match[1]!.toLowerCase();
  const name = match[2]!.toLowerCase();
  return { owner, name, fullName: `${owner}/${name}`, path: `/repos/${owner}/${name}` };
}

function parseIssue(value: unknown, repository: string): GitHubIssue & { isPullRequest: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubIssueError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid issue.");
  }
  const issue = value as Record<string, unknown>;
  if (!Number.isSafeInteger(issue.number) || Number(issue.number) < 1 || typeof issue.title !== "string" ||
      issue.title.length > 256 || (issue.body !== null && typeof issue.body !== "string") ||
      (typeof issue.body === "string" && issue.body.length > 64_000) ||
      (issue.state !== "open" && issue.state !== "closed") || !Array.isArray(issue.labels)) {
    throw new GitHubIssueError("GITHUB_RESPONSE_INVALID", "GitHub returned an issue with an invalid shape.");
  }
  const labels = issue.labels.map((label: unknown) => {
    if (!label || typeof label !== "object" || Array.isArray(label) || typeof (label as { name?: unknown }).name !== "string") {
      throw new GitHubIssueError("GITHUB_RESPONSE_INVALID", "GitHub returned invalid issue labels.");
    }
    return (label as { name: string }).name;
  });
  return {
    repository,
    number: Number(issue.number),
    title: issue.title,
    body: issue.body as string | null,
    state: issue.state,
    labels,
    isPullRequest: issue.pull_request !== undefined,
  };
}

function requestPathAllowed(repositoryPath: string, url: URL, method: string): boolean {
  if (url.origin !== "https://api.github.com" || url.username || url.password || url.hash) return false;
  const path = url.pathname.split("/");
  const repository = repositoryPath.split("/").filter(Boolean);
  const prefix = ["", ...repository.map((part) => part.toLowerCase()), "issues"];
  if (path.length === prefix.length && path.map((part) => part.toLowerCase()).join("/") === prefix.join("/")) {
    return method === "GET";
  }
  return path.length === prefix.length + 1 &&
    path.slice(0, prefix.length).map((part) => part.toLowerCase()).join("/") === prefix.join("/") &&
    /^[1-9][0-9]*$/.test(path[prefix.length] ?? "") &&
    (method === "GET" || method === "PATCH");
}

async function readBoundedResponse(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<Response> {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const cancelOnAbort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  if (signal?.aborted) cancelOnAbort();
  else signal?.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new GitHubIssueError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the configured size limit.");
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export class OctokitGitHubIssueProvider {
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly maximumPages: number;

  constructor(private readonly options: GitHubIssueProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maximumResponseBytes = options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES;
    this.maximumPages = options.maximumPages ?? DEFAULT_MAXIMUM_PAGES;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000 ||
        !Number.isSafeInteger(this.maximumResponseBytes) || this.maximumResponseBytes < 256 ||
        this.maximumResponseBytes > 16_000_000 || !Number.isSafeInteger(this.maximumPages) ||
        this.maximumPages < 1 || this.maximumPages > 100) {
      throw new GitHubIssueError("GITHUB_CONFIGURATION_INVALID", "GitHub request bounds are invalid.");
    }
  }

  async listReadyIssues(repository: string): Promise<GitHubIssue[]> {
    const target = parseRepository(repository);
    const requestState: { timedOut: boolean; guardFailure?: unknown } = { timedOut: false };
    try {
      const octokit = await this.client(
        target,
        undefined,
        (error) => { requestState.guardFailure = error; },
        undefined,
        () => { requestState.timedOut = true; },
      );
      const issues: GitHubIssue[] = [];
      let pages = 0;
      for await (const page of octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
        owner: target.owner,
        repo: target.name,
        state: "open",
        labels: READY_LABEL,
        per_page: 100,
      })) {
        pages += 1;
        if (pages > this.maximumPages) {
          throw new GitHubIssueError("GITHUB_PAGE_LIMIT", "GitHub issue listing exceeded the page limit.");
        }
        for (const value of page.data) {
          const issue = parseIssue(value, target.fullName);
          if (!issue.isPullRequest && issue.state === "open" && issue.labels.includes(READY_LABEL)) {
            const { isPullRequest: _pullRequest, ...publicIssue } = issue;
            issues.push(publicIssue);
          }
        }
      }
      return issues;
    } catch (error) {
      if (requestState.guardFailure !== undefined) throw requestState.guardFailure;
      if (requestState.timedOut) {
        throw new GitHubIssueError("GITHUB_REQUEST_TIMEOUT", "GitHub issue request exceeded its time limit.");
      }
      throw this.safeError(error, "GITHUB_DISCOVERY_FAILED");
    }
  }

  async readIssue(repository: string, number: number): Promise<GitHubIssue> {
    const target = parseRepository(repository);
    this.validateIssueNumber(number);
    const requestState: { timedOut: boolean; guardFailure?: unknown } = { timedOut: false };
    try {
      const octokit = await this.client(
        target,
        undefined,
        (error) => { requestState.guardFailure = error; },
        undefined,
        () => { requestState.timedOut = true; },
      );
      const { data } = await octokit.rest.issues.get({ owner: target.owner, repo: target.name, issue_number: number });
      const issue = parseIssue(data, target.fullName);
      if (issue.isPullRequest || issue.number !== number) {
        throw new GitHubIssueError("GITHUB_RESPONSE_INVALID", "GitHub returned a different resource than the assigned issue.");
      }
      const { isPullRequest: _pullRequest, ...publicIssue } = issue;
      return publicIssue;
    } catch (error) {
      if (requestState.guardFailure !== undefined) throw requestState.guardFailure;
      if (requestState.timedOut) {
        throw new GitHubIssueError("GITHUB_REQUEST_TIMEOUT", "GitHub issue request exceeded its time limit.");
      }
      throw this.safeError(error, "GITHUB_READ_FAILED");
    }
  }

  async updateIssueBody(
    repository: string,
    number: number,
    body: string,
    beforeDispatch?: () => void,
  ): Promise<GitHubIssue> {
    const target = parseRepository(repository);
    this.validateIssueNumber(number);
    if (typeof body !== "string" || body.length > 64_000) {
      throw new GitHubIssueError("GITHUB_BODY_INVALID", "Issue body must be text no longer than 64 KB.");
    }
    const requestState: { started: boolean; timedOut: boolean; guardFailure?: unknown } = {
      started: false,
      timedOut: false,
    };
    try {
      const octokit = await this.client(target, (url, method) => {
        beforeDispatch?.();
        if (!requestPathAllowed(target.path, url, method)) {
          throw new GitHubIssueError("GITHUB_REQUEST_BLOCKED", "GitHub request was outside the configured repository issue API.");
        }
      }, (error) => { requestState.guardFailure = error; }, () => { requestState.started = true; },
      () => { requestState.timedOut = true; });
      const { data } = await octokit.rest.issues.update({
        owner: target.owner,
        repo: target.name,
        issue_number: number,
        body,
      });
      const issue = parseIssue(data, target.fullName);
      if (issue.isPullRequest || issue.number !== number || issue.body !== body) {
        throw new GitHubIssueError("GITHUB_WRITE_UNCERTAIN", "GitHub issue update needs operator inspection.");
      }
      const { isPullRequest: _pullRequest, ...publicIssue } = issue;
      return publicIssue;
    } catch (error) {
      if (requestState.guardFailure !== undefined) throw requestState.guardFailure;
      if (requestState.timedOut) {
        throw new GitHubIssueError("GITHUB_WRITE_UNCERTAIN", "GitHub issue update outcome is uncertain; inspect the issue before retrying.");
      }
      const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
      if (requestState.started && !(typeof status === "number" && status >= 400 && status < 500)) {
        throw new GitHubIssueError("GITHUB_WRITE_UNCERTAIN", "GitHub issue update outcome is uncertain; inspect the issue before retrying.");
      }
      throw this.safeError(error, "GITHUB_WRITE_UNCERTAIN");
    }
  }

  private async client(
    target: ReturnType<typeof parseRepository>,
    beforeDispatch?: (url: URL, method: string) => void,
    onGuardFailure?: (error: unknown) => void,
    onRequestStart?: () => void,
    onTimeout?: () => void,
  ): Promise<Octokit> {
    let token: string;
    try {
      token = (await this.options.getInstallationToken()).trim();
    } catch {
      throw new GitHubIssueError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub installation credential is unavailable.");
    }
    if (!token) throw new GitHubIssueError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub installation credential is unavailable.");
    const fetcher = this.options.fetcher ?? fetch;
    const scopedFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!requestPathAllowed(target.path, url, method)) {
        const error = new GitHubIssueError("GITHUB_REQUEST_BLOCKED", "GitHub request was outside the configured repository issue API.");
        onGuardFailure?.(error);
        throw error;
      }
      try {
        beforeDispatch?.(url, method);
      } catch (error) {
        onGuardFailure?.(error);
        throw error;
      }
      onRequestStart?.();
      const controller = new AbortController();
      const externalSignal = init?.signal;
      const abortFromCaller = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abortFromCaller();
      else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          controller.abort(new DOMException("GitHub request timed out.", "TimeoutError"));
          reject(new GitHubIssueError("GITHUB_REQUEST_TIMEOUT", "GitHub issue request exceeded its time limit."));
        }, this.timeoutMs);
      });
      try {
        const response = await Promise.race([
          (async () => {
            const result = await fetcher(input, { ...init, signal: controller.signal, redirect: "error", cache: "no-store" });
            return readBoundedResponse(result, this.maximumResponseBytes, controller.signal);
          })(),
          deadline,
        ]);
        return response;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abortFromCaller);
      }
    };
    return new Octokit({
      auth: token,
      request: { timeout: this.timeoutMs, fetch: scopedFetch },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
  }

  private validateIssueNumber(number: number): void {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new GitHubIssueError("GITHUB_ISSUE_INVALID", "Issue number must be a positive integer.");
    }
  }

  private safeError(error: unknown, fallbackCode: string): GitHubIssueError {
    if (error instanceof GitHubIssueError) return error;
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    const code = typeof status === "number" && status >= 400 && status < 500
      ? "GITHUB_REQUEST_REJECTED"
      : fallbackCode;
    const message = code === "GITHUB_WRITE_UNCERTAIN"
      ? "GitHub issue update outcome is uncertain; inspect the issue before retrying."
      : "GitHub issue request failed.";
    return new GitHubIssueError(code, message);
  }
}
