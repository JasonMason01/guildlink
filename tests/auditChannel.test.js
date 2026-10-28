import assert from "node:assert/strict";
import test from "node:test";
import { attachAuditChannel, listAuditServers } from "../src/bot/auditChannel.js";
import { createMockClient } from "../src/bot/mockDiscord.js";
import { openDatabase } from "../src/db.js";

const GOVERNMENT = "100000000000000001";
const POLICE = "100000000000000002";

test("an optional audit channel receives new lines and can be cleared", async () => {
  const client = createMockClient();
  const database = openDatabase(":memory:");
  attachAuditChannel(database, client);
  const community = database.createCommunity({
    name: "State of San Andreas",
    masterGuildId: GOVERNMENT,
    createdBy: "200000000000000099",
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: POLICE,
    addedBy: "200000000000000099",
    masterGuildId: GOVERNMENT,
  });
  const servers = await listAuditServers(client, community);
  const government = servers.find((server) => server.id === GOVERNMENT);
  assert.ok(government.channels.some((channel) => channel.name === "mod-log"));
  assert.ok(government.channels.some((channel) => channel.name === "announcements"));
  assert.equal(government.channels.some((channel) => channel.name === "voice"), false);

  const channel = client.channels.cache.get("500000000000000001");
  database.addLog({ communityId: community.id, kind: "config", detail: "Turned role sync on." });
  await settle();
  assert.equal(channel.messages.length, 0);

  const saved = database.setAuditChannel(community.id, GOVERNMENT, channel.id);
  assert.equal(saved.auditChannelId, channel.id);
  database.addLog({ communityId: community.id, kind: "ban", detail: "Banned Casey from the main server." });
  await settle();
  assert.match(channel.messages.at(-1), /\*\*Ban\*\* · Banned Casey from the main server\./);

  database.setAuditChannel(community.id, POLICE, "500000000000000002");
  assert.equal(database.getCommunity(community.id).auditGuildId, POLICE);
  database.removeLinkedGuild(community.id, POLICE);
  assert.equal(database.getCommunity(community.id).auditChannelId, null);
  assert.throws(
    () => database.setAuditChannel(community.id, POLICE, "500000000000000002"),
    /Choose a server in this community/
  );
  database.close();
});

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
