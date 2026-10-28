import assert from "node:assert/strict";
import test from "node:test";
import { guildsSubjectToBans, liftSyncedBans, propagateBan } from "../src/bot/banSync.js";
import { openDatabase } from "../src/db.js";

const masterId = "100000000000000051";
const policeId = "100000000000000052";
const appealsId = "100000000000000053";
const userId = "200000000000000051";

test("ban targets leave out the ban appeals server", () => {
  const community = {
    linkedGuildIds: [policeId, appealsId],
    appealsGuildId: appealsId,
  };
  assert.deepEqual(guildsSubjectToBans(community), [policeId]);
  assert.deepEqual(guildsSubjectToBans(community, [appealsId, policeId, "100000000000000099"]), [policeId]);
});

test("copying a ban does not ban the appeals server, and marking it exempt lifts GuildLink bans there", async () => {
  const database = openDatabase(":memory:");
  const community = database.createCommunity({
    name: "State",
    masterGuildId: masterId,
    createdBy: userId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: policeId,
    addedBy: userId,
    masterGuildId: masterId,
  });
  database.addLinkedGuild({
    communityId: community.id,
    guildId: appealsId,
    addedBy: userId,
    masterGuildId: masterId,
  });
  database.setAppealsGuild(community.id, appealsId);
  database.upsertSyncedBan({
    communityId: community.id,
    guildId: appealsId,
    userId,
    reason: "synced",
  });
  database.upsertSyncedBan({
    communityId: community.id,
    guildId: policeId,
    userId,
    reason: "synced",
  });

  const banned = [];
  const unbanned = [];
  const client = {
    guilds: {
      cache: new Map([
        [masterId, { id: masterId, name: "Government" }],
        [policeId, fakeGuild(policeId, "Los Santos Police", banned, unbanned)],
        [appealsId, fakeGuild(appealsId, "Ban Appeals", banned, unbanned)],
      ]),
    },
  };

  const fresh = database.getCommunity(community.id);
  await propagateBan(database, client, fresh, userId, "evading", {});
  assert.deepEqual(banned, [policeId]);

  const lifted = await liftSyncedBans(database, client, fresh, appealsId);
  assert.equal(lifted.ok, true);
  assert.deepEqual(unbanned, [appealsId]);
  assert.equal(database.getSyncedBan(community.id, appealsId, userId), null);
  assert.ok(database.getSyncedBan(community.id, policeId, userId));
  database.close();
});

function fakeGuild(id, name, banned, unbanned) {
  return {
    id,
    name,
    ownerId: "900000000000000001",
    client: { user: { id: "900000000000000002" } },
    members: {
      ban(target) {
        banned.push(id);
        return Promise.resolve(target);
      },
      unban(target, reason) {
        assert.match(reason, /exempt so banned people can appeal/);
        unbanned.push(id);
        return Promise.resolve(target);
      },
    },
    bans: {
      fetch() {
        const error = new Error("Unknown Ban");
        error.code = 10026;
        return Promise.reject(error);
      },
    },
  };
}
