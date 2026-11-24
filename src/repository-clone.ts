import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
}

function parseCredentialRequest(value: unknown): { operation: string; input: string } | undefined {
  if (typeof value !== "object" || value === null || !("operation" in value) || !("input" in value) ||
      typeof value.operation !== "string" || typeof value.input !== "string" || value.input.length > 8_192) return undefined;
  return { operation: value.operation, input: value.input };
}

function hasMatchingRepository(input: string, repository: string): boolean {
  const values = new Map<string, string>();
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator >= 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const path = values.get("path")?.replace(/\.git$/, "").toLowerCase();
  return values.get("protocol") === "https" && values.get("host")?.toLowerCase() === "github.com" &&
    path === repository.toLowerCase();
}

async function createCredentialChannel(repository: string, token: string): Promise<{
  socketPath: string; close: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "agent-crew-git-credential-"));
  const socketPath = join(directory, "credential.sock");
  const server = createServer((socket) => {
    let input = "";
    socket.setTimeout(5_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (input.length > 8_192) { socket.destroy(); return; }
      const end = input.indexOf("\n");
      if (end < 0) return;
      try {
        const parsed: unknown = JSON.parse(input.slice(0, end));
        const request = parseCredentialRequest(parsed);
        const authorized = request?.operation === "get" && hasMatchingRepository(request.input, repository);
        socket.end(JSON.stringify(authorized ? { username: "x-access-token", password: token } : {}) + "\n");
      } catch {
        socket.destroy();
      }
    });
  });
  try {
    await new Promise<void>((resolveServer, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolveServer());
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    socketPath,
    close: async () => {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function gitEnvironment(socketPath?: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
    ...(process.env.SSL_CERT_FILE ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE } : {}),
    ...(process.env.SSL_CERT_DIR ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR } : {}),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TRACE: "0",
    GIT_TRACE_CURL: "0",
    ...(socketPath ? { AGENT_CREW_CREDENTIAL_SOCKET: socketPath } : {}),
  };
}

function sourceUrl(repository: string): string {
  return `https://github.com/${repository.toLowerCase()}.git`;
}

export async function inspectRepositoryCheckout(path: string, repository: string): Promise<boolean> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new Error("Checkout path must be a real directory.");
  let remote: string;
  try {
    ({ stdout: remote } = await execFile("git", ["-C", path, "remote", "get-url", "origin"], { timeout: 5_000, maxBuffer: 16_384 }));
  } catch {
    throw new Error("Checkout path exists but is not a Git repository with an origin remote.");
  }
  if (remote.trim().toLowerCase() !== sourceUrl(repository)) {
    throw new Error("Existing checkout remote does not match the selected repository.");
  }
  return true;
}

export async function cloneRepository(options: {
  repository: string;
  repositoryPath?: string;
  token: string;
}): Promise<{ repositoryPath: string; status: "cloned" | "already-present" }> {
  const repository = options.repository.toLowerCase();
  if (!GITHUB_REPOSITORY.test(repository) || !options.token) throw new Error("Repository selection is invalid.");
  const root = resolve(process.env.AGENT_CREW_REPOSITORY_ROOT ?? "/workspaces/repositories");
  const target = resolve(options.repositoryPath || join(root, ...repository.split("/")));
  if (!inside(root, target)) throw new Error("Checkout path must be inside the configured repository directory.");
  await stat(root);
  const rootReal = await realpath(root);
  await mkdir(dirname(target), { recursive: true });
  const parentReal = await realpath(dirname(target));
  if (!inside(rootReal, parentReal)) throw new Error("Checkout path resolves outside the configured repository directory.");
  if (await inspectRepositoryCheckout(target, repository)) return { repositoryPath: target, status: "already-present" };

  const staging = await mkdtemp(join(parentReal, ".agent-crew-clone-"));
  const checkout = join(staging, "checkout");
  const credential = await createCredentialChannel(repository, options.token);
  const helper = fileURLToPath(new URL("./git-credential-helper.js", import.meta.url));
  try {
    await execFile("git", [
      "-c", "credential.helper=",
      "-c", "credential.useHttpPath=true",
      "-c", `credential.helper=!${process.execPath} ${helper}`,
      "clone", "--", sourceUrl(repository), checkout,
    ], {
      timeout: 120_000,
      maxBuffer: 1_000_000,
      env: gitEnvironment(credential.socketPath),
    });
    if (!(await inspectRepositoryCheckout(checkout, repository))) throw new Error("Git clone did not create the requested checkout.");
    await rename(checkout, target);
    return { repositoryPath: target, status: "cloned" };
  } catch {
    throw new Error("Repository clone failed; verify GitHub Contents read permission and checkout path.");
  } finally {
    await credential.close();
    await rm(staging, { recursive: true, force: true });
  }
}

const TASK_BASE_MESSAGES = {
  SOURCE_DIRTY: "Source checkout is dirty; inspect it before starting a task.",
  SOURCE_NOT_MAIN: "Source checkout must be on main.",
  TASK_BRANCH_EXISTS: "Task branch already exists; operator inspection is required.",
  REMOTE_MAIN_UNAVAILABLE: "Fetching remote main failed; verify access and remote main.",
  SOURCE_MAIN_DIVERGED: "Local main is ahead of or divergent from remote main; inspect before starting.",
  SOURCE_CHANGED: "Source checkout changed during preparation; inspect before starting.",
  SOURCE_BASE_MISMATCH: "Source main did not reach the fetched base commit.",
} as const;

export class TaskBaseError extends Error {
  constructor(readonly code: keyof typeof TASK_BASE_MESSAGES) {
    super(TASK_BASE_MESSAGES[code]);
    this.name = "TaskBaseError";
  }
}

/** Prepare only a new assignment. A resumed assignment must keep its stored base. */
export async function prepareTaskBase(options: {
  repository: string; repositoryPath: string; branch: string; token: string;
}): Promise<string> {
  if (!GITHUB_REPOSITORY.test(options.repository) || !options.token ||
      !/^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(options.branch)) {
    throw new Error("Task repository or branch is invalid.");
  }
  if (!(await inspectRepositoryCheckout(options.repositoryPath, options.repository))) {
    throw new Error("Task source checkout is missing.");
  }
  const git = async (args: string[], socketPath?: string) => {
    const result = await execFile("git", ["-C", options.repositoryPath, ...args], {
      timeout: socketPath ? 120_000 : 10_000, maxBuffer: 1_000_000,
      env: gitEnvironment(socketPath),
    });
    return result.stdout.trim();
  };
  if (await git(["status", "--porcelain", "--untracked-files=all"])) {
    throw new TaskBaseError("SOURCE_DIRTY");
  }
  if (await git(["symbolic-ref", "--short", "HEAD"]) !== "main") {
    throw new TaskBaseError("SOURCE_NOT_MAIN");
  }
  if (await git(["for-each-ref", "--format=%(refname)", `refs/heads/${options.branch}`])) {
    throw new TaskBaseError("TASK_BRANCH_EXISTS");
  }
  const credential = await createCredentialChannel(options.repository, options.token);
  const helper = fileURLToPath(new URL("./git-credential-helper.js", import.meta.url));
  try {
    await git([
      "-c", "credential.helper=", "-c", "credential.useHttpPath=true",
      "-c", `credential.helper=!${process.execPath} ${helper}`,
      "fetch", "--no-tags", "origin", "refs/heads/main",
    ], credential.socketPath);
  } catch {
    throw new TaskBaseError("REMOTE_MAIN_UNAVAILABLE");
  } finally {
    await credential.close();
  }
  // FETCH_HEAD is the exact fetched main, never an old remote-tracking ref.
  const baseCommit = await git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  if (!/^[a-f0-9]{40,64}$/.test(baseCommit)) throw new Error("Fetched main commit is invalid.");
  // A clean clone of an empty remote has symbolic HEAD=main but no main ref.
  // Query refs without swallowing Git failures as an unborn-branch result.
  const localMain = await git(["for-each-ref", "--format=%(refname)", "refs/heads/main"]);
  const mainExists = localMain.split("\n").includes("refs/heads/main");
  if (mainExists) {
    try {
      await git(["merge-base", "--is-ancestor", "refs/heads/main", baseCommit]);
    } catch {
      throw new TaskBaseError("SOURCE_MAIN_DIVERGED");
    }
  }
  // A concurrent local edit must not be overwritten during fast-forward.
  if (await git(["status", "--porcelain", "--untracked-files=all"]) ||
      await git(["symbolic-ref", "--short", "HEAD"]) !== "main") {
    throw new TaskBaseError("SOURCE_CHANGED");
  }
  await git(["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", baseCommit]);
  if (await git(["rev-parse", "HEAD"]) !== baseCommit) {
    throw new TaskBaseError("SOURCE_BASE_MISMATCH");
  }
  return baseCommit;
}

async function taskGit(path: string, args: string[]): Promise<string> {
  return (await execFile("git", ["-C", path,
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
    "-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
    timeout: 10_000, maxBuffer: 1_000_000, env: gitEnvironment(),
  })).stdout.trim();
}

export async function verifyTaskWorkspace(options: {
  repositoryPath: string; workspacePath: string; branch: string; baseCommit: string;
  newlyCreated: boolean;
}): Promise<void> {
  if (!/^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(options.branch) ||
      !/^[a-f0-9]{40,64}$/.test(options.baseCommit)) {
    throw new Error("Task branch or base binding is invalid; operator inspection is required.");
  }
  const git = taskGit;
  const commonDirectory = async (path: string) => realpath(await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (await commonDirectory(options.repositoryPath) !== await commonDirectory(options.workspacePath) ||
      await git(options.workspacePath, ["symbolic-ref", "--short", "HEAD"]) !== options.branch) {
    throw new Error("Task worktree does not match its repository and branch binding.");
  }
  if (options.newlyCreated && await git(options.workspacePath, ["rev-parse", "HEAD"]) !== options.baseCommit) {
    throw new Error("New task worktree does not match the assigned base commit.");
  }
  // Even status/add may invoke clean filters; reject them before inspecting file changes.
  const configKeys = (await git(options.workspacePath, ["config", "--name-only", "--list"])).split("\n");
  if (configKeys.some((key) => /^filter\..*\.(clean|process)$/.test(key))) {
    throw new Error("Controller delivery requires a repository without executable Git filters.");
  }
  await git(options.workspacePath, ["merge-base", "--is-ancestor", options.baseCommit, "HEAD"]);
}

/** Inspect local commits only; this neither writes Git history nor grants publication. */
export async function verifyTaskDelivery(options: {
  repositoryPath: string; workspacePath: string; branch: string; baseCommit: string;
}): Promise<string> {
  await verifyTaskWorkspace({ ...options, newlyCreated: false });
  const git = (args: string[]) => taskGit(options.workspacePath, args);
  const head = await git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!/^[a-f0-9]{40,64}$/.test(head) || head === options.baseCommit) {
    throw new Error("Coding delivery requires a local task commit.");
  }
  if (await git(["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Coding delivery worktree is dirty or contains untracked files.");
  }
  // Recheck after inspection; WBS5 must also revalidate this snapshot before push.
  await verifyTaskWorkspace({ ...options, newlyCreated: false });
  if (await git(["rev-parse", "HEAD"]) !== head) throw new Error("Coding delivery head changed during inspection.");
  return head;
}

export async function verifyTaskPublication(options: {
  repository: string;
  repositoryPath: string;
  workspacePath: string;
  branch: string;
  baseCommit: string;
  expectedHead: string;
}): Promise<void> {
  if (!GITHUB_REPOSITORY.test(options.repository) ||
      !/^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(options.branch) ||
      !/^[a-f0-9]{40,64}$/.test(options.expectedHead)) {
    throw new Error("Recorded publication head is invalid.");
  }
  if (!(await inspectRepositoryCheckout(options.repositoryPath, options.repository))) {
    throw new Error("Recorded publication checkout is missing.");
  }
  const head = await verifyTaskDelivery(options);
  if (head !== options.expectedHead) {
    throw new Error("Recorded coding delivery head changed; operator inspection is required.");
  }
}

function credentialGitArguments(helper: string): string[] {
  return [
    "-c", "credential.helper=",
    "-c", "credential.useHttpPath=true",
    "-c", `credential.helper=!${process.execPath} ${helper}`,
  ];
}

async function authenticatedTaskGit(options: {
  repository: string;
  token: string;
  workspacePath: string;
  timeoutMs: number;
  args: string[];
}): Promise<string> {
  const credential = await createCredentialChannel(options.repository, options.token);
  const helper = fileURLToPath(new URL("./git-credential-helper.js", import.meta.url));
  try {
    const result = await execFile("git", [
      "-C", options.workspacePath,
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.fsmonitor=false",
      ...credentialGitArguments(helper),
      ...options.args,
    ], {
      timeout: options.timeoutMs,
      maxBuffer: 1_000_000,
      env: gitEnvironment(credential.socketPath),
    });
    return result.stdout.trim();
  } finally {
    await credential.close();
  }
}

export async function inspectTaskRemoteHead(options: {
  repository: string;
  token: string;
  workspacePath: string;
  branch: string;
}): Promise<string | undefined> {
  if (!GITHUB_REPOSITORY.test(options.repository) || !options.token ||
      !/^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(options.branch)) {
    throw new Error("Remote task branch inspection is invalid.");
  }
  const output = await authenticatedTaskGit({
    ...options,
    timeoutMs: 120_000,
    args: ["ls-remote", "--refs", "origin", `refs/heads/${options.branch}`],
  });
  if (!output) return undefined;
  const rows = output.split("\n");
  if (rows.length !== 1) throw new Error("Remote task branch lookup returned ambiguous results.");
  const head = rows[0]?.split(/\s+/, 1)[0];
  if (!head || !/^[a-f0-9]{40,64}$/.test(head)) {
    throw new Error("Remote task branch lookup returned an invalid head.");
  }
  return head;
}

export class TaskPushError extends Error {
  constructor(readonly code: "PUSH_REJECTED" | "PUSH_UNCERTAIN" | "REMOTE_BRANCH_MISMATCH", message: string) {
    super(message);
    this.name = "TaskPushError";
  }
}

export async function pushTaskBranch(options: {
  repository: string;
  token: string;
  workspacePath: string;
  branch: string;
  expectedHead: string;
  previousRemoteHead?: string;
}): Promise<void> {
  if (!GITHUB_REPOSITORY.test(options.repository) || !options.token ||
      !/^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(options.branch) ||
      !/^[a-f0-9]{40,64}$/.test(options.expectedHead) ||
      (options.previousRemoteHead !== undefined && !/^[a-f0-9]{40,64}$/.test(options.previousRemoteHead))) {
    throw new Error("Task branch push binding is invalid.");
  }
  try {
    await authenticatedTaskGit({
      ...options,
      timeoutMs: 120_000,
      args: ["push", "--porcelain", "origin", `${options.expectedHead}:refs/heads/${options.branch}`],
    });
  } catch (error) {
    let remoteHead: string | undefined;
    try {
      remoteHead = await inspectTaskRemoteHead(options);
    } catch {
      throw new TaskPushError("PUSH_UNCERTAIN", "Task branch push outcome could not be confirmed.");
    }
    if (remoteHead === options.expectedHead) return;
    if (remoteHead !== undefined && remoteHead !== options.previousRemoteHead) {
      throw new TaskPushError("REMOTE_BRANCH_MISMATCH", "Remote task branch changed to an incompatible head.");
    }
    const details = error && typeof error === "object"
      ? `${"stdout" in error ? String(error.stdout) : ""}\n${"stderr" in error ? String(error.stderr) : ""}`
      : "";
    if (remoteHead === options.previousRemoteHead &&
        details.split(/\r?\n/).some((line) => /\[(?:remote )?rejected\](?:\s.*)?$/.test(line.trim()))) {
      throw new TaskPushError("PUSH_REJECTED", "Task branch push was definitively rejected.");
    }
    throw new TaskPushError("PUSH_UNCERTAIN", "Task branch push outcome is uncertain.");
  }
  const remoteHead = await inspectTaskRemoteHead(options);
  if (remoteHead !== options.expectedHead) {
    throw new TaskPushError("PUSH_UNCERTAIN", "Task branch push did not confirm the recorded head.");
  }
}

export async function commitTaskDelivery(options: {
  repositoryPath: string; workspacePath: string; branch: string; baseCommit: string; issueNumber: number;
}): Promise<string> {
  if (!Number.isSafeInteger(options.issueNumber) || options.issueNumber < 1 ||
      options.branch !== `openclaw/agent-crew-issue-${options.issueNumber}`) {
    throw new Error("Commit issue does not match its assigned branch.");
  }
  await verifyTaskWorkspace({ ...options, newlyCreated: false });
  const git = (args: string[]) => taskGit(options.workspacePath, args);
  const head = await git(["rev-parse", "HEAD"]);
  if (await git(["status", "--porcelain", "--untracked-files=all"])) {
    const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0");
    if (untracked.some((path) => path === ".npm" || path.startsWith(".npm/"))) {
      throw new Error("Project-local npm cache blocks delivery; inspect generated files and use sandbox /tmp.");
    }
    await git(["add", "--all", "--", "."]);
    await verifyTaskWorkspace({ ...options, newlyCreated: false });
    if (await git(["rev-parse", "HEAD"]) !== head) throw new Error("Task head changed before commit.");
    await git([
      "-c", "user.name=Agent Crew", "-c", "user.email=agent-crew@example.invalid",
      "commit", "--no-gpg-sign", "-m", `chore: implement issue #${options.issueNumber}`,
    ]);
  }
  return verifyTaskDelivery(options);
}
