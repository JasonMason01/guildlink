import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../src/db.js";

function db() {
  return openDatabase(":memory:");
}

test("a server can only belong to one community", () => {
  const database = db();
  const first = database.createCommunity({
    name: "State of San Andreas",
    masterGuildId: "100000000000000001",
    createdBy: "200000000000000001",
  });
  database.addLinkedGuild({
    communityId: first.id,
    guildId: "100000000000000002",
    addedBy: "200000000000000001",
    masterGuildId: first.masterGuildId,
  });

  assert.throws(
    () =>
      database.createCommunity({
        name: "Other",
        masterGuildId: "100000000000000099",
        createdBy: "200000000000000001",
      }),
    /already has a community/
  );
  assert.throws(() =>
    database.addLinkedGuild({
      communityId: first.id,
      guildId: first.masterGuildId,
      addedBy: "200000000000000001",
      masterGuildId: first.masterGuildId,
    })
  );
  database.close();
});

test("guildlink role names are unique and a parent is chosen before a destination", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000011",
    createdBy: "200000000000000011",
  });
  const police = "100000000000000012";
  const courts = "100000000000000013";
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police,
    addedBy: "200000000000000011",
    masterGuildId: community.masterGuildId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts,
    addedBy: "200000000000000011",
    masterGuildId: community.masterGuildId,
  });
  const mod = database.createNamedRole(community.id, "Mod");
  assert.throws(() => database.createNamedRole(community.id, "mod"), /already exists/);
  assert.throws(() => database.createNamedRole(community.id, "x".repeat(81)), /80 characters/);
  database.setNamedRoleParent(community.id, mod.id, police, "400000000000000009");
  assert.equal(database.getNamedRole(community.id, mod.id).parentGuildId, police);
  database.setNamedRoleDestination(community.id, mod.id, courts, "400000000000000012");
  database.setNamedRoleDestination(community.id, mod.id, courts, "400000000000000013");
  assert.deepEqual(database.listNamedRoleDestinations(community.id), [
    { namedRoleId: mod.id, guildId: courts, roleId: "400000000000000013" },
  ]);
  assert.throws(() => database.setNamedRoleDestination(community.id, mod.id, police, "400000000000000001"), /comes from this server/);
  database.rememberNamedRoleGrant(community.id, mod.id, "200000000000000011", courts, "400000000000000013");
  database.deleteNamedRole(community.id, mod.id);
  assert.deepEqual(database.listNamedRoles(community.id), []);
  assert.deepEqual(database.listNamedRoleDestinations(community.id), []);
  assert.equal(database.listNamedRoleGrants(community.id, "200000000000000011").length, 1);
  database.close();
});

test("deleting a guildlink role keeps the audit log scoped to a linked server", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000021",
    createdBy: "200000000000000021",
  });
  const named = database.createNamedRole(community.id, "Mod");
  database.addLinkedGuild({
    communityId: community.id,
    guildId: "100000000000000022",
    addedBy: "200000000000000021",
    masterGuildId: community.masterGuildId,
  });
  database.setNamedRoleParent(community.id, named.id, community.masterGuildId, "300000000000000021");
  database.setNamedRoleDestination(community.id, named.id, "100000000000000022", "400000000000000021");
  database.addLog({ communityId: community.id, kind: "config", detail: "Turned ban sync on." });
  database.addLog({
    communityId: community.id,
    kind: "role",
    guildId: "100000000000000022",
    detail: "Gave Staff.",
  });
  database.deleteNamedRole(community.id, named.id);
  assert.equal(database.listLogs(community.id).length, 2);
  assert.equal(database.listLogs(community.id, { guildIds: ["100000000000000022"] }).length, 1);
  database.close();
});

test("unlinking a server forgets that server's choices and leaves other grants recorded", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000031",
    createdBy: "200000000000000031",
  });
  const police = "100000000000000032";
  const courts = "100000000000000033";
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police,
    addedBy: "200000000000000031",
    masterGuildId: community.masterGuildId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts,
    addedBy: "200000000000000031",
    masterGuildId: community.masterGuildId,
  });
  const named = database.createNamedRole(community.id, "Police");
  database.setNamedRoleParent(community.id, named.id, police, "400000000000000031");
  database.setNamedRoleDestination(community.id, named.id, courts, "400000000000000033");
  database.rememberNamedRoleGrant(community.id, named.id, "200000000000000031", courts, "400000000000000033");
  database.rememberNamedRoleGrant(community.id, named.id, "200000000000000031", police, "400000000000000032");
  database.removeLinkedGuild(community.id, police);
  assert.equal(database.getNamedRole(community.id, named.id).parentGuildId, police);
  assert.deepEqual(database.listNamedRoleDestinations(community.id), [
    { namedRoleId: named.id, guildId: courts, roleId: "400000000000000033" },
  ]);
  assert.deepEqual(database.listNamedRoleGrants(community.id, "200000000000000031"), [
    { namedRoleId: named.id, guildId: courts, roleId: "400000000000000033" },
  ]);
  database.close();
});

test("the ban appeals server has to be linked, and unlinking it clears the exemption", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000041",
    createdBy: "200000000000000041",
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: "100000000000000042",
    addedBy: "200000000000000041",
    masterGuildId: community.masterGuildId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: "100000000000000043",
    addedBy: "200000000000000041",
    masterGuildId: community.masterGuildId,
  });
  assert.equal(database.getCommunity(community.id).appealsGuildId, null);
  assert.throws(() => database.setAppealsGuild(community.id, "100000000000000099"));
  const marked = database.setAppealsGuild(community.id, "100000000000000043");
  assert.equal(marked.appealsGuildId, "100000000000000043");
  assert.equal(marked.appealUnbanEnabled, false);
  const allowed = database.setAppealsGuild(community.id, "100000000000000043", true);
  assert.equal(allowed.appealUnbanEnabled, true);
  database.setAppealUnbanRoles(community.id, ["400000000000000099"]);
  assert.deepEqual(database.listAppealUnbanRoles(community.id), ["400000000000000099"]);
  database.setAppealsGuild(community.id, "100000000000000042", true);
  assert.deepEqual(database.listAppealUnbanRoles(community.id), []);
  database.setAppealUnbanRoles(community.id, ["400000000000000098"]);
  database.removeLinkedGuild(community.id, "100000000000000043");
  assert.deepEqual(database.listAppealUnbanRoles(community.id), ["400000000000000098"]);
  database.removeLinkedGuild(community.id, "100000000000000042");
  assert.deepEqual(database.listAppealUnbanRoles(community.id), []);
  const cleared = database.getCommunity(community.id);
  assert.equal(cleared.appealsGuildId, null);
  assert.deepEqual(cleared.linkedGuildIds, []);
  database.close();
});

test("a parent on a linked server can grant one role on another server", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000051",
    createdBy: "200000000000000051",
  });
  const police = "100000000000000052";
  const courts = "100000000000000053";
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police,
    addedBy: "200000000000000051",
    masterGuildId: community.masterGuildId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts,
    addedBy: "200000000000000051",
    masterGuildId: community.masterGuildId,
  });
  const named = database.createNamedRole(community.id, "Police");
  database.setNamedRoleParent(community.id, named.id, police, "400000000000000052");
  database.setNamedRoleDestination(community.id, named.id, courts, "400000000000000053");
  database.setNamedRoleDestination(community.id, named.id, community.masterGuildId, "300000000000000051");
  database.setNamedRoleDestination(community.id, named.id, community.masterGuildId, "");
  assert.deepEqual(
    database.listNamedRoleDestinations(community.id).map((item) => item.guildId),
    [courts]
  );
  database.close();
});

test("categories store optional requirements and limit which servers a role links on", () => {
  const database = db();
  const community = database.createCommunity({
    name: "State",
    masterGuildId: "100000000000000061",
    createdBy: "200000000000000061",
  });
  const police = "100000000000000062";
  const courts = "100000000000000063";
  database.addLinkedGuild({
    communityId: community.id,
    guildId: police,
    addedBy: "200000000000000061",
    masterGuildId: community.masterGuildId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: courts,
    addedBy: "200000000000000061",
    masterGuildId: community.masterGuildId,
  });
  const law = database.createCategory(community.id, "Law enforcement");
  const bench = database.createCategory(community.id, "Courts");
  const command = database.createNamedRole(community.id, "Command");
  const cadet = database.createNamedRole(community.id, "Cadet");
  database.setCategoryRequirements(community.id, law, [command.id, cadet.id]);
  database.setCategoryRequirementPermissions(community.id, law, command.id, ["BanMembers"]);
  database.setCategoryRequirementPermissions(community.id, law, cadet.id, ["KickMembers"]);
  database.setGuildCategory(community.id, police, law);
  database.setNamedRoleParent(community.id, command.id, community.masterGuildId, "300000000000000061");
  database.setNamedRoleDestination(community.id, command.id, police, "400000000000000062");
  database.setNamedRoleCategoryLimit(community.id, command.id, [law]);

  const saved = database.listCategories(community.id);
  const lawRoles = saved.find((item) => item.id === law).roles;
  assert.deepEqual(lawRoles.map((role) => role.name), ["Cadet", "Command"]);
  assert.deepEqual(
    lawRoles.find((role) => role.name === "Command").permissions,
    ["BanMembers"]
  );
  assert.deepEqual(
    lawRoles.find((role) => role.name === "Cadet").permissions,
    ["KickMembers"]
  );
  database.setCategoryRequirements(community.id, law, [command.id]);
  const kept = database.listCategories(community.id).find((item) => item.id === law).roles;
  assert.deepEqual(kept.map((role) => role.name), ["Command"]);
  assert.deepEqual(kept[0].permissions, ["BanMembers"]);
  database.setCategoryRequirements(community.id, law, [command.id, cadet.id]);
  assert.equal(database.listGuildCategories(community.id).find((row) => row.guildId === police).categoryId, law);
  assert.equal(database.listGuildCategories(community.id).find((row) => row.guildId === courts).categoryId, null);
  assert.deepEqual(database.listNamedRoleCategoryLimits(community.id), [{ namedRoleId: command.id, categoryId: law }]);

  database.setGuildCategory(community.id, police, bench);
  database.setGuildCategory(community.id, police, law);
  database.removeCategoryRequirement(community.id, law, command.id);
  database.removeCategoryRequirement(community.id, law, cadet.id);
  assert.deepEqual(database.listCategories(community.id).find((item) => item.id === law).roles, []);

  database.setGuildCategory(community.id, courts, bench);
  database.deleteCategory(community.id, bench);
  assert.equal(database.listGuildCategories(community.id).find((row) => row.guildId === courts).categoryId, null);
  assert.deepEqual(database.listNamedRoleCategoryLimits(community.id), [{ namedRoleId: command.id, categoryId: law }]);

  const dispatch = database.createNamedRole(community.id, "Dispatch");
  database.addGuildExtraRole(community.id, police, dispatch.id);
  database.setNamedRoleDestination(community.id, dispatch.id, police, "400000000000000063");
  assert.deepEqual(database.listGuildExtraRoles(community.id), [{ guildId: police, namedRoleId: dispatch.id }]);
  database.removeGuildExtraRole(community.id, police, dispatch.id);
  assert.deepEqual(database.listGuildExtraRoles(community.id), []);
  assert.equal(
    database.listNamedRoleDestinations(community.id).some((item) => item.namedRoleId === dispatch.id),
    false
  );
  database.addGuildExtraRole(community.id, police, dispatch.id);

  database.removeLinkedGuild(community.id, police);
  assert.deepEqual(database.listNamedRoleDestinations(community.id), []);
  assert.deepEqual(database.listGuildExtraRoles(community.id), []);
  database.deleteCommunity(community.id);
  assert.deepEqual(database.listCategories(community.id), []);
  database.close();
});
