const fields = [
  ["githubAppId", "GitHub App ID"],
  ["repository", "GitHub repository"],
  ["installationId", "GitHub App installation"],
  ["repositoryPath", "Repository checkout path"],
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
  const errorText = (error, fallback) => error instanceof Error && error.message.length > 0
    ? Array.from(error.message.slice(0, 240), (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character).join("")
    : fallback;
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";
  save.disabled = true;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.disabled = true;
  apply.title = "Connection validation is not yet available";
  const discover = document.createElement("button");
  discover.type = "button";
  discover.textContent = "Load repositories";
  const clone = document.createElement("button");
  clone.type = "button";
  clone.textContent = "Clone selected repository";

  for (const [name, label] of fields) {
    if (name === "installationId") continue;
    const row = document.createElement("p");
    const caption = document.createElement("label");
    caption.textContent = label;
    caption.htmlFor = `agent-crew-${name}`;
    const input = name.endsWith("AgentId") || name === "repository" ? document.createElement("select") : document.createElement("input");
    input.name = name;
    input.id = `agent-crew-${name}`;
    input.maxLength = 1024;
    if (name === "repository") {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Load repositories first";
      input.append(option);
    }
    row.append(caption);
    if (name === "githubAppId") {
      const controls = document.createElement("div");
      controls.className = "agent-crew-app-controls";
      controls.append(input, discover);
      row.append(controls);
    } else {
      row.append(document.createElement("br"), input);
    }
    form.append(row);
    inputs.set(name, input);
  }
  const installationId = document.createElement("input");
  installationId.type = "hidden";
  installationId.name = "installationId";
  inputs.set("installationId", installationId);
  const actions = document.createElement("div");
  actions.className = "agent-crew-actions";
  actions.append(save, apply, clone);
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
        installationId.value = typeof values.installationId === "string" ? values.installationId : "";
        if (values.repository) {
          const unavailable = document.createElement("option");
          unavailable.value = values.repository;
          unavailable.textContent = `${values.repository} (load repository list to refresh)`;
          inputs.get("repository").append(unavailable);
          inputs.get("repository").value = values.repository;
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
  discover.addEventListener("click", async () => {
    discover.disabled = true;
    feedback.textContent = "Loading GitHub repositories…";
    try {
      const result = await host.request("agent-crew.setup.repositories.list", {
        appId: inputs.get("githubAppId").value,
      });
      if (signal.aborted) return;
      const select = inputs.get("repository");
      const previousRepository = select.value;
      const previousInstallation = installationId.value;
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = result.repositories.length ? "Select a repository" : "No accessible repositories";
      select.append(placeholder);
      for (const item of result.repositories) {
        if (typeof item?.repository !== "string" || !Number.isSafeInteger(item.installationId) ||
            typeof item.installationAccount !== "string") continue;
        const option = document.createElement("option");
        option.value = item.repository;
        option.dataset.installationId = String(item.installationId);
        option.textContent = `${item.repository} (${item.installationAccount})`;
        select.append(option);
      }
      const existing = [...select.options].find((option) => option.value === previousRepository &&
        option.dataset.installationId === previousInstallation);
      if (existing) select.selectedIndex = [...select.options].indexOf(existing);
      if (!existing && select.options.length > 1) select.selectedIndex = 1;
      installationId.value = select.selectedOptions[0]?.dataset.installationId ?? "";
      if (select.value) {
        const [owner, repo] = select.value.split("/");
        inputs.get("repositoryPath").value = `/workspaces/repositories/${owner}/${repo}`;
      }
      feedback.textContent = result.repositories.length
        ? `Loaded ${result.repositories.length} accessible repositories.`
        : "This GitHub App has no accessible repositories.";
    } catch (error) {
      if (!signal.aborted) feedback.textContent = errorText(error,
        "Unable to load repositories. Check the App ID, private key and installation permissions.");
    } finally {
      if (!signal.aborted) discover.disabled = false;
    }
  });
  inputs.get("repository").addEventListener("change", () => {
    const selected = inputs.get("repository").selectedOptions[0];
    installationId.value = selected?.dataset.installationId ?? "";
    if (inputs.get("repository").value) {
      const [owner, repo] = inputs.get("repository").value.split("/");
      inputs.get("repositoryPath").value = `/workspaces/repositories/${owner}/${repo}`;
    }
  });
  clone.addEventListener("click", async () => {
    clone.disabled = true;
    feedback.textContent = "Cloning repository…";
    try {
      const result = await host.request("agent-crew.setup.repository.clone", {
        appId: inputs.get("githubAppId").value,
        repository: inputs.get("repository").value,
        installationId: Number(installationId.value),
        repositoryPath: inputs.get("repositoryPath").value,
      });
      if (!signal.aborted) feedback.textContent = result.status === "cloned"
        ? `Repository cloned to ${result.repositoryPath}.`
        : `Matching checkout already exists at ${result.repositoryPath}.`;
    } catch (error) {
      if (!signal.aborted) feedback.textContent = errorText(error,
        "Clone failed. Check repository permissions, path and existing checkout.");
    } finally {
      if (!signal.aborted) clone.disabled = false;
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
