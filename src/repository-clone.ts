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

function sourceUrl(repository: string): string {
  return `https://github.com/${repository.toLowerCase()}.git`;
}

async function assertRepositoryCheckout(path: string, repository: string): Promise<boolean> {
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
  if (await assertRepositoryCheckout(target, repository)) return { repositoryPath: target, status: "already-present" };

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
      env: {
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
        AGENT_CREW_CREDENTIAL_SOCKET: credential.socketPath,
      },
    });
    if (!(await assertRepositoryCheckout(checkout, repository))) throw new Error("Git clone did not create the requested checkout.");
    await rename(checkout, target);
    return { repositoryPath: target, status: "cloned" };
  } catch {
    throw new Error("Repository clone failed; verify GitHub Contents read permission and checkout path.");
  } finally {
    await credential.close();
    await rm(staging, { recursive: true, force: true });
  }
}
