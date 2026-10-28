import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createMockClient } from "../src/bot/mockDiscord.js";
import { acceptBanAppeal, syncAllBans } from "../src/bot/banSync.js";
import { handleCommand } from "../src/bot/commands.js";
import { reconcileRolePermissions } from "../src/bot/rolePermissions.js";
import { syncAllRoles } from "../src/bot/roleSync.js";
import { openDatabase } from "../src/db.js";
import { tokenBox } from "../src/secretBox.js";
import { describeGuild } from "../src/web/present.js";
import { createApp } from "../src/web/routes.js";

const jordan = "200000000000000001";
const casey = "200000000000000004";

test("sample servers expose assignable roles and keep local roles during sync", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const profile = await describeGuild(client, government.id);
  const moderator = profile.roles.find((role) => role.name === "Moderator");
  const booster = profile.roles.find((role) => role.name === "Server Booster");
  assert.equal(moderator.assignable, true);
  assert.equal(booster.assignable, false);

  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  const mod = database.createNamedRole(community.id, "Mod");
  database.setNamedRoleParent(community.id, mod.id, government.id, moderator.id);
  const staff = [...police.roles.cache.values()].find((role) => role.name === "Staff");
  database.setNamedRoleDestination(community.id, mod.id, police.id, staff.id);

  const result = await syncAllRoles(database, client, community);
  assert.equal(result.ok, true);
  const member = police.members.cache.get(jordan);
  assert.equal(member.roles.cache.get(staff.id)?.name, "Staff");
  assert.equal([...member.roles.cache.values()].some((role) => role.name === "Cadet"), true);
  const avery = police.members.cache.get("200000000000000002");
  assert.equal(avery.roles.cache.has(staff.id), false);

  database.deleteNamedRole(community.id, mod.id);
  await syncAllRoles(database, client, database.getCommunity(community.id));
  assert.equal(police.members.cache.get(jordan).roles.cache.has(staff.id), false);
  assert.equal([...police.members.cache.get(jordan).roles.cache.values()].some((role) => role.name === "Cadet"), true);
  database.close();
});

test("a parent on a linked server grants the chosen role on another server", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const courts = guildNamed(client, "Blaine County Courts");
  const moderator = [...government.roles.cache.values()].find((role) => role.name === "Moderator");
  const cadet = [...police.roles.cache.values()].find((role) => role.name === "Cadet");
  const clerk = [...courts.roles.cache.values()].find((role) => role.name === "Clerk");
  const bailiff = [...courts.roles.cache.values()].find((role) => role.name === "Bailiff");
  const avery = "200000000000000002";

  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  const named = database.createNamedRole(community.id, "Police");
  database.setNamedRoleParent(community.id, named.id, police.id, cadet.id);
  database.setNamedRoleDestination(community.id, named.id, courts.id, clerk.id);
  await courts.members.cache.get(jordan).roles.add(bailiff.id);

  const result = await syncAllRoles(database, client, community);
  assert.equal(result.ok, true);
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(clerk.id), true);
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(bailiff.id), true);
  assert.equal(courts.members.cache.get(avery).roles.cache.has(clerk.id), false);
  assert.equal([...government.roles.cache.values()].some((role) => role.name === "Cadet" || role.name === "Police"), false);
  assert.equal(government.members.cache.get(jordan).roles.cache.has(moderator.id), true);

  await police.members.cache.get(jordan).roles.remove(cadet.id);
  await syncAllRoles(database, client, database.getCommunity(community.id));
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(clerk.id), false);
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(bailiff.id), true);
  assert.equal(police.members.cache.get(jordan).roles.cache.has(cadet.id), false);
  database.close();
});

test("category permissions are granted and removed only when GuildLink added them", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const staff = [...police.roles.cache.values()].find((role) => role.name === "Staff");
  const kick = 1n << 1n;
  const ban = 1n << 2n;
  staff.permissions = kick.toString();

  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  const command = database.createNamedRole(community.id, "Command");
  database.setNamedRoleParent(community.id, command.id, police.id, staff.id);
  const law = database.createCategory(community.id, "Law enforcement");
  database.setGuildCategory(community.id, police.id, law);
  database.addCategoryRequirement(community.id, law, command.id);
  database.setCategoryRequirementPermissions(community.id, law, command.id, ["BanMembers"]);

  const granted = await reconcileRolePermissions(database, client, community, { guildIds: [police.id] });
  assert.equal(granted.ok, true);
  const afterGrant = BigInt(staff.permissions);
  assert.equal((afterGrant & ban) === ban, true);
  assert.equal((afterGrant & kick) === kick, true);
  assert.deepEqual(database.listPermissionGrants(community.id, police.id).get(staff.id), ["BanMembers"]);

  database.setCategoryRequirementPermissions(community.id, law, command.id, []);
  await reconcileRolePermissions(database, client, community, { guildIds: [police.id] });
  const afterRemove = BigInt(staff.permissions);
  assert.equal((afterRemove & ban) === ban, false);
  assert.equal((afterRemove & kick) === kick, true);

  staff.permissions = ban.toString();
  database.setCategoryRequirementPermissions(community.id, law, command.id, ["BanMembers"]);
  await reconcileRolePermissions(database, client, community, { guildIds: [police.id] });
  assert.equal(database.listPermissionGrants(community.id, police.id).get(staff.id), undefined);
  database.setCategoryRequirementPermissions(community.id, law, command.id, []);
  await reconcileRolePermissions(database, client, community, { guildIds: [police.id] });
  assert.equal((BigInt(staff.permissions) & ban) === ban, true);

  staff.permissions = "0";
  police.members.me.permissions = "0";
  database.setCategoryRequirementPermissions(community.id, law, command.id, ["BanMembers"]);
  const blocked = await reconcileRolePermissions(database, client, community, { guildIds: [police.id] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /Administrator/);
  assert.equal(staff.permissions, "0");
  database.close();
});

test("sample ban sync skips the ban appeals server", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const appeals = guildNamed(client, "Ban Appeals");
  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: appeals.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.setAppealsGuild(community.id, appeals.id);

  const avery = "200000000000000002";
  await police.members.ban(avery, { reason: "Local note stays here" });
  const result = await syncAllBans(database, client, database.getCommunity(community.id));
  assert.equal(result.ok, true);
  const copied = await police.bans.fetch(casey);
  assert.equal(copied.reason, "[GuildLink] Banned from San Andreas Government");
  assert.equal(copied.reason.includes("Fail RP"), false);
  assert.equal((await government.bans.fetch(casey)).reason, "Fail RP");
  assert.equal((await police.bans.fetch(avery)).reason, "Local note stays here");
  await police.members.ban(casey, { reason: "[GuildLink] Banned from San Andreas Government: Fail RP" });
  await syncAllBans(database, client, database.getCommunity(community.id));
  const refreshed = await police.bans.fetch(casey);
  assert.equal(refreshed.reason, "[GuildLink] Banned from San Andreas Government");
  assert.equal(refreshed.reason.includes("Fail RP"), false);
  await assert.rejects(() => appeals.bans.fetch(casey), (error) => error.code === 10026);
  assert.equal(appeals.members.cache.has(casey), true);
  database.close();
});

test("beta mode opens the panel on the sample servers", async () => {
  const client = createMockClient();
  const database = openDatabase(":memory:");
  const app = createApp({
    db: database,
    client,
    config: {
      clientId: "100000000000000001",
      clientSecret: "",
      redirectUri: "http://127.0.0.1:3000/auth/callback",
      secureCookies: false,
      trustProxy: false,
      betaOpenPanel: true,
    },
    botState: { ready: true, error: null },
    box: tokenBox("test-session-secret"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /San Andreas Government/);
    assert.match(html, /samples stored on this computer/);
    assert.doesNotMatch(html, /The bot is still connecting/);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const masterGuildId = guildNamed(client, "San Andreas Government").id;

    const created = await fetch(`${origin}/communities`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, name: "State of San Andreas", masterGuildId }),
    });
    assert.equal(created.status, 303);
    const communityUrl = created.headers.get("location");
    const community = await fetch(`${origin}${communityUrl}`);
    const communityHtml = await community.text();
    assert.match(communityHtml, /Community pages/);
    assert.match(communityHtml, /href="\/c\/\d+\/roles"/);
    assert.match(communityHtml, /href="\/c\/\d+\/servers"/);
    assert.match(communityHtml, /href="\/c\/\d+\/categories"/);
    assert.match(communityHtml, /href="\/c\/\d+\/bans"/);
    assert.match(communityHtml, /href="\/c\/\d+\/audit"/);
    assert.doesNotMatch(communityHtml, /Created the community with San Andreas Government/);
    assert.doesNotMatch(communityHtml, /name="appealsGuildId"/);
    assert.doesNotMatch(communityHtml, /name="target_/);
    const audit = await fetch(`${origin}${communityUrl}/audit`);
    assert.equal(audit.status, 200);
    const auditHtml = await audit.text();
    assert.match(auditHtml, /<title>Audit log · GuildLink<\/title>/);
    assert.match(auditHtml, /href="\/c\/\d+\/audit" aria-current="page"/);
    assert.match(auditHtml, /Created the community with San Andreas Government as the main server/);
    const roles = await fetch(`${origin}${communityUrl}/roles`);
    const rolesHtml = await roles.text();
    assert.match(rolesHtml, /Add this role/);
    assert.doesNotMatch(rolesHtml, /Add a server/);
    const servers = await fetch(`${origin}${communityUrl}/servers`);
    const serversHtml = await servers.text();
    assert.match(serversHtml, /Los Santos Police/);
    assert.match(serversHtml, /Ban Appeals/);
    assert.match(serversHtml, /href="\/c\/\d+\/servers" aria-current="page"/);
    const categories = await fetch(`${origin}${communityUrl}/categories`);
    const categoriesHtml = await categories.text();
    assert.match(categoriesHtml, /Create category/);
    assert.match(categoriesHtml, /href="\/c\/\d+\/categories" aria-current="page"/);
  } finally {
    server.close();
    database.close();
  }
});

test("the appeals unban command stays off until a main-server admin allows it", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const appeals = guildNamed(client, "Ban Appeals");
  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: appeals.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.setAppealsGuild(community.id, appeals.id);
  await police.members.ban(casey, { reason: "copied" });
  database.upsertSyncedBan({ communityId: community.id, guildId: police.id, userId: casey, reason: "copied" });

  const blocked = await acceptBanAppeal(database, client, community, casey, jordan);
  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /turned off/);
  assert.ok(await government.bans.fetch(casey));

  const enabled = database.setAppealsGuild(community.id, appeals.id, true);
  const replies = [];
  const reply = (text) => replies.push(text);
  const context = { db: database, config: { publicUrl: "http://127.0.0.1:3000" } };
  await handleCommand(fakeUnban(appeals.id, client, reply), context);
  assert.match(replies.at(-1), /No roles are allowed/);
  assert.ok(await government.bans.fetch(casey));

  const appellant = "400000000000000021";
  database.setAppealUnbanRoles(community.id, [appellant]);
  await handleCommand(fakeUnban(appeals.id, client, reply), context);
  assert.match(replies.at(-1), /need a role/);
  assert.ok(await government.bans.fetch(casey));

  await handleCommand(fakeUnban(appeals.id, client, reply, [appellant]), context);
  assert.match(replies.at(-1), /Removed the main-server ban/);
  await assert.rejects(() => government.bans.fetch(casey), (error) => error.code === 10026);
  await assert.rejects(() => police.bans.fetch(casey), (error) => error.code === 10026);
  assert.equal(database.getSyncedBan(community.id, police.id, casey), null);
  assert.equal(appeals.members.cache.has(casey), true);
  assert.equal(enabled.appealUnbanEnabled, true);

  await handleCommand(fakeUnban(appeals.id, client, reply, [appellant]), context);
  assert.match(replies.at(-1), /not banned on the main server/);
  database.close();
});

test("category limits stop new grants and leave roles already applied", async () => {
  const client = createMockClient();
  const government = guildNamed(client, "San Andreas Government");
  const police = guildNamed(client, "Los Santos Police");
  const courts = guildNamed(client, "Blaine County Courts");
  const moderator = [...government.roles.cache.values()].find((role) => role.name === "Moderator");
  const staff = [...police.roles.cache.values()].find((role) => role.name === "Staff");
  const bailiff = [...courts.roles.cache.values()].find((role) => role.name === "Bailiff");

  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: government.id,
    createdBy: jordan,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts.id,
    addedBy: jordan,
    masterGuildId: government.id,
  });
  const mod = database.createNamedRole(community.id, "Mod");
  database.setNamedRoleParent(community.id, mod.id, government.id, moderator.id);
  database.setNamedRoleDestination(community.id, mod.id, police.id, staff.id);
  database.setNamedRoleDestination(community.id, mod.id, courts.id, bailiff.id);

  await syncAllRoles(database, client, community);
  assert.equal(police.members.cache.get(jordan).roles.cache.has(staff.id), true);
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(bailiff.id), true);
  assert.equal(government.members.cache.get(jordan).roles.cache.has(moderator.id), true);

  const law = database.createCategory(community.id, "Law enforcement");
  const bench = database.createCategory(community.id, "Courts");
  database.setGuildCategory(community.id, police.id, law);
  database.setGuildCategory(community.id, courts.id, bench);
  database.setNamedRoleCategoryLimit(community.id, mod.id, [law]);

  await syncAllRoles(database, client, database.getCommunity(community.id));
  assert.equal(police.members.cache.get(jordan).roles.cache.has(staff.id), true);
  assert.equal(courts.members.cache.get(jordan).roles.cache.has(bailiff.id), true);
  assert.equal(government.members.cache.get(jordan).roles.cache.has(moderator.id), true);
  database.close();
});

function fakeUnban(guildId, client, editReply = () => {}, roleIds = []) {
  return {
    isChatInputCommand: () => true,
    commandName: "guildlink",
    inGuild: () => true,
    guild: { id: guildId, ownerId: "200000000000000099", name: "Ban Appeals", roles: { cache: new Map() } },
    guildId,
    user: { id: jordan },
    member: { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } },
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => "unban",
      getUser: () => ({ id: casey }),
    },
    client,
    deferReply: async () => {},
    editReply,
    reply: async () => {},
  };
}

function guildNamed(client, name) {
  return [...client.guilds.cache.values()].find((guild) => guild.name === name);
}
