import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { inspectRepositoryCheckout } from "./repository-clone.js";

export type ConnectionCheck = {
  id: string;
  status: "passed" | "failed" | "pending" | "unverified";
  message: string;
};

export async function validateCheckout(repository: string, path: string): Promise<ConnectionCheck> {
  const root = resolve(process.env.AGENT_CREW_REPOSITORY_ROOT ?? "/workspaces/repositories");
  const target = resolve(path);
  const inside = (base: string, candidate: string) => {
    const part = relative(base, candidate);
    return part !== "" && part !== ".." && !part.startsWith("../") && !isAbsolute(part);
  };
  if (!path.startsWith("/") || !inside(root, target)) {
    return { id: "checkout", status: "failed", message: "Checkout must be inside the configured repository directory." };
  }
  try {
    const rootReal = await realpath(root);
    let parent = dirname(target);
    while (true) {
      try {
        const parentReal = await realpath(parent);
        if (parentReal !== rootReal && !inside(rootReal, parentReal)) {
          return { id: "checkout", status: "failed", message: "Checkout parent resolves outside the repository directory." };
        }
        break;
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
        const next = dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
    if (!(await inspectRepositoryCheckout(target, repository))) {
      return { id: "checkout", status: "pending", message: "Not cloned; Apply will prepare the checkout." };
    }
    return { id: "checkout", status: "passed", message: "Checkout remote matches the selected repository." };
  } catch (error) {
    return { id: "checkout", status: "failed", message: error instanceof Error ? error.message : "Checkout could not be inspected." };
  }
}
