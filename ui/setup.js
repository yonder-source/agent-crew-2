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
  apply.title = "Validate the saved connection before applying";
  const discover = document.createElement("button");
  discover.type = "button";
  discover.textContent = "Load repositories";

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
    if (name === "tokenBudget") {
      input.inputMode = "numeric";
      input.placeholder = "Empty: no token limit";
      input.title = "Cumulative reported tokens; checked between coding turns";
    }
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
  actions.append(save, apply);
  form.append(actions, feedback);
  const status = document.createElement("aside");
  const statusHeading = document.createElement("h2");
  statusHeading.textContent = "Connection status";
  status.append(statusHeading);
  const validate = document.createElement("button");
  validate.type = "button";
  validate.textContent = "Validate saved connection";
  const validationResults = document.createElement("div");
  validationResults.setAttribute("role", "status");
  validationResults.textContent = "Connection not validated.";
  status.append(validate, validationResults);
  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = "Resume scheduling";
  const pollingStatus = document.createElement("p");
  status.append(resume, pollingStatus);
  const slackHeading = document.createElement("h2");
  slackHeading.textContent = "Slack credentials";
  const slackStatus = document.createElement("p");
  slackStatus.setAttribute("role", "status");
  const refreshSlack = document.createElement("button");
  refreshSlack.type = "button";
  refreshSlack.textContent = "Check Slack credentials";
  status.append(slackHeading, slackStatus, refreshSlack);
  const checkSlack = async () => {
    refreshSlack.disabled = true;
    slackStatus.textContent = "Checking mounted Slack credentials…";
    try {
      const result = await host.request("agent-crew.setup.slack.credentials", {});
      if (!signal.aborted) {
        slackStatus.textContent = `Bot token: ${result.botToken}. App token: ${result.appToken}. File readiness only; Slack connection not checked.`;
      }
    } catch {
      if (!signal.aborted) slackStatus.textContent = "Slack credential status unavailable.";
    } finally {
      if (!signal.aborted) refreshSlack.disabled = false;
    }
  };
  refreshSlack.addEventListener("click", () => { void checkSlack(); });
  const hint = document.createElement("p");
  hint.textContent = "Save validates a draft. Apply prepares the checkout and starts automatic scheduling; active or uncertain tasks block it.";
  status.append(hint);
  layout.append(form, status);
  container.replaceChildren(title, layout);
  let savedFields = "";
  let validatedDraftHash = "";
  const formFields = () => Object.fromEntries(fields.map(([name]) => [name, inputs.get(name).value]));
  form.addEventListener("input", () => { apply.disabled = true; });
  const refreshPolling = async () => {
    try {
      const result = await host.request("agent-crew.setup.polling.status", {});
      if (!signal.aborted) pollingStatus.textContent = result.running ? "Scheduling: Running" : `Scheduling: Paused — ${result.reason}`;
    } catch {
      if (!signal.aborted) pollingStatus.textContent = "Scheduling status unavailable; reconnect after any Gateway restart.";
    }
  };
  resume.addEventListener("click", async () => {
    resume.disabled = true;
    try {
      await host.request("agent-crew.setup.polling.resume", {});
    } catch (error) {
      if (!signal.aborted) feedback.textContent = errorText(error, "Scheduling could not resume.");
    } finally {
      if (!signal.aborted) resume.disabled = false;
      await refreshPolling();
    }
  });

  async function validateSavedConnection() {
    apply.disabled = true;
    validate.disabled = true;
    validationResults.textContent = "Validating saved connection…";
    try {
      const result = await host.request("agent-crew.setup.validate", {});
      if (signal.aborted) return;
      validationResults.replaceChildren();
      for (const check of result.checks) {
        const row = document.createElement("p");
        const label = document.createElement("strong");
        label.className = "agent-crew-check-status";
        label.dataset.status = check.status;
        label.textContent = `${check.status.charAt(0).toUpperCase()}${check.status.slice(1)}`;
        row.append(label, document.createTextNode(`: ${check.message}`));
        validationResults.append(row);
      }
      validatedDraftHash = typeof result.draftHash === "string" ? result.draftHash : "";
      apply.disabled = !result.valid || !validatedDraftHash || JSON.stringify(formFields()) !== savedFields;
    } catch (error) {
      if (!signal.aborted) validationResults.textContent = errorText(error, "Unable to validate the saved connection.");
    } finally {
      if (!signal.aborted) validate.disabled = false;
    }
  }
  validate.addEventListener("click", () => { void validateSavedConnection(); });

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
      if (saved?.draft) savedFields = JSON.stringify(formFields());
      if (!values?.codingAgentId && agents.some((agent) => agent?.id === "coding")) {
        inputs.get("codingAgentId").value = "coding";
      }
      save.disabled = false;
      await Promise.all([refreshPolling(), checkSlack()]);
    } catch {
      if (!signal.aborted) feedback.textContent = "Unable to load setup or agents.";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const draft = formFields();
      await host.request("agent-crew.setup.draft.save", { draft });
      savedFields = JSON.stringify(draft);
      if (!signal.aborted) feedback.textContent = "Draft saved.";
      await validateSavedConnection();
    } catch {
      if (!signal.aborted) feedback.textContent = "Unable to save draft.";
    } finally {
      if (!signal.aborted) save.disabled = false;
    }
  });
  discover.addEventListener("click", async () => {
    apply.disabled = true;
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
    apply.disabled = true;
    const selected = inputs.get("repository").selectedOptions[0];
    installationId.value = selected?.dataset.installationId ?? "";
    if (inputs.get("repository").value) {
      const [owner, repo] = inputs.get("repository").value.split("/");
      inputs.get("repositoryPath").value = `/workspaces/repositories/${owner}/${repo}`;
    }
  });
  apply.addEventListener("click", async () => {
    apply.disabled = true;
    feedback.textContent = "Applying saved connection…";
    try {
      const result = await host.request("agent-crew.setup.apply", { draftHash: validatedDraftHash });
      if (!signal.aborted) feedback.textContent = result.message;
    } catch (error) {
      if (!signal.aborted) feedback.textContent = errorText(error,
        "Apply was not acknowledged. Check Gateway settings and active tasks before retrying.");
    } finally {
      await refreshPolling();
    }
  });
  void load();
  const pollingTimer = setInterval(() => { void refreshPolling(); }, 5000);
  signal.addEventListener("abort", () => clearInterval(pollingTimer), { once: true });
  return { dispose: () => { clearInterval(pollingTimer); container.replaceChildren(); } };
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
