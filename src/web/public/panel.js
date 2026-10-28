if (document.querySelector(".beta-banner")) {
  let seen = null;
  window.setInterval(async () => {
    try {
      const response = await fetch("/healthz", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      if (body.started == null) return;
      if (seen != null && body.started !== seen) {
        window.location.reload();
        return;
      }
      seen = body.started;
    } catch {
      // GuildLink is restarting. The next successful check reloads this page.
    }
  }, 1000);
}

document.querySelectorAll("[data-audit-server]").forEach((server) => {
  const form = server.closest("form");
  const channels = form?.querySelector("[data-audit-channel]");
  if (!channels) return;
  const options = [...channels.querySelectorAll("option[data-guild]")];
  const apply = () => {
    const guildId = server.value;
    for (const option of options) {
      const show = option.getAttribute("data-guild") === guildId;
      option.hidden = !show;
      option.disabled = !show;
    }
    const selected = channels.selectedOptions[0];
    if (selected?.hidden) channels.value = "";
  };
  server.addEventListener("change", apply);
  apply();
});

document.querySelectorAll("[data-parent-server]").forEach((server) => {
  const form = server.closest("form");
  const roles = form?.querySelector("[data-parent-role]");
  if (!roles) return;
  const options = [...roles.querySelectorAll("option[data-guild]")];
  const apply = () => {
    const guildId = server.value;
    for (const option of options) {
      const show = option.getAttribute("data-guild") === guildId;
      option.hidden = !show;
      option.disabled = !show;
    }
    const selected = roles.selectedOptions[0];
    if (selected?.hidden) roles.value = "";
  };
  server.addEventListener("change", apply);
  apply();
});

document.querySelectorAll("[data-filter]").forEach((input) => {
  const scope = input.closest("[data-role-scope]") || input.closest(".guild-card");
  if (!scope) return;
  const empty = scope.querySelector(".filter-empty");
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    const rows = [...scope.querySelectorAll("[data-role-name]")];
    rows.forEach((row) => {
      const name = row.getAttribute("data-role-name") || "";
      row.hidden = query.length > 0 && !name.includes(query);
    });
    scope.querySelectorAll(".role-group, fieldset").forEach((group) => {
      const groupRows = [...group.querySelectorAll("[data-role-name]")];
      group.hidden = groupRows.length > 0 && groupRows.every((row) => row.hidden);
    });
    if (empty) empty.hidden = query.length === 0 || rows.some((row) => !row.hidden);
  });
});
