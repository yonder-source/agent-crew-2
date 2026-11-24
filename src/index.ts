import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { assignedIssueFromSession, trustedSessionKey } from "./assignment.js";
import { parseConfig } from "./config.mjs";
import { IssueDiscovery } from "./discovery.js";
import { GitHubIssueError, OctokitGitHubIssueProvider } from "./github-issues.js";
import { GitHubAppClient, GitHubAppError } from "./github-app.js";
import {
  GitHubPullRequestError, OctokitGitHubPullRequestProvider,
  pullRequestUrlMatches, type GitHubPullRequest,
} from "./github-pulls.js";
import {
  cloneRepository, prepareTaskBase, verifyTaskWorkspace, commitTaskDelivery, verifyTaskPublication,
  inspectTaskRemoteHead, pushTaskBranch, TaskBaseError, TaskPushError,
} from "./repository-clone.js";
import { codingPrompt } from "./coding-prompt.js";
import { normalizeCodingValidation, isCodingDelivery, normalizeCodingUsage, isCodingUsage, addCodingUsage, parseTokenBudget, type CodingUsage, type CodingDelivery } from "./coding-result.js";
import { validateCheckout, type ConnectionCheck } from "./repository-validation.js";
import { connectionConfig } from "./setup-config.js";
import { draftSlackSettings, validateSlackSettings } from "./slack-settings.js";
import { authorizesSlackTaskReply, isReplyAfterSlackConnection, parseSlackTaskReply, type SlackTaskReply } from "./slack-task-reply.js";
import { isSlackTaskThread, postTaskSlackMessage, type SlackTaskThread } from "./slack-task-thread.js";
import { slackCredentialStatus } from "./slack-credentials.js";

const NAMESPACE = "agent-crew-job";
const TASK_ACTIVE_LIMIT_MS = 1_200_000;
const JOB_STATUSES = ["starting", "active", "waiting", "completed", "needs-inspection", "retry-approved", "abandoned"] as const;
const WORKFLOW_STATUSES = ["ok", "needs_approval", "needs_input", "cancelled"] as const;
type JobStatus = typeof JOB_STATUSES[number];
type WorkflowStatus = typeof WORKFLOW_STATUSES[number];
const LOCKED = new Set(["starting", "active", "waiting", "completed", "needs-inspection", "abandoned"]);
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
type PublicationPushOperation = {
  operationId: string;
  status: "writing" | "needs-inspection" | "confirmed" | "retry-approved" | "failed" | "abandoned";
  repository: string;
  ref: string;
  headCommit: string;
  updatedAt: string;
  reason?: string;
  decision?: string;
};
type PublicationPrOperation = {
  operationId: string;
  status: "writing" | "needs-inspection" | "confirmed" | "retry-approved" | "failed" | "abandoned";
  repository: string;
  issueNumber: number;
  baseRef: "main";
  headRef: string;
  headCommit: string;
  titleHash: string;
  bodyHash: string;
  updatedAt: string;
  reason?: string;
  decision?: string;
  pullRequest?: GitHubPullRequest;
};
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
  codingUsage?: CodingUsage;
  taskTokenUsage?: CodingUsage;
  tokenBudget?: number;
  inputRequest?: string;
  slackThread?: SlackTaskThread;
  activeMs?: number;
  activeTimeUncertain?: boolean;
  codingSessionId?: string;
  connection?: { agentId: string; repositoryPath: string };
  workspacePath?: string;
  workspaceBranch?: string;
  baseCommit?: string;
  codingDelivery?: CodingDelivery;
  error?: string;
  decision?: string;
  issueUpdate?: {
    status: "writing" | "needs-inspection" | "retry-approved" | "confirmed" | "abandoned";
    operationId: string;
    bodyHash: string;
    updatedAt: string;
    decision?: string;
  };
  publication?: {
    pushOperations: PublicationPushOperation[];
    prOperations?: PublicationPrOperation[];
  };
};

type PublicationAcceptance = {
  repository: string;
  issueNumber: number;
  jobId: string;
  sessionKey: string;
  codingRunId: string;
  workspacePath: string;
  workspaceBranch: string;
  baseCommit: string;
  headCommit: string;
  validation: CodingDelivery["validation"];
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
      (value.codingUsage !== undefined && !isCodingUsage(value.codingUsage)) ||
      (value.taskTokenUsage !== undefined && !isCodingUsage(value.taskTokenUsage)) ||
      (value.tokenBudget !== undefined && (typeof value.tokenBudget !== "number" || !Number.isSafeInteger(value.tokenBudget) || value.tokenBudget < 1)) ||
      (value.codingSessionId !== undefined && (typeof value.codingSessionId !== "string" || !value.codingSessionId)) ||
      (value.activeTimeUncertain !== undefined && typeof value.activeTimeUncertain !== "boolean") ||
      (value.activeMs !== undefined && (typeof value.activeMs !== "number" || !Number.isSafeInteger(value.activeMs) || value.activeMs < 0)) ||
      (value.connection !== undefined && (!isRecord(value.connection) || typeof value.connection.agentId !== "string" || typeof value.connection.repositoryPath !== "string")) ||
      (value.slackThread !== undefined && !isSlackTaskThread(value.slackThread)) ||
      (value.inputRequest !== undefined && (typeof value.inputRequest !== "string" || !value.inputRequest.trim() || value.inputRequest.length > 4_000)) ||
      (value.status === "waiting" && (typeof value.inputRequest !== "string" || value.codingRunStatus !== "ok" ||
        typeof value.codingRunId !== "string" || !value.codingRunId || typeof value.workspacePath !== "string" ||
        typeof value.workspaceBranch !== "string" || typeof value.baseCommit !== "string")) ||
      (value.codingSummary !== undefined && typeof value.codingSummary !== "string") ||
      (value.workspacePath !== undefined && typeof value.workspacePath !== "string") ||
      (value.workspaceBranch !== undefined && typeof value.workspaceBranch !== "string") ||
      (value.baseCommit !== undefined && (typeof value.baseCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.baseCommit))) ||
      (value.codingDelivery !== undefined && !isCodingDelivery(value.codingDelivery)) ||
      (value.error !== undefined && typeof value.error !== "string") ||
      (value.decision !== undefined && typeof value.decision !== "string")) return false;
  if (value.issueUpdate !== undefined) {
    const update = value.issueUpdate;
    if (!isRecord(update) ||
        !["writing", "needs-inspection", "retry-approved", "confirmed", "abandoned"].includes(String(update.status)) ||
        typeof update.operationId !== "string" || typeof update.bodyHash !== "string" ||
        typeof update.updatedAt !== "string" ||
        (update.decision !== undefined && typeof update.decision !== "string")) return false;
  }
  if (value.publication === undefined) return true;
  if (!isRecord(value.publication) || !Array.isArray(value.publication.pushOperations) ||
      value.publication.pushOperations.length === 0 || value.publication.pushOperations.length > 100) return false;
  if (!value.publication.pushOperations.every((operation) => isRecord(operation) &&
    ["writing", "needs-inspection", "confirmed", "retry-approved", "failed", "abandoned"].includes(String(operation.status)) &&
    typeof operation.operationId === "string" && typeof operation.repository === "string" &&
    typeof operation.ref === "string" && /^refs\/heads\/openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(operation.ref) &&
    typeof operation.headCommit === "string" && /^[a-f0-9]{40,64}$/.test(operation.headCommit) &&
    typeof operation.updatedAt === "string" &&
    (operation.reason === undefined || typeof operation.reason === "string") &&
    (operation.decision === undefined || typeof operation.decision === "string"))) return false;
  if (value.publication.prOperations === undefined) return true;
  if (!Array.isArray(value.publication.prOperations) || value.publication.prOperations.length === 0 ||
      value.publication.prOperations.length > 100) return false;
  return value.publication.prOperations.every((operation) => isRecord(operation) &&
    ["writing", "needs-inspection", "confirmed", "retry-approved", "failed", "abandoned"].includes(String(operation.status)) &&
    typeof operation.operationId === "string" && typeof operation.repository === "string" &&
    typeof operation.issueNumber === "number" && Number.isSafeInteger(operation.issueNumber) &&
    operation.issueNumber > 0 && operation.baseRef === "main" &&
    typeof operation.headRef === "string" &&
    /^openclaw\/agent-crew-issue-[1-9][0-9]*$/.test(operation.headRef) &&
    typeof operation.headCommit === "string" && /^[a-f0-9]{40,64}$/.test(operation.headCommit) &&
    typeof operation.titleHash === "string" && /^[a-f0-9]{64}$/.test(operation.titleHash) &&
    typeof operation.bodyHash === "string" && /^[a-f0-9]{64}$/.test(operation.bodyHash) &&
    typeof operation.updatedAt === "string" &&
    (operation.reason === undefined || typeof operation.reason === "string") &&
    (operation.decision === undefined || typeof operation.decision === "string") &&
    (operation.pullRequest === undefined || isRecord(operation.pullRequest) &&
      typeof operation.pullRequest.repository === "string" &&
      typeof operation.pullRequest.id === "number" && Number.isSafeInteger(operation.pullRequest.id) &&
      operation.pullRequest.id > 0 &&
      typeof operation.pullRequest.number === "number" && Number.isSafeInteger(operation.pullRequest.number) &&
      operation.pullRequest.number > 0 &&
      typeof operation.pullRequest.url === "string" && typeof operation.pullRequest.title === "string" &&
      operation.pullRequest.title.length <= 256 &&
      (operation.pullRequest.body === null ||
        typeof operation.pullRequest.body === "string" && operation.pullRequest.body.length <= 64_000) &&
      ["open", "closed"].includes(String(operation.pullRequest.state)) &&
      typeof operation.pullRequest.draft === "boolean" && typeof operation.pullRequest.merged === "boolean" &&
      typeof operation.pullRequest.baseRef === "string" && typeof operation.pullRequest.headRef === "string" &&
      typeof operation.pullRequest.headCommit === "string") &&
    (operation.status === "confirmed" ? operation.pullRequest !== undefined : operation.pullRequest === undefined));
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
    ...(job.codingUsage !== undefined ? { codingUsage: normalizeCodingUsage(job.codingUsage) } : {}),
    ...(job.taskTokenUsage !== undefined ? { taskTokenUsage: normalizeCodingUsage(job.taskTokenUsage) } : {}),
    ...(job.tokenBudget !== undefined ? { tokenBudget: job.tokenBudget } : {}),
    ...(job.activeTimeUncertain !== undefined ? { activeTimeUncertain: job.activeTimeUncertain } : {}),
    ...(job.activeMs !== undefined ? { activeMs: job.activeMs, activeTimeLimitMs: TASK_ACTIVE_LIMIT_MS } : {}),
    ...(job.slackThread !== undefined ? { slackThread: job.slackThread } : {}),
    ...(job.inputRequest !== undefined ? { inputRequest: job.inputRequest } : {}),
    ...(job.codingSummary !== undefined ? { codingSummary: job.codingSummary } : {}),
    ...(job.workspacePath !== undefined ? { workspacePath: job.workspacePath } : {}),
    ...(job.workspaceBranch !== undefined ? { workspaceBranch: job.workspaceBranch } : {}),
    ...(job.baseCommit !== undefined ? { baseCommit: job.baseCommit } : {}),
    ...(job.codingDelivery !== undefined ? { codingDelivery: job.codingDelivery } : {}),
    ...(job.error !== undefined ? { error: "Workflow outcome requires inspection" } : {}),
    ...(job.decision !== undefined ? { decision: job.decision } : {}),
    ...(job.issueUpdate !== undefined ? { issueUpdate: job.issueUpdate } : {}),
    ...(job.publication !== undefined ? { publication: job.publication } : {}),
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

function boundedPublicationSummary(value: string | undefined, maximum = 4_000): string {
  if (!value) return "No summary reported.";
  return value.length > maximum ? `${value.slice(0, maximum - 3)}...` : value;
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
    const admittingSessions = new Set<string>();
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
    let publicationQueue = Promise.resolve();
    const activeIssueUpdates = new Set<string>();
    const activePublicationPushes = new Set<string>();
    const activePublicationPrs = new Set<string>();
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
    const pullRequestProvider = new OctokitGitHubPullRequestProvider({
      getInstallationToken: async () => config.github?.appId !== undefined
        ? githubApp.pullRequestTokenForRepository(config.github.appId, config.github.installationId, config.github.repository)
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

    const serializePublication = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = publicationQueue.then(operation, operation);
      publicationQueue = result.then(() => undefined, () => undefined);
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
      const pushOperations = job.publication?.pushOperations;
      if (pushOperations !== undefined && (
          pushOperations.length === 0 ||
          pushOperations.some((operation) => operation.repository !== job.repository ||
            operation.ref !== `refs/heads/${job.workspaceBranch}` ||
            job.codingDelivery?.status !== "ready" ||
            operation.headCommit !== job.codingDelivery.headCommit))) {
        throw new Error("Invalid publication metadata; operator inspection required");
      }
      const prOperations = job.publication?.prOperations;
      if (prOperations !== undefined && (
          pushOperations === undefined ||
          prOperations.some((operation) =>
            operation.repository !== job.repository ||
            operation.issueNumber !== job.number ||
            operation.headRef !== job.workspaceBranch ||
            job.codingDelivery?.status !== "ready" ||
            operation.headCommit !== job.codingDelivery.headCommit ||
            operation.pullRequest !== undefined && (
              operation.pullRequest.repository !== job.repository ||
              operation.pullRequest.headRef !== operation.headRef ||
              operation.pullRequest.headCommit !== operation.headCommit ||
              operation.pullRequest.baseRef !== "main" ||
              operation.pullRequest.state !== "open" ||
              !operation.pullRequest.draft || operation.pullRequest.merged ||
              !pullRequestUrlMatches(
                operation.pullRequest.url,
                operation.repository,
                operation.pullRequest.number,
              ) ||
              createHash("sha256").update(operation.pullRequest.title).digest("hex") !== operation.titleHash ||
              !new RegExp(`(?:^|\\n)Fixes #${String(operation.issueNumber)}(?:\\s|$)`)
                .test(operation.pullRequest.body ?? "")
            )))) {
        throw new Error("Invalid pull request publication metadata; operator inspection required");
      }
      // Read-only normalization avoids a status request racing an operator reset.
      const currentPush = pushOperations?.at(-1);
      const currentPr = prOperations?.at(-1);
      return {
        ...job,
        ...(job.status === "starting" && (job.bootId !== bootId || (job.jobId !== startingJobId && !admittingSessions.has(job.sessionKey)))
          ? { status: "needs-inspection" as const } : {}),
        ...(job.issueUpdate?.status === "writing" && !activeIssueUpdates.has(job.issueUpdate.operationId)
          ? { issueUpdate: { ...job.issueUpdate, status: "needs-inspection" as const } }
          : {}),
        ...(currentPush?.status === "writing" && !activePublicationPushes.has(currentPush.operationId)
          ? {
            publication: {
              pushOperations: [
                ...pushOperations!.slice(0, -1),
                {
                  ...currentPush,
                  status: "needs-inspection" as const,
                  reason: "Push was unfinished when the Gateway stopped; inspect the remote branch.",
                  updatedAt: new Date().toISOString(),
                },
              ],
              ...(prOperations !== undefined ? { prOperations } : {}),
            },
          }
          : {}),
        ...(currentPr?.status === "writing" && !activePublicationPrs.has(currentPr.operationId)
          ? {
            publication: {
              pushOperations: pushOperations!,
              prOperations: [
                ...prOperations!.slice(0, -1),
                {
                  ...currentPr,
                  status: "needs-inspection" as const,
                  reason: "Pull request creation was unfinished when the Gateway stopped; inspect GitHub.",
                  updatedAt: new Date().toISOString(),
                },
              ],
            },
          }
          : {}),
      };
    };
    const publicationAcceptance = (job: Job): PublicationAcceptance => {
      if (job.status !== "completed") {
        throw new Error("Coding job must be completed before publication.");
      }
      if (job.codingRunStatus !== "ok") {
        throw new Error("Coding run status must be ok before publication.");
      }
      if (!job.codingDelivery || job.codingDelivery.status !== "ready") {
        throw new Error("Retained coding delivery is not ready for publication.");
      }
      if (job.codingDelivery.validation.status !== "ok") {
        throw new Error("Retained coding validation must be ok before publication.");
      }
      if (!job.workspacePath || !job.workspaceBranch || !job.baseCommit || !job.codingRunId) {
        throw new Error("Retained task binding is incomplete for publication.");
      }
      if (job.workspaceBranch !== `openclaw/agent-crew-issue-${job.number}` ||
          !config.coding || !config.github ||
          job.repository !== config.github.repository ||
          job.connection?.agentId !== config.coding.agentId ||
          job.connection.repositoryPath !== config.coding.repositoryPath) {
        throw new Error("Publication task binding no longer matches the active repository connection.");
      }
      return {
        repository: job.repository,
        issueNumber: job.number,
        jobId: job.jobId,
        sessionKey: job.sessionKey,
        codingRunId: job.codingRunId,
        workspacePath: job.workspacePath,
        workspaceBranch: job.workspaceBranch,
        baseCommit: job.baseCommit,
        headCommit: job.codingDelivery.headCommit,
        validation: job.codingDelivery.validation,
      };
    };
    const latestPublicationPush = (job: Job): PublicationPushOperation | undefined =>
      job.publication?.pushOperations.at(-1);
    const latestPublicationPr = (job: Job): PublicationPrOperation | undefined =>
      job.publication?.prOperations?.at(-1);
    const updatePublicationPush = async (
      issue: Issue,
      operation: PublicationPushOperation,
    ): Promise<Job> => patchJob(issue, (current) => {
      const operations = current.publication?.pushOperations ?? [];
      const existing = operations.findIndex((candidate) => candidate.operationId === operation.operationId);
      const pushOperations = existing < 0
        ? [...operations, operation]
        : operations.map((candidate) => candidate.operationId === operation.operationId ? operation : candidate);
      if (pushOperations.length > 100) throw new Error("Publication operation history requires inspection.");
      const prOperations = current.publication?.prOperations;
      return {
        ...current,
        publication: { pushOperations, ...(prOperations !== undefined ? { prOperations } : {}) },
        updatedAt: new Date().toISOString(),
      };
    });
    const updatePublicationPr = async (
      issue: Issue,
      operation: PublicationPrOperation,
    ): Promise<Job> => patchJob(issue, (current) => {
      const pushOperations = current.publication?.pushOperations;
      if (!pushOperations || latestPublicationPush(current)?.status !== "confirmed") {
        throw new Error("Pull request publication requires a confirmed task branch push.");
      }
      const operations = current.publication?.prOperations ?? [];
      const existing = operations.findIndex((candidate) => candidate.operationId === operation.operationId);
      const prOperations = existing < 0
        ? [...operations, operation]
        : operations.map((candidate) => candidate.operationId === operation.operationId ? operation : candidate);
      if (prOperations.length > 100) throw new Error("Pull request operation history requires inspection.");
      return {
        ...current,
        publication: { pushOperations, prOperations },
        updatedAt: new Date().toISOString(),
      };
    });
    const ensurePublicationPr = async (
      issue: Issue,
      accepted: PublicationAcceptance,
      job: Job,
      assertCurrent: () => void,
    ): Promise<PublicationPrOperation> => {
      const confirmedPush = latestPublicationPush(job);
      if (!confirmedPush || confirmedPush.status !== "confirmed") {
        throw new Error("Pull request publication requires a confirmed task branch push.");
      }
      const previous = latestPublicationPr(job);
      if (previous?.status === "writing") {
        if (activePublicationPrs.has(previous.operationId)) {
          throw new Error("Draft pull request creation is already in progress.");
        }
        return {
          ...previous,
          status: "needs-inspection",
          reason: "Pull request creation was unfinished when the Gateway stopped; inspect GitHub.",
          updatedAt: new Date().toISOString(),
        };
      }
      if (previous && previous.status !== "retry-approved") return previous;

      assertCurrent();
      const assignedIssue = await issueProvider.readIssue(issue.repository, issue.number);
      assertCurrent();
      if (assignedIssue.number !== issue.number || assignedIssue.repository !== issue.repository) {
        throw new Error("Assigned issue identity changed during pull request publication.");
      }
      if (assignedIssue.state !== "open") {
        throw new Error("Assigned issue is no longer open; inspect before creating a pull request.");
      }
      const validationSummary = accepted.validation.summary ??
        accepted.validation.checks.map((check) =>
          `${check.command}: ${check.outcome}${check.exitCode === undefined ? "" : ` (exit ${String(check.exitCode)})`}`)
          .join("\n");
      const body = [
        "## Coding summary",
        boundedPublicationSummary(job.codingSummary),
        "## Validation",
        boundedPublicationSummary(validationSummary),
        `Fixes #${String(issue.number)}`,
      ].join("\n\n");
      const operation: PublicationPrOperation = {
        operationId: randomUUID(),
        status: "needs-inspection",
        repository: accepted.repository,
        issueNumber: issue.number,
        baseRef: "main",
        headRef: accepted.workspaceBranch,
        headCommit: accepted.headCommit,
        titleHash: createHash("sha256").update(assignedIssue.title).digest("hex"),
        bodyHash: createHash("sha256").update(body).digest("hex"),
        updatedAt: new Date().toISOString(),
      };
      await updatePublicationPr(issue, operation);
      assertCurrent();
      let existing: GitHubPullRequest | undefined;
      try {
        existing = await pullRequestProvider.findExisting({
          repository: accepted.repository,
          issueNumber: issue.number,
          issueTitle: assignedIssue.title,
          headRef: accepted.workspaceBranch,
          headCommit: accepted.headCommit,
          baseRef: "main",
        });
      } catch (error) {
        const failed = {
          ...operation,
          status: error instanceof GitHubPullRequestError &&
            error.code === "GITHUB_CREDENTIAL_UNAVAILABLE" ? "failed" as const : "needs-inspection" as const,
          reason: error instanceof GitHubPullRequestError && error.code === "GITHUB_CREDENTIAL_UNAVAILABLE"
            ? "GitHub pull request credentials were unavailable."
            : "Existing pull requests could not be proven absent or matching; inspect before creating one.",
          updatedAt: new Date().toISOString(),
        };
        await updatePublicationPr(issue, failed);
        return failed;
      }
      if (existing) {
        const confirmed: PublicationPrOperation = {
          ...operation,
          status: "confirmed",
          pullRequest: existing,
          updatedAt: new Date().toISOString(),
        };
        await updatePublicationPr(issue, confirmed);
        return confirmed;
      }

      const writing: PublicationPrOperation = {
        ...operation,
        status: "writing",
        updatedAt: new Date().toISOString(),
      };
      activePublicationPrs.add(writing.operationId);
      try {
        await updatePublicationPr(issue, writing);
        assertCurrent();
        let created: GitHubPullRequest;
        try {
          created = await pullRequestProvider.create({
            repository: accepted.repository,
            issueNumber: issue.number,
            issueTitle: assignedIssue.title,
            headRef: accepted.workspaceBranch,
            headCommit: accepted.headCommit,
            baseRef: "main",
            body,
            beforeDispatch: assertCurrent,
          });
        } catch (error) {
          const rejected = error instanceof GitHubPullRequestError &&
            error.code === "GITHUB_PULL_REQUEST_CREATE_REJECTED";
          const stopped: PublicationPrOperation = {
            ...writing,
            status: rejected ? "failed" : "needs-inspection",
            reason: rejected
              ? "GitHub definitively rejected draft pull request creation."
              : "Draft pull request creation outcome is uncertain; inspect GitHub before retrying.",
            updatedAt: new Date().toISOString(),
          };
          await updatePublicationPr(issue, stopped);
          return stopped;
        }
        assertCurrent();
        const confirmed: PublicationPrOperation = {
          ...writing,
          status: "confirmed",
          pullRequest: created,
          updatedAt: new Date().toISOString(),
        };
        await updatePublicationPr(issue, confirmed);
        return confirmed;
      } finally {
        activePublicationPrs.delete(writing.operationId);
      }
    };

    const assertNoActiveCodingTasks = async (approvedRetryJobId?: string, resuming = false): Promise<void> => {
      let approvedRetryFound = false;
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
        const approvedRetry = (job.status === "retry-approved" || (resuming && job.status === "waiting")) && job.jobId === approvedRetryJobId;
        const publicationPush = latestPublicationPush(job);
        const publicationPr = latestPublicationPr(job);
        if (approvedRetry) approvedRetryFound = true;
        const blockingStatuses = resuming ? ["starting", "active", "needs-inspection", "retry-approved"]
          : ["starting", "active", "waiting", "needs-inspection", "retry-approved"];
        if ((!approvedRetry && blockingStatuses.includes(job.status)) ||
            (job.issueUpdate !== undefined && ["writing", "needs-inspection", "retry-approved", "abandoned"].includes(job.issueUpdate.status)) ||
            (publicationPush !== undefined && ["writing", "needs-inspection", "retry-approved", "abandoned"].includes(publicationPush.status)) ||
            (publicationPr !== undefined && ["writing", "needs-inspection", "retry-approved", "abandoned"].includes(publicationPr.status))) {
          throw new Error("An Agent Crew coding task is active or uncertain; repository checkout is blocked.");
        }
      }
      if (approvedRetryJobId !== undefined && !approvedRetryFound) {
        throw new Error("Approved retry is missing from the task inventory; inspect before resuming.");
      }
    };

    const baseJob = (issue: Issue): Job => ({
      ...issue,
      jobId: randomUUID(),
      sessionKey: issueSessionKey(issue),
      status: "starting",
      bootId,
      updatedAt: new Date().toISOString(),
      ...(config.coding ? { activeMs: 0, taskTokenUsage: { status: "reported", total: 0 },
        ...(config.coding.tokenBudget !== undefined ? { tokenBudget: config.coding.tokenBudget } : {}), connection: { agentId: config.coding.agentId, repositoryPath: config.coding.repositoryPath } } : {}),
    });

    const taskSlackThread = async (issue: Issue, job: Job): Promise<SlackTaskThread | undefined> => {
      const setting = config.slack?.coding;
      if (!setting) {
        if (job.slackThread) throw new Error("Task Slack configuration changed; inspect before continuing.");
        return undefined;
      }
      if (setting.agentId !== config.coding?.agentId || (job.slackThread &&
          (job.slackThread.agentId !== setting.agentId || job.slackThread.channelId !== setting.channelId ||
            JSON.stringify(job.slackThread.userIds) !== JSON.stringify(setting.userIds)))) {
        throw new Error("Task Slack binding changed; inspect before continuing.");
      }
      if (job.slackThread) {
        if (job.slackThread.status !== "ready") throw new Error("Task thread creation requires inspection.");
        return job.slackThread;
      }
      const creating: SlackTaskThread = { ...setting, userIds: [...setting.userIds], status: "creating" };
      await patchJob(issue, (current) => ({ ...current, slackThread: creating }));
      let threadTs: string;
      try {
        threadTs = await postTaskSlackMessage(setting.channelId, `Agent Crew task ${job.repository}#${job.number}`, undefined,
          (path) => readFile(path, "utf8"));
      } catch {
        await patchJob(issue, (current) => ({ ...current, slackThread: { ...creating, status: "failed" } }));
        throw new Error("Task Slack thread creation requires inspection.");
      }
      const ready: SlackTaskThread = { ...creating, status: "ready", threadTs };
      await patchJob(issue, (current) => ({ ...current, slackThread: ready }));
      return ready;
    };
    const deliverInputRequest = async (issue: Issue, job: Job): Promise<Job> => {
      const thread = job.slackThread;
      if (!thread || thread.status !== "ready" || !thread.threadTs || !job.inputRequest || !job.codingRunId) return job;
      if (thread.input?.runId === job.codingRunId) return job; // Includes uncertain sends: never replay.
      const input = { runId: job.codingRunId, status: "sending" as const };
      await patchJob(issue, (current) => ({ ...current, slackThread: { ...thread, input } }));
      let sent: SlackTaskThread["input"];
      try {
        const messageTs = await postTaskSlackMessage(thread.channelId, job.inputRequest, thread.threadTs,
          (path) => readFile(path, "utf8"));
        sent = { ...input, status: "sent", messageTs };
      } catch {
        sent = { ...input, status: "failed" };
      }
      return patchJob(issue, (current) => ({ ...current, slackThread: { ...thread, input: sent } }));
    };
    const stoppedCodingSession = async (
      job: Job,
      runId: string,
    ): Promise<string> => {
      const stopped: unknown = await call("sessions.describe", { key: job.sessionKey });
      const session = isRecord(stopped) ? stopped.session : undefined;
      if (!isRecord(session) || session.key !== job.sessionKey ||
          session.lastRunId !== runId || session.hasActiveRun !== false ||
          typeof session.sessionId !== "string" || !session.sessionId ||
          (Array.isArray(session.activeRunIds) && session.activeRunIds.length > 0) ||
          (job.codingSessionId !== undefined && job.codingSessionId !== session.sessionId)) {
        throw new Error("Coding run stopped state or native session binding could not be confirmed.");
      }
      return session.sessionId;
    };
    const runPublicationWorkflow = async (issue: Issue, job: Job): Promise<Job> => {
      if (!config.github || !config.coding || !job.codingSessionId ||
          job.status !== "completed" || job.codingRunStatus !== "ok" ||
          job.codingDelivery?.status !== "ready") return job;
      try {
        const response: unknown = await call("tools.invoke", {
          name: "lobster",
          args: {
            action: "run",
            pipeline: "workflows/publication-issue.lobster",
            cwd: ".",
            timeoutMs: 120_000,
            argsJson: JSON.stringify({
              sessionKey: job.sessionKey,
              agentId: config.coding.agentId,
            }),
          },
          sessionKey: "agent:main:main",
        });
        const details = isRecord(response) && isRecord(response.output) &&
          isRecord(response.output.details) ? response.output.details : undefined;
        const publication = Array.isArray(details?.output)
          ? details.output[details.output.length - 1] as unknown
          : undefined;
        if (!isRecord(response) || response.ok !== true || details?.ok !== true ||
            details.status !== "ok" || !isRecord(publication) ||
            typeof publication.status !== "string") {
          throw new Error("Lobster publication result was invalid.");
        }
        return await readJob(issue) ?? job;
      } catch {
        api.logger.error(`Publication workflow requires inspection for ${issue.repository}#${issue.number}.`);
        return job;
      }
    };

    const dispatchIssue = (issue: Issue, operatorRetry = false, resume?: { expectedRunId: string; input: string; slackReply?: SlackTaskReply; onAdmitted?: () => void }): Promise<Job> => {
      const requestedEpoch = admissionEpoch;
      const admissionWasOpen = !setupApplying && pollingReady;
      pendingDispatches += 1;
      return serialize(async () => {
      if (setupApplying || activationPending || pollingInspectionRequired || requestedEpoch !== admissionEpoch) {
        throw new Error("Issue admission is paused while repository settings are being applied.");
      }
      const session = describe(issue);
      const existing = await readJob(issue, session);
      const approvedRetry = operatorRetry && existing?.status === "retry-approved";
      if (resume) {
        if (!existing || existing.status !== "waiting" || existing.codingRunId !== resume.expectedRunId ||
            !config.coding || !config.github || issue.repository !== config.github.repository ||
            existing.connection?.agentId !== config.coding.agentId || existing.connection.repositoryPath !== config.coding.repositoryPath ||
            existing.activeMs === undefined || existing.activeTimeUncertain === true) throw new Error("Waiting task binding or elapsed usage requires inspection.");
        if (resume.slackReply && (!existing.slackThread ||
            !authorizesSlackTaskReply(existing.slackThread, resume.slackReply, resume.expectedRunId))) {
          throw new Error("Slack reply no longer matches the authorized waiting question.");
        }
        const view = await session;
        if (!view || !existing.codingSessionId || view.session.sessionId !== existing.codingSessionId ||
            view.session.lastRunId !== resume.expectedRunId || view.session.hasActiveRun !== false ||
            (Array.isArray(view.session.activeRunIds) && view.session.activeRunIds.length > 0) ||
            (view.session.workspaceDir ?? view.session.sessionRoot) !== existing.workspacePath) {
          throw new Error("Native session changed or stopped state is unknown; inspect before resuming.");
        }
        await assertNoActiveCodingTasks(existing.jobId, true);
      }
      if ((!admissionWasOpen || !pollingReady) && !approvedRetry && !resume) {
        throw new Error("Issue admission is paused while repository settings are being applied.");
      }
      if (approvedRetry && config.coding) {
        if (existing.activeTimeUncertain === true) throw new Error("Interrupted active time is unknown; inspect usage before retrying.");
        await assertNoActiveCodingTasks(existing.jobId);
      }
      if (existing && LOCKED.has(existing.status) && !resume) {
        return existing.status === "completed"
          ? runPublicationWorkflow(issue, existing)
          : existing;
      }
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
      const priorUsage: CodingUsage = existing ? normalizeCodingUsage(existing.taskTokenUsage) : { status: "reported", total: 0 };
      const tokenBudget = existing ? existing.tokenBudget : config.coding?.tokenBudget;
      if (config.coding && existing && (tokenBudget !== config.coding.tokenBudget ||
          (tokenBudget !== undefined && (priorUsage.status === "unknown" || priorUsage.total >= tokenBudget)))) {
        return patchJob(issue, current => ({ ...current, status: "needs-inspection", error: "Task token budget reached, changed or usage unknown.", updatedAt: new Date().toISOString() }));
      }
      const usedMs = existing?.activeMs ?? 0;
      const remainingSeconds = Math.floor((TASK_ACTIVE_LIMIT_MS - usedMs) / 1000);
      if (config.coding && remainingSeconds < 1) {
        if (!existing) throw new Error("Task active-time budget is exhausted.");
        return patchJob(issue, (current) => ({ ...current, status: "needs-inspection", error: "Task active-time limit reached", updatedAt: new Date().toISOString() }));
      }
      let job: Job;
      admittingSessions.add(issueSessionKey(issue));
      try {
        job = existing
          ? await patchJob(issue, (current) => ({
            ...baseJob(issue),
            ...(resume ? { jobId: current.jobId, codingSessionId: current.codingSessionId } : {}),
            ...(config.coding ? { activeMs: usedMs, activeTimeUncertain: true, taskTokenUsage: { status: "unknown" },
              ...(tokenBudget !== undefined ? { tokenBudget } : {}) } : {}),
            ...(workspace && baseCommit ? { workspacePath: workspace.path, workspaceBranch: workspace.branch, baseCommit } : {}),
            ...(current.slackThread ? { slackThread: { ...current.slackThread,
              ...(resume?.slackReply ? { acceptedReplyTs: resume.slackReply.messageTs } : {}) } } : {}),
            ...(current.decision ? { decision: current.decision } : {}),
            ...(current.issueUpdate ? { issueUpdate: current.issueUpdate } : {}),
          }))
          : { ...baseJob(issue), ...(workspace && baseCommit ? { workspacePath: workspace.path, workspaceBranch: workspace.branch, baseCommit } : {}) };
        startingJobId = job.jobId;
        if (!existing) await writeJob(issue, config.coding ? { ...job, activeTimeUncertain: true, taskTokenUsage: { status: "unknown" } } : job);
      } catch (error) {
        startingJobId = undefined;
        throw error;
      } finally {
        admittingSessions.delete(issueSessionKey(issue));
      }
      resume?.onAdmitted?.();
      let turnStartedAt: number | undefined;
      let activeMs = usedMs;
      let turnSubmitted = false;
      try {
        let workflowArgs: string | undefined;
        let pipeline = "workflows/synthetic-issue.lobster";
        if (config.github && config.coding) {
          const assignedIssue = await issueProvider.readIssue(issue.repository, issue.number);
          if (assignedIssue.state !== "open" || !assignedIssue.labels.includes("ready for agent")) {
            throw new Error("Assigned issue is no longer ready for coding");
          }
          await taskSlackThread(issue, job);
          workflowArgs = JSON.stringify({
            sessionKey: job.sessionKey,
            agentId: config.coding.agentId,
            workspacePath: job.workspacePath ?? "",
            workspaceBranch: job.workspaceBranch ?? "",
            prompt: codingPrompt({
              repository: job.repository, number: job.number,
              workspacePath: job.workspacePath ?? "", branch: job.workspaceBranch ?? "",
              title: assignedIssue.title, body: assignedIssue.body,
              ...(resume ? { humanInput: resume.input } : {}),
            }),
            timeoutSeconds: String(remainingSeconds),
          });
          pipeline = "workflows/coding-issue.lobster";
        }
        turnStartedAt = performance.now();
        turnSubmitted = true;
        const response: unknown = await call("tools.invoke", {
          name: "lobster",
          args: {
            action: "run",
            pipeline,
            cwd: ".",
            timeoutMs: remainingSeconds * 1000,
            ...(workflowArgs ? { argsJson: workflowArgs } : {}),
          },
          sessionKey: "agent:main:main",
        });
        activeMs += Math.ceil(performance.now() - turnStartedAt);
        turnStartedAt = undefined;
        if (!Number.isSafeInteger(activeMs) || activeMs < usedMs || activeMs >= TASK_ACTIVE_LIMIT_MS) throw new Error("Task active-time limit reached or unknown.");
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
        let taskTokenUsage: CodingUsage = { status: "unknown" };
        let tokenBlocked = false;
        let codingResult: Record<string, unknown> | undefined;
        let codingDelivery: CodingDelivery | undefined;
        let inputRequest: string | undefined;
        let codingSessionId: string | undefined;
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
          taskTokenUsage = addCodingUsage(priorUsage, normalizeCodingUsage(resultValue.usage));
          tokenBlocked = tokenBudget !== undefined && (taskTokenUsage.status === "unknown" || taskTokenUsage.total >= tokenBudget);
          if (workflowStatus === "ok" && !tokenBlocked) {
            codingSessionId = await stoppedCodingSession(job, resultValue.runId);
          }
          if (resultValue.requestInput !== undefined && !tokenBlocked) {
            if (typeof resultValue.requestInput !== "string" || !resultValue.requestInput.trim() ||
                resultValue.requestInput.length > 4_000 || workflowStatus !== "ok" || codingResult.status !== "ok") {
              throw new Error("Coding input request is invalid or the turn did not finish successfully.");
            }
            inputRequest = resultValue.requestInput.trim();
          }
          if (workflowStatus === "ok" && inputRequest === undefined && !tokenBlocked) {
            const validation = normalizeCodingValidation(resultValue.validation);
            codingDelivery = {
              status: "needs-inspection", validation,
              reason: codingResult.status !== "ok" ? "coding-failed"
                : validation.status === "failed" ? "validation-failed"
                  : validation.status === "unknown" ? "validation-unknown" : "worktree-unverified",
            };
            if (codingResult.status === "ok" && validation.status === "ok" &&
                job.workspacePath && job.workspaceBranch && job.baseCommit) {
              try {
                const headCommit = await commitTaskDelivery({
                  repositoryPath: config.coding.repositoryPath, workspacePath: job.workspacePath,
                  branch: job.workspaceBranch, baseCommit: job.baseCommit, issueNumber: job.number,
                });
                codingDelivery = { status: "ready", validation, headCommit };
              } catch {
                // Keep the run and validation evidence, but never mark an unverified delivery ready.
              }
            }
          }
        }
        const completed = await patchJob(issue, (current) => {
          const next = { ...current };
          delete next.inputRequest;
          delete next.codingUsage;
          delete next.codingDelivery;
          delete next.workflowRef;
          delete next.error;
          return {
            ...next,
            status: tokenBlocked ? "needs-inspection" : inputRequest !== undefined ? "waiting" : workflowStatus === "ok" && (!config.coding || codingDelivery?.status === "ready")
              ? "completed" : workflowStatus === "cancelled" || (config.coding && codingResult?.status !== "ok")
                || codingDelivery?.status === "needs-inspection"
                ? "needs-inspection" : "active",
            workflowStatus,
            ...(config.coding ? { activeMs, activeTimeUncertain: false } : {}),
            ...(inputRequest !== undefined ? { inputRequest } : {}),
            ...(codingSessionId !== undefined ? { codingSessionId } : {}),
            ...(codingResult && typeof codingResult.runId === "string" ? { codingRunId: codingResult.runId } : {}),
            ...(codingResult && typeof codingResult.status === "string" ? { codingRunStatus: codingResult.status } : {}),
            ...(config.coding ? { codingUsage: normalizeCodingUsage(codingResult?.usage), taskTokenUsage } : {}),
            ...(tokenBlocked ? { error: "Task token budget reached or usage unknown." } : {}),
            ...(codingResult && typeof codingResult.text === "string" ? { codingSummary: codingResult.text } : {}),
            ...(codingDelivery ? { codingDelivery } : {}),
            ...(typeof continuation?.resumeToken === "string" ? { workflowRef: continuation.resumeToken } : {}),
            updatedAt: new Date().toISOString(),
          };
        });
        const retained = completed.status === "waiting" ? await deliverInputRequest(issue, completed) : completed;
        return retained.status === "completed" ? await runPublicationWorkflow(issue, retained) : retained;
      } catch {
        const retained = await readJob(issue);
        if (retained?.status === "waiting") return retained;
        if (turnStartedAt !== undefined) activeMs += Math.ceil(performance.now() - turnStartedAt);
        const uncertain = await patchJob(issue, (current) => ({
          ...current,
          status: "needs-inspection",
          ...(Number.isSafeInteger(activeMs) && activeMs >= usedMs && config.coding ? { activeMs, activeTimeUncertain: turnSubmitted } : {}),
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

    api.registerGatewayMethod("agent-crew.setup.slack.credentials", async ({ respond }) => {
      respond(true, await slackCredentialStatus((path) => readFile(path, "utf8")));
    }, { scope: "operator.admin" });

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
            githubAppId: config.github?.appId ?? "",
            installationId: config.github?.installationId?.toString() ?? "",
            repository: config.github?.repository ?? "",
            repositoryPath: config.coding?.repositoryPath ?? "",
            codingAgentId: config.coding?.agentId ?? "",
            tokenBudget: config.coding?.tokenBudget?.toString() ?? "",
            codingChannelId: config.slack?.coding?.channelId ?? "",
            codingUserIds: config.slack?.coding?.userIds.join(", ") ?? "",
            designerAgentId: config.slack?.designer?.agentId ?? "",
            designerChannelId: config.slack?.designer?.channelId ?? "",
            designerUserIds: config.slack?.designer?.userIds.join(", ") ?? "",
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
          parseTokenBudget(draft.tokenBudget);
          checks.push({ id: "token-budget", status: "passed", message: draft.tokenBudget ? "Token budget is valid; checked between coding turns." : "No token limit configured." });
        } catch {
          checks.push({ id: "token-budget", status: "failed", message: "Token budget must be a positive safe integer or empty." });
        }
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
        try {
          checks.push(...await validateSlackSettings(draftSlackSettings(draft), (path) => readFile(path, "utf8")));
        } catch {
          checks.push({ id: "slack-settings", status: "failed", message: "Each Slack role requires an agent, channel ID and authorized user IDs." });
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
            agentId: draft.codingAgentId, repositoryPath: draft.repositoryPath, tokenBudget: parseTokenBudget(draft.tokenBudget), slack: draftSlackSettings(draft),
          });
          const token = await githubApp.installationTokenForRepository(draft.githubAppId, Number(draft.installationId), draft.repository);
          await cloneRepository({ repository: draft.repository, repositoryPath: draft.repositoryPath, token });
          if (JSON.stringify(await readSetupDraft()) !== JSON.stringify(draft)) throw new Error("Draft changed during Apply; validate and apply again.");
          unchanged = config.github?.appId === draft.githubAppId && config.github.installationId === Number(draft.installationId) &&
            config.github.repository === draft.repository && config.coding?.agentId === draft.codingAgentId && config.coding.repositoryPath === draft.repositoryPath &&
            config.coding?.tokenBudget === parseTokenBudget(draft.tokenBudget) &&
            JSON.stringify(config.slack ?? {}) === JSON.stringify(draftSlackSettings(draft));
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
        const job = publicJob(await dispatchIssue(issue, true));
        respond(true, { status: job.status, job });
      } catch (error) {
        respond(false, undefined, {
          code: "ISSUE_DISPATCH_FAILED",
          message: error instanceof Error ? error.message : "issue dispatch failed",
        });
      }
    }, { scope: "operator.admin" });

    // Claim before queueing: later replies must receive busy, never become steering.
    const pendingResumes = new Set<string>();
    const resumeTask = async (issue: Issue, expectedRunId: string, input: string, slackReply?: SlackTaskReply, onAdmitted?: () => void): Promise<Job> => {
      const key = issueSessionKey(issue);
      if (pendingResumes.has(key)) throw new Error("Task is busy; wait for another input request.");
      pendingResumes.add(key);
      try { return await dispatchIssue(issue, false, { expectedRunId, input, ...(slackReply ? { slackReply } : {}), ...(onAdmitted ? { onAdmitted } : {}) }); }
      finally { pendingResumes.delete(key); }
    };
    api.registerGatewayMethod("agent-crew.resume", async ({ params, respond }) => {
      try {
        if (!isRecord(params) || typeof params.expectedRunId !== "string" || !params.expectedRunId || params.expectedRunId.length > 200 ||
            typeof params.input !== "string" || !params.input.trim() || params.input.length > 16_000) {
          throw new Error("Resume requires the waiting run ID and bounded human input.");
        }
        const issue = parseIssue(params.repository, params.issueNumber);
        const job = await resumeTask(issue, params.expectedRunId, params.input);
        respond(true, { status: job.status, job: publicJob(job) });
      } catch (error) {
        respond(false, undefined, { code: "TASK_RESUME_BLOCKED", message: error instanceof Error ? error.message : "Task resume requires inspection." });
      }
    }, { scope: "operator.admin" });
    api.registerGatewayMethod("agent-crew.publication.accept", async ({ respond, sessionAccessAuthority }) => {
      try {
        if (!sessionAccessAuthority) {
          throw new Error("Publication acceptance requires an authenticated task session.");
        }
        await serializePublication(async () => {
          sessionAccessAuthority.assertCurrent();
          const target = sessionAccessAuthority.target;
          const response: unknown = await call("sessions.describe", { key: target.sessionKey });
          const session = isRecord(response) ? response.session : undefined;
          if (!isRecord(session) || !Array.isArray(session.pluginExtensions)) {
            throw new Error("Publication task session metadata is unavailable.");
          }
          const extensions = session.pluginExtensions;
          const matches = extensions.filter((item: unknown) => isRecord(item) &&
            item.pluginId === "agent-crew" && item.namespace === NAMESPACE);
          const retained: unknown = matches.length === 1 && isRecord(matches[0]) ? matches[0].value : undefined;
          sessionAccessAuthority.assertCurrent();
          if (!isJob(retained) || retained.sessionKey !== target.sessionKey ||
              retained.sessionKey !== issueSessionKey(retained) ||
              retained.repository !== config.github?.repository) {
            throw new Error("Publication request does not match the retained task binding.");
          }
          if (!retained.codingSessionId ||
              target.sessionId !== retained.codingSessionId ||
              session.sessionId !== retained.codingSessionId) {
            throw new Error("Publication request does not match the retained native coding session.");
          }
          const accepted = publicationAcceptance(retained);
          const issue = { repository: retained.repository, number: retained.number };
          const previous = latestPublicationPush(retained);
          const respondAfterConfirmedPush = async (job: Job, push: PublicationPushOperation) => {
            const pullRequest = await ensurePublicationPr(
              issue, accepted, job, () => sessionAccessAuthority.assertCurrent(),
            );
            respond(true, {
              status: pullRequest.status,
              publication: accepted,
              push,
              pullRequest,
            });
          };
          if (previous?.status === "writing") {
            if (activePublicationPushes.has(previous.operationId)) {
              throw new Error("Task branch publication is already in progress.");
            }
            const inspection: PublicationPushOperation = {
              ...previous,
              status: "needs-inspection",
              reason: "Push was unfinished when the Gateway stopped; inspect the remote branch.",
              updatedAt: new Date().toISOString(),
            };
            await updatePublicationPush(retained, inspection);
            respond(true, { status: inspection.status, publication: accepted, push: inspection });
            return;
          }
          if (previous && previous.status !== "retry-approved") {
            if (previous.status === "confirmed") {
              await respondAfterConfirmedPush(retained, previous);
            } else {
              respond(true, { status: previous.status, publication: accepted, push: previous });
            }
            return;
          }
          const operation: PublicationPushOperation = {
            operationId: randomUUID(),
            status: "needs-inspection",
            repository: accepted.repository,
            ref: `refs/heads/${accepted.workspaceBranch}`,
            headCommit: accepted.headCommit,
            updatedAt: new Date().toISOString(),
          };
          try {
            await verifyTaskPublication({
              repository: accepted.repository,
              repositoryPath: config.coding!.repositoryPath,
              workspacePath: accepted.workspacePath,
              branch: accepted.workspaceBranch,
              baseCommit: accepted.baseCommit,
              expectedHead: accepted.headCommit,
            });
          } catch {
            const blocked = {
              ...operation,
              reason: "Worktree, branch, base ancestry, clean state or exact head verification failed.",
            };
            await updatePublicationPush(retained, blocked);
            respond(true, { status: blocked.status, publication: accepted, push: blocked });
            return;
          }
          sessionAccessAuthority.assertCurrent();
          let token: string;
          try {
            token = config.github?.appId !== undefined
              ? await githubApp.publicationTokenForRepository(
                config.github.appId, config.github.installationId, accepted.repository,
              )
              : (await readFile("/run/secrets/agent-crew-github-installation-token", "utf8")).trim();
            if (!token) throw new Error("Publication token is empty.");
          } catch {
            const failed: PublicationPushOperation = {
              ...operation,
              status: "failed",
              reason: "GitHub publication credentials were unavailable.",
            };
            await updatePublicationPush(retained, failed);
            respond(true, { status: failed.status, publication: accepted, push: failed });
            return;
          }
          sessionAccessAuthority.assertCurrent();
          let remoteHead: string | undefined;
          try {
            remoteHead = await inspectTaskRemoteHead({
              repository: accepted.repository,
              token,
              workspacePath: accepted.workspacePath,
              branch: accepted.workspaceBranch,
            });
          } catch {
            const inspection = {
              ...operation,
              reason: "Existing remote task branch could not be inspected unambiguously.",
            };
            await updatePublicationPush(retained, inspection);
            respond(true, { status: inspection.status, publication: accepted, push: inspection });
            return;
          }
          sessionAccessAuthority.assertCurrent();
          if (remoteHead !== undefined) {
            const matching: PublicationPushOperation = remoteHead === accepted.headCommit
              ? { ...operation, status: "confirmed", updatedAt: new Date().toISOString() }
              : {
                ...operation,
                reason: `Remote task branch has incompatible head ${remoteHead}.`,
              };
            const matchingJob = await updatePublicationPush(retained, matching);
            if (matching.status === "confirmed") {
              await respondAfterConfirmedPush(matchingJob, matching);
            } else {
              respond(true, { status: matching.status, publication: accepted, push: matching });
            }
            return;
          }
          const writing: PublicationPushOperation = {
            ...operation,
            status: "writing",
            updatedAt: new Date().toISOString(),
          };
          activePublicationPushes.add(writing.operationId);
          try {
            await updatePublicationPush(retained, writing);
            sessionAccessAuthority.assertCurrent();
            let dispatchStarted = false;
            try {
              await verifyTaskPublication({
                repository: accepted.repository,
                repositoryPath: config.coding!.repositoryPath,
                workspacePath: accepted.workspacePath,
                branch: accepted.workspaceBranch,
                baseCommit: accepted.baseCommit,
                expectedHead: accepted.headCommit,
              });
              sessionAccessAuthority.assertCurrent();
              dispatchStarted = true;
              await pushTaskBranch({
                repository: accepted.repository,
                token,
                workspacePath: accepted.workspacePath,
                branch: accepted.workspaceBranch,
                expectedHead: accepted.headCommit,
                ...(remoteHead !== undefined ? { previousRemoteHead: remoteHead } : {}),
              });
            } catch (error) {
              const rejected = error instanceof TaskPushError && error.code === "PUSH_REJECTED";
              const failed = {
                ...writing,
                status: rejected ? "failed" as const : "needs-inspection" as const,
                reason: !dispatchStarted
                  ? "Publication binding changed during final worktree verification; no push was dispatched."
                  : rejected
                    ? "GitHub definitively rejected the branch push without a confirmed remote effect."
                    : "Branch push outcome is uncertain or the remote branch changed; inspect before retrying.",
                updatedAt: new Date().toISOString(),
              };
              await updatePublicationPush(retained, failed);
              respond(true, { status: failed.status, publication: accepted, push: failed });
              return;
            }
            sessionAccessAuthority.assertCurrent();
            const confirmed: PublicationPushOperation = {
              ...writing,
              status: "confirmed",
              updatedAt: new Date().toISOString(),
            };
            const confirmedJob = await updatePublicationPush(retained, confirmed);
            await respondAfterConfirmedPush(confirmedJob, confirmed);
          } finally {
            activePublicationPushes.delete(writing.operationId);
          }
        });
      } catch (error) {
        respond(false, undefined, {
          code: "PUBLICATION_ACCEPTANCE_BLOCKED",
          message: error instanceof Error ? error.message : "Publication acceptance requires inspection.",
        });
      }
    }, { scope: "operator.write", sessionAccess: { mode: "write" } });

    const claimedSlackThreads = new Map<string, symbol>();
    api.on("before_dispatch", async (event, context) => {
      if (context.channelId !== "slack" || !config.slack?.coding) return;
      // This installation owns Slack task input. Never fall through to an ordinary model turn.
      let releaseClaim: (() => void) | undefined;
      try {
        const reply = parseSlackTaskReply(event, context);
        const setting = config.slack.coding;
        if (!reply || reply.channelId !== setting.channelId || !setting.userIds.includes(reply.userId)) return { handled: true };
        const threadKey = `${reply.channelId}:${reply.threadTs}`;
        if (claimedSlackThreads.has(threadKey)) return { handled: true, text: "Task is busy; wait for another input request." };
        const claimToken = Symbol();
        claimedSlackThreads.set(threadKey, claimToken);
        const release = () => { if (claimedSlackThreads.get(threadKey) === claimToken) claimedSlackThreads.delete(threadKey); };
        releaseClaim = release;
        const transport: unknown = await call("channels.status", { probe: false });
        const accounts = isRecord(transport) && isRecord(transport.channelAccounts) && Array.isArray(transport.channelAccounts.slack)
          ? transport.channelAccounts.slack as unknown[] : [];
        const defaults = accounts.filter(account => isRecord(account) && account.accountId === "default");
        const account = defaults[0];
        if (defaults.length !== 1 || !isRecord(account) || account.running !== true || account.connected !== true ||
            !isReplyAfterSlackConnection(reply, account.lastConnectedAt)) return { handled: true };
        const inventory: unknown = await call("sessions.list", { archived: "all", limit: 5000 });
        if (!isRecord(inventory) || !Array.isArray(inventory.sessions) || inventory.sessions.length >= 5000 ||
            inventory.hasMore === true || (typeof inventory.totalCount === "number" && inventory.totalCount > inventory.sessions.length) ||
            (typeof inventory.nextOffset === "number" && inventory.nextOffset > 0) ||
            (typeof inventory.nextCursor === "string" && inventory.nextCursor)) throw new Error("Incomplete task inventory");
        const matches: Job[] = [];
        for (const row of inventory.sessions) {
          if (!isRecord(row) || typeof row.key !== "string" || !/^agent:[a-z][a-z0-9_-]*:agent-crew-[a-f0-9]{32}$/.test(row.key)) continue;
          const described: unknown = await call("sessions.describe", { key: row.key });
          if (!isRecord(described) || !isRecord(described.session) || !Array.isArray(described.session.pluginExtensions)) throw new Error("Unknown task state");
          const extensions: unknown[] = described.session.pluginExtensions;
          const entries = extensions.filter(value => isRecord(value) && value.pluginId === "agent-crew" && value.namespace === NAMESPACE);
          if (entries.length !== 1 || !isRecord(entries[0]) || !isJob(entries[0].value)) throw new Error("Unknown task binding");
          const job = entries[0].value;
          if (job.slackThread?.channelId === reply.channelId && job.slackThread.threadTs === reply.threadTs) {
            if (job.sessionKey !== row.key || job.sessionKey !== issueSessionKey(job) || job.repository !== config.github?.repository) throw new Error("Task identity changed");
            matches.push(job);
          }
        }
        if (matches.length > 1) throw new Error("Ambiguous task thread binding");
        if (matches.length === 0) return { handled: true };
        const job = matches[0];
        if (!job || !job.slackThread || !job.codingRunId) return { handled: true };
        if (pendingResumes.has(job.sessionKey) || job.status === "starting" || job.status === "active") {
          return { handled: true, text: "Task is busy; wait for another input request." };
        }
        if (job.status !== "waiting" || !authorizesSlackTaskReply(job.slackThread, reply, job.codingRunId)) return { handled: true };
        let accept: () => void = () => {};
        const admitted = new Promise<"accepted">((resolve) => { accept = () => resolve("accepted"); });
        const execution = resumeTask(job, job.codingRunId, reply.text, reply, accept);
        // The durable starting marker owns recovery if this process stops after acceptance.
        const settled = execution.then(() => "settled" as const, () => "failed" as const)
          .finally(release);
        const outcome = await Promise.race([admitted, settled]);
        if (outcome !== "accepted") return { handled: true, text: "Task reply requires operator inspection; no automatic retry was started." };
        releaseClaim = undefined; // The background execution owns the claim until it settles.
        return { handled: true };
      } catch {
        return { handled: true, text: "Task reply requires operator inspection; no automatic retry was started." };
      } finally {
        releaseClaim?.();
      }
    });

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
            : values.target === "publication-push"
              ? await serializePublication(async () => patchJob(issue, (existing) => {
                const current = latestPublicationPush(existing);
                if (!current || (current.status !== "needs-inspection" && current.status !== "failed") ||
                    (values.decision !== "retry" && values.decision !== "abandon")) {
                  throw new Error("publication push is not awaiting a valid operator decision");
                }
                const resolved: PublicationPushOperation = {
                  ...current,
                  status: values.decision === "retry" ? "retry-approved" : "abandoned",
                  decision: `${values.decision}: ${note}`,
                  updatedAt: new Date().toISOString(),
                };
                return {
                  ...existing,
                  publication: {
                    pushOperations: [
                      ...existing.publication!.pushOperations.slice(0, -1),
                      resolved,
                    ],
                  },
                  updatedAt: new Date().toISOString(),
                };
              }))
            : values.target === "publication-pr"
              ? await serializePublication(async () => patchJob(issue, (existing) => {
                const current = latestPublicationPr(existing);
                if (!current || (current.status !== "needs-inspection" && current.status !== "failed") ||
                    (values.decision !== "retry" && values.decision !== "abandon")) {
                  throw new Error("publication pull request is not awaiting a valid operator decision");
                }
                const resolved: PublicationPrOperation = {
                  ...current,
                  status: values.decision === "retry" ? "retry-approved" : "abandoned",
                  decision: `${values.decision}: ${note}`,
                  updatedAt: new Date().toISOString(),
                };
                return {
                  ...existing,
                  publication: {
                    pushOperations: existing.publication!.pushOperations,
                    prOperations: [
                      ...existing.publication!.prOperations!.slice(0, -1),
                      resolved,
                    ],
                  },
                  updatedAt: new Date().toISOString(),
                };
              }))
            : await serialize(() => patchJob(issue, (existing) => {
            if (values.target !== undefined && values.target !== "workflow") {
              throw new Error("target must be workflow, issue-update, publication-push or publication-pr");
            }
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
