import { CATEGORY_PERMISSIONS, linkAllowed } from "../categoryRules.js";
import { escapeHtml, monogram, roleColor, safeHex, safeIconUrl } from "../text.js";

export function renderLogin({ notice = null, inviteUrl, error = null }) {
  const message = error || notice;
  return page({
    title: "Sign in",
    gate: true,
    content: `
      <main class="gate-card">
        <p class="eyebrow">Community sync</p>
        <h1>GuildLink</h1>
        <p class="page-lead">One main roleplay server, and the other servers that belong with it.</p>
        ${message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : ""}
        <div class="button-row">
          <a class="button primary" href="/auth/discord">Sign in with Discord</a>
          <a class="button ghost" href="${escapeHtml(inviteUrl)}">Invite the bot</a>
        </div>
        <ul class="points">
          <li>Each GuildLink role has a name. It comes from one Discord role on one server, and each other server chooses the Discord role people receive.</li>
          <li>A ban on the main server is copied to every linked server except the ban appeals server. Unbanning there removes the bans GuildLink created.</li>
          <li>Administrator on the main server can change every server. Administrator on a linked server can change only the servers they administer.</li>
        </ul>
      </main>`,
  });
}

export function renderHome({
  viewer,
  csrf,
  notice = null,
  creatableGuilds,
  missingBotGuilds,
  inviteUrl,
  botMessage = null,
  homeHref = "/",
  beta = false,
  betaLinked = false,
  mock = false,
  blocked = null,
}) {
  const create =
    blocked || creatableGuilds.length === 0
      ? ""
      : `
      <section class="card">
        <h2>Create the community</h2>
        <p class="page-lead">Name the community, then choose the main server.</p>
        <form method="post" action="/communities" class="stack-form">
          ${hiddenCsrf(csrf)}
          <ol class="steps">
            <li>
              <h3>1. Name the community</h3>
              <label>Community name
                <input name="name" required maxlength="80" placeholder="State of San Andreas">
                <span class="hint">This name is shown at the top of the panel.</span>
              </label>
            </li>
            <li>
              <h3>2. Choose the main server</h3>
              <label>Main server
                <select name="masterGuildId" required>
                  ${creatableGuilds
                    .map((guild) => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</option>`)
                    .join("")}
                </select>
                <span class="hint">You need Administrator on this server. Linked servers come after this.</span>
              </label>
            </li>
          </ol>
          <div class="form-actions">
            <button class="button primary" type="submit">Set up this community</button>
          </div>
        </form>
      </section>`;

  const missing =
    blocked || missingBotGuilds.length === 0
      ? ""
      : `<section class="card">
          <h2>Invite the bot</h2>
          <p class="page-lead">GuildLink is not in ${escapeHtml(formatNameSample(missingBotGuilds))} yet. Invite it, then refresh this page.</p>
          <a class="button ${creatableGuilds.length === 0 ? "primary" : "ghost"}" href="${escapeHtml(inviteUrl)}">Invite the bot</a>
        </section>`;

  const empty =
    blocked || creatableGuilds.length > 0
      ? ""
      : `<section class="card empty-state">
          <h2>Waiting for an administrator</h2>
          <p class="page-lead">An administrator of the main server sets this GuildLink up from a server the bot has joined.</p>
          <ol class="steps">
            <li><h3>1. Name the community</h3></li>
            <li><h3>2. Choose the main server</h3><p class="hint">You need Administrator there, and GuildLink needs to be in that server.</p></li>
          </ol>
        </section>`;

  const blockedNote = blocked ? `<p class="notice notice-warn" role="status">${escapeHtml(blocked)}</p>` : "";

  return page({
    title: "Set up",
    viewer,
    csrf,
    notice,
    homeHref,
    beta,
    betaLinked,
    mock,
    content: `
      <main class="wrap">
        <header class="page-head">
          <div>
            <p class="eyebrow">Setup</p>
            <h1>Set up GuildLink</h1>
            <p class="page-lead">Name the community, then choose the main server.</p>
          </div>
        </header>
        ${botMessage ? `<p class="notice notice-warn" role="status">${escapeHtml(botMessage)}</p>` : ""}
        ${blockedNote}
        ${empty}
        ${create}
        ${missing}
        <p class="hint">This install runs one community. Administrator on the main server covers every linked server. Administrator on a linked server can change only the servers they administer.</p>
      </main>`,
  });
}

export function renderCommunity(options) {
  const { access, community, csrf, guilds = [] } = options;
  if (!access?.canManageCommunity) {
    return communityFrame(
      { ...options, pageLead: "Choose a server you administer.", eyebrow: "Your servers" },
      "servers",
      guildPicker({ community, guilds })
    );
  }
  return communityFrame(
    options,
    "community",
    `
      ${setupGuide(options)}
      ${communitySettings(community, csrf)}
      ${dangerZone(community, csrf)}
    `
  );
}

export function renderCategories(options) {
  const { access, community, csrf, categories = [], namedRoles = [] } = options;
  const pageLead = access?.canManageCommunity
    ? "Categories are optional. Open one to choose the GuildLink roles it requires."
    : "Categories are optional. Each one lists the GuildLink roles a server requires.";
  return communityFrame(
    { ...options, pageLead },
    "categories",
    categorySection({ access, community, csrf, categories, namedRoles })
  );
}

export function renderCategorySettings(options) {
  const { access, community, csrf, category, namedRoles = [] } = options;
  return communityFrame(
    { ...options, pageLead: `Choose the GuildLink roles ${category.name} requires.` },
    "categories",
    categorySettingsView({ access, community, csrf, category, namedRoles })
  );
}

export function renderCategoryRoleSettings(options) {
  const { community, csrf, category, role } = options;
  return communityFrame(
    { ...options, pageLead: `Discord permissions for ${role.name} in ${category.name}.` },
    "categories",
    categoryRoleSettingsView({ community, csrf, category, role })
  );
}

export function renderServers(options) {
  const { access, csrf, community, guilds = [], addableGuilds = [] } = options;
  const pageLead = access?.canManageCommunity
    ? "Add a server, then open it and choose a Discord role for each GuildLink role."
    : "Open a server and choose a Discord role for each GuildLink role.";
  return communityFrame(
    { ...options, pageLead },
    "servers",
    serverSection({ access, csrf, community, guilds, addableGuilds })
  );
}

export function renderAudit(options) {
  const { logs = [], access, community, auditServers = [] } = options;
  const channel = access?.canManageCommunity ? auditChannelCard({ community, auditServers }) : "";
  return communityFrame(options, "audit", `${channel}${logSection(logs)}`);
}

export function renderAuditChannel(options) {
  const { community, auditServers = [] } = options;
  const current = auditChannelStatus(community, auditServers);
  return communityFrame(
    { ...options, pageLead: "Choose the Discord channel new audit lines are posted to." },
    "audit",
    `
      ${backLink(`/c/${community.id}/audit`, "audit")}
      <section class="card">
        <h2>Audit channel</h2>
        <p class="page-lead">${escapeHtml(current)}</p>
        ${auditChannelFields(options)}
      </section>
    `
  );
}

export function renderRoles(options) {
  const { access, csrf, community, namedRoles = [], guilds = [] } = options;
  const next = rolesNext({ access, namedRoles, guilds });
  const pageLead = access?.canManageCommunity
    ? "Add a GuildLink role, then open it and choose the Discord role it comes from."
    : "These are the GuildLink roles. On Servers, choose the Discord role people on your server receive.";
  return communityFrame(
    { ...options, pageLead },
    "roles",
    `
      ${next ? `<p class="next-step">${escapeHtml(next)}</p>` : ""}
      ${namedRoleSection({ access, csrf, community, namedRoles })}
    `
  );
}

export function renderRoleSettings(options) {
  const { role } = options;
  return communityFrame(
    { ...options, pageLead: `Choose the Discord role ${role.name} comes from.` },
    "roles",
    roleSettingsView(options)
  );
}

export function renderGuildRoles(options) {
  const { access, community, guild } = options;
  const scoped = !access?.canManageCommunity;
  return communityFrame(
    {
      ...options,
      pageLead: `Choose a Discord role on ${guild.name} for each GuildLink role.`,
      ...(scoped ? { eyebrow: "Your servers" } : {}),
    },
    "servers",
    `
      ${backLink(scoped ? `/c/${community.id}` : `/c/${community.id}/servers`, scoped ? "your servers" : "servers")}
      ${guildCard({
        csrf: options.csrf,
        community,
        guild,
        namedRoles: guild.namedRoles || options.namedRoles || [],
        canRemove: access.canManageCommunity,
        categories: options.categories || [],
      })}
    `
  );
}

export function renderGuildRoleSettings(options) {
  const { access, guild, role } = options;
  const scoped = !access?.canManageCommunity;
  return communityFrame(
    {
      ...options,
      pageLead: `Which Discord role is ${role.name} on ${guild.name}?`,
      ...(scoped ? { eyebrow: "Your servers" } : {}),
    },
    "servers",
    guildRoleSettingsView(options)
  );
}

export function renderBans(options) {
  const { access, csrf, community, guilds, appealUnbanRoleIds = [] } = options;
  return communityFrame(
    options,
    "bans",
    banSection({ access, csrf, community, guilds, appealUnbanRoleIds })
  );
}

function communityFrame(options, current, body) {
  const {
    viewer,
    csrf,
    notice = null,
    community,
    master,
    botMessage = null,
    homeHref = "/",
    beta = false,
    betaLinked = false,
    mock = false,
  } = options;
  const eyebrow = {
    bans: "Bans",
    roles: "Roles",
    servers: "Servers",
    categories: "Categories",
    audit: "Audit",
  }[current] || "Community";
  const leads = {
    community: "Set up roles, then link the other servers. Turn role sync on when those choices are ready.",
    roles: "These are the GuildLink roles. On Servers, choose the Discord role people on your server receive.",
    servers: "Open a server and choose a Discord role for each GuildLink role.",
    categories: "Categories are optional. Each one lists the GuildLink roles a server requires.",
    bans: "Copy bans from the main server, then choose the server where people can appeal.",
    audit: "Role changes, ban changes, and settings GuildLink has recorded.",
  };
  const lead = options.pageLead || leads[current] || "";
  const eyebrowText = options.eyebrow || eyebrow;
  return page({
    title: current === "audit" ? "Audit log" : community.name,
    viewer,
    csrf,
    notice,
    homeHref,
    beta,
    betaLinked,
    mock,
    content: `
      <main class="wrap">
        <header class="page-head">
          <div>
            <p class="eyebrow">${eyebrowText}</p>
            <h1>${escapeHtml(community.name)}</h1>
            ${lead ? `<p class="page-lead">${escapeHtml(lead)}</p>` : ""}
          </div>
          ${serverIdentity(master, "Main server")}
        </header>
        ${statusStrip(community)}
        ${botMessage ? `<p class="notice notice-warn" role="status">${escapeHtml(botMessage)}</p>` : ""}
        ${communityNav(community, current, options.access)}
        ${body}
      </main>`,
  });
}

function backLink(href, label) {
  return `<p class="back"><a href="${escapeHtml(href)}">Back to ${escapeHtml(label)}</a></p>`;
}

function communityNav(community, current, access) {
  const items = access?.canManageCommunity
    ? [
        ["community", "Community", `/c/${community.id}`],
        ["roles", "Roles", `/c/${community.id}/roles`],
        ["servers", "Servers", `/c/${community.id}/servers`],
        ["categories", "Categories", `/c/${community.id}/categories`],
        ["bans", "Bans", `/c/${community.id}/bans`],
        ["audit", "Audit", `/c/${community.id}/audit`],
      ]
    : [["servers", "Your servers", `/c/${community.id}`]];
  const links = items
    .map(([key, label, href]) => {
      const here = key === current ? ` aria-current="page"` : "";
      return `<a href="${escapeHtml(href)}"${here}>${label}</a>`;
    })
    .join("");
  return `<nav class="page-nav" aria-label="Community pages">${links}</nav>`;
}

function rolesNext({ access, namedRoles, guilds }) {
  const named = namedRoles.length > 0;
  const linked = guilds.length > 0;
  if (!named && !linked) {
    return access.canManageCommunity
      ? "Next: type a role name below, then open it and choose the Discord role it comes from."
      : "Next: a main-server administrator adds GuildLink roles. You then choose the Discord role on your server.";
  }
  if (!linked && access.canManageCommunity) {
    return "Next: open Servers, link a server, and choose the Discord role people there receive.";
  }
  if (!named) {
    return access.canManageCommunity
      ? "Next: add a GuildLink role, then choose the Discord role it comes from."
      : "Next: open Servers and choose the Discord role for each GuildLink role.";
  }
  return "";
}

function statusStrip(community) {
  const roleOn = Boolean(community.roleSyncEnabled);
  const banOn = Boolean(community.banSyncEnabled);
  return `<ul class="status-strip" aria-label="Sync status">
    <li class="status ${roleOn ? "status-on" : "status-off"}"><span>Role sync</span> <strong>${roleOn ? "On" : "Off"}</strong></li>
    <li class="status ${banOn ? "status-on" : "status-off"}"><span>Ban sync</span> <strong>${banOn ? "On" : "Off"}</strong></li>
  </ul>`;
}

function syncSwitch({ name, checked, label }) {
  return `<label class="switch">
    <input type="checkbox" name="${name}" value="1" ${checked ? "checked" : ""}>
    <span class="switch-body">
      <span class="switch-name">${label}</span>
      <span class="switch-state"><span class="when-on">On</span><span class="when-off">Off</span></span>
    </span>
  </label>`;
}

export function renderStatus({ title, message, viewer = null, csrf = null, actionHref = "/", actionLabel = "Continue", beta = false, betaLinked = false, mock = false }) {
  return page({
    title,
    viewer,
    csrf,
    beta,
    betaLinked,
    mock,
    content: `
      <main class="wrap narrow">
        <h1>${escapeHtml(title)}</h1>
        <p class="lead">${escapeHtml(message)}</p>
        <a class="button primary" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
      </main>`,
  });
}

function guildPicker({ community, guilds }) {
  const links = guilds
    .map((guild) => {
      const label = guild.id === community.appealsGuildId ? "Ban appeals" : "Your server";
      return `<li>
        <a class="community-card" href="/c/${community.id}/guilds/${escapeHtml(guild.id)}/roles">${serverIdentity(guild, label)}<span class="open-cue">Edit</span></a>
      </li>`;
    })
    .join("");
  return `<section class="card">
    <h2>Your servers</h2>
    ${links ? `<ul class="server-links">${links}</ul>` : `<p class="meta">You administer no linked server in this community yet.</p>`}
  </section>`;
}

function setupGuide({ community }) {
  return `<section class="card">
    <h2>What to do</h2>
    <p class="page-lead">Set up roles first, then the other servers. Categories and bans can wait until that works.</p>
    <ol class="steps">
      <li>
        <h3>1. Add a GuildLink role</h3>
        <p class="hint">On Roles, add a name such as Mod. Open it and choose the Discord role it comes from.</p>
        <a class="button ghost" href="/c/${community.id}/roles">Open Roles</a>
      </li>
      <li>
        <h3>2. Link the other servers</h3>
        <p class="hint">On Servers, open each server and choose the Discord role people there should receive.</p>
        <a class="button ghost" href="/c/${community.id}/servers">Open Servers</a>
      </li>
      <li>
        <h3>3. Turn role sync on</h3>
        <p class="hint">Use the switch in Community settings below. GuildLink then updates those Discord roles.</p>
      </li>
    </ol>
  </section>`;
}

function communitySettings(community, csrf) {
  return `<section class="card">
    <h2>Community settings</h2>
    <p class="page-lead">Save the name, and turn role sync on when GuildLink should update roles.</p>
    <form method="post" action="/c/${community.id}/settings" class="stack-form">
      ${hiddenCsrf(csrf)}
      <label>Name
        <input name="name" required maxlength="80" value="${escapeHtml(community.name)}">
        <span class="hint">People see this name at the top of the panel.</span>
      </label>
      ${syncSwitch({ name: "roleSync", checked: community.roleSyncEnabled, label: "Role sync" })}
      <p class="hint">Change ban sync on the Bans page.</p>
      <div class="form-actions">
        <button class="button primary" type="submit">Save settings</button>
      </div>
    </form>
  </section>`;
}

function roleSummary(role) {
  return role.parentRoleName
    ? `Comes from ${role.parentRoleName} on ${role.parentGuildName}.`
    : "Choose where this role comes from.";
}

function roleLink(community, role) {
  return `<li>
    <a class="community-card" href="/c/${community.id}/roles/${role.id}">
      <div class="identity"><div><strong>${escapeHtml(role.name)}</strong><span class="meta">${escapeHtml(roleSummary(role))}</span></div></div>
      <span class="open-cue">Edit</span>
    </a>
  </li>`;
}

function namedRoleSection({ access, csrf, community, namedRoles }) {
  if (!access?.canManageCommunity) {
    const cards = (namedRoles || [])
      .map(
        (role) =>
          `<div class="community-card"><div class="identity"><div><strong>${escapeHtml(role.name)}</strong><span class="meta">${escapeHtml(roleSummary(role))}</span></div></div></div>`
      )
      .join("");
    return `<section class="card">
      <h2>Roles</h2>
      ${cards ? `<div class="server-links">${cards}</div>` : `<p class="meta">No GuildLink roles yet.</p>`}
      <p class="meta">An administrator of the main server adds GuildLink roles and chooses where each one comes from. You choose the Discord role on your servers.</p>
    </section>`;
  }
  const links = (namedRoles || []).map((role) => roleLink(community, role)).join("");
  return `<section class="card">
    <h2>Roles</h2>
    ${links ? `<ul class="server-links">${links}</ul>` : `<p class="meta">No GuildLink roles yet. Add the first one below.</p>`}
    <h3>Add a role</h3>
    <form method="post" action="/c/${community.id}/named-roles" class="inline-form">
      ${hiddenCsrf(csrf)}
      <label>Role name
        <input name="name" required maxlength="80" placeholder="Mod">
        <span class="hint">Use a name people already know. Mod and mod count as the same name.</span>
      </label>
      <button class="button primary" type="submit">Add this role</button>
    </form>
  </section>`;
}

function roleSettingsView({ access, csrf, community, master, role, roleServers, categories }) {
  const parentForm = access?.canManageCommunity ? parentSetupForm({ csrf, community, role, roleServers }) : "";
  const mainChoice =
    access?.canManageCommunity && role.parentGuildId && master?.id && role.parentGuildId !== master.id
      ? mainDestinationForm({ csrf, community, master, role })
      : "";
  const remove = access?.canManageCommunity
    ? `<div class="danger-panel">
        <h3>Delete this role</h3>
        <form method="post" action="/c/${community.id}/named-roles/${role.id}/remove">
          ${hiddenCsrf(csrf)}
          <button class="button danger" type="submit">Delete ${escapeHtml(role.name)}</button>
        </form>
      </div>`
    : "";
  const limit = roleCategoryLimit({
    access,
    csrf,
    community,
    role,
    categories,
    action: `/c/${community.id}/named-roles/${role.id}/categories`,
  });
  return `<section class="stack">
    ${backLink(`/c/${community.id}/roles`, "roles")}
    <section class="card">
      <h2>${escapeHtml(role.name)}</h2>
      <p class="page-lead">${escapeHtml(roleSummary(role))}</p>
      ${access?.canManageCommunity ? `<h3>Name</h3>
      <form method="post" action="/c/${community.id}/named-roles/${role.id}" class="inline-form">
        ${hiddenCsrf(csrf)}
        <label>Name
          <input name="name" required maxlength="80" value="${escapeHtml(role.name)}">
        </label>
        <button class="button ghost" type="submit">Rename</button>
      </form>` : ""}
      ${parentForm}
      ${mainChoice}
      ${limit}
      ${remove}
    </section>
  </section>`;
}

function parentSetupForm({ csrf, community, role, roleServers }) {
  const servers = (roleServers || [])
    .map(
      (server) =>
        `<option value="${escapeHtml(server.id)}" ${server.id === role.parentGuildId ? "selected" : ""}>${escapeHtml(server.name)}</option>`
    )
    .join("");
  const roles = (roleServers || [])
    .flatMap((server) =>
      (server.roles || []).map(
        (discordRole) =>
          `<option value="${escapeHtml(discordRole.id)}" data-guild="${escapeHtml(server.id)}" ${discordRole.id === role.parentRoleId && server.id === role.parentGuildId ? "selected" : ""}>${escapeHtml(discordRole.name)}</option>`
      )
    )
    .join("");
  return `<form method="post" action="/c/${community.id}/named-roles/${role.id}/parent" class="stack-form">
    ${hiddenCsrf(csrf)}
    <h3>Where ${escapeHtml(role.name)} comes from</h3>
    <p class="hint">Pick one server and the Discord role on it that already means ${escapeHtml(role.name)}. People with that Discord role have this GuildLink role.</p>
    <label>Server
      <select name="parentGuildId" data-parent-server required>
        <option value="">Choose a server</option>
        ${servers}
      </select>
      <span class="hint">The main server or any linked server.</span>
    </label>
    <label>Discord role on that server
      <select name="parentRoleId" data-parent-role required>
        <option value="">Choose a role</option>
        ${roles}
      </select>
    </label>
    <div class="form-actions">
      <button class="button primary" type="submit">Save where this role comes from</button>
    </div>
  </form>`;
}

function mainDestinationForm({ csrf, community, master, role }) {
  const chosen = role.mainRoleId || "";
  const options = [
    `<option value="">No role yet</option>`,
    ...(master.roles || []).map(
      (discordRole) =>
        `<option value="${escapeHtml(discordRole.id)}" ${discordRole.id === chosen ? "selected" : ""}>${escapeHtml(discordRole.name)}</option>`
    ),
  ].join("");
  const empty = chosen ? "" : `<p class="meta">This server does not grant ${escapeHtml(role.name)} yet.</p>`;
  return `<form method="post" action="/c/${community.id}/guilds/${escapeHtml(master.id)}/named-roles/${role.id}" class="stack-form">
    ${hiddenCsrf(csrf)}
    <label>Which role is ${escapeHtml(role.name)} on ${escapeHtml(master.name)}?
      <select name="roleId">${options}</select>
    </label>
    ${empty}
    <div class="form-actions">
      <button class="button primary" type="submit">Save Discord role</button>
    </div>
  </form>`;
}

function serverSection({ access, csrf, community, guilds, addableGuilds }) {
  const links = guilds
    .map((guild) => {
      const label = guild.id === community.appealsGuildId ? "Ban appeals" : "Linked server";
      return `<li>
        <a class="community-card" href="/c/${community.id}/guilds/${escapeHtml(guild.id)}/roles">${serverIdentity(guild, label)}<span class="open-cue">Edit</span></a>
      </li>`;
    })
    .join("");
  const adder =
    access.canManageCommunity && addableGuilds.length > 0
      ? `<h3>Add a server</h3>
        <form method="post" action="/c/${community.id}/guilds" class="inline-form">
          ${hiddenCsrf(csrf)}
          <label>Server
            <select name="guildId" required>
              ${addableGuilds
                .map((guild) => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</option>`)
                .join("")}
            </select>
            <span class="hint">GuildLink is already in this server.</span>
          </label>
          <button class="button primary" type="submit">Add a server</button>
        </form>`
      : "";
  const syncAll = access.canManageCommunity
    ? `<form method="post" action="/c/${community.id}/sync-roles" class="follow-form">
        ${hiddenCsrf(csrf)}
        <button class="button ghost" type="submit">Sync roles on every server</button>
      </form>`
    : "";
  const empty = access.canManageCommunity
    ? `<p class="meta">No linked servers yet. Add one below.</p>`
    : `<p class="meta">No linked servers yet.</p>`;
  return `<section class="card">
    <h2>Servers</h2>
    ${links ? `<ul class="server-links">${links}</ul>` : empty}
    ${adder}
    ${syncAll}
  </section>`;
}

function guildRoleSummary(guild, role) {
  const source = role.parentRoleName ? `Comes from ${role.parentRoleName} on ${role.parentGuildName}.` : "";
  if (!role.localRoleId) return [`This server does not grant ${role.name} yet.`, source].filter(Boolean).join(" ");
  const chosen = (guild.roles || []).find((item) => item.id === role.localRoleId);
  const current = chosen?.name ? `${chosen.name} on this server.` : "";
  return [current, source].filter(Boolean).join(" ");
}

function guildRoleLink(community, guild, role) {
  return `<li>
    <a class="community-card" href="/c/${community.id}/guilds/${escapeHtml(guild.id)}/roles/${role.id}">
      <div class="identity"><div><strong>${escapeHtml(role.name)}</strong><span class="meta">${escapeHtml(guildRoleSummary(guild, role))}</span></div></div>
      <span class="open-cue">Edit</span>
    </a>
  </li>`;
}

function guildCard({ csrf, community, guild, namedRoles, canRemove, categories = [] }) {
  const groups = guildRoleGroups(guild, namedRoles, categories);
  const requiredLinks = groups.required.map((role) => guildRoleLink(community, guild, role)).join("");
  const addedLinks = groups.added.map((role) => guildRoleLink(community, guild, role)).join("");
  const requiredEmpty = guild.categoryId
    ? `<p class="meta">This category has no required roles.</p>`
    : `<p class="meta">This server has no required roles until it has a category.</p>`;
  const addOptions = groups.available
    .map((role) => `<option value="${escapeHtml(String(role.id))}">${escapeHtml(role.name)}</option>`)
    .join("");
  const addHint = guild.categoryId
    ? "These roles can be used in this category. They are not required."
    : "These roles can be used on every server. They are not required.";
  const adder = addOptions
    ? `<h3>Add a role</h3>
      <form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/extra-roles" class="inline-form">
        ${hiddenCsrf(csrf)}
        <label>GuildLink role
          <select name="namedRoleId" required>
            <option value="">Choose a GuildLink role</option>
            ${addOptions}
          </select>
          <span class="hint">${addHint}</span>
        </label>
        <button class="button primary" type="submit">Add role</button>
      </form>`
    : "";
  const blocks = [
    `<h3>Required roles</h3>`,
    requiredLinks ? `<ul class="server-links">${requiredLinks}</ul>` : requiredEmpty,
    addedLinks ? `<h3>Other roles</h3><ul class="server-links">${addedLinks}</ul>` : "",
    adder,
    groups.fromHere.length
      ? `<h3>Comes from this server</h3><div class="server-links">${groups.fromHere.map((role) => parentHereNote(role)).join("")}</div>`
      : "",
    groups.hidden.map((role) => `<p class="meta">${escapeHtml(role.name)} is set up on servers in ${escapeHtml(allowedCategoryText(role, categories))}.</p>`).join(""),
  ].join("");
  const remove = canRemove
    ? `<div class="danger-panel">
        <h3>Remove this server</h3>
        <p class="hint">Roles and bans already applied on Discord stay in place.</p>
        <form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/remove" class="remove-form">
          ${hiddenCsrf(csrf)}
          <label class="checkline"><input type="checkbox" name="confirm" value="1" required> Remove ${escapeHtml(guild.name)} from the community</label>
          <button class="button danger" type="submit">Remove server</button>
        </form>
      </div>`
    : "";
  const appealsNote =
    guild.id === community.appealsGuildId
      ? `<p class="meta">Ban appeals. Main-server bans are not copied to this server. Role sync still runs.</p>`
      : "";
  const empty = namedRoles.length === 0 ? `<p class="meta">No GuildLink roles yet. A main-server administrator adds them on the Roles page.</p>` : "";
  return `<article class="card guild-card">
    ${serverHeading(guild, guild.id === community.appealsGuildId ? "Ban appeals" : "Linked server")}
    ${appealsNote}
    ${categoryAssignment({ csrf, community, guild, categories, canEdit: canRemove })}
    ${(guild.requirementIssues || []).map((text) => `<p class="notice notice-warn" role="status">${escapeHtml(text)}</p>`).join("")}
    ${empty}
    ${blocks}
    <form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/sync-roles" class="follow-form">
      ${hiddenCsrf(csrf)}
      <button class="button ghost" type="submit">Sync roles here</button>
    </form>
    ${remove}
  </article>`;
}

function guildRoleGroups(guild, namedRoles, categories) {
  const category = (categories || []).find((item) => String(item.id) === String(guild.categoryId));
  const requiredIds = new Set((category?.roles || []).map((role) => String(role.namedRoleId)));
  const extraIds = new Set((guild.extraRoleIds || []).map(String));
  const required = [];
  const added = [];
  const available = [];
  const hidden = [];
  const fromHere = [];
  for (const role of namedRoles || []) {
    if (role.parentGuildId === guild.id) {
      fromHere.push(role);
      continue;
    }
    if (!linkAllowed(guild.categoryId ?? null, role.allowedCategoryIds || [])) {
      hidden.push(role);
      continue;
    }
    if (requiredIds.has(String(role.id))) required.push(role);
    else if (extraIds.has(String(role.id)) || role.localRoleId) added.push(role);
    else available.push(role);
  }
  return { required, added, available, hidden, fromHere };
}

function guildRoleSettingsView({ csrf, community, guild, role, categories = [] }) {
  const category = (categories || []).find((item) => String(item.id) === String(guild.categoryId));
  const required = Boolean(category?.roles?.some((item) => String(item.namedRoleId) === String(role.id)));
  const remove = required
    ? ""
    : `<div class="danger-panel">
        <h3>Remove from this server</h3>
        <form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/extra-roles/${role.id}/remove">
          ${hiddenCsrf(csrf)}
          <button class="button danger" type="submit">Remove ${escapeHtml(role.name)}</button>
        </form>
      </div>`;
  return `<section class="stack">
    ${backLink(`/c/${community.id}/guilds/${guild.id}/roles`, guild.name)}
    <section class="card">
      <h2>${escapeHtml(role.name)}</h2>
      <p class="page-lead">${escapeHtml(guildRoleSummary(guild, role))}</p>
      ${destinationForm({ csrf, community, guild, role })}
      ${remove}
    </section>
  </section>`;
}

function destinationForm({ csrf, community, guild, role }) {
  if (!guild.present) return `<p class="meta">Invite GuildLink back to this server before choosing a Discord role for ${escapeHtml(role.name)}.</p>`;
  const options = [
    `<option value="">No role yet</option>`,
    ...(guild.roles || []).map(
      (discordRole) =>
        `<option value="${escapeHtml(discordRole.id)}" ${discordRole.id === role.localRoleId ? "selected" : ""}>${escapeHtml(discordRole.name)}</option>`
    ),
  ].join("");
  return `<form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/named-roles/${role.id}" class="stack-form">
    ${hiddenCsrf(csrf)}
    <label>Which role is ${escapeHtml(role.name)} on ${escapeHtml(guild.name)}?
      <select name="roleId">${options}</select>
    </label>
    <div class="form-actions">
      <button class="button primary" type="submit">Save Discord role</button>
    </div>
  </form>`;
}

function parentHereNote(role) {
  return `<div class="community-card"><p><strong>${escapeHtml(role.name)}</strong> comes from ${escapeHtml(role.parentRoleName || "its Discord role")} on this server.</p></div>`;
}

function sourceMap(guild, source, categories) {
  if (!linkAllowed(guild.categoryId ?? null, source.allowedCategoryIds || [])) {
    return `<fieldset>
      <legend>${escapeHtml(source.name)} grants</legend>
      <p class="meta">This role links on servers in ${escapeHtml(allowedCategoryText(source, categories))}.</p>
    </fieldset>`;
  }
  const parents = guild.present ? parentBlock(guild, source) : "";
  const grid = guild.present
    ? roleGrid(guild.roles, (role) => roleOption(guild, source, role), "This server has no roles GuildLink can assign.")
    : `<p class="meta">Invite GuildLink back to this server.</p>`;
  return `<fieldset>
    <legend>When someone has ${escapeHtml(source.name)}</legend>
    <p class="hint">They receive the roles you tick on this server.</p>
    ${grid}
    ${parents}
  </fieldset>`;
}

function categoryAssignment({ csrf, community, guild, categories, canEdit, returnTo = "" }) {
  if (!canEdit) {
    return guild.categoryName
      ? `<p><strong>Category</strong> ${escapeHtml(guild.categoryName)}</p>`
      : `<p class="meta">This server has no category.</p>`;
  }
  const options = [
    `<option value="">No category</option>`,
    ...(categories || []).map(
      (category) =>
        `<option value="${escapeHtml(String(category.id))}" ${String(guild.categoryId) === String(category.id) ? "selected" : ""}>${escapeHtml(category.name)}</option>`
    ),
  ].join("");
  const back = returnTo ? `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">` : "";
  return `<form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/category" class="stack-form">
    ${hiddenCsrf(csrf)}
    ${back}
    <label>Category
      <select name="categoryId">${options}</select>
    </label>
    <p class="meta">Choose a category when this server should require that category's GuildLink roles.</p>
    <div class="form-actions">
      <button class="button primary" type="submit">Save category</button>
    </div>
  </form>`;
}

function slotPickers(guild) {
  const slots = guild.slots || [];
  if (!guild.present || slots.length === 0) return "";
  return slots
    .map((slot) => {
      const options = [
        `<option value="">Choose a role</option>`,
        ...guild.roles.map(
          (role) =>
            `<option value="${escapeHtml(role.id)}" ${slot.linkedRoleId === role.id ? "selected" : ""}>${escapeHtml(role.name)}</option>`
        ),
      ].join("");
      const required = slot.permissionLabels?.length
        ? `<p class="meta">Required permissions: ${escapeHtml(slot.permissionLabels.join(", "))}</p>`
        : `<p class="meta">This slot needs a local role.</p>`;
      const statusClass = slot.met ? "meta req-ok" : "notice notice-warn";
      return `<fieldset>
        <legend>${escapeHtml(slot.name)}</legend>
        ${required}
        <label>Local role
          <select name="slot_${escapeHtml(String(slot.id))}">${options}</select>
        </label>
        <p class="${statusClass}" role="status">${escapeHtml(slot.statusLine || "")}</p>
      </fieldset>`;
    })
    .join("");
}

function grantGroup(guild, source, dest, categories) {
  if (!linkAllowed(dest.categoryId ?? null, source.allowedCategoryIds || [])) {
    return `<div class="parent-block">
      <p class="meta">Grants on ${escapeHtml(dest.name)}</p>
      <p class="meta">This role links on servers in ${escapeHtml(allowedCategoryText(source, categories))}.</p>
    </div>`;
  }
  return `<div class="parent-block">
    <p class="role-group-label">Roles on ${escapeHtml(dest.name)}</p>
    ${roleGrid(dest.roles || [], (role) => grantOption(guild, source, dest, role), "This server has no roles GuildLink can assign.")}
  </div>`;
}

function roleCategoryLimit({ access, csrf, community, role, categories = [], action }) {
  const ids = new Set((role.allowedCategoryIds || []).map(String));
  const names = categories.filter((item) => ids.has(String(item.id))).map((item) => item.name);
  if (!categories.length && ids.size === 0) {
    if (!access?.canManageCommunity) return "";
    return `<p class="meta">Create a category when you want to limit where ${escapeHtml(role.name)} links. With no limit, it links on every server.</p>`;
  }
  if (!access?.canManageCommunity) {
    if (ids.size === 0) return `<p class="meta">${escapeHtml(role.name)} links on every server.</p>`;
    return `<p class="meta">${escapeHtml(role.name)} links on servers in ${escapeHtml(names.join(", "))}.</p>`;
  }
  if (!categories.length) {
    return `<p class="meta">${escapeHtml(role.name)} links on servers in ${escapeHtml(names.join(", "))}.</p>`;
  }
  const boxes = categories
    .map(
      (category) => `<label class="checkline">
        <input type="checkbox" name="categoryId" value="${escapeHtml(String(category.id))}" ${ids.has(String(category.id)) ? "checked" : ""}>
        ${escapeHtml(category.name)}
      </label>`
    )
    .join("");
  return `<form method="post" action="${action}" class="stack-form limit-form">
    ${hiddenCsrf(csrf)}
    <input type="hidden" name="roleId" value="${escapeHtml(role.id)}">
    <fieldset>
      <legend>Only link this role on servers in</legend>
      <div class="check-grid">${boxes}</div>
      <p class="meta">Leave these clear to use this role on every server.</p>
    </fieldset>
    <div class="form-actions">
      <button class="button primary" type="submit">Save where this role links</button>
    </div>
  </form>`;
}

function allowedCategoryText(source, categories) {
  const ids = new Set((source.allowedCategoryIds || []).map(String));
  const names = (categories || []).filter((item) => ids.has(String(item.id))).map((item) => item.name);
  return names.join(", ") || "the selected categories";
}

function categorySection({ access, community, csrf, categories }) {
  if (!access?.canManageCommunity) {
    const cards = (categories || [])
      .map(
        (category) =>
          `<div class="community-card"><div class="identity"><div><strong>${escapeHtml(category.name)}</strong><span class="meta">${escapeHtml(categorySummary(category))}</span></div></div></div>`
      )
      .join("");
    return `<section class="card">
      <h2>Categories</h2>
      ${cards ? `<div class="server-links">${cards}</div>` : `<p class="meta">No categories yet.</p>`}
    </section>`;
  }
  const cards = (categories || []).map((category) => categoryLink(community, category)).join("");
  return `<section class="card">
    <h2>Categories</h2>
    ${cards ? `<ul class="server-links">${cards}</ul>` : `<p class="meta">No categories yet. Add one below.</p>`}
    <h3>Add a category</h3>
    <form method="post" action="/c/${community.id}/categories" class="inline-form">
      ${hiddenCsrf(csrf)}
      <label>Name
        <input name="name" required maxlength="80" placeholder="Law enforcement">
      </label>
      <button class="button primary" type="submit">Create category</button>
    </form>
  </section>`;
}

function categorySummary(category) {
  const required = (category.roles || []).map((role) => role.name).filter(Boolean);
  return required.length ? `Requires ${required.join(", ")}.` : "No required roles yet. This category works as a label.";
}

function categoryLink(community, category) {
  return `<li>
    <a class="community-card" href="/c/${community.id}/categories/${category.id}">
      <div class="identity"><div><strong>${escapeHtml(category.name)}</strong><span class="meta">${escapeHtml(categorySummary(category))}</span></div></div>
      <span class="open-cue">Edit</span>
    </a>
  </li>`;
}

function categorySettingsView({ community, csrf, category, namedRoles }) {
  const taken = new Set((category.roles || []).map((role) => String(role.namedRoleId)));
  const available = (namedRoles || []).filter((role) => !taken.has(String(role.id)));
  const options = available
    .map((role) => `<option value="${escapeHtml(String(role.id))}">${escapeHtml(role.name)}</option>`)
    .join("");
  const adder = !(namedRoles || []).length
    ? ""
    : !available.length
      ? ""
      : `<h3>Add a role</h3>
        <form method="post" action="/c/${community.id}/categories/${category.id}/requirements" class="inline-form">
        ${hiddenCsrf(csrf)}
        <label>GuildLink role
          <select name="namedRoleId" required>
            <option value="">Choose a GuildLink role</option>
            ${options}
          </select>
        </label>
        <button class="button primary" type="submit">Add role</button>
      </form>`;
  const roleLinks = (category.roles || [])
    .map(
      (role) => `<li>
        <a class="community-card" href="/c/${community.id}/categories/${category.id}/roles/${role.namedRoleId}">
          <div class="identity"><div><strong>${escapeHtml(role.name)}</strong><span class="meta">${role.permissions?.length ? "Permissions are set." : "No extra permissions yet."}</span></div></div>
          <span class="open-cue">Edit</span>
        </a>
      </li>`
    )
    .join("");
  const requiredEmpty = !(category.roles || []).length
    ? `<p class="meta">This category has no required roles yet. It works as a label until you add one.</p>`
    : "";
  const addNote = !(namedRoles || []).length
    ? `<p class="meta">Add GuildLink roles on the Roles page, then require them here.</p>`
    : !available.length
      ? `<p class="meta">Every GuildLink role is already required in this category.</p>`
      : "";
  return `<section class="stack">
    ${backLink(`/c/${community.id}/categories`, "categories")}
    <section class="card">
      <h2>${escapeHtml(category.name)}</h2>
      <p class="page-lead">${escapeHtml(categorySummary(category))}</p>
      <h3>Name</h3>
      <form method="post" action="/c/${community.id}/categories/${category.id}" class="inline-form">
        ${hiddenCsrf(csrf)}
        <label>Name
          <input name="name" required maxlength="80" value="${escapeHtml(category.name)}">
        </label>
        <button class="button ghost" type="submit">Rename</button>
      </form>
      <h3>Required roles</h3>
      ${roleLinks ? `<ul class="server-links">${roleLinks}</ul>` : requiredEmpty}
      ${addNote}
      ${adder}
      <div class="danger-panel">
        <h3>Delete this category</h3>
        <form method="post" action="/c/${community.id}/categories/${category.id}/delete" class="remove-form">
          ${hiddenCsrf(csrf)}
          <label class="checkline"><input type="checkbox" name="confirm" value="1" required> Delete ${escapeHtml(category.name)}</label>
          <button class="button danger" type="submit">Delete category</button>
        </form>
      </div>
    </section>
  </section>`;
}

function categoryRoleSettingsView({ community, csrf, category, role }) {
  const selected = new Set(role.permissions || []);
  const boxes = CATEGORY_PERMISSIONS.map(
    (permission) => `<label class="checkline">
      <input type="checkbox" name="permission" value="${escapeHtml(permission.name)}" ${selected.has(permission.name) ? "checked" : ""}>
      ${escapeHtml(permission.label)}
    </label>`
  ).join("");
  return `<section class="stack">
    ${backLink(`/c/${community.id}/categories/${category.id}`, category.name)}
    <section class="card">
      <h2>${escapeHtml(role.name)}</h2>
      <p class="page-lead">Permissions GuildLink gives the Discord role used for ${escapeHtml(role.name)} on servers in ${escapeHtml(category.name)}.</p>
      <form method="post" action="/c/${community.id}/categories/${category.id}/requirements/${role.namedRoleId}/permissions" class="stack-form">
        ${hiddenCsrf(csrf)}
        <div class="check-grid">${boxes}</div>
        <p class="meta">The bot needs Administrator on the server. Saving a change updates the Discord roles set up for this category.</p>
        <div class="form-actions">
          <button class="button primary" type="submit">Save permissions</button>
        </div>
      </form>
      <div class="danger-panel">
        <h3>Remove this required role</h3>
        <form method="post" action="/c/${community.id}/categories/${category.id}/requirements/${role.namedRoleId}/remove">
          ${hiddenCsrf(csrf)}
          <button class="button danger" type="submit">Remove required role</button>
        </form>
      </div>
    </section>
  </section>`;
}

function parentBlock(guild, source) {
  return `<div class="parent-block">
    <p class="role-group-label">Roles on this server that grant ${escapeHtml(source.name)}</p>
    <p class="hint">${escapeHtml(source.name)} is granted by roles on this server. Someone with one of these receives it on the main server, and the roles it grants on every server.</p>
    ${roleGrid(guild.roles, (role) => parentOption(guild, source, role), "This server has no roles.", { groupBlocked: false })}
  </div>`;
}

function grantDestinations(guild, master, guilds) {
  const list = [];
  if (master?.present && master.id !== guild.id) {
    list.push({ id: master.id, name: master.name, roles: master.roles || [], categoryId: null });
  }
  for (const other of guilds) {
    if (other.id === guild.id || !other.present) continue;
    list.push({ id: other.id, name: other.name, roles: other.roles || [], categoryId: other.categoryId ?? null });
  }
  return list;
}

function syncFromSection({ csrf, community, guild, destinations, categories = [], canEditLimits = false }) {
  const sources = guild.syncSources || [];
  const known = new Set(sources.map((source) => source.id));
  const localRoles = guild.roles || [];
  const choices = localRoles.filter((role) => !known.has(role.id));
  const adder =
    localRoles.length === 0
      ? `<p class="meta">This server has no roles.</p>`
      : choices.length > 0
        ? `<form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/sync-from" class="inline-form">
            ${hiddenCsrf(csrf)}
            <label>Role on ${escapeHtml(guild.name)}
              <select name="roleId" required>
                <option value="">Choose a role</option>
                ${choices.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join("")}
              </select>
            </label>
            <button class="button primary" type="submit">Sync this role</button>
          </form>`
        : `<p class="meta">Every role on this server is already set to sync.</p>`;
  const stops = sources
    .map(
      (source) => `<form id="stop-sync-${escapeHtml(guild.id)}-${escapeHtml(source.id)}" method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/sync-from/remove">
        ${hiddenCsrf(csrf)}
        <input type="hidden" name="roleId" value="${escapeHtml(source.id)}">
      </form>`
    )
    .join("");
  const blocks = sources
    .map((source) => {
      const groups = destinations
        .map((dest) => grantGroup(guild, source, dest, categories))
        .join("");
      const limit = roleCategoryLimit({
        access: { canManageCommunity: canEditLimits },
        csrf,
        community,
        role: source,
        categories,
        action: `/c/${community.id}/guilds/${escapeHtml(guild.id)}/sync-from/categories`,
      });
      return `<fieldset>
        <legend>${escapeHtml(source.name)} grants</legend>
        <p class="meta">${escapeHtml(source.name)} does not need to exist on the main server. Someone who has it receives the roles ticked below. GuildLink only removes roles it added.</p>
        ${limit}
        ${groups || `<p class="meta">There are no other servers to grant roles on yet.</p>`}
        <button class="button danger" type="submit" form="stop-sync-${escapeHtml(guild.id)}-${escapeHtml(source.id)}">Stop syncing this role</button>
      </fieldset>`;
    })
    .join("");
  const save =
    sources.length > 0
      ? `<div class="form-actions"><button class="button primary" type="submit">Save roles synced from this server</button></div>`
      : "";
  const grantForm =
    sources.length > 0
      ? `<form method="post" action="/c/${community.id}/guilds/${escapeHtml(guild.id)}/grants">
          ${hiddenCsrf(csrf)}
          ${blocks}
          ${save}
        </form>`
      : "";
  return `<div class="sync-from">
    <h3>Roles that start on this server</h3>
    <p class="hint">A role here can grant roles on the main server and on other linked servers. It does not need to exist on the main server.</p>
    ${adder}
    ${stops}
    ${grantForm}
  </div>`;
}

function roleGrid(roles, renderOne, emptyMessage, { groupBlocked = true } = {}) {
  if (!roles?.length) return `<p class="meta">${emptyMessage}</p>`;
  if (!groupBlocked) return `<div class="role-grid">${roles.map(renderOne).join("")}</div>`;
  const ready = [];
  const blocked = [];
  for (const role of roles) {
    (role.assignable === false ? blocked : ready).push(renderOne(role));
  }
  if (ready.length && blocked.length) {
    return `<div class="role-group"><p class="role-group-label">Ready to assign</p><div class="role-grid">${ready.join("")}</div></div><div class="role-group role-group-blocked"><p class="role-group-label">Cannot assign yet</p><div class="role-grid">${blocked.join("")}</div></div>`;
  }
  if (blocked.length) {
    return `<div class="role-group role-group-blocked"><p class="role-group-label">Cannot assign yet</p><div class="role-grid">${blocked.join("")}</div></div>`;
  }
  return `<div class="role-grid">${ready.join("")}</div>`;
}

function roleChoice({ name, value, checked, disabled = false, keep = false, role }) {
  const color = safeHex(roleColor(role.color));
  const blocked = disabled ? " role-option-blocked" : "";
  const hidden = keep ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">` : "";
  const reason = role.problem ? `<small>${escapeHtml(role.problem)}</small>` : "";
  return `<label class="role-option${blocked}" data-role-name="${escapeHtml(role.name.toLocaleLowerCase())}" style="--role:${color}">
    ${hidden}
    <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
    <span class="swatch" style="background:${color}"></span>
    <span class="role-copy"><span class="role-name">${escapeHtml(role.name)}</span>${reason}</span>
  </label>`;
}

function grantOption(guild, source, dest, role) {
  const on = guild.grants?.has(`${source.id}:${dest.id}:${role.id}`) || false;
  return roleChoice({
    name: `grant_${source.id}_${dest.id}`,
    value: role.id,
    checked: on,
    disabled: role.assignable === false,
    keep: role.assignable === false && on,
    role,
  });
}

function parentOption(guild, source, role) {
  const on = guild.parents?.has(`${source.id}:${role.id}`) || false;
  return roleChoice({
    name: `parent_${source.id}`,
    value: role.id,
    checked: on,
    role,
  });
}

function roleOption(guild, source, role) {
  const on = guild.selected?.has(`${source.id}:${role.id}`) || false;
  return roleChoice({
    name: `target_${source.id}`,
    value: role.id,
    checked: on,
    disabled: !role.assignable,
    keep: !role.assignable && on,
    role,
  });
}

function banSection({ access, csrf, community, guilds = [], appealUnbanRoleIds = [] }) {
  if (!access.canManageCommunity) {
    const unbanOn = Boolean(community.appealUnbanEnabled);
    return `<section class="card">
      <h2>Bans</h2>
      <p class="status ${unbanOn ? "status-on" : "status-off"}">Unban command <strong>${unbanOn ? "On" : "Off"}</strong></p>
      <p>${linkedBanCopy(community, guilds, appealUnbanRoleIds)}</p>
      <p class="hint">A ban made by hand on a linked server stays in place when the main server unbans someone, unless GuildLink created that ban.</p>
    </section>`;
  }
  const options = [
    `<option value="">None</option>`,
    ...guilds.map(
      (guild) =>
        `<option value="${escapeHtml(guild.id)}" ${guild.id === community.appealsGuildId ? "selected" : ""}>${escapeHtml(guild.name)}</option>`
    ),
  ].join("");
  const appealsSaved = Boolean(community.appealsGuildId);
  const unbanHint = appealsSaved
    ? "An administrator of the ban appeals server can run this when they have a role from step 3."
    : "Choose a server in step 1. You can turn this on in the same save.";
  return `<section class="card">
    <h2>Ban sync</h2>
    <p class="page-lead">Copy bans from the main server to each linked server.</p>
    <form method="post" action="/c/${community.id}/settings" class="stack-form">
      ${hiddenCsrf(csrf)}
      <input type="hidden" name="returnTo" value="bans">
      ${syncSwitch({ name: "banSync", checked: community.banSyncEnabled, label: "Ban sync" })}
      <p class="hint">Messages stay in place. The ban appeals server is skipped.</p>
      <div class="form-actions">
        <button class="button primary" type="submit">Save ban sync</button>
      </div>
    </form>
  </section>
  <section class="card">
    <h2>Ban appeals</h2>
    <p class="page-lead">Save these three steps in order.</p>
    <form method="post" action="/c/${community.id}/appeals" class="stack-form">
      ${hiddenCsrf(csrf)}
      <ol class="steps">
        <li>
          <h3>1. Ban appeals server</h3>
          <label>Ban appeals server
            <select name="appealsGuildId">
              ${options}
            </select>
            <span class="hint">People banned on the main server can join here to appeal. GuildLink removes bans it created on this server.</span>
          </label>
        </li>
        <li>
          <h3>2. Unban command</h3>
          ${syncSwitch({ name: "appealUnban", checked: community.appealUnbanEnabled, label: "Allow /guildlink unban" })}
          <p class="hint">${unbanHint}</p>
        </li>
        <li>
          <h3>3. Who may use it</h3>
          ${unbanRolePicker(community, guilds, appealUnbanRoleIds)}
        </li>
      </ol>
      <div class="form-actions">
        <button class="button primary" type="submit">Save ban appeals</button>
      </div>
    </form>
    <form method="post" action="/c/${community.id}/sync-bans" class="follow-form">
      ${hiddenCsrf(csrf)}
      <button class="button ghost" type="submit">Sync bans</button>
    </form>
  </section>`;
}

function unbanRolePicker(community, guilds, appealUnbanRoleIds) {
  const guild = guilds.find((item) => item.id === community.appealsGuildId);
  if (!guild) {
    return `<p class="meta">Save the ban appeals server first. Then tick the roles that may run /guildlink unban.</p>`;
  }
  if (!guild.present) {
    return `<p class="meta">Invite GuildLink back to ${escapeHtml(guild.name)} before choosing who can unban.</p>`;
  }
  const selected = new Set(appealUnbanRoleIds);
  const grid = roleGrid(
    guild.roles,
    (role) =>
      roleChoice({
        name: "unbanRole",
        value: role.id,
        checked: selected.has(role.id),
        role,
      }),
    "This server has no roles.",
    { groupBlocked: false }
  );
  return `<div class="parent-block" data-role-scope>
    <p class="role-group-label">Roles that may run /guildlink unban</p>
    <label class="filter">Filter roles
      <input type="search" data-filter placeholder="Staff, bailiff, command">
    </label>
    <p class="filter-empty" hidden>No roles match that search.</p>
    ${grid}
  </div>`;
}

function linkedBanCopy(community, guilds, appealUnbanRoleIds = []) {
  const note = appealCommandNote(community, guilds, appealUnbanRoleIds);
  if (!community.banSyncEnabled) {
    return `Ban sync is off. An administrator of the main server can turn it on.${note}`;
  }
  const exempt = guilds.filter((guild) => guild.id === community.appealsGuildId);
  const covered = guilds.filter((guild) => guild.id !== community.appealsGuildId);
  if (exempt.length && covered.length === 0) {
    return `${names(exempt)} is the ban appeals server. Bans from the main server are not copied here, so people can appeal. Role sync still applies.${note}`;
  }
  if (exempt.length) {
    return `Bans from the main server are copied to ${names(covered)}. ${names(exempt)} is the ban appeals server, so bans are not copied there.${note}`;
  }
  if (community.appealsGuildId) {
    return "Bans from the main server are copied to the servers you administer. The ban appeals server is exempt.";
  }
  return "Bans on the main server are copied to every linked server, including the servers you administer.";
}

function appealCommandNote(community, guilds, appealUnbanRoleIds = []) {
  if (!community.appealUnbanEnabled) return "";
  const guild = guilds.find((item) => item.id === community.appealsGuildId);
  if (!guild) return "";
  if (appealUnbanRoleIds.length === 0) {
    return " /guildlink unban is on, but no roles are allowed to use it yet.";
  }
  const names = appealUnbanRoleIds
    .map((id) => guild.roles.find((role) => role.id === id)?.name)
    .filter(Boolean);
  if (names.length === 0) return " /guildlink unban is limited to roles chosen by a main-server administrator.";
  return ` Administrators with ${names.map((name) => escapeHtml(name)).join(", ")} can run /guildlink unban to remove a main-server ban.`;
}

function names(guilds) {
  return guilds.map((guild) => escapeHtml(guild.name)).join(", ");
}

function auditChannelCard({ community, auditServers }) {
  return `<section class="card">
    <h2>Audit channel</h2>
    <p class="page-lead">${escapeHtml(auditChannelStatus(community, auditServers))}</p>
    <a class="button ghost" href="/c/${community.id}/audit/channel">Manage audit channel</a>
  </section>`;
}

function auditChannelStatus(community, auditServers) {
  const channelId = community.auditChannelId || "";
  if (!channelId) return "Audit stays in the panel.";
  for (const server of auditServers) {
    const channel = server.channels.find((item) => item.id === channelId);
    if (channel) return `Posts to #${channel.name} on ${server.name}.`;
  }
  return "A channel is saved, and GuildLink cannot see it.";
}

function auditChannelFields({ csrf, community, auditServers }) {
  const guildId = community.auditGuildId || "";
  const channelId = community.auditChannelId || "";
  const known = auditServers.some((server) => server.channels.some((channel) => channel.id === channelId));
  const missing = Boolean(channelId) && !known;
  const servers = [
    `<option value="">None</option>`,
    ...auditServers.map(
      (server) =>
        `<option value="${escapeHtml(server.id)}" ${server.id === guildId ? "selected" : ""}>${escapeHtml(server.name)}</option>`
    ),
  ].join("");
  const channels = [
    `<option value="">Choose a channel</option>`,
    ...(missing
      ? [`<option value="${escapeHtml(channelId)}" data-guild="${escapeHtml(guildId)}" selected>Saved channel</option>`]
      : []),
    ...auditServers.flatMap((server) =>
      server.channels.map(
        (channel) =>
          `<option value="${escapeHtml(channel.id)}" data-guild="${escapeHtml(server.id)}" ${channel.id === channelId ? "selected" : ""}>#${escapeHtml(channel.name)}</option>`
      )
    ),
  ].join("");
  const missingNote = missing
    ? `<p class="hint">GuildLink cannot see the saved channel. Choose another channel, or set the server to None.</p>`
    : `<p class="hint">Set the server to None to keep audit in the panel.</p>`;
  return `<form method="post" action="/c/${community.id}/audit-channel" class="stack-form">
      ${hiddenCsrf(csrf)}
      <label>Server
        <select name="guildId" data-audit-server>
          ${servers}
        </select>
      </label>
      <label>Channel
        <select name="channelId" data-audit-channel>
          ${channels}
        </select>
      </label>
      ${missingNote}
      <div class="form-actions">
        <button class="button primary" type="submit">Save audit channel</button>
      </div>
    </form>`;
}

function logSection(logs) {
  const rows = logs
    .map(
      (entry) => `<li>
        <div class="log-top">${logTag(entry.kind)}<time datetime="${escapeHtml(entry.createdAt)}">${escapeHtml(formatTime(entry.createdAt))}</time></div>
        <p>${escapeHtml(entry.detail)}</p>
      </li>`
    )
    .join("");
  return `<section class="card">
    <h2>Audit</h2>
    ${rows ? `<ul class="log">${rows}</ul>` : `<p class="meta">Nothing has been recorded yet.</p>`}
  </section>`;
}

function dangerZone(community, csrf) {
  return `<section class="card danger-zone">
    <h2>Delete community</h2>
    <p class="page-lead">This clears the community on this GuildLink so it can be set up again.</p>
    <p class="hint">Discord servers, roles, and bans stay in place.</p>
    <form method="post" action="/c/${community.id}/delete" class="stack-form">
      ${hiddenCsrf(csrf)}
      <label><span>Type <span class="name-chip">${escapeHtml(community.name)}</span> to confirm</span>
        <input name="confirmName" required autocomplete="off">
      </label>
      <div class="form-actions">
        <button class="button danger" type="submit">Delete community</button>
      </div>
    </form>
  </section>`;
}

function serverIdentity(guild, label) {
  return `<div class="identity">${serverMark(guild)}<div><strong>${escapeHtml(guild.name)}</strong><span class="meta">${escapeHtml(serverCaption(guild, label))}</span></div></div>`;
}

function serverHeading(guild, label) {
  return `<header class="detail-head">${serverMark(guild)}<div><h2>${escapeHtml(guild.name)}</h2><p class="page-lead">${escapeHtml(serverCaption(guild, label))}</p></div></header>`;
}

function serverMark(guild) {
  const icon = safeIconUrl(guild.icon);
  return icon
    ? `<img class="server-icon" src="${escapeHtml(icon)}" alt="">`
    : `<span class="monogram" aria-hidden="true">${escapeHtml(monogram(guild.name))}</span>`;
}

function serverCaption(guild, label) {
  if (guild.present === false && label === "Ban appeals") return "Ban appeals · Bot not in server";
  if (guild.present === false) return "Bot not in server";
  return label;
}

function rolePill(role) {
  const color = safeHex(roleColor(role.color));
  return `<span class="pill"><span class="swatch" style="background:${color}"></span>${escapeHtml(role.name)}</span>`;
}

function logTag(kind) {
  const labels = { role: "Role", ban: "Ban", unban: "Unban", error: "Error", config: "Settings" };
  const key = Object.hasOwn(labels, kind) ? kind : "config";
  return `<span class="tag tag-${key}">${labels[key]}</span>`;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatNameSample(names) {
  const shown = names.slice(0, 8);
  const extra = names.length - shown.length;
  const text = shown.join(", ");
  return extra > 0 ? `${text}, and ${extra} more` : text;
}

function hiddenCsrf(csrf) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

function logoutForm(csrf) {
  return `<form method="post" action="/logout">
    ${csrf ? hiddenCsrf(csrf) : ""}
    <button class="button ghost" type="submit">Log out</button>
  </form>`;
}

function betaViewForm(csrf, betaLinked) {
  const view = betaLinked ? "main" : "linked";
  const label = betaLinked ? "View as the main server" : "View as a linked server";
  return `<form method="post" action="/beta/view">
    ${csrf ? hiddenCsrf(csrf) : ""}
    <input type="hidden" name="view" value="${view}">
    <button class="button ghost" type="submit">${label}</button>
  </form>`;
}

function page({ title, viewer = null, csrf = null, content, notice = null, gate = false, homeHref = "/", beta = false, betaLinked = false, mock = false }) {
  const account = beta ? betaViewForm(csrf, betaLinked) : logoutForm(csrf);
  const bar = gate
    ? ""
    : `<header class="topbar">
        <a class="brand" href="${escapeHtml(homeHref)}">GuildLink</a>
        ${
          viewer
            ? `<div class="who">
                ${safeIconUrl(viewer.avatarUrl) ? `<img class="avatar" src="${escapeHtml(safeIconUrl(viewer.avatarUrl))}" alt="">` : `<span class="monogram">${escapeHtml(monogram(viewer.name))}</span>`}
                <span>${escapeHtml(viewer.name)}</span>
                ${account}
              </div>`
            : ""
        }
      </header>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} · GuildLink</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="${gate ? "gate" : ""}">
  ${bar}
  ${beta ? `<p class="notice notice-warn beta-banner" role="status">Beta testing. Discord login is off, and anyone who can open this panel is treated as an administrator of every server the bot is in.${mock ? " The servers shown here are samples stored on this computer. Nothing is sent to Discord." : ""} Turn BETA_OPEN_PANEL off before anyone else can reach this.</p>` : ""}
  ${notice ? `<p class="notice wrap notice-float" role="status">${escapeHtml(notice)}</p>` : ""}
  ${content}
  <script src="/panel.js"></script>
</body>
</html>`;
}
