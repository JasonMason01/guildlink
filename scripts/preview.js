import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBans, renderCommunity, renderHome, renderLogin } from "../src/web/render.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewDir = path.join(root, "preview");
const moderator = "300000000000000001";
const command = "300000000000000002";
const staff = "400000000000000002";
const bailiff = "400000000000000003";
const liaison = "400000000000000004";

const viewer = { name: "Jordan Hale", avatarUrl: null };

function localize(html) {
  return html
    .replaceAll('href="/styles.css"', 'href="styles.css"')
    .replaceAll('src="/panel.js"', 'src="panel.js"')
    .replaceAll('href="/favicon.svg"', 'href="favicon.svg"');
}

const policeRoles = [
  { id: staff, name: "Staff", color: 0x6ea8fe, assignable: true, problem: null },
  { id: "400000000000000010", name: "Command", color: 0xe2b45a, assignable: true, problem: null },
  { id: "400000000000000011", name: "High Command", color: 0xe08a7c, assignable: false, problem: "Move the GuildLink role above this one." },
];

const courtRoles = [
  { id: bailiff, name: "Bailiff", color: 0x8ed0c6, assignable: true, problem: null },
  { id: "400000000000000012", name: "Clerk", color: 0x9aaba0, assignable: true, problem: null },
];

const medicalRoles = [
  { id: liaison, name: "Liaison", color: 0x8fce96, assignable: true, problem: null },
  { id: "400000000000000013", name: "Supervisor", color: 0xe2b45a, assignable: true, problem: null },
];

await mkdir(previewDir, { recursive: true });
await cp(path.join(root, "src", "web", "public"), previewDir, { recursive: true });

const pages = {
  "login.html": renderLogin({
    inviteUrl: "https://discord.com/oauth2/authorize",
  }),
  "home.html": renderHome({
    viewer,
    csrf: "preview",
    homeHref: "home.html",
    inviteUrl: "https://discord.com/oauth2/authorize",
    botMessage: null,
    missingBotGuilds: [],
    creatableGuilds: [{ id: "200000000000000009", name: "Paleto Bay" }],
  }),
  "main-admin.html": renderCommunity({
    viewer,
    csrf: "preview",
    homeHref: "home.html",
    community: {
      id: 1,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
      appealsGuildId: "200000000000000003",
    },
    access: { isMainAdmin: true, canManageCommunity: true, editableGuildIds: ["police", "courts", "medical"] },
    summary: "You have Administrator on San Andreas Government, the main server, so you can change settings for every server in this community.",
    master: { id: "main", name: "San Andreas Government", icon: null, present: true },
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
        selected: new Set([`${moderator}:${staff}`, `${command}:400000000000000010`]),
        roles: policeRoles,
      },
      {
        id: "200000000000000003",
        name: "Blaine County Courts",
        icon: null,
        present: true,
        selected: new Set([`${moderator}:${bailiff}`]),
        roles: courtRoles,
      },
      {
        id: "200000000000000004",
        name: "San Andreas Medical",
        icon: null,
        present: true,
        selected: new Set([`${command}:${liaison}`]),
        roles: medicalRoles,
      },
    ],
    addableGuilds: [{ id: "200000000000000008", name: "Paleto Bay" }],
    logs: [
      { createdAt: "2026-10-28T06:12:00.000Z", kind: "role", detail: "jordan on Los Santos Police: Gave Staff." },
      { createdAt: "2026-10-28T06:10:00.000Z", kind: "ban", detail: "Banned user 555000000000000001 on Blaine County Courts." },
      { createdAt: "2026-10-28T06:02:00.000Z", kind: "config", detail: "Linked San Andreas Medical." },
    ],
  }),
  "linked-admin.html": renderCommunity({
    viewer: { name: "Avery Quinn", avatarUrl: null },
    csrf: "preview",
    homeHref: "home.html",
    community: {
      id: 1,
      name: "State of San Andreas",
      roleSyncEnabled: true,
      banSyncEnabled: true,
      appealsGuildId: "200000000000000003",
    },
    access: { isMainAdmin: false, canManageCommunity: false, editableGuildIds: ["courts"] },
    summary: "You have Administrator on Blaine County Courts, so you can change settings for that server only.",
    master: { id: "main", name: "San Andreas Government", icon: null, present: true },
    sourceRoles: [
      { id: moderator, name: "Moderator", color: 0xe2b45a },
      { id: command, name: "Police Command", color: 0x8ed0c6 },
    ],
    masterRoleChoices: [],
    guilds: [
      {
        id: "200000000000000003",
        name: "Blaine County Courts",
        icon: null,
        present: true,
        selected: new Set([`${moderator}:${bailiff}`]),
        roles: courtRoles,
      },
    ],
    addableGuilds: [],
    logs: [{ createdAt: "2026-10-28T06:10:00.000Z", kind: "ban", detail: "Banned user 555000000000000001 on Blaine County Courts." }],
  }),
};

for (const [name, html] of Object.entries(pages)) {
  await writeFile(path.join(previewDir, name), localize(html));
}

const check = await readFile(path.join(previewDir, "linked-admin.html"), "utf8");
if (check.includes("Los Santos Police") || check.includes("Sync bans") || check.includes("Save ban appeals")) {
  throw new Error("Linked admin preview leaked other servers or community controls.");
}
const linkedBans = renderBans({
  viewer: { name: "Avery Quinn", avatarUrl: null },
  csrf: "preview",
  homeHref: "home.html",
  community: {
    id: 1,
    name: "State of San Andreas",
    roleSyncEnabled: true,
    banSyncEnabled: true,
    appealsGuildId: "200000000000000003",
    appealUnbanEnabled: true,
  },
  access: { isMainAdmin: false, canManageCommunity: false, editableGuildIds: ["200000000000000003"] },
  summary: "You have Administrator on Blaine County Courts, so you can change settings for that server only.",
  master: { id: "main", name: "San Andreas Government", icon: null, present: true },
  guilds: [
    {
      id: "200000000000000003",
      name: "Blaine County Courts",
      icon: null,
      present: true,
      roles: courtRoles,
    },
  ],
});
if (!linkedBans.toLowerCase().includes("ban appeals")) {
  throw new Error("Linked admin bans page should explain the ban appeals server.");
}

console.log(`Wrote previews to ${previewDir}`);
