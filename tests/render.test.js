import assert from "node:assert/strict";
import test from "node:test";
import { renderAudit, renderAuditChannel, renderBans, renderCategories, renderCategoryRoleSettings, renderCategorySettings, renderCommunity, renderGuildRoleSettings, renderGuildRoles, renderRoleSettings, renderRoles, renderServers } from "../src/web/render.js";

const moderator = "300000000000000001";
const command = "300000000000000002";
const bailiff = "400000000000000001";
const staff = "400000000000000002";

test("a linked-server admin only sees the servers they can change", () => {
  const props = {
    viewer: { name: "Avery", avatarUrl: null },
    csrf: "csrf-token",
    community: {
      id: 4,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
    },
    access: { isMainAdmin: false, canManageCommunity: false, editableGuildIds: ["200000000000000003"] },
    summary: "You have Administrator on Blaine County Courts, so you can change settings for that server only.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [{ id: moderator, name: "Moderator", color: 0xe2b45a }],
    masterRoleChoices: [],
    guilds: [
      {
        id: "200000000000000003",
        name: "Blaine County Courts",
        icon: null,
        present: true,
        roles: [{ id: bailiff, name: "Bailiff", color: 0x8ed0c6, assignable: true, problem: null }],
        namedRoles: [
          {
            id: 7,
            name: "Mod",
            parentGuildId: "200000000000000001",
            parentGuildName: "San Andreas Government",
            parentRoleName: "Moderator",
            allowedCategoryIds: [],
            localRoleId: bailiff,
          },
        ],
      },
    ],
    addableGuilds: [],
    logs: [{ createdAt: "2026-10-28T06:00:00.000Z", kind: "role", detail: "Gave Bailiff." }],
    botMessage: null,
  };
  const home = renderCommunity(props);
  const roles = renderRoles(props);
  const servers = renderServers(props);
  const guild = renderGuildRoles({ ...props, guild: props.guilds[0] });
  const audit = renderAudit(props);

  assert.match(home, /Choose a server you administer/);
  assert.match(home, /Your servers/);
  assert.match(home, /Blaine County Courts/);
  assert.match(home, /href="\/c\/4\/guilds\/200000000000000003\/roles"/);
  assert.match(home, /href="\/c\/4" aria-current="page"/);
  assert.doesNotMatch(home, /href="\/c\/4\/roles"/);
  assert.doesNotMatch(home, /href="\/c\/4\/bans"/);
  assert.doesNotMatch(home, /href="\/c\/4\/audit"/);
  assert.doesNotMatch(home, /href="\/c\/4\/categories"/);
  assert.doesNotMatch(home, /Community settings/);
  assert.doesNotMatch(home, /Gave Bailiff/);
  assert.doesNotMatch(home, /<h2>Audit log<\/h2>/);
  assert.doesNotMatch(home, /Los Santos Police/);
  assert.doesNotMatch(home, /All communities/);
  assert.doesNotMatch(home, /San Andreas Medical/);
  assert.doesNotMatch(home, /Add a server/);
  assert.doesNotMatch(home, /Delete community/);
  assert.doesNotMatch(home, /Sync bans/);
  assert.doesNotMatch(home, /Save ban appeals/);
  assert.doesNotMatch(home, /Track this role/);
  assert.doesNotMatch(home, /name="parent_/);
  assert.doesNotMatch(home, /name="appealsGuildId"/);

  assert.match(roles, /Your servers/);
  assert.match(roles, /href="\/c\/4">Your servers/);
  assert.doesNotMatch(roles, /href="\/c\/4\/roles"/);
  assert.doesNotMatch(roles, /href="\/c\/4\/servers"/);
  assert.doesNotMatch(roles, /href="\/c\/4\/categories"/);
  assert.doesNotMatch(roles, /href="\/c\/4\/audit"/);
  assert.doesNotMatch(roles, /Los Santos Police/);
  assert.doesNotMatch(roles, /Add a server/);
  assert.doesNotMatch(roles, /Track this role/);
  assert.doesNotMatch(roles, /Save ban appeals/);
  assert.doesNotMatch(roles, /Sync roles on every server/);
  assert.doesNotMatch(roles, /Create category/);

  assert.match(servers, /Blaine County Courts/);
  assert.match(servers, /href="\/c\/4\/guilds\/200000000000000003\/roles"/);
  assert.match(servers, /Your servers/);
  assert.doesNotMatch(servers, /href="\/c\/4\/servers"/);
  assert.doesNotMatch(servers, /Los Santos Police/);
  assert.doesNotMatch(servers, /Add a server/);
  assert.doesNotMatch(servers, /Create category/);

  const guildRole = renderGuildRoleSettings({ ...props, guild: props.guilds[0], role: props.guilds[0].namedRoles[0] });

  assert.match(guild, /Bailiff/);
  assert.match(guild, /Your servers/);
  assert.match(guild, /Back to your servers/);
  assert.doesNotMatch(guild, /href="\/c\/4\/audit"/);
  assert.doesNotMatch(guild, /href="\/c\/4\/roles"/);
  assert.doesNotMatch(guild, /href="\/c\/4\/bans"/);
  assert.doesNotMatch(guild, /href="\/c\/4\/categories"/);
  assert.match(guild, /href="\/c\/4\/guilds\/200000000000000003\/roles\/7"/);
  assert.match(guild, /Edit/);
  assert.match(guild, /Comes from Moderator on San Andreas Government/);
  assert.match(guildRole, /Which role is Mod on Blaine County Courts/);
  assert.match(guildRole, /Comes from Moderator on San Andreas Government/);
  assert.doesNotMatch(guild, /Which role is Mod on Blaine County Courts/);
  assert.doesNotMatch(guild, /Save parent/);
  assert.doesNotMatch(guild, /Save ban appeals/);
  assert.doesNotMatch(guild, /name="unbanRole"/);
  assert.doesNotMatch(guild, /Remove server/);

  assert.match(audit, /<title>Audit log · GuildLink<\/title>/);
  assert.match(audit, /<h2>Audit<\/h2>/);
  assert.doesNotMatch(audit, /Manage audit channel/);
  assert.doesNotMatch(audit, /Save audit channel/);
  assert.match(audit, /Gave Bailiff/);
  assert.match(audit, /2026-10-28 06:00 UTC/);
  assert.match(audit, /Your servers/);
  assert.match(audit, /href="\/c\/4">Your servers/);
  assert.doesNotMatch(audit, /href="\/c\/4\/roles"/);
  assert.doesNotMatch(audit, /href="\/c\/4\/bans"/);
  assert.doesNotMatch(audit, /Los Santos Police/);
  assert.doesNotMatch(audit, /Add a server/);
  assert.doesNotMatch(audit, /Delete community/);
  assert.doesNotMatch(audit, /Save settings/);
  assert.doesNotMatch(audit, /Track this role/);
});

test("a main-server admin sees every linked server and community settings", () => {
  const props = {
    viewer: { name: "Jordan", avatarUrl: null },
    csrf: "csrf-token",
    community: {
      id: 4,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
    },
    access: {
      isMainAdmin: true,
      canManageCommunity: true,
      editableGuildIds: ["200000000000000002", "200000000000000003"],
    },
    summary:
      "You have Administrator on San Andreas Government, the main server, so you can change settings for every server in this community.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [
      { id: moderator, name: "Moderator", color: 0xe2b45a },
      { id: command, name: "Police Command", color: 0x8ed0c6 },
    ],
    masterRoleChoices: [{ id: "300000000000000009", name: "Citizen", color: 0 }],
    guilds: [
      {
        id: "200000000000000002",
        name: "Los Santos Police",
        icon: null,
        present: true,
        roles: [{ id: staff, name: "Staff", color: 0xe2b45a, assignable: true, problem: null }],
        namedRoles: [
          {
            id: 7,
            name: "Mod",
            parentGuildId: "200000000000000001",
            parentGuildName: "San Andreas Government",
            parentRoleName: "Moderator",
            allowedCategoryIds: [],
            localRoleId: "",
          },
        ],
      },
      {
        id: "200000000000000003",
        name: "Blaine County Courts",
        icon: null,
        present: true,
        roles: [{ id: bailiff, name: "Bailiff", color: 0x8ed0c6, assignable: true, problem: null }],
      },
    ],
    addableGuilds: [{ id: "200000000000000004", name: "San Andreas Medical" }],
    logs: [],
    botMessage: null,
  };
  const home = renderCommunity(props);
  const roles = renderRoles(props);
  const servers = renderServers(props);
  const bans = renderBans(props);
  const guild = renderGuildRoles({ ...props, guild: props.guilds[0] });
  const audit = renderAudit(props);

  assert.match(home, /What to do/);
  assert.match(home, /Open Roles/);
  assert.match(home, /Delete community/);
  assert.match(home, /Save settings/);
  assert.match(home, /href="\/c\/4" aria-current="page"/);
  assert.match(home, /href="\/c\/4\/audit"/);
  assert.doesNotMatch(home, /Nothing has been recorded yet/);
  assert.doesNotMatch(home, /<h2>Audit log<\/h2>/);
  assert.doesNotMatch(home, /Add a server/);
  assert.doesNotMatch(home, /Track this role/);
  assert.doesNotMatch(home, /Save ban appeals/);
  assert.doesNotMatch(home, /name="target_/);
  assert.doesNotMatch(home, /name="appealsGuildId"/);

  assert.match(roles, /Add this role/);
  assert.match(roles, /href="\/c\/4\/roles" aria-current="page"/);
  assert.match(roles, /href="\/c\/4\/servers"/);
  assert.match(roles, /href="\/c\/4\/categories"/);
  assert.match(roles, /href="\/c\/4\/audit"/);
  assert.doesNotMatch(roles, /Add a server/);
  assert.doesNotMatch(roles, /Save ban appeals/);
  assert.doesNotMatch(roles, /name="appealsGuildId"/);
  assert.doesNotMatch(roles, /Create category/);

  assert.match(servers, /Los Santos Police/);
  assert.match(servers, /Blaine County Courts/);
  assert.match(servers, /Add a server/);
  assert.match(servers, /San Andreas Medical/);
  assert.match(servers, /Sync roles on every server/);
  assert.match(servers, /href="\/c\/4\/servers" aria-current="page"/);
  assert.doesNotMatch(servers, /Save ban appeals/);
  assert.doesNotMatch(servers, /Add this role/);

  const guildRole = renderGuildRoleSettings({ ...props, guild: props.guilds[0], role: props.guilds[0].namedRoles[0] });

  assert.match(guild, /Add a role/);
  assert.match(guild, /<option value="7">Mod<\/option>/);
  assert.doesNotMatch(guild, /href="\/c\/4\/guilds\/200000000000000002\/roles\/7"/);
  assert.match(guildRole, /Which role is Mod on Los Santos Police/);
  assert.match(guildRole, /This server does not grant Mod yet/);
  assert.doesNotMatch(guild, /name="target_/);
  assert.doesNotMatch(guild, /Save ban appeals/);
  assert.doesNotMatch(guild, /Sync bans/);

  assert.match(bans, /Sync bans/);
  assert.match(bans, /Ban appeals server/);
  assert.match(bans, /name="appealUnban" value="1"/);
  assert.doesNotMatch(bans, /name="appealUnban" value="1" checked/);
  assert.match(bans, /Save ban appeals/);
  assert.match(bans, /name="banSync"/);
  assert.match(bans, /href="\/c\/4\/bans" aria-current="page"/);
  assert.match(bans, /href="\/c\/4\/audit"/);
  assert.match(guild, /href="\/c\/4\/servers" aria-current="page"/);
  assert.match(guild, /href="\/c\/4\/audit"/);
  assert.match(audit, /Nothing has been recorded yet/);
  assert.match(audit, /Manage audit channel/);
  assert.match(audit, /href="\/c\/4\/audit\/channel"/);
  assert.doesNotMatch(audit, /name="channelId"/);
  const channelPage = renderAuditChannel({
    ...props,
    auditServers: [{ id: "200000000000000001", name: "San Andreas Government", channels: [{ id: "500000000000000001", name: "mod-log" }] }],
  });
  assert.match(channelPage, /Back to audit/);
  assert.match(channelPage, /Save audit channel/);
  assert.match(channelPage, /name="channelId"/);
  assert.match(channelPage, /#mod-log/);
  assert.match(audit, /href="\/c\/4\/audit" aria-current="page"/);
  assert.doesNotMatch(bans, /name="target_/);
  assert.doesNotMatch(bans, /Save roles for /);
  assert.doesNotMatch(bans, /Track this role/);
});

test("a parent on a linked server is shown there, and another server chooses its own role", () => {
  const cadet = "400000000000000009";
  const citizen = "300000000000000003";
  const clerk = "400000000000000012";
  const masterId = "100000000000000001";
  const policeId = "100000000000000002";
  const courtsId = "100000000000000003";
  const page = {
    viewer: { name: "Jordan", avatarUrl: null },
    csrf: "csrf-token",
    community: {
      id: 4,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
      appealsGuildId: null,
      appealUnbanEnabled: false,
    },
    access: {
      isMainAdmin: true,
      canManageCommunity: true,
      editableGuildIds: [policeId, courtsId],
    },
    summary: "You can change every server.",
    master: {
      id: masterId,
      name: "San Andreas Government",
      icon: null,
      present: true,
      roles: [{ id: citizen, name: "Citizen", color: 0x9aaba0, assignable: true, problem: null }],
    },
    sourceRoles: [],
    masterRoleChoices: [],
    guilds: [
      {
        id: policeId,
        name: "Los Santos Police",
        icon: null,
        present: true,
        roles: [{ id: cadet, name: "Cadet", color: 0x9aaba0, assignable: true, problem: null }],
        syncSources: [{ id: cadet, name: "Cadet", color: 0x9aaba0 }],
        grants: new Set([`${cadet}:${masterId}:${citizen}`, `${cadet}:${courtsId}:${clerk}`]),
      },
      {
        id: courtsId,
        name: "Blaine County Courts",
        icon: null,
        present: true,
        roles: [{ id: clerk, name: "Clerk", color: 0x8ed0c6, assignable: true, problem: null }],
      },
    ],
    addableGuilds: [],
    logs: [],
    botMessage: null,
  };
  const policeRole = {
    id: 9,
    name: "Police",
    parentGuildId: policeId,
    parentGuildName: "Los Santos Police",
    parentRoleName: "Cadet",
    allowedCategoryIds: [],
    localRoleId: "",
  };
  const parentPage = renderGuildRoles({
    ...page,
    guild: { ...page.guilds[0], namedRoles: [policeRole] },
  });
  const courtsPage = renderGuildRoles({
    ...page,
    guild: { ...page.guilds[1], namedRoles: [{ ...policeRole, localRoleId: clerk }] },
  });
  const roles = renderRoles({
    ...page,
    namedRoles: [policeRole],
    roleServers: [
      { id: masterId, name: "San Andreas Government", roles: [{ id: citizen, name: "Citizen" }] },
      { id: policeId, name: "Los Santos Police", roles: [{ id: cadet, name: "Cadet" }] },
      { id: courtsId, name: "Blaine County Courts", roles: [{ id: clerk, name: "Clerk" }] },
    ],
  });

  const courtsRole = renderGuildRoleSettings({
    ...page,
    guild: { ...page.guilds[1], namedRoles: [{ ...policeRole, localRoleId: clerk }] },
    role: { ...policeRole, localRoleId: clerk },
  });

  assert.match(parentPage, /Police<\/strong> comes from Cadet on this server/);
  assert.doesNotMatch(parentPage, /Which role is Police on Los Santos Police/);
  assert.match(courtsPage, /href="\/c\/4\/guilds\/100000000000000003\/roles\/9"/);
  assert.match(courtsPage, /Edit/);
  assert.match(courtsPage, /Comes from Cadet on Los Santos Police/);
  assert.doesNotMatch(courtsPage, /Which role is Police on Blaine County Courts/);
  assert.match(courtsRole, /Which role is Police on Blaine County Courts/);
  assert.match(courtsRole, /Comes from Cadet on Los Santos Police/);
  assert.match(courtsRole, /value="400000000000000012" selected/);
  const setup = renderRoleSettings({
    ...page,
    role: { ...policeRole, parentRoleId: cadet },
    roleServers: [
      { id: masterId, name: "San Andreas Government", roles: [{ id: citizen, name: "Citizen" }] },
      { id: policeId, name: "Los Santos Police", roles: [{ id: cadet, name: "Cadet" }] },
      { id: courtsId, name: "Blaine County Courts", roles: [{ id: clerk, name: "Clerk" }] },
    ],
  });

  assert.match(roles, /href="\/c\/4\/roles\/9"/);
  assert.match(roles, /Edit/);
  assert.match(roles, /Comes from Cadet on Los Santos Police/);
  assert.doesNotMatch(roles, /name="parentGuildId"/);
  assert.doesNotMatch(roles, /Which role is Police on Blaine County Courts/);
  assert.match(setup, /name="parentGuildId"/);
  assert.match(setup, /name="parentRoleId"/);
  assert.match(setup, />Los Santos Police</);
  assert.match(setup, />Blaine County Courts</);
  assert.match(setup, /value="400000000000000009" data-guild="100000000000000002" selected/);
});

test("the ban appeals server is labeled, and a linked admin cannot change it", () => {
  const community = {
    id: 4,
    name: "State of San Andreas",
    roleSyncEnabled: true,
    banSyncEnabled: true,
    appealsGuildId: "200000000000000003",
    appealUnbanEnabled: true,
  };
  const appellant = "400000000000000021";
  const courts = {
    id: "200000000000000003",
    name: "Blaine County Courts",
    icon: null,
    present: true,
    selected: new Set(),
    roles: [{ id: appellant, name: "Appellant", color: 0xe2b45a, assignable: true, problem: null }],
  };
  const mainProps = {
    viewer: { name: "Jordan", avatarUrl: null },
    csrf: "csrf-token",
    community,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [courts.id] },
    summary: "You can change settings for every server in this community.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [],
    masterRoleChoices: [],
    guilds: [courts],
    addableGuilds: [],
    logs: [],
    appealUnbanRoleIds: [appellant],
    botMessage: null,
  };
  const main = renderBans(mainProps);
  const guildPage = renderGuildRoles({ ...mainProps, guild: courts });
  assert.match(main, /<option value="200000000000000003" selected>Blaine County Courts<\/option>/);
  assert.match(guildPage, /Ban appeals\. Main-server bans are not copied to this server/);
  assert.match(main, /name="unbanRole" value="400000000000000021" checked/);

  const linked = renderBans({
    viewer: { name: "Avery", avatarUrl: null },
    csrf: "csrf-token",
    community,
    access: { isMainAdmin: false, canManageCommunity: false, editableGuildIds: [courts.id] },
    summary: "You can change settings for that server only.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [],
    masterRoleChoices: [],
    guilds: [courts],
    addableGuilds: [],
    logs: [],
    appealUnbanRoleIds: [appellant],
    botMessage: null,
  });
  assert.match(linked, /Bans from the main server are not copied here, so people can appeal/);
  assert.match(linked, /Administrators with Appellant can run \/guildlink unban/);
  assert.doesNotMatch(linked, /name="unbanRole"/);
  assert.doesNotMatch(linked, /Save ban appeals/);
  assert.doesNotMatch(linked, /Sync bans/);
});

test("the ban form stays on the bans page and the role map stays on the role page", () => {
  const guildId = "200000000000000002";
  const props = {
    viewer: { name: "Jordan", avatarUrl: null },
    csrf: "csrf-token",
    community: {
      id: 4,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
      appealsGuildId: null,
      appealUnbanEnabled: false,
    },
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [guildId] },
    summary: "You can change settings for every server in this community.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [{ id: moderator, name: "Moderator", color: 0xe2b45a }],
    masterRoleChoices: [],
    guilds: [
      {
        id: guildId,
        name: "Los Santos Police",
        icon: null,
        present: true,
        roles: [{ id: staff, name: "Staff", color: 0xe2b45a, assignable: true, problem: null }],
        namedRoles: [
          {
            id: 7,
            name: "Mod",
            parentGuildId: "200000000000000001",
            parentGuildName: "San Andreas Government",
            parentRoleName: "Moderator",
            allowedCategoryIds: [],
            localRoleId: "",
          },
        ],
      },
    ],
    addableGuilds: [],
    logs: [],
    appealUnbanRoleIds: [],
    botMessage: null,
  };
  const roles = renderRoles(props);
  const guild = renderGuildRoles({ ...props, guild: props.guilds[0] });
  const guildRole = renderGuildRoleSettings({ ...props, guild: props.guilds[0], role: props.guilds[0].namedRoles[0] });
  const bans = renderBans(props);

  assert.match(guild, /Add a role/);
  assert.match(guild, /<option value="7">Mod<\/option>/);
  assert.doesNotMatch(guild, /href="\/c\/4\/guilds\/200000000000000002\/roles\/7"/);
  assert.match(guildRole, /Which role is Mod on Los Santos Police/);
  assert.match(guildRole, /Save/);
  assert.doesNotMatch(guild, /Which role is Mod on Los Santos Police/);
  assert.match(bans, /Ban appeals server/);
  assert.match(bans, /Save ban appeals/);
  assert.match(bans, /name="banSync"/);
  assert.doesNotMatch(roles, /Save ban appeals/);
  assert.doesNotMatch(roles, /name="appealsGuildId"/);
  assert.doesNotMatch(roles, /name="unbanRole"/);
  assert.doesNotMatch(guild, /Save ban appeals/);
  assert.doesNotMatch(guild, /name="appealsGuildId"/);
  assert.doesNotMatch(guild, /name="unbanRole"/);
  assert.doesNotMatch(guild, /Sync bans/);
  assert.doesNotMatch(bans, /name="target_/);
  assert.doesNotMatch(bans, /name="parent_/);
  assert.doesNotMatch(bans, /name="grant_/);
  assert.doesNotMatch(bans, /Save roles for /);
  assert.doesNotMatch(bans, /Sync from this server/);
});

test("categories and role limits show up for the people who can use them", () => {
  const law = {
    id: 1,
    name: "Law enforcement",
    roles: [
      { namedRoleId: 7, name: "Command", permissions: ["BanMembers"] },
      { namedRoleId: 8, name: "Cadet", permissions: [] },
    ],
  };
  const bench = { id: 2, name: "Courts", roles: [] };
  const police = {
    id: "200000000000000002",
    name: "Los Santos Police",
    icon: null,
    present: true,
    categoryId: 1,
    categoryName: "Law enforcement",
    slots: [
      {
        id: 8,
        name: "Command",
        permissions: ["BanMembers"],
        permissionLabels: ["Ban Members"],
        linkedRoleId: staff,
        met: false,
        statusLine: "Staff is missing Ban Members.",
      },
    ],
    requirementIssues: ["Command needs a Discord role on this server."],
    roles: [{ id: staff, name: "Staff", color: 0xe2b45a, assignable: true, problem: null, permissions: "0" }],
    namedRoles: [
      {
        id: 7,
        name: "Command",
        parentGuildId: "200000000000000001",
        parentGuildName: "San Andreas Government",
        parentRoleName: "Moderator",
        allowedCategoryIds: [1],
        localRoleId: "",
      },
      {
        id: 8,
        name: "Cadet",
        parentGuildId: "200000000000000001",
        parentGuildName: "San Andreas Government",
        parentRoleName: "Citizen",
        allowedCategoryIds: [],
        localRoleId: "",
      },
      {
        id: 9,
        name: "Dispatch",
        parentGuildId: "200000000000000001",
        parentGuildName: "San Andreas Government",
        parentRoleName: "Clerk",
        allowedCategoryIds: [],
        localRoleId: "",
      },
    ],
  };
  const courts = {
    id: "200000000000000003",
    name: "Blaine County Courts",
    icon: null,
    present: true,
    categoryId: 2,
    categoryName: "Courts",
    slots: [],
    requirementIssues: [],
    selected: new Set(),
    roles: [{ id: bailiff, name: "Bailiff", color: 0x8ed0c6, assignable: true, problem: null }],
  };
  const open = {
    id: "200000000000000004",
    name: "Ban Appeals",
    icon: null,
    present: true,
    categoryId: null,
    categoryName: "",
    slots: [],
    requirementIssues: [],
    selected: new Set(),
    roles: [],
  };
  const base = {
    viewer: { name: "Jordan", avatarUrl: null },
    csrf: "csrf-token",
    community: { id: 4, name: "State of San Andreas", roleSyncEnabled: true, banSyncEnabled: true },
    summary: "You can change every server.",
    master: { id: "200000000000000001", name: "San Andreas Government", icon: null, present: true },
    namedRoles: [
      {
        id: 7,
        name: "Command",
        parentRoleName: "",
        parentGuildName: "",
        allowedCategoryIds: [1],
      },
      {
        id: 8,
        name: "Cadet",
        parentRoleName: "",
        parentGuildName: "",
        allowedCategoryIds: [],
      },
      {
        id: 9,
        name: "Dispatch",
        parentRoleName: "",
        parentGuildName: "",
        allowedCategoryIds: [],
      },
    ],
    masterRoleChoices: [],
    categories: [law, bench],
    guilds: [police, courts, open],
    addableGuilds: [],
    logs: [],
    botMessage: null,
  };
  const mainCategories = renderCategories({
    ...base,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [police.id, courts.id, open.id] },
  });
  const mainRoles = renderRoles({
    ...base,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [police.id, courts.id, open.id] },
  });
  const allowed = renderGuildRoles({
    ...base,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [police.id] },
    guild: police,
  });
  const other = renderGuildRoles({
    ...base,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [courts.id] },
    guild: courts,
  });
  const uncategorized = renderGuildRoles({
    ...base,
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [open.id] },
    guild: open,
  });
  const linked = renderGuildRoles({
    ...base,
    access: { isMainAdmin: false, canManageCommunity: false, editableGuildIds: [police.id] },
    guild: police,
  });

  const categoryAccess = { isMainAdmin: true, canManageCommunity: true, editableGuildIds: [police.id, courts.id, open.id] };
  const categorySettings = renderCategorySettings({ ...base, access: categoryAccess, category: law });
  const roleSettings = renderCategoryRoleSettings({
    ...base,
    access: categoryAccess,
    category: law,
    role: law.roles[0],
  });

  assert.match(mainCategories, /Create category/);
  assert.match(mainCategories, /Categories are optional/);
  assert.match(mainCategories, /href="\/c\/4\/categories\/1"/);
  assert.match(mainCategories, /Edit/);
  assert.match(mainCategories, /href="\/c\/4\/categories" aria-current="page"/);
  assert.doesNotMatch(mainCategories, /<details/);
  assert.doesNotMatch(mainCategories, /Add role/);
  assert.match(categorySettings, /<select name="namedRoleId"/);
  assert.match(categorySettings, /<option value="9">Dispatch<\/option>/);
  assert.doesNotMatch(categorySettings, /<option value="7"/);
  assert.doesNotMatch(categorySettings, /type="checkbox" name="namedRoleId"/);
  assert.match(categorySettings, /Add role/);
  assert.match(categorySettings, /href="\/c\/4\/categories\/1\/roles\/7"/);
  assert.match(categorySettings, /href="\/c\/4\/categories\/1\/roles\/8"/);
  assert.match(categorySettings, /Edit/);
  assert.match(roleSettings, /Discord permissions for Command/);
  assert.match(roleSettings, /The bot needs Administrator on the server/);
  assert.match(roleSettings, /Saving a change updates the Discord roles set up for this category/);
  assert.match(roleSettings, /href="\/c\/4\/categories\/1"/);
  const commandSetup = renderRoleSettings({
    ...base,
    access: categoryAccess,
    role: base.namedRoles[0],
  });

  const commandOnPolice = renderGuildRoleSettings({
    ...base,
    access: categoryAccess,
    guild: police,
    role: police.namedRoles[0],
  });

  assert.match(mainRoles, /Add this role/);
  assert.match(mainRoles, /href="\/c\/4\/roles\/7"/);
  assert.doesNotMatch(mainRoles, /name="parentGuildId"/);
  assert.doesNotMatch(mainRoles, /Only link this role on servers in/);
  assert.match(commandSetup, /Only link this role on servers in/);
  assert.match(commandSetup, /name="categoryId" value="1"/);
  assert.match(commandSetup, /name="parentGuildId"/);
  assert.match(allowed, /name="categoryId"/);
  assert.match(allowed, /Required roles/);
  assert.match(allowed, /Command needs a Discord role on this server/);
  assert.match(allowed, /href="\/c\/4\/guilds\/200000000000000002\/roles\/7"/);
  assert.match(allowed, /Add a role/);
  assert.match(allowed, /<option value="9">Dispatch<\/option>/);
  assert.doesNotMatch(allowed, /<option value="7">/);
  assert.match(allowed, /Edit/);
  assert.doesNotMatch(allowed, /Which role is Command on Los Santos Police/);
  assert.match(commandOnPolice, /Which role is Command on Los Santos Police/);
  assert.match(other, /Command is set up on servers in Law enforcement/);
  assert.doesNotMatch(other, /Which role is Command/);
  assert.match(uncategorized, /Command is set up on servers in Law enforcement/);
  assert.doesNotMatch(uncategorized, /Which role is Command/);
  assert.match(linked, /<strong>Category<\/strong> Law enforcement/);
  assert.match(linked, /href="\/c\/4\/guilds\/200000000000000002\/roles\/7"/);
  assert.match(linked, /Edit/);
  assert.doesNotMatch(linked, /Which role is Command on Los Santos Police/);
  assert.doesNotMatch(linked, /Create category/);
  assert.doesNotMatch(linked, /Save category/);
  assert.doesNotMatch(linked, /name="categoryId"/);
});
