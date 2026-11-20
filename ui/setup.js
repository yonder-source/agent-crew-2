const fields = [
  ["githubAppId", "GitHub App ID"],
  ["repository", "GitHub repository"],
  ["repositoryPath", "Repository source path"],
  ["codingAgentId", "Coding agent"],
  ["codingChannelId", "Coding Slack channel ID"],
  ["codingUserIds", "Coding authorized Slack user IDs"],
  ["designerAgentId", "Designer agent"],
  ["designerChannelId", "Designer Slack channel ID"],
  ["designerUserIds", "Designer authorized Slack user IDs"],
  ["tokenBudget", "Coding task token budget"],
];

function mount(container, { host, signal }) {
  const title = document.createElement("h1");
  title.textContent = "Agent Crew setup";
  const layout = document.createElement("div");
  layout.className = "agent-crew-setup";
  const form = document.createElement("form");
  const formHeading = document.createElement("h2");
  formHeading.textContent = "Connection settings";
  form.append(formHeading);
  const inputs = new Map();
  const feedback = document.createElement("p");
  feedback.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";
  save.disabled = true;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.disabled = true;
  apply.title = "Connection validation is not yet available";

  for (const [name, label] of fields) {
    const row = document.createElement("p");
    const caption = document.createElement("label");
    caption.textContent = label;
    const input = name.endsWith("AgentId") ? document.createElement("select") : document.createElement("input");
    input.name = name;
    input.maxLength = 1024;
    caption.append(document.createElement("br"), input);
    row.append(caption);
    form.append(row);
    inputs.set(name, input);
  }
  const actions = document.createElement("div");
  actions.className = "agent-crew-actions";
  actions.append(save, apply);
  form.append(actions, feedback);
  const status = document.createElement("aside");
  const statusHeading = document.createElement("h2");
  statusHeading.textContent = "Connection status";
  status.append(statusHeading);
  for (const label of ["GitHub App private key", "Repository access", "Repository source", "Slack credentials"]) {
    const row = document.createElement("p");
    row.textContent = `${label}: Not checked`;
    status.append(row);
  }
  const hint = document.createElement("p");
  hint.textContent = "Save keeps a draft. Apply requires connection validation.";
  status.append(hint);
  layout.append(form, status);
  container.replaceChildren(title, layout);

  async function load() {
    try {
      const [saved, roster] = await Promise.all([
        host.request("agent-crew.setup.draft.get", {}),
        host.request("agents.list", {}),
      ]);
      if (signal.aborted) return;
      const agents = Array.isArray(roster?.agents) ? roster.agents : [];
      for (const name of ["codingAgentId", "designerAgentId"]) {
        const select = inputs.get(name);
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Select an agent";
        select.append(empty);
        for (const agent of agents) {
          if (typeof agent?.id !== "string") continue;
          const option = document.createElement("option");
          option.value = agent.id;
          option.textContent = agent.id;
          select.append(option);
        }
      }
      const values = saved?.draft ?? saved?.current;
      if (values) {
        for (const [name] of fields) {
          const value = values[name];
          if (typeof value !== "string") continue;
          const input = inputs.get(name);
          if (name.endsWith("AgentId") && value && !agents.some((agent) => agent?.id === value)) {
            const unavailable = document.createElement("option");
            unavailable.value = value;
            unavailable.textContent = `${value} (unavailable)`;
            input.append(unavailable);
          }
          input.value = value;
        }
      }
      if (!values?.codingAgentId && agents.some((agent) => agent?.id === "coding")) {
        inputs.get("codingAgentId").value = "coding";
      }
      save.disabled = false;
    } catch {
      if (!signal.aborted) feedback.textContent = "Unable to load setup or agents.";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const draft = Object.fromEntries(fields.map(([name]) => [name, inputs.get(name).value]));
      await host.request("agent-crew.setup.draft.save", { draft });
      if (!signal.aborted) feedback.textContent = "Draft saved.";
    } catch {
      if (!signal.aborted) feedback.textContent = "Unable to save draft.";
    } finally {
      if (!signal.aborted) save.disabled = false;
    }
  });
  void load();
  return { dispose: () => container.replaceChildren() };
}

export default {
  id: "agent-crew",
  activate(host) {
    const page = host.ui.registerPage({ id: "setup", label: "Agent Crew", mount });
    const navigation = host.ui.registerNavigation({
      id: "setup", label: "Agent Crew", page: { id: "setup", path: [] }, order: 30,
    });
    return () => { navigation(); page(); };
  },
};
