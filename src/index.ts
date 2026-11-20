import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { assignedIssueFromSession, trustedSessionKey } from "./assignment.js";
import { parseConfig } from "./config.mjs";
import { IssueDiscovery } from "./discovery.js";
import { GitHubIssueError, OctokitGitHubIssueProvider } from "./github-issues.js";
import { GitHubAppClient, GitHubAppError } from "./github-app.js";
import { cloneRepository, prepareTaskBase, verifyTaskWorkspace, TaskBaseError } from "./repository-clone.js";
import { validateCheckout, type ConnectionCheck } from "./repository-validation.js";
import { connectionConfig } from "./setup-config.js";

const NAMESPACE = "agent-crew-job";
const JOB_STATUSES = ["starting", "active", "completed", "needs-inspection", "retry-approved", "abandoned"] as const;
const WORKFLOW_STATUSES = ["ok", "needs_approval", "needs_input", "cancelled"] as const;
type JobStatus = typeof JOB_STATUSES[number];
type WorkflowStatus = typeof WORKFLOW_STATUSES[number];
const LOCKED = new Set(["starting", "active", "completed", "needs-inspection", "abandoned"]);
const DRAFT_FIELDS = [
  "githubAppId", "repository", "installationId", "repositoryPath", "codingAgentId", "designerAgentId",
  "codingChannelId", "designerChannelId", "codingUserIds", "designerUserIds", "tokenBudget",
] as const;
const DRAFT_FIELD_SET = new Set<string>(DRAFT_FIELDS);
type SetupDraft = Omit<Record<typeof DRAFT_FIELDS[number], string>, "installationId"> & { installationId?: string };

function parseSetupDraft(value: unknown): SetupDraft {
  if (!isRecord(value) || Object.keys(value).some((key) => !DRAFT_FIELD_SET.has(key)) ||
      Object.keys(value).length < DRAFT_FIELDS.length - 1 || Object.keys(value).length > DRAFT_FIELDS.length) {
    throw new Error("Invalid setup draft");
  }
  const { githubAppId, repository, repositoryPath, codingAgentId, designerAgentId,
    codingChannelId, designerChannelId, codingUserIds, designerUserIds, tokenBudget } = value;
  const installationId = Object.hasOwn(value, "installationId") ? value.installationId : "";
  if (typeof githubAppId !== "string" || typeof repository !== "string" || typeof installationId !== "string" ||
      typeof repositoryPath !== "string" || typeof codingAgentId !== "string" ||
      typeof designerAgentId !== "string" || typeof codingChannelId !== "string" ||
      typeof designerChannelId !== "string" || typeof codingUserIds !== "string" ||
      typeof designerUserIds !== "string" || typeof tokenBudget !== "string" ||
      DRAFT_FIELDS.some((field) => (field !== "installationId" && typeof value[field] !== "string") ||
        (typeof value[field] === "string" && value[field].length > 1024))) {
    throw new Error("Invalid setup draft");
  }
  return {
    githubAppId, repository, ...(Object.hasOwn(value, "installationId") ? { installationId } : {}),
    repositoryPath, codingAgentId, designerAgentId,
    codingChannelId, designerChannelId, codingUserIds, designerUserIds, tokenBudget,
  };
}

function isJobStatus(value: unknown): value is JobStatus {
  return JOB_STATUSES.some((status) => status === value);
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return WORKFLOW_STATUSES.some((status) => status === value);
}

type Issue = { repository: string; number: number };
type Job = Issue & {
  jobId: string;
  sessionKey: string;
  status: JobStatus;
  bootId: string;
  updatedAt: string;
  workflowRef?: string;
  workflowStatus?: WorkflowStatus;
  codingRunId?: string;
  codingRunStatus?: string;
  codingSummary?: string;
  workspacePath?: string;
  workspaceBranch?: string;
  baseCommit?: string;
  error?: string;
  decision?: string;
  issueUpdate?: {
    status: "writing" | "needs-inspection" | "retry-approved" | "confirmed" | "abandoned";
    operationId: string;
    bodyHash: string;
    updatedAt: string;
    decision?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJob(value: unknown): value is Job {
  if (!isRecord(value) || typeof value.repository !== "string" ||
      typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1 ||
      typeof value.jobId !== "string" || typeof value.sessionKey !== "string" ||
      typeof value.bootId !== "string" || typeof value.updatedAt !== "string" ||
      !isJobStatus(value.status) ||
      (value.workflowRef !== undefined && typeof value.workflowRef !== "string") ||
      (value.workflowStatus !== undefined && !isWorkflowStatus(value.workflowStatus)) ||
      (value.codingRunId !== undefined && typeof value.codingRunId !== "string") ||
      (value.codingRunStatus !== undefined && typeof value.codingRunStatus !== "string") ||
      (value.codingSummary !== undefined && typeof value.codingSummary !== "string") ||
      (value.workspacePath !== undefined && typeof value.workspacePath !== "string") ||
      (value.workspaceBranch !== undefined && typeof value.workspaceBranch !== "string") ||
      (value.baseCommit !== undefined && (typeof value.baseCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.baseCommit))) ||
      (value.error !== undefined && typeof value.error !== "string") ||
      (value.decision !== undefined && typeof value.decision !== "string")) return false;
  if (value.issueUpdate === undefined) return true;
  const update = value.issueUpdate;
  return isRecord(update) &&
    ["writing", "needs-inspection", "retry-approved", "confirmed", "abandoned"].includes(String(update.status)) &&
    typeof update.operationId === "string" && typeof update.bodyHash === "string" &&
    typeof update.updatedAt === "string" &&
    (update.decision === undefined || typeof update.decision === "string");
}

// Explicit output boundary: continuation credentials stay in session metadata.
function publicJob(job: Job) {
  return {
    repository: job.repository, number: job.number, jobId: job.jobId,
    sessionKey: job.sessionKey, status: job.status, bootId: job.bootId,
    updatedAt: job.updatedAt,
    ...(job.workflowStatus !== undefined ? { workflowStatus: job.workflowStatus } : {}),
    ...(job.codingRunId !== undefined ? { codingRunId: job.codingRunId } : {}),
    ...(job.codingRunStatus !== undefined ? { codingRunStatus: job.codingRunStatus } : {}),
    ...(job.codingSummary !== undefined ? { codingSummary: job.codingSummary } : {}),
    ...(job.workspacePath !== undefined ? { workspacePath: job.workspacePath } : {}),
    ...(job.workspaceBranch !== undefined ? { workspaceBranch: job.workspaceBranch } : {}),
    ...(job.baseCommit !== undefined ? { baseCommit: job.baseCommit } : {}),
    ...(job.error !== undefined ? { error: "Workflow outcome requires inspection" } : {}),
    ...(job.decision !== undefined ? { decision: job.decision } : {}),
    ...(job.issueUpdate !== undefined ? { issueUpdate: job.issueUpdate } : {}),
  };
}

function parseIssue(repository: unknown, number: unknown): Issue {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use owner/name format");
  }
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw new Error("issue number must be a positive integer");
  }
  return { repository: repository.toLowerCase(), number };
}

function sessionKey(issue: Issue, agentId: string): string {
  const digest = createHash("sha256").update(`${issue.repository}#${issue.number}`).digest("hex");
  return `agent:${agentId}:agent-crew-${digest.slice(0, 32)}`;
}

export default definePluginEntry({
  id: "agent-crew",
  name: "Agent Crew",
  description: "Synthetic Agent Crew issue dispatcher and status",
  register(api) {
    const config = parseConfig(api.pluginConfig);
    const issueSessionKey = (issue: Issue) => sessionKey(issue, config.coding?.agentId ?? "coding");
    const bootId = randomUUID();
    let queue = Promise.resolve();
    let startingJobId: string | undefined;
    let pendingDispatches = 0;
    let setupApplying = false;
    let pollingReady = config.github?.appId === undefined;
    let pollingReason = config.github ? "Connection checks pending" : "No active repository connection";
    let pollingInspectionRequired = false;
    let activationPending = false;
    let admissionEpoch = 0;
    let discovery: IssueDiscovery | undefined;
    let issueUpdateQueue = Promise.resolve();
    let metadataQueue = Promise.resolve();
    const activeIssueUpdates = new Set<string>();
    api.session.state.registerSessionExtension({ namespace: NAMESPACE, description: "Issue admission and workflow status" });
    // Explicit operator credential: use the authenticated public API, not the
    // trusted-plugin-only in-process gateway.request capability.
    const call = async (method: string, params: unknown) => {
      const token = process.env.AGENT_CREW_GATEWAY_TOKEN;
      if (!token) throw new Error("AGENT_CREW_GATEWAY_TOKEN is required for dispatch");
      try {
        return await callGatewayFromCli(method, {
          url: "ws://127.0.0.1:18789", token, timeout: "1210000", json: true,
        }, params);
      } catch {
        throw new Error("Gateway request failed; operator inspection required");
      }
    };
    const githubApp = new GitHubAppClient({
      readPrivateKey: async () => readFile("/run/secrets/agent-crew-github-app-private-key", "utf8"),
    });
    const issueProvider = new OctokitGitHubIssueProvider({
      getInstallationToken: async () => config.github?.appId !== undefined
        ? githubApp.issueTokenForRepository(config.github.appId, config.github.installationId, config.github.repository)
        : readFile("/run/secrets/agent-crew-github-installation-token", "utf8"),
    });
    const describe = async (issue: Issue) => {
      const response: unknown = await call("sessions.describe", { key: issueSessionKey(issue) });
      const session = isRecord(response) ? response.session : undefined;
      if (session === null) return null;
      if (!isRecord(session)) {
        throw new Error("Invalid Gateway session response; operator inspection required");
      }
      const extensions = session.pluginExtensions;
      if (extensions !== undefined && !Array.isArray(extensions)) {
        throw new Error("Invalid session extensions; operator inspection required");
      }
      const items = (extensions ?? []) as unknown[];
      return { session, extensions: items.map((item: unknown) => {
        if (!isRecord(item) || typeof item.pluginId !== "string" || typeof item.namespace !== "string") {
          throw new Error("Invalid session extensions; operator inspection required");
        }
        return { pluginId: item.pluginId, namespace: item.namespace, value: item.value };
      }) };
    };
    const writeJob = async (issue: Issue, job: Job): Promise<void> => {
      await call("sessions.pluginPatch", {
        key: issueSessionKey(issue), pluginId: "agent-crew", namespace: NAMESPACE, value: job,
      });
    };

    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = queue.then(operation, operation);
      queue = result.then(() => undefined, () => undefined);
      return result;
    };

    const serializeIssueUpdate = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = issueUpdateQueue.then(operation, operation);
      issueUpdateQueue = result.then(() => undefined, () => undefined);
      return result;
    };

    const patchJob = (issue: Issue, update: (job: Job) => Job): Promise<Job> => {
      const result = metadataQueue.then(async () => {
        const current = await readJob(issue);
        if (!current) throw new Error("Issue admission metadata is missing; operator inspection is required");
        const updated = update(current);
        await writeJob(issue, updated);
        return updated;
      });
      metadataQueue = result.then(() => undefined, () => undefined);
      return result;
    };

    const readJob = async (issue: Issue, session = describe(issue)): Promise<Job | undefined> => {
      const view = await session;
      const matches = view?.extensions.filter((item) => item.pluginId === "agent-crew" && item.namespace === NAMESPACE) ?? [];
      if (matches.length === 0) {
        if (!view || !config.coding) return undefined;
        const worktree = view.session.worktree;
        const workspace = isRecord(worktree) && worktree.repoRoot === config.coding.repositoryPath &&
          typeof worktree.branch === "string" && typeof view.session.sessionRoot === "string"
          ? { workspacePath: view.session.sessionRoot, workspaceBranch: worktree.branch } : {};
        return {
          ...issue,
          jobId: `unrecorded-${createHash("sha256").update(issueSessionKey(issue)).digest("hex").slice(0, 32)}`,
          sessionKey: issueSessionKey(issue), status: "needs-inspection", bootId: "unrecorded",
          updatedAt: new Date().toISOString(),
          ...workspace,
        };
      }
      const value = matches[0]?.value;
      if (matches.length !== 1 || value === undefined) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      if (!isJob(value) || value.repository !== issue.repository || value.number !== issue.number ||
          value.sessionKey !== issueSessionKey(issue)) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      const job = value;
      if (job.repository !== issue.repository || job.number !== issue.number ||
          job.sessionKey !== issueSessionKey(issue) || typeof job.jobId !== "string" ||
          typeof job.bootId !== "string" || !(LOCKED.has(job.status) || job.status === "retry-approved")) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      if (job.issueUpdate !== undefined && (!job.issueUpdate ||
          !["writing", "needs-inspection", "retry-approved", "confirmed", "abandoned"].includes(job.issueUpdate.status) ||
          typeof job.issueUpdate.operationId !== "string" || typeof job.issueUpdate.bodyHash !== "string" ||
          typeof job.issueUpdate.updatedAt !== "string")) {
        throw new Error("Invalid issue update metadata; operator inspection required");
      }
      // Read-only normalization avoids a status request racing an operator reset.
      return {
        ...job,
        ...(job.status === "starting" && (job.bootId !== bootId || job.jobId !== startingJobId)
          ? { status: "needs-inspection" as const } : {}),
        ...(job.issueUpdate?.status === "writing" && !activeIssueUpdates.has(job.issueUpdate.operationId)
          ? { issueUpdate: { ...job.issueUpdate, status: "needs-inspection" as const } }
          : {}),
      };
    };

    const assertNoActiveCodingTasks = async (): Promise<void> => {
      const response: unknown = await call("sessions.list", { archived: "all", limit: 5000 });
      if (!isRecord(response) || !Array.isArray(response.sessions) || response.sessions.length >= 5000) {
        throw new Error("Coding task inventory is incomplete; repository checkout is blocked.");
      }
      if (response.hasMore === true || (typeof response.nextOffset === "number" && response.nextOffset > 0) ||
          (typeof response.totalCount === "number" && response.totalCount > response.sessions.length) ||
          (typeof response.nextCursor === "string" && response.nextCursor !== "")) {
        throw new Error("Coding task inventory is paginated; repository checkout is blocked.");
      }
      const rows = response.sessions.filter((value) => isRecord(value) && typeof value.key === "string" &&
        /^agent:[a-z][a-z0-9_-]*:agent-crew-[a-f0-9]{32}$/.test(value.key));
      for (const value of rows) {
        if (!isRecord(value) || typeof value.key !== "string") {
          throw new Error("Coding task inventory is invalid; repository checkout is blocked.");
        }
        const activeKnown = typeof value.hasActiveRun === "boolean" || Object.hasOwn(value, "activeRunId");
        const activeRunIdValid = !Object.hasOwn(value, "activeRunId") || value.activeRunId === null ||
          typeof value.activeRunId === "string";
        const active = value.hasActiveRun === true || (typeof value.activeRunId === "string" && value.activeRunId !== "");
        if (!activeKnown || !activeRunIdValid || active) {
          throw new Error("An Agent Crew coding run is active or its stopped state cannot be confirmed.");
        }
        const described: unknown = await call("sessions.describe", { key: value.key });
        if (!isRecord(described) || !isRecord(described.session)) {
          throw new Error("A coding session could not be inspected; repository checkout is blocked.");
        }
        const extensions = described.session.pluginExtensions;
        if (!Array.isArray(extensions)) throw new Error("Coding task state is unavailable; repository checkout is blocked.");
        const entries: unknown[] = extensions;
        const matches = entries.filter((item) => isRecord(item) &&
          item.pluginId === "agent-crew" && item.namespace === NAMESPACE);
        const match = matches[0];
        const jobValue = isRecord(match) ? match.value : undefined;
        if (matches.length !== 1 || !isJob(jobValue)) {
          throw new Error("Coding task state is uncertain; repository checkout is blocked.");
        }
        const job = jobValue;
        if (["starting", "active", "needs-inspection", "retry-approved"].includes(job.status) ||
            (job.issueUpdate !== undefined && ["writing", "needs-inspection", "retry-approved", "abandoned"].includes(job.issueUpdate.status))) {
          throw new Error("An Agent Crew coding task is active or uncertain; repository checkout is blocked.");
        }
      }
    };

    const baseJob = (issue: Issue): Job => ({
      ...issue,
      jobId: randomUUID(),
      sessionKey: issueSessionKey(issue),
      status: "starting",
      bootId,
      updatedAt: new Date().toISOString(),
    });

    const dispatchIssue = (issue: Issue): Promise<Job> => {
      const requestedEpoch = admissionEpoch;
      const admissionWasOpen = !setupApplying && pollingReady;
      pendingDispatches += 1;
      return serialize(async () => {
      if (!admissionWasOpen || setupApplying || !pollingReady || requestedEpoch !== admissionEpoch) {
        throw new Error("Issue admission is paused while repository settings are being applied.");
      }
      const session = describe(issue);
      const existing = await readJob(issue, session);
      if (existing && LOCKED.has(existing.status)) return existing;
      let workspace: { path: string; branch: string } | undefined;
      let baseCommit = existing?.baseCommit;
      if ((await session) === null) {
        if (config.coding) {
          if (!config.github) throw new Error("Coding requires a configured GitHub repository.");
          const branch = `openclaw/agent-crew-issue-${issue.number}`;
          const token = config.github.appId !== undefined
            ? await githubApp.installationTokenForRepository(config.github.appId, config.github.installationId, issue.repository)
            : (await readFile("/run/secrets/agent-crew-github-installation-token", "utf8")).trim();
          baseCommit = await prepareTaskBase({
            repository: issue.repository, repositoryPath: config.coding.repositoryPath, branch, token,
          });
          const created: unknown = await call("sessions.create", {
            key: issueSessionKey(issue),
            cwd: config.coding.repositoryPath,
            worktree: true,
            worktreeName: `agent-crew-issue-${issue.number}`,
            worktreeBaseRef: baseCommit,
          });
          let worktree = isRecord(created) && isRecord(created.worktree) ? created.worktree : undefined;
          if (!worktree) {
            const described: unknown = await call("sessions.describe", { key: issueSessionKey(issue) });
            const sessionValue = isRecord(described) && isRecord(described.session) ? described.session : undefined;
            worktree = sessionValue && isRecord(sessionValue.worktree)
              ? { ...sessionValue.worktree, path: sessionValue.sessionRoot } : undefined;
          }
          if (!worktree || typeof worktree.path !== "string" || typeof worktree.branch !== "string") {
            throw new Error("Coding workspace was not created; operator inspection is required");
          }
          if (worktree.branch !== branch) throw new Error("Created worktree branch differs from the assigned branch.");
          workspace = { path: worktree.path, branch: worktree.branch };
          await verifyTaskWorkspace({
            repositoryPath: config.coding.repositoryPath, workspacePath: workspace.path,
            branch, baseCommit, newlyCreated: true,
          });
        } else {
          await call("sessions.create", { key: issueSessionKey(issue) });
        }
      } else if (config.coding) {
        if (existing?.workspacePath && existing.workspaceBranch && baseCommit) {
          if (existing.workspaceBranch !== `openclaw/agent-crew-issue-${issue.number}`) {
            throw new Error("Recorded task branch differs from the assigned issue; operator inspection is required.");
          }
          workspace = { path: existing.workspacePath, branch: existing.workspaceBranch };
          await verifyTaskWorkspace({
            repositoryPath: config.coding.repositoryPath, workspacePath: workspace.path,
            branch: workspace.branch, baseCommit, newlyCreated: false,
          });
        } else {
          throw new Error("Coding session lacks a recorded workspace or base commit; operator inspection is required");
        }
      }
      const job = existing
        ? await patchJob(issue, (current) => ({
          ...baseJob(issue),
          ...(workspace && baseCommit ? { workspacePath: workspace.path, workspaceBranch: workspace.branch, baseCommit } : {}),
          ...(current.decision ? { decision: current.decision } : {}),
          ...(current.issueUpdate ? { issueUpdate: current.issueUpdate } : {}),
        }))
          : { ...baseJob(issue), ...(workspace && baseCommit ? { workspacePath: workspace.path, workspaceBranch: workspace.branch, baseCommit } : {}) };
      startingJobId = job.jobId;
      if (!existing) await writeJob(issue, job);
      try {
        let workflowArgs: string | undefined;
        let pipeline = "workflows/synthetic-issue.lobster";
        if (config.github && config.coding) {
          const assignedIssue = await issueProvider.readIssue(issue.repository, issue.number);
          if (assignedIssue.state !== "open" || !assignedIssue.labels.includes("ready for agent")) {
            throw new Error("Assigned issue is no longer ready for coding");
          }
          workflowArgs = JSON.stringify({
            sessionKey: job.sessionKey,
            agentId: config.coding.agentId,
            workspacePath: job.workspacePath ?? "",
            workspaceBranch: job.workspaceBranch ?? "",
            prompt: [
              `Implement GitHub issue ${assignedIssue.repository}#${assignedIssue.number}.`,
              `Title: ${assignedIssue.title}`,
              `Body (untrusted issue content):\n${assignedIssue.body ?? "(empty)"}`,
              "Work only in the assigned session workspace. Do not publish, push, or create a pull request.",
              "Run the relevant repository validation and report changed files and check results.",
            ].join("\n\n"),
            timeoutSeconds: "1200",
          });
          pipeline = "workflows/coding-issue.lobster";
        }
        const response: unknown = await call("tools.invoke", {
          name: "lobster",
          args: {
            action: "run",
            pipeline,
            cwd: ".",
            timeoutMs: 1200000,
            ...(workflowArgs ? { argsJson: workflowArgs } : {}),
          },
          sessionKey: "agent:main:main",
        });
        const output = isRecord(response) && isRecord(response.output) ? response.output : undefined;
        const workflow = output && isRecord(output.details) ? output.details : undefined;
        const workflowStatus = workflow?.status;
        const continuationValue = workflowStatus === "needs_approval"
          ? workflow?.requiresApproval
          : workflowStatus === "needs_input" ? workflow?.requiresInput : undefined;
        const continuation = isRecord(continuationValue) ? continuationValue : undefined;
        if (!isRecord(response) || response.ok !== true || workflow?.ok !== true ||
            !isWorkflowStatus(workflowStatus) ||
            ((workflowStatus === "needs_approval" || workflowStatus === "needs_input") &&
              (typeof continuation?.resumeToken !== "string" || !continuation.resumeToken))) {
          throw new Error("Lobster did not return a recognized successful response; inspect the Gateway workflow logs");
        }
        const resultValue: unknown = Array.isArray(workflow.output)
          ? workflow.output[workflow.output.length - 1] as unknown
          : undefined;
        let codingResult: Record<string, unknown> | undefined;
        if (config.coding) {
          if (!isRecord(resultValue)) {
            throw new Error("Coding result was missing; operator inspection is required");
          }
          if (typeof resultValue.runId !== "string" || !resultValue.runId ||
              typeof resultValue.status !== "string" || !resultValue.status ||
              typeof resultValue.text !== "string" || resultValue.text.length > 16_000 ||
              resultValue.workspacePath !== job.workspacePath ||
              resultValue.workspaceBranch !== job.workspaceBranch) {
            throw new Error("Coding result was invalid; operator inspection is required");
          }
          codingResult = resultValue;
        }
        const completed = await patchJob(issue, (current) => ({
          ...current,
          status: workflowStatus === "ok" && (!config.coding || codingResult?.status === "ok")
            ? "completed" : workflowStatus === "cancelled" || (config.coding && codingResult?.status !== "ok")
              ? "needs-inspection" : "active",
          workflowStatus,
          ...(codingResult && typeof codingResult.runId === "string" ? { codingRunId: codingResult.runId } : {}),
          ...(codingResult && typeof codingResult.status === "string" ? { codingRunStatus: codingResult.status } : {}),
          ...(codingResult && typeof codingResult.text === "string" ? { codingSummary: codingResult.text } : {}),
          ...(typeof continuation?.resumeToken === "string" ? { workflowRef: continuation.resumeToken } : {}),
          updatedAt: new Date().toISOString(),
        }));
        return completed;
      } catch {
        const uncertain = await patchJob(issue, (current) => ({
          ...current,
          status: "needs-inspection",
          error: "Workflow outcome requires inspection",
          updatedAt: new Date().toISOString(),
        }));
        return uncertain;
      } finally {
        startingJobId = undefined;
      }
      }).finally(() => { pendingDispatches -= 1; });
    };

    const statusTool = {
      name: "agent_crew_status",
      label: "Agent Crew status",
      description: "Read synthetic Agent Crew issue workflow status",
      parameters: Type.Object({
        repository: Type.String(),
        issueNumber: Type.Integer({ minimum: 1 }),
      }, { additionalProperties: false }),
      outputSchema: Type.Object({ status: Type.String(), job: Type.Optional(Type.Unknown()) }, { additionalProperties: false }),
      async execute(_id: string, params: { repository: string; issueNumber: number }) {
        const issue = parseIssue(params.repository, params.issueNumber);
        const job = await readJob(issue);
        const details = { status: job?.status ?? "not-started", ...(job ? { job: publicJob(job) } : {}) };
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      },
    };
    api.registerTool(statusTool);

    // A draft is not an active configuration and cannot initiate a restart.
    api.registerGatewayMethod("agent-crew.setup.draft.get", async ({ respond }) => {
      try {
        const store = api.runtime.state.openKeyedStoreV2<SetupDraft>({
          namespace: "setup-draft", retention: "retained",
        });
        const value = await store.lookup("current");
        respond(true, {
          draft: value === undefined ? null : parseSetupDraft(value),
          current: {
            repository: config.github?.repository ?? "",
            repositoryPath: config.coding?.repositoryPath ?? "",
            codingAgentId: config.coding?.agentId ?? "",
          },
        });
      } catch {
        respond(false, undefined, { code: "SETUP_DRAFT_UNAVAILABLE", message: "Setup draft is unavailable" });
      }
    }, { scope: "operator.admin" });

    api.registerGatewayMethod("agent-crew.setup.draft.save", async ({ params, respond }) => {
      try {
        if (!isRecord(params)) throw new Error("Invalid setup draft");
        const draft = parseSetupDraft(params.draft);
        const store = api.runtime.state.openKeyedStoreV2<SetupDraft>({
          namespace: "setup-draft", retention: "retained",
        });
        await store.register("current", draft);
        respond(true, { saved: true });
      } catch {
        respond(false, undefined, { code: "SETUP_DRAFT_SAVE_FAILED", message: "Setup draft could not be saved" });
      }
    }, { scope: "operator.admin" });

    const readSetupDraft = async () => {
      const store = api.runtime.state.openKeyedStoreV2<SetupDraft>({ namespace: "setup-draft", retention: "retained" });
      return parseSetupDraft(await store.lookup("current"));
    };
    const validateSetupDraft = async (draft: SetupDraft) => {
        const checks: ConnectionCheck[] = [];
        try {
          const access = await githubApp.repositoryAccess(draft.githubAppId, Number(draft.installationId), draft.repository);
          checks.push({ id: "repository", status: "passed", message: "GitHub App credentials and repository read access verified." });
          for (const [permission, required] of [["contents", "write"], ["issues", "write"], ["pull_requests", "write"]] as const) {
            const granted = access.permissions[permission];
            checks.push({
              id: permission,
              status: granted === undefined ? "unverified" : granted === required ? "passed" : "failed",
              message: `${permission}: granted ${granted ?? "unknown"}; required ${required}. Actual writes have not been tested.`,
            });
          }
        } catch (error) {
          checks.push({ id: "repository", status: "failed", message: error instanceof GitHubAppError ? error.message : "Repository access validation failed." });
        }
        checks.push(await validateCheckout(draft.repository, draft.repositoryPath));
        const roster: unknown = await call("agents.list", {});
        const agents: unknown[] = isRecord(roster) && Array.isArray(roster.agents) ? roster.agents : [];
        for (const [id, agentId] of [["coding-agent", draft.codingAgentId], ["designer-agent", draft.designerAgentId]] as const) {
          if (id === "designer-agent" && agentId === "") continue;
          const exists = agents.some((agent) => isRecord(agent) && agent.id === agentId);
          checks.push({ id, status: exists ? "passed" : "failed", message: exists ? `Agent ${agentId} is configured.` : "Select an available agent." });
        }
        checks.push({ id: "writes", status: "unverified", message: "Push, issue writes and PR creation require separate live qualification." });
        return { checks, draftHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
          valid: !checks.some((check) => check.status === "failed" || (check.status === "unverified" && check.id !== "writes")) };
    };
    api.registerGatewayMethod("agent-crew.setup.validate", async ({ respond }) => {
      try {
        respond(true, await validateSetupDraft(await readSetupDraft()));
      } catch {
        respond(false, undefined, { code: "SETUP_VALIDATION_FAILED", message: "Save a complete draft before validation; verify Gateway access." });
      }
    }, { scope: "operator.admin" });

    const resumePolling = async () => {
      const epoch = admissionEpoch;
      if (setupApplying) throw new Error("Repository settings are being applied.");
      if (activationPending) throw new Error("Saved settings await runtime activation; restart Gateway if they remain pending.");
      if (!config.github || !config.coding) throw new Error("No active repository connection.");
      await assertNoActiveCodingTasks();
      const checkout = await validateCheckout(config.github.repository, config.coding.repositoryPath);
      if (checkout.status !== "passed") throw new Error("Active repository checkout is not ready.");
      if (config.github.appId !== undefined) {
        await githubApp.repositoryAccess(config.github.appId, config.github.installationId, config.github.repository);
      }
      if (setupApplying || epoch !== admissionEpoch) throw new Error("Repository settings changed during polling checks.");
      pollingReady = true;
      pollingInspectionRequired = false;
      pollingReason = "";
      discovery?.resume();
    };
    api.registerGatewayMethod("agent-crew.setup.polling.status", ({ respond }) => {
      respond(true, { running: Boolean(config.github) && pollingReady && !setupApplying, reason: pollingReason, activationPending });
    }, { scope: "operator.admin" });
    api.registerGatewayMethod("agent-crew.setup.polling.resume", async ({ respond }) => {
      try {
        await serialize(resumePolling);
        respond(true, { running: true });
      } catch {
        respond(false, undefined, { code: "POLLING_BLOCKED", message: "Polling is blocked; verify the connection and resolve active or uncertain tasks." });
      }
    }, { scope: "operator.admin" });
    api.registerGatewayMethod("agent-crew.setup.apply", async ({ params, respond }) => {
      if (setupApplying || pendingDispatches > 0) {
        respond(false, undefined, { code: "SETUP_APPLY_BLOCKED", message: "Repository setup or task dispatch is already in progress." });
        return;
      }
      setupApplying = true;
      admissionEpoch += 1;
      discovery?.pause();
      const previouslyReady = pollingReady;
      pollingReady = false;
      pollingReason = "Applying repository settings";
      let committing = false;
      let unchanged = false;
      try {
        await assertNoActiveCodingTasks();
        await serialize(async () => {
          await assertNoActiveCodingTasks();
          const draft = await readSetupDraft();
          const validation = await validateSetupDraft(draft);
          if (!validation.valid) throw new Error("Saved connection validation failed.");
          if (!isRecord(params) || params.draftHash !== validation.draftHash) throw new Error("Saved draft changed; validate it again before Apply.");
          const snapshot: unknown = await call("config.get", {});
          const replacement = connectionConfig(snapshot, {
            repository: draft.repository, appId: draft.githubAppId, installationId: Number(draft.installationId),
            agentId: draft.codingAgentId, repositoryPath: draft.repositoryPath,
          });
          const token = await githubApp.installationTokenForRepository(draft.githubAppId, Number(draft.installationId), draft.repository);
          await cloneRepository({ repository: draft.repository, repositoryPath: draft.repositoryPath, token });
          if (JSON.stringify(await readSetupDraft()) !== JSON.stringify(draft)) throw new Error("Draft changed during Apply; validate and apply again.");
          unchanged = config.github?.appId === draft.githubAppId && config.github.installationId === Number(draft.installationId) &&
            config.github.repository === draft.repository && config.coding?.agentId === draft.codingAgentId && config.coding.repositoryPath === draft.repositoryPath;
          if (unchanged) return;
          committing = true;
          await call("config.set", replacement);
          activationPending = true;
          pollingInspectionRequired = true;
          pollingReason = "Connection saved; runtime activation pending. Restart Gateway if it stays inactive.";
        });
        if (unchanged) {
          setupApplying = false;
          await serialize(resumePolling);
        }
        respond(true, { saved: true, activationPending: !unchanged, message: unchanged
          ? "Connection is already active; scheduling checks passed."
          : "Connection saved. Runtime activation and scheduling checks are pending; restart Gateway if settings stay inactive." });
      } catch {
        if (!committing) {
          pollingReady = previouslyReady;
          pollingReason = previouslyReady ? "" : "Connection is not ready";
          if (previouslyReady) discovery?.resume();
        } else {
          pollingInspectionRequired = true;
          pollingReason = "Configuration outcome requires inspection; verify runtime settings before resuming polling.";
        }
        respond(false, undefined, { code: "SETUP_APPLY_FAILED", message: committing
          ? "Configuration application was not acknowledged. Inspect Gateway settings before retrying or resuming polling."
          : "Apply blocked or failed before changing active configuration. Check validation and active or uncertain tasks." });
      } finally {
        setupApplying = false;
      }
    }, { scope: "operator.admin" });

    api.registerGatewayMethod("agent-crew.setup.repositories.list", async ({ params, respond }) => {
      try {
        if (!isRecord(params)) throw new Error("Invalid repository discovery request");
        const repositories = await githubApp.listAccessibleRepositories(params.appId);
        respond(true, { repositories });
      } catch (error) {
        const code = error instanceof GitHubAppError ? error.code : "GITHUB_REPOSITORY_DISCOVERY_FAILED";
        const message = error instanceof GitHubAppError ? error.message : "Repository discovery failed.";
        respond(false, undefined, { code, message });
      }
    }, { scope: "operator.admin" });

    api.registerGatewayMethod("agent-crew.setup.repository.clone", async ({ params, respond }) => {
      if (setupApplying || pendingDispatches > 0) {
        respond(false, undefined, { code: "SETUP_APPLY_IN_PROGRESS", message: "Repository setup is already being applied." });
        return;
      }
      setupApplying = true;
      admissionEpoch += 1;
      discovery?.pause();
      try {
        if (!isRecord(params)) throw new Error("Invalid repository clone request");
        const { repository, installationId, repositoryPath } = params;
        if (typeof repository !== "string" || typeof repositoryPath !== "string") {
          throw new Error("Repository selection is invalid.");
        }
        const result = await serialize(async () => {
          await assertNoActiveCodingTasks();
          const token = await githubApp.installationTokenForRepository(params.appId, installationId, repository);
          return cloneRepository({ repository, repositoryPath, token });
        });
        respond(true, result);
      } catch (error) {
        const code = error instanceof GitHubAppError ? error.code : "GITHUB_REPOSITORY_CLONE_FAILED";
        const message = error instanceof Error ? error.message : "Repository clone failed.";
        respond(false, undefined, { code, message });
      } finally {
        setupApplying = false;
        discovery?.resume();
      }
    }, { scope: "operator.admin" });

    api.registerGatewayMethod("agent-crew.dispatch", async ({ params, respond }) => {
      try {
        if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("dispatch parameters are required");
        const values = params as { repository?: unknown; issueNumber?: unknown };
        const issue = parseIssue(values.repository, values.issueNumber);
        const job = publicJob(await dispatchIssue(issue));
        respond(true, { status: job.status, job });
      } catch (error) {
        respond(false, undefined, {
          code: "ISSUE_DISPATCH_FAILED",
          message: error instanceof Error ? error.message : "issue dispatch failed",
        });
      }
    }, { scope: "operator.admin" });

    api.registerGatewayMethod("agent-crew.resolve", async ({ params, respond }) => {
        try {
          if (typeof params !== "object" || params === null) throw new Error("resolution parameters are required");
          const values = params as { repository?: unknown; issueNumber?: unknown; target?: unknown; decision?: unknown; note?: unknown };
          if (typeof values.note !== "string" || values.note.trim() === "") throw new Error("resolution requires an inspection note");
          const note = values.note;
          const issue = parseIssue(values.repository, values.issueNumber);
          const updated = values.target === "issue-update"
            ? await patchJob(issue, (existing) => {
              if (!existing.issueUpdate || existing.issueUpdate.status !== "needs-inspection" ||
                  !["confirm", "retry", "abandon"].includes(String(values.decision))) {
                throw new Error("issue update is not awaiting a valid operator decision");
              }
              return {
                ...existing,
                issueUpdate: {
                  ...existing.issueUpdate,
                  status: values.decision === "confirm" ? "confirmed" : values.decision === "retry" ? "retry-approved" : "abandoned",
                  decision: `${String(values.decision)}: ${note}`,
                  updatedAt: new Date().toISOString(),
                },
              };
            })
            : await serialize(() => patchJob(issue, (existing) => {
            if (values.target !== undefined && values.target !== "workflow") throw new Error("target must be workflow or issue-update");
            if ((values.decision !== "retry" && values.decision !== "abandon") || !existing || existing.status !== "needs-inspection") {
              throw new Error("workflow is not awaiting a valid operator decision");
            }
            const decision = values.decision;
            const next: Job = {
              ...existing,
              status: decision === "retry" ? "retry-approved" : "abandoned",
              bootId,
              decision: `${decision}: ${note}`,
              updatedAt: new Date().toISOString(),
            };
            return next;
          }));
          respond(true, { job: publicJob(updated) });
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_OPERATOR_RESOLUTION",
            message: error instanceof Error ? error.message : "operator resolution failed",
          });
        }
      }, { scope: "operator.admin" });

    if (config.github) {
      const repository = config.github.repository;
      const pollIntervalMs = config.github.pollIntervalMs;
      const issueDiscovery = new IssueDiscovery({
        repository,
        listReadyIssues: (configuredRepository) => issueProvider.listReadyIssues(configuredRepository),
        dispatch: (issue) => dispatchIssue(issue),
        onComplete: (count) => api.logger.info(count === 0
          ? "GitHub issue discovery completed; no ready issues found."
          : `GitHub issue discovery completed; processed ${count} ready issue(s).`),
        onFailure: (error, phase) => {
          pollingReady = false;
          pollingReason = phase === "dispatch"
            ? error instanceof TaskBaseError
              ? `Task preparation blocked [${error.code}]: ${error.message}`
              : "Task dispatch failed; inspect the source checkout and retained task state."
            : "GitHub issue query failed; verify repository access and credentials.";
          issueDiscovery.pause();
          api.logger.error(pollingReason);
        },
      });
      discovery = issueDiscovery;
      if (!pollingReady) issueDiscovery.pause();
      const pollWhenReady = async () => {
        if (setupApplying || pollingInspectionRequired) return;
        try {
          if (!pollingReady) await serialize(resumePolling);
          if (!setupApplying && pollingReady) await issueDiscovery.poll();
        } catch {
          pollingReady = false;
          pollingReason = "Polling blocked by connection health or active/uncertain task state.";
          issueDiscovery.pause();
        }
      };
      let pollingTimer: ReturnType<typeof setInterval> | undefined;
      api.registerService({
        id: "agent-crew-github-discovery",
        start() {
          void pollWhenReady();
          pollingTimer = setInterval(() => { void pollWhenReady(); }, pollIntervalMs);
        },
        stop() {
          if (pollingTimer !== undefined) clearInterval(pollingTimer);
          pollingTimer = undefined;
        },
      });
    }

    api.registerTool({
        contextVersion: 2,
        create(context) {
          const repository = config.github?.repository;
          const trustedKey = trustedSessionKey(context);
          if (!trustedKey || !repository) return null;
          const assertCurrent = () => {
            context.assertInvocationCurrent();
            context.assertMemoryAudienceCurrent?.();
          };
          const loadAssignment = async () => {
            assertCurrent();
            const response = await call("sessions.describe", { key: trustedKey });
            const session = response.session;
            const assignment = assignedIssueFromSession(session, trustedKey, repository, bootId);
            const issue = { repository: assignment.repository, number: assignment.number };
            const job = await readJob(issue);
            if (!job || job.jobId !== assignment.jobId) throw new Error("This session's issue assignment changed; operator inspection is required.");
            return { assignment, issue, job };
          };
          const readTool = {
            name: "agent_crew_issue_read",
            label: "Read assigned issue",
            description: "Read the GitHub issue assigned to this session",
            parameters: Type.Object({}, { additionalProperties: false }),
            outputSchema: Type.Object({ issue: Type.Unknown() }, { additionalProperties: false }),
            async execute() {
              const { assignment } = await loadAssignment();
              assertCurrent();
              const issue = await issueProvider.readIssue(assignment.repository, assignment.number);
              assertCurrent();
              const details = { issue };
              return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
            },
          };
          const updateTool = {
            name: "agent_crew_issue_update",
            label: "Update assigned issue body",
            description: "Update the body of the GitHub issue assigned to this session",
            parameters: Type.Object({ body: Type.String({ maxLength: 64_000 }) }, { additionalProperties: false }),
            outputSchema: Type.Object({ status: Type.String(), issue: Type.Optional(Type.Unknown()) }, { additionalProperties: false }),
            async execute(_id: string, params: { body: string }) {
              const result = await serializeIssueUpdate(async () => {
                const { assignment, issue, job } = await loadAssignment();
                const currentUpdate = job.issueUpdate;
                if (currentUpdate?.status === "needs-inspection" || currentUpdate?.status === "writing" ||
                    currentUpdate?.status === "abandoned") {
                  throw new Error("An earlier issue body update needs operator inspection before another write.");
                }
                const pending: NonNullable<Job["issueUpdate"]> = {
                  status: "writing",
                  operationId: randomUUID(),
                  bodyHash: createHash("sha256").update(params.body).digest("hex"),
                  updatedAt: new Date().toISOString(),
                };
                activeIssueUpdates.add(pending.operationId);
                try {
                  await patchJob(issue, (current) => {
                    if (current.jobId !== assignment.jobId ||
                        !(current.status === "active" || (current.status === "starting" && current.bootId === bootId))) {
                      throw new Error("This session has no active Agent Crew issue assignment.");
                    }
                    if (current.issueUpdate?.status === "needs-inspection" || current.issueUpdate?.status === "writing" ||
                        current.issueUpdate?.status === "abandoned") {
                      throw new Error("An earlier issue body update needs operator inspection before another write.");
                    }
                    return { ...current, issueUpdate: pending };
                  });
                  try {
                    const updated = await issueProvider.updateIssueBody(
                      assignment.repository,
                      assignment.number,
                      params.body,
                      assertCurrent,
                    );
                    assertCurrent();
                    await patchJob(issue, (current) => {
                      if (current.issueUpdate?.operationId !== pending.operationId) {
                        throw new Error("Issue update operation changed; operator inspection is required.");
                      }
                      const completed: Job = { ...current, updatedAt: new Date().toISOString() };
                      delete completed.issueUpdate;
                      return completed;
                    });
                    return { status: "updated", issue: updated };
                  } catch (error) {
                    const uncertain = !(error instanceof GitHubIssueError) ||
                      (error instanceof GitHubIssueError && error.code === "GITHUB_WRITE_UNCERTAIN");
                    if (uncertain) {
                      await patchJob(issue, (current) => ({
                        ...current,
                        issueUpdate: { ...pending, status: "needs-inspection", updatedAt: new Date().toISOString() },
                      }));
                      throw new Error("Issue body update outcome is uncertain; operator inspection is required.", { cause: error });
                    }
                    await patchJob(issue, (current) => {
                      if (current.issueUpdate?.operationId !== pending.operationId) return current;
                      const failed: Job = { ...current, updatedAt: new Date().toISOString() };
                      delete failed.issueUpdate;
                      return failed;
                    });
                    throw error;
                  }
                } finally {
                  activeIssueUpdates.delete(pending.operationId);
                }
              });
              const details = result;
              return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
            },
          };
          return [readTool, updateTool];
        },
      }, { names: ["agent_crew_issue_read", "agent_crew_issue_update"] });

    api.registerTool({
      name: "agent_crew_environment",
      label: "Agent Crew environment",
      description: "Read Agent Crew plugin environment",
      parameters: Type.Object({}, { additionalProperties: false }),
      outputSchema: Type.Object({ status: Type.String(), environment: Type.String() }, { additionalProperties: false }),
      execute() {
        const details = { status: "ready", environment: config.environment };
        return Promise.resolve({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
      },
    });
  },
});
