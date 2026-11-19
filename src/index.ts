import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { assignedIssueFromSession, trustedSessionKey } from "./assignment.js";
import { parseConfig } from "./config.mjs";
import { IssueDiscovery } from "./discovery.js";
import { GitHubIssueError, OctokitGitHubIssueProvider } from "./github-issues.js";

const NAMESPACE = "agent-crew-job";
const AGENT_ID = "main";
const JOB_STATUSES = ["starting", "active", "completed", "needs-inspection", "retry-approved", "abandoned"] as const;
const WORKFLOW_STATUSES = ["ok", "needs_approval", "needs_input", "cancelled"] as const;
type JobStatus = typeof JOB_STATUSES[number];
type WorkflowStatus = typeof WORKFLOW_STATUSES[number];
const LOCKED = new Set(["starting", "active", "completed", "needs-inspection", "abandoned"]);

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

function sessionKey(issue: Issue): string {
  const digest = createHash("sha256").update(`${issue.repository}#${issue.number}`).digest("hex");
  return `agent:${AGENT_ID}:agent-crew-${digest.slice(0, 32)}`;
}

export default definePluginEntry({
  id: "agent-crew",
  name: "Agent Crew",
  description: "Synthetic Agent Crew issue dispatcher and status",
  register(api) {
    const config = parseConfig(api.pluginConfig);
    const bootId = randomUUID();
    let queue = Promise.resolve();
    let startingJobId: string | undefined;
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
    const describe = async (issue: Issue) => {
      const response: unknown = await call("sessions.describe", { key: sessionKey(issue) });
      const session = isRecord(response) ? response.session : undefined;
      if (session === null) return null;
      if (!isRecord(session)) {
        throw new Error("Invalid Gateway session response; operator inspection required");
      }
      const extensions = session.pluginExtensions;
      if (extensions === undefined) return [];
      if (!Array.isArray(extensions)) {
        throw new Error("Invalid session extensions; operator inspection required");
      }
      return extensions.map((item: unknown) => {
        if (!isRecord(item) || typeof item.pluginId !== "string" || typeof item.namespace !== "string") {
          throw new Error("Invalid session extensions; operator inspection required");
        }
        return { pluginId: item.pluginId, namespace: item.namespace, value: item.value };
      });
    };
    const writeJob = async (issue: Issue, job: Job): Promise<void> => {
      await call("sessions.pluginPatch", {
        key: sessionKey(issue), pluginId: "agent-crew", namespace: NAMESPACE, value: job,
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
      const extensions = await session;
      const matches = extensions?.filter((item) => item.pluginId === "agent-crew" && item.namespace === NAMESPACE) ?? [];
      if (matches.length === 0) return undefined;
      const value = matches[0]?.value;
      if (matches.length !== 1 || value === undefined) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      if (!isJob(value) || value.repository !== issue.repository || value.number !== issue.number ||
          value.sessionKey !== sessionKey(issue)) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      const job = value;
      if (job.repository !== issue.repository || job.number !== issue.number ||
          job.sessionKey !== sessionKey(issue) || typeof job.jobId !== "string" ||
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

    const baseJob = (issue: Issue): Job => ({
      ...issue,
      jobId: randomUUID(),
      sessionKey: sessionKey(issue),
      status: "starting",
      bootId,
      updatedAt: new Date().toISOString(),
    });

    const dispatchIssue = (issue: Issue): Promise<Job> => serialize(async () => {
      const session = describe(issue);
      const existing = await readJob(issue, session);
      if (existing && LOCKED.has(existing.status)) return existing;
      if ((await session) === null) await call("sessions.create", { key: sessionKey(issue) });
      const job = existing
        ? await patchJob(issue, (current) => ({
          ...baseJob(issue),
          ...(current.decision ? { decision: current.decision } : {}),
          ...(current.issueUpdate ? { issueUpdate: current.issueUpdate } : {}),
        }))
        : baseJob(issue);
      startingJobId = job.jobId;
      if (!existing) await writeJob(issue, job);
      try {
        const response: unknown = await call("tools.invoke", {
          name: "lobster",
          args: {
            action: "run",
            pipeline: "workflows/synthetic-issue.lobster",
            cwd: ".",
            timeoutMs: 1200000,
          },
          sessionKey: job.sessionKey,
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
        const completed = await patchJob(issue, (current) => ({
          ...current,
          status: workflowStatus === "ok" ? "completed" : workflowStatus === "cancelled" ? "needs-inspection" : "active",
          workflowStatus,
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
    });

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

    const issueProvider = new OctokitGitHubIssueProvider({
      getInstallationToken: async () => readFile("/run/secrets/agent-crew-github-installation-token", "utf8"),
    });
    if (config.github) {
      const repository = config.github.repository;
      const discovery = new IssueDiscovery({
        repository,
        listReadyIssues: (configuredRepository) => issueProvider.listReadyIssues(configuredRepository),
        dispatch: (issue) => dispatchIssue(issue),
        onComplete: (count) => api.logger.info(count === 0
          ? "GitHub issue discovery completed; no ready issues found."
          : `GitHub issue discovery completed; processed ${count} ready issue(s).`),
        onFailure: () => api.logger.error("GitHub issue discovery failed; no empty-result state was recorded."),
      });
      let pollingTimer: ReturnType<typeof setInterval> | undefined;
      api.registerService({
        id: "agent-crew-github-discovery",
        start() {
          void discovery.poll();
          pollingTimer = setInterval(() => { void discovery.poll(); }, config.github!.pollIntervalMs);
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
