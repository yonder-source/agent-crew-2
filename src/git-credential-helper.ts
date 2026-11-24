import { connect } from "node:net";

async function run(): Promise<void> {
  const socketPath = process.env.AGENT_CREW_CREDENTIAL_SOCKET;
  if (!socketPath || process.argv[2] !== "get") return;
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    if (typeof chunk !== "string") return;
    input += chunk;
    if (input.length > 8_192) return;
  }
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(socketPath);
    let output = "";
    socket.setTimeout(5_000, () => socket.destroy(new Error("credential helper timeout")));
    socket.on("data", (chunk) => { output += chunk.toString(); });
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`${JSON.stringify({ operation: "get", input })}\n`));
    socket.once("end", () => resolve(output));
  });
  const value: unknown = JSON.parse(response);
  if (typeof value === "object" && value !== null && "username" in value && "password" in value &&
      typeof value.username === "string" && typeof value.password === "string") {
    process.stdout.write(`username=${value.username}\npassword=${value.password}\n\n`);
  }
}

void run().catch(() => process.exitCode = 1);
