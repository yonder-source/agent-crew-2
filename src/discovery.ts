import type { GitHubIssue } from "./github-issues.js";

export type IssueDiscoveryOptions = {
  repository: string;
  listReadyIssues: (repository: string) => Promise<GitHubIssue[]>;
  dispatch: (issue: { repository: string; number: number }) => Promise<unknown>;
  onComplete: (count: number) => void;
  onFailure: (error: unknown, phase: "discovery" | "dispatch") => void;
};

export class IssueDiscovery {
  private running = false;
  private paused = false;

  constructor(private readonly options: IssueDiscoveryOptions) {}

  async poll(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    let phase: "discovery" | "dispatch" = "discovery";
    try {
      const issues = await this.options.listReadyIssues(this.options.repository);
      if (this.paused) return;
      phase = "dispatch";
      for (const issue of issues) {
        await this.options.dispatch({ repository: issue.repository, number: issue.number });
      }
      this.options.onComplete(issues.length);
    } catch (error) {
      this.options.onFailure(error, phase);
    } finally {
      this.running = false;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }
}
