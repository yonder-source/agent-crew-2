let input = "";
for await (const chunk of process.stdin) input += chunk;

let result;
try {
  const parsed = JSON.parse(input);
  result = Array.isArray(parsed) ? parsed[0] : parsed;
} catch {
  throw new Error("OpenClaw coding run returned invalid JSON.");
}

if (!result || typeof result !== "object" || Array.isArray(result) ||
    typeof result.runId !== "string" || typeof result.status !== "string") {
  throw new Error("OpenClaw coding run result is missing its run ID or status.");
}

const text = Array.isArray(result.result?.payloads)
  ? result.result.payloads
    .filter((payload) => payload && typeof payload.text === "string")
    .map((payload) => payload.text)
    .join("\n")
  : "";

process.stdout.write(JSON.stringify({ runId: result.runId, status: result.status, text }));
