import { parseCodingResult } from "../dist/coding-result.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const [workspacePath, workspaceBranch] = process.argv.slice(2);
process.stdout.write(JSON.stringify(parseCodingResult(input, workspacePath ?? "", workspaceBranch ?? "")));
