import { attachAuditChannel } from "./auditChannel.js";
import { queueBanUser, queueUnbanUser } from "./banSync.js";
import { handleCommand, registerCommands } from "./commands.js";
import { queueUserRoleSync } from "./roleSync.js";

const UNKNOWN_BAN = 10026;
const UNKNOWN_MEMBER = 10007;

export function attachBot({ client, db, botState, config }) {
  attachAuditChannel(db, client);
  client.once("ready", async () => {
    botState.ready = true;
    botState.error = null;
    console.log(`[guildlink] Logged in as ${client.user.tag}. Panel commands are registering.`);
    for (const guild of client.guilds.cache.values()) {
      try {
        await registerCommands(guild);
      } catch (error) {
        console.error(`[guildlink] Could not register commands in ${guild.name}: ${error.message}`);
      }
    }
  });

  client.on("guildCreate", (guild) => {
    registerCommands(guild).catch((error) => {
      console.error(`[guildlink] Could not register commands in ${guild.name}: ${error.message}`);
    });
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    if (sameRoles(oldMember.roles?.cache, newMember.roles.cache)) return;
    const community = db.findCommunityByGuild(newMember.guild.id);
    if (!community?.roleSyncEnabled) return;
    const onMain = community.masterGuildId === newMember.guild.id;
    const linked = community.linkedGuildIds.includes(newMember.guild.id);
    if (!onMain && !linked) return;
    void queueUserRoleSync(db, client, community, newMember.id).catch(report);
  });

  client.on("guildMemberAdd", (member) => {
    const community = db.findCommunityByGuild(member.guild.id);
    if (!community) return;
    void onMemberJoin(db, client, community, member).catch(report);
  });

  client.on("guildMemberRemove", (member) => {
    const community = db.findCommunityByGuild(member.guild.id);
    if (!community?.roleSyncEnabled || member.user?.bot) return;
    if (community.masterGuildId === member.guild.id) {
      void leaveMainServer(db, client, community, member).catch(report);
      return;
    }
    if (community.linkedGuildIds.includes(member.guild.id)) {
      void queueUserRoleSync(db, client, community, member.id).catch(report);
    }
  });

  client.on("guildBanAdd", (ban) => {
    const community = db.findCommunityByGuild(ban.guild.id);
    if (!community || community.masterGuildId !== ban.guild.id || !community.banSyncEnabled) return;
    const userId = ban.user?.id;
    if (!userId || userId === client.user?.id) return;
    void queueBanUser(db, client, community, userId, ban.reason).catch(report);
  });

  client.on("guildBanRemove", (ban) => {
    const community = db.findCommunityByGuild(ban.guild.id);
    if (!community || community.masterGuildId !== ban.guild.id || !community.banSyncEnabled) return;
    const userId = ban.user?.id;
    if (!userId) return;
    void queueUnbanUser(db, client, community, userId).catch(report);
  });

  client.on("interactionCreate", (interaction) => {
    handleCommand(interaction, { db, config }).catch((error) => {
      console.error(`[guildlink] command failed: ${error.message}`);
    });
  });

  client.on("error", (error) => console.error(`[guildlink] ${error.message}`));
  client.on("shardError", (error) => console.error(`[guildlink] ${error.message}`));
}

async function onMemberJoin(db, client, community, member) {
  if (member.user?.bot) return;
  const fresh = db.getCommunity(community.id);
  if (!fresh) return;

  if (fresh.masterGuildId === member.guild.id) {
    if (fresh.roleSyncEnabled) await queueUserRoleSync(db, client, fresh, member.id);
    return;
  }
  if (!fresh.linkedGuildIds.includes(member.guild.id)) return;

  if (fresh.banSyncEnabled && fresh.appealsGuildId !== member.guild.id) {
    const master = client.guilds.cache.get(fresh.masterGuildId);
    if (master) {
      let ban = null;
      try {
        ban = await master.bans.fetch(member.id);
      } catch (error) {
        if (error.code !== UNKNOWN_BAN && error.code !== UNKNOWN_MEMBER) {
          db.addLog({
            communityId: fresh.id,
            kind: "error",
            guildId: member.guild.id,
            userId: member.id,
            detail: `Could not check the main-server ban list when this member joined (${error.code || "error"}).`,
          });
          return;
        }
      }
      if (ban) {
        try {
          await queueBanUser(db, client, fresh, member.id, ban.reason, { guildIds: [member.guild.id] });
        } catch (error) {
          db.addLog({
            communityId: fresh.id,
            kind: "error",
            guildId: member.guild.id,
            userId: member.id,
            detail: `Could not copy the main-server ban when this member joined (${error.code || "error"}).`,
          });
        }
        return;
      }
    }
  }

  if (fresh.roleSyncEnabled) {
    await queueUserRoleSync(db, client, fresh, member.id);
  }
}

async function leaveMainServer(db, client, community, member) {
  if (community.banSyncEnabled) {
    try {
      await member.guild.bans.fetch(member.id);
      return;
    } catch (error) {
      if (error.code !== UNKNOWN_BAN) return;
    }
  }
  await queueUserRoleSync(db, client, community, member.id);
}

function sameRoles(left, right) {
  if (!left || !right) return false;
  if (left.size !== right.size) return false;
  for (const id of left.keys()) {
    if (!right.has(id)) return false;
  }
  return true;
}

function report(error) {
  console.error(`[guildlink] ${error.message}`);
}
