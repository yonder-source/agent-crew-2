import { createHash, randomUUID } from "node:crypto";
import { Type } from "typebox";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig } from "./config.mjs";

const NAMESPACE = "agent-crew-job";
const AGENT_ID = "main";
const LOCKED = new Set(["starting", "active", "completed", "needs-inspection", "abandoned"]);

type Issue = { repository: string; number: number };
type Job = Issue & {
  jobId: string;
  sessionKey: string;
  status: "starting" | "active" | "completed" | "needs-inspection" | "retry-approved" | "abandoned";
  bootId: string;
  updatedAt: string;
  workflowRef?: string;
  workflowStatus?: string;
  error?: string;
  decision?: string;
};

// Explicit output boundary: continuation credentials stay in session metadata.
function publicJob(job: Job) {
  return {
    repository: job.repository, number: job.number, jobId: job.jobId,
    sessionKey: job.sessionKey, status: job.status, bootId: job.bootId,
    updatedAt: job.updatedAt,
    ...(job.workflowStatus !== undefined ? { workflowStatus: job.workflowStatus } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(job.decision !== undefined ? { decision: job.decision } : {}),
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
    api.session.state.registerSessionExtension({ namespace: NAMESPACE, description: "Issue admission and workflow status" });
    // Explicit operator credential: use the authenticated public API, not the
    // trusted-plugin-only in-process gateway.request capability.
    const call = (method: string, params: unknown) => {
      const token = process.env.AGENT_CREW_GATEWAY_TOKEN;
      if (!token) throw new Error("AGENT_CREW_GATEWAY_TOKEN is required for dispatch");
      return callGatewayFromCli(method, {
        url: "ws://127.0.0.1:18789", token, timeout: "1210000", json: true,
      }, params);
    };
    const describe = async (issue: Issue) => {
      const response = await call("sessions.describe", { key: sessionKey(issue) });
      const session: unknown = response.session;
      if (session === null) return null;
      if (typeof session !== "object" || Array.isArray(session)) {
        throw new Error("Invalid Gateway session response; operator inspection required");
      }
      const extensions = (session as { pluginExtensions?: unknown }).pluginExtensions;
      if (extensions === undefined) return [];
      if (!Array.isArray(extensions) || extensions.some((item: unknown) =>
        typeof item !== "object" || item === null || Array.isArray(item) ||
        typeof (item as { pluginId?: unknown }).pluginId !== "string" ||
        typeof (item as { namespace?: unknown }).namespace !== "string")) {
        throw new Error("Invalid session extensions; operator inspection required");
      }
      return extensions as Array<{ pluginId: string; namespace: string; value: unknown }>;
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

    const readJob = async (issue: Issue, session = describe(issue)): Promise<Job | undefined> => {
      const extensions = await session;
      const value = extensions?.find((item) => item.pluginId === "agent-crew" && item.namespace === NAMESPACE)?.value;
      if (value === undefined) return undefined;
      const job = value as Job;
      if (!job || job.repository !== issue.repository || job.number !== issue.number ||
          job.sessionKey !== sessionKey(issue) || typeof job.jobId !== "string" ||
          typeof job.bootId !== "string" || !(LOCKED.has(job.status) || job.status === "retry-approved")) {
        throw new Error("Invalid issue admission metadata; operator inspection required");
      }
      // Read-only normalization avoids a status request racing an operator reset.
      return job.status === "starting" && job.bootId !== bootId
        ? { ...job, status: "needs-inspection" as const } : job;
    };

    const baseJob = (issue: Issue): Job => ({
      ...issue,
      jobId: randomUUID(),
      sessionKey: sessionKey(issue),
      status: "starting",
      bootId,
      updatedAt: new Date().toISOString(),
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

    api.registerTool({
      name: "agent_crew_dispatch",
      label: "Dispatch synthetic issue",
      description: "Start one synthetic Lobster workflow for a repository issue",
      parameters: Type.Object({
        repository: Type.String(),
        issueNumber: Type.Integer({ minimum: 1 }),
      }, { additionalProperties: false }),
      outputSchema: Type.Object({ status: Type.String(), job: Type.Unknown() }, { additionalProperties: false }),
      async execute(_id: string, params: { repository: string; issueNumber: number }) {
        const issue = parseIssue(params.repository, params.issueNumber);
        const result = await serialize(async () => {
          const session = describe(issue);
          const existing = await readJob(issue, session);
          if (existing && LOCKED.has(existing.status)) return existing;
          if ((await session) === null) await call("sessions.create", { key: sessionKey(issue) });
          const job = { ...baseJob(issue), ...(existing?.decision ? { decision: existing.decision } : {}) };
          await writeJob(issue, job);
          try {
            const response = await call("tools.invoke", {
              name: "lobster",
              args: {
                action: "run",
                pipeline: "workflows/synthetic-issue.lobster",
                cwd: ".",
                timeoutMs: 1200000,
              },
              sessionKey: job.sessionKey,
            });
            const output = response.output as { details?: Record<string, unknown> } | undefined;
            const workflow = output?.details;
            if (response.ok !== true || workflow?.ok !== true ||
                !["ok", "needs_approval", "needs_input", "cancelled"].includes(String(workflow.status))) {
              throw new Error("Lobster did not return a recognized successful response; inspect the Gateway workflow logs");
            }
            const continuation = (workflow.requiresApproval ?? workflow.requiresInput) as { resumeToken?: string } | null;
            const completed: Job = {
              ...job,
              status: workflow.status === "ok" ? "completed" : workflow.status === "cancelled" ? "needs-inspection" : "active",
              workflowStatus: String(workflow.status),
              ...(typeof continuation?.resumeToken === "string" ? { workflowRef: continuation.resumeToken } : {}),
              updatedAt: new Date().toISOString(),
            };
            await writeJob(issue, completed);
            return completed;
          } catch (error) {
            const uncertain: Job = {
              ...job,
              status: "needs-inspection",
              error: error instanceof Error ? error.message : "workflow invocation failed",
              updatedAt: new Date().toISOString(),
            };
            await writeJob(issue, uncertain);
            return uncertain;
          }
        });
        const job = publicJob(result);
        return { content: [{ type: "text" as const, text: JSON.stringify(job) }], details: { status: job.status, job } };
      },
    });

    api.registerGatewayMethod("agent-crew.resolve", async ({ params, respond }) => {
        try {
          if (typeof params !== "object" || params === null) throw new Error("resolution parameters are required");
          const values = params as { repository?: unknown; issueNumber?: unknown; decision?: unknown; note?: unknown };
          if ((values.decision !== "retry" && values.decision !== "abandon") || typeof values.note !== "string" || values.note.trim() === "") {
            throw new Error("decision must be retry or abandon and include a note");
          }
          const decision = values.decision;
          const note = values.note;
          const issue = parseIssue(values.repository, values.issueNumber);
          const updated = await serialize(async () => {
            const existing = await readJob(issue);
            if (!existing || existing.status !== "needs-inspection") throw new Error("issue is not awaiting inspection");
            const next: Job = {
              ...existing,
              status: decision === "retry" ? "retry-approved" : "abandoned",
              bootId,
              decision: `${decision}: ${note}`,
              updatedAt: new Date().toISOString(),
            };
            await writeJob(issue, next);
            return next;
          });
          respond(true, { job: publicJob(updated) });
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_OPERATOR_RESOLUTION",
            message: error instanceof Error ? error.message : "operator resolution failed",
          });
        }
      }, { scope: "operator.admin" });

    api.registerTool({
      name: "agent_crew_environment",
      label: "Agent Crew environment",
      description: "Read Agent Crew plugin environment",
      parameters: Type.Object({}, { additionalProperties: false }),
      outputSchema: Type.Object({ status: Type.String(), environment: Type.String() }, { additionalProperties: false }),
      async execute() {
        const details = { status: "ready", environment: config.environment };
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      },
    });
  },
});
