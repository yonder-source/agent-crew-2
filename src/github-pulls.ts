import { Octokit } from "@octokit/rest";

export type GitHubPullRequest = {
  repository: string;
  id: number;
  number: number;
  url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  baseRef: string;
  headRef: string;
  headCommit: string;
};

type PullRequestProviderOptions = {
  getInstallationToken: () => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumPages?: number;
};

export class GitHubPullRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GitHubPullRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repositoryParts(repository: string): { owner: string; name: string; fullName: string; path: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match) {
    throw new GitHubPullRequestError("GITHUB_CONFIGURATION_INVALID", "GitHub repository must use owner/name format.");
  }
  const owner = match[1]?.toLowerCase();
  const name = match[2]?.toLowerCase();
  if (!owner || !name) {
    throw new GitHubPullRequestError("GITHUB_CONFIGURATION_INVALID", "GitHub repository must use owner/name format.");
  }
  return { owner, name, fullName: `${owner}/${name}`, path: `/repos/${owner}/${name}` };
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function pullRequestUrlMatches(value: unknown, repository: string, number: number): boolean {
  if (typeof value !== "string" || !Number.isSafeInteger(number) || number < 1) return false;
  try {
    const url = new URL(value);
    if (url.origin !== "https://github.com" || url.username || url.password ||
        url.hash || url.search) return false;
    const match = /^\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(url.pathname);
    return match?.[1]?.toLowerCase() === repository.toLowerCase() &&
      Number(match[2]) === number;
  } catch {
    return false;
  }
}

function parsePullRequest(value: unknown, repository: string): GitHubPullRequest {
  if (!isRecord(value) || !isSafeInteger(value.id) || !isSafeInteger(value.number) ||
      typeof value.title !== "string" || value.title.length > 256 ||
      (value.body !== null && typeof value.body !== "string") ||
      (typeof value.body === "string" && value.body.length > 64_000) ||
      (value.state !== "open" && value.state !== "closed") ||
      typeof value.draft !== "boolean" || !isRecord(value.base) || !isRecord(value.head) ||
      !isRecord(value.base.repo) || !isRecord(value.head.repo) ||
      typeof value.base.ref !== "string" || typeof value.head.ref !== "string" ||
      typeof value.head.sha !== "string" || !/^[a-f0-9]{40,64}$/.test(value.head.sha) ||
      typeof value.base.repo.full_name !== "string" || typeof value.head.repo.full_name !== "string") {
    throw new GitHubPullRequestError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid pull request.");
  }
  if (typeof value.html_url !== "string" ||
      !pullRequestUrlMatches(value.html_url, repository, value.number) ||
      value.base.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
      value.head.repo.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new GitHubPullRequestError("GITHUB_RESPONSE_INVALID", "GitHub returned a pull request from a different repository.");
  }
  const mergedAt = value.merged_at;
  const merged = value.merged === true || (mergedAt !== null && mergedAt !== undefined);
  return {
    repository: repository.toLowerCase(),
    id: value.id,
    number: value.number,
    url: value.html_url,
    title: value.title,
    body: value.body,
    state: value.state,
    draft: value.draft,
    merged,
    baseRef: value.base.ref,
    headRef: value.head.ref,
    headCommit: value.head.sha,
  };
}

function requestAllowed(path: string, url: URL, method: string): boolean {
  if (url.origin !== "https://api.github.com" || url.username || url.password || url.hash) return false;
  if (url.pathname.toLowerCase() === `${path}/pulls` && method === "GET") return true;
  return url.pathname.toLowerCase() === `${path}/pulls` && method === "POST";
}

type PullRequest422Disposition = "conflict" | "definitive-rejection" | "uncertain";

function pullRequest422Disposition(error: unknown): PullRequest422Disposition {
  if (!isRecord(error) || error.status !== 422) return "uncertain";
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const text = [
    typeof error.message === "string" ? error.message : "",
    data ? JSON.stringify(data) : "",
  ].join("\n").toLowerCase();
  if (/already exists|pull request .*exists|another pull request|head .*already|already_exists|duplicate/.test(text)) {
    return "conflict";
  }
  if (Array.isArray(data?.errors)) {
    const errors = data.errors.filter(isRecord);
    if (errors.length > 0 && errors.every((item) => {
      const code = typeof item.code === "string" ? item.code.toLowerCase() : "";
      return ["missing", "missing_field", "invalid", "unprocessable"].includes(code);
    })) {
      return "definitive-rejection";
    }
  }
  return "uncertain";
}

async function boundedResponse(response: Response, maximumBytes: number, signal: AbortSignal): Promise<Response> {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new GitHubPullRequestError("GITHUB_RESPONSE_TOO_LARGE", "GitHub pull request response exceeded its size limit.");
      }
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
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

export class OctokitGitHubPullRequestProvider {
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly maximumPages: number;

  constructor(private readonly options: PullRequestProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 1_000_000;
    this.maximumPages = options.maximumPages ?? 100;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000 ||
        !Number.isSafeInteger(this.maximumResponseBytes) || this.maximumResponseBytes < 256 ||
        this.maximumResponseBytes > 16_000_000 ||
        !Number.isSafeInteger(this.maximumPages) || this.maximumPages < 1 || this.maximumPages > 100) {
      throw new GitHubPullRequestError("GITHUB_CONFIGURATION_INVALID", "GitHub pull request request bounds are invalid.");
    }
  }

  async findExisting(options: {
    repository: string;
    issueNumber: number;
    issueTitle: string;
    headRef: string;
    headCommit: string;
    baseRef: "main";
  }): Promise<GitHubPullRequest | undefined> {
    const target = repositoryParts(options.repository);
    this.validateBinding(options);
    const state: { timedOut: boolean; guardFailure?: unknown } = { timedOut: false };
    try {
      const client = await this.client(target, undefined, (error) => { state.guardFailure = error; },
        undefined, () => { state.timedOut = true; });
      const pulls: GitHubPullRequest[] = [];
      let pages = 0;
      for await (const page of client.paginate.iterator(client.rest.pulls.list, {
        owner: target.owner,
        repo: target.name,
        state: "all",
        head: `${target.owner}:${options.headRef}`,
        per_page: 100,
      })) {
        pages += 1;
        if (pages > this.maximumPages) {
          throw new GitHubPullRequestError("GITHUB_PAGE_LIMIT", "GitHub pull request listing exceeded the page limit.");
        }
        pulls.push(...page.data.map((value) => parsePullRequest(value, target.fullName)));
      }
      if (pulls.length === 0) return undefined;
      if (pulls.length !== 1) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_AMBIGUOUS", "More than one pull request matches the task branch.");
      }
      const pull = pulls[0];
      if (!pull || !this.matches(pull, options)) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_MISMATCH", "An existing pull request does not match the retained task delivery.");
      }
      return pull;
    } catch (error) {
      if (state.guardFailure !== undefined) throw this.asError(state.guardFailure);
      if (state.timedOut) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_LOOKUP_UNCERTAIN", "GitHub pull request lookup did not complete.");
      }
      if (error instanceof GitHubPullRequestError) throw error;
      throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_LOOKUP_UNCERTAIN", "GitHub pull request lookup requires inspection.");
    }
  }

  async create(options: {
    repository: string;
    issueNumber: number;
    issueTitle: string;
    headRef: string;
    headCommit: string;
    baseRef: "main";
    body: string;
    beforeDispatch?: () => void;
  }): Promise<GitHubPullRequest> {
    const target = repositoryParts(options.repository);
    this.validateBinding(options);
    if (typeof options.body !== "string" || options.body.length > 64_000) {
      throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_BODY_INVALID", "Pull request body is invalid.");
    }
    const state: { started: boolean; timedOut: boolean; guardFailure?: unknown } = {
      started: false, timedOut: false,
    };
    try {
      const client = await this.client(target, () => { options.beforeDispatch?.(); },
        (error) => { state.guardFailure = error; }, () => { state.started = true; },
        () => { state.timedOut = true; });
      const { data } = await client.rest.pulls.create({
        owner: target.owner,
        repo: target.name,
        title: options.issueTitle,
        head: options.headRef,
        base: options.baseRef,
        body: options.body,
        draft: true,
      });
      const pull = parsePullRequest(data, target.fullName);
      if (!this.matches(pull, options) || pull.body !== options.body) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_CREATE_UNCERTAIN", "GitHub pull request creation could not be confirmed.");
      }
      return pull;
    } catch (error) {
      if (state.guardFailure !== undefined) throw this.asError(state.guardFailure);
      if (state.timedOut || (error instanceof GitHubPullRequestError &&
          error.code === "GITHUB_PULL_REQUEST_CREATE_UNCERTAIN")) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_CREATE_UNCERTAIN", "GitHub pull request creation requires inspection.");
      }
      const status = isRecord(error) ? error.status : undefined;
      if (state.started && status === 422) {
        const disposition = pullRequest422Disposition(error);
        if (disposition === "definitive-rejection") {
          throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_CREATE_REJECTED", "GitHub rejected pull request creation.");
        }
        throw new GitHubPullRequestError(
          "GITHUB_PULL_REQUEST_CREATE_UNCERTAIN",
          disposition === "conflict"
            ? "GitHub pull request creation may have an existing conflicting draft; inspect before retrying."
            : "GitHub pull request creation returned an unrecognized 422 response; inspect before retrying.",
        );
      }
      if (state.started && typeof status === "number" && [400, 401, 403, 404].includes(status)) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_CREATE_REJECTED", "GitHub rejected pull request creation.");
      }
      if (state.started) {
        throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_CREATE_UNCERTAIN", "GitHub pull request creation requires inspection.");
      }
      if (error instanceof GitHubPullRequestError) throw error;
      throw new GitHubPullRequestError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub pull request credential is unavailable.");
    }
  }

  private async client(
    target: ReturnType<typeof repositoryParts>,
    beforeDispatch?: () => void,
    onGuardFailure?: (error: unknown) => void,
    onRequestStart?: () => void,
    onTimeout?: () => void,
  ): Promise<Octokit> {
    let token: string;
    try {
      token = (await this.options.getInstallationToken()).trim();
    } catch {
      throw new GitHubPullRequestError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub pull request credential is unavailable.");
    }
    if (!token) throw new GitHubPullRequestError("GITHUB_CREDENTIAL_UNAVAILABLE", "GitHub pull request credential is unavailable.");
    const fetcher = this.options.fetcher ?? fetch;
    const scopedFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!requestAllowed(target.path, url, method)) {
        const error = new GitHubPullRequestError("GITHUB_REQUEST_BLOCKED", "GitHub request was outside the repository pull request API.");
        onGuardFailure?.(error);
        throw error;
      }
      try { beforeDispatch?.(); } catch (error) {
        onGuardFailure?.(error);
        throw error;
      }
      onRequestStart?.();
      const controller = new AbortController();
      const externalSignal = init?.signal;
      const abort = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abort();
      else externalSignal?.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          controller.abort(new DOMException("GitHub request timed out.", "TimeoutError"));
          reject(new GitHubPullRequestError("GITHUB_PULL_REQUEST_TIMEOUT", "GitHub pull request request timed out."));
        }, this.timeoutMs);
      });
      try {
        return await Promise.race([
          (async () => {
            const response = await fetcher(input, {
              ...init, signal: controller.signal, redirect: "error", cache: "no-store",
            });
            return boundedResponse(response, this.maximumResponseBytes, controller.signal);
          })(),
          deadline,
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abort);
      }
    };
    return new Octokit({
      auth: token,
      request: { timeout: this.timeoutMs, fetch: scopedFetch },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
  }

  private validateBinding(options: {
    issueNumber: number;
    issueTitle: string;
    headRef: string;
    headCommit: string;
  }): void {
    if (!Number.isSafeInteger(options.issueNumber) || options.issueNumber < 1 ||
        typeof options.issueTitle !== "string" || !options.issueTitle ||
        options.issueTitle.length > 256 ||
        options.headRef !== `openclaw/agent-crew-issue-${String(options.issueNumber)}` ||
        !/^[a-f0-9]{40,64}$/.test(options.headCommit)) {
      throw new GitHubPullRequestError("GITHUB_PULL_REQUEST_INVALID", "Pull request binding is invalid.");
    }
  }

  private matches(
    pull: GitHubPullRequest,
    expected: {
      issueNumber: number;
      issueTitle: string;
      headRef: string;
      headCommit: string;
      baseRef: "main";
    },
  ): boolean {
    const marker = new RegExp(`(?:^|\\n)Fixes #${String(expected.issueNumber)}(?:\\s|$)`);
    return pull.state === "open" && pull.draft && !pull.merged &&
      pull.baseRef === expected.baseRef && pull.headRef === expected.headRef &&
      pull.headCommit === expected.headCommit && pull.title === expected.issueTitle &&
      typeof pull.body === "string" && marker.test(pull.body);
  }

  private asError(error: unknown): GitHubPullRequestError {
    return error instanceof GitHubPullRequestError
      ? error
      : new GitHubPullRequestError("GITHUB_PULL_REQUEST_FAILED", "GitHub pull request request failed.");
  }
}
