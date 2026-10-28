import { banReason } from "../text.js";
import { enqueue } from "./jobs.js";

const UNKNOWN_BAN = 10026;

export function queueBanUser(db, client, community, userId, reason, options = {}) {
  return enqueue(`bans:${community.id}`, () => propagateBan(db, client, community, userId, reason, options));
}

export function queueUnbanUser(db, client, community, userId, options = {}) {
  return enqueue(`bans:${community.id}`, () => propagateUnban(db, client, community, userId, options));
}

export function queueFullBanSync(db, client, community, options = {}) {
  return enqueue(`bans:${community.id}`, () => syncAllBans(db, client, community, options));
}

export function queueLiftAppealsBans(db, client, community, guildId, actorId = null) {
  return enqueue(`bans:${community.id}`, () => liftSyncedBans(db, client, community, guildId, actorId));
}

export function queueAcceptBanAppeal(db, client, community, userId, actorId = null) {
  return enqueue(`bans:${community.id}`, () => acceptBanAppeal(db, client, community, userId, actorId));
}

export function guildsSubjectToBans(community, guildIds = null) {
  const appeals = community.appealsGuildId || null;
  const linked = new Set(community.linkedGuildIds || []);
  const requested = guildIds ?? community.linkedGuildIds ?? [];
  return requested.filter((id) => linked.has(id) && id !== appeals);
}

export async function propagateBan(db, client, community, userId, _originalReason, { guildIds = null, actorId = null, logEach = true } = {}) {
  const fresh = db.getCommunity(community.id);
  if (!fresh?.banSyncEnabled) return [];
  const master = client.guilds.cache.get(fresh.masterGuildId);
  const reason = banReason(master?.name || "the main server");
  const targets = guildsSubjectToBans(fresh, guildIds);
  const results = [];
  for (const guildId of targets) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      if (logEach) {
        db.addLog({
          communityId: fresh.id,
          kind: "error",
          guildId,
          userId,
          actorId,
          detail: "The bot is not in this server, so the ban was not copied.",
        });
      }
      results.push({ guildId, status: "error" });
      continue;
    }
    results.push({
      guildId,
      status: await ensureBan({ db, community: fresh, guild, userId, reason, actorId, logEach }),
    });
  }
  return results;
}

export async function propagateUnban(
  db,
  client,
  community,
  userId,
  { actorId = null, logEach = true, guildIds = null, force = false, reason = "[GuildLink] Unbanned on the main server" } = {}
) {
  const fresh = db.getCommunity(community.id);
  if (!fresh || (!fresh.banSyncEnabled && !force)) return [];
  const allowed = new Set(guildIds ?? fresh.linkedGuildIds);
  const rows = db.listSyncedBansForUser(fresh.id, userId).filter((row) => allowed.has(row.guild_id));
  const results = [];
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      db.deleteSyncedBan(fresh.id, row.guild_id, userId);
      if (logEach) {
        db.addLog({
          communityId: fresh.id,
          kind: "error",
          guildId: row.guild_id,
          userId,
          actorId,
          detail: "The bot is not in this server. The synced ban record was cleared, and the ban on Discord was left as it is.",
        });
      }
      results.push({ guildId: row.guild_id, status: "error" });
      continue;
    }
    try {
      await guild.members.unban(userId, reason);
      db.deleteSyncedBan(fresh.id, guild.id, userId);
      if (logEach) {
        db.addLog({
          communityId: fresh.id,
          kind: "unban",
          guildId: guild.id,
          userId,
          actorId,
          detail: `Unbanned user ${userId} on ${guild.name}.`,
        });
      }
      results.push({ guildId: guild.id, status: "unbanned" });
    } catch (error) {
      if (error.code === UNKNOWN_BAN) {
        db.deleteSyncedBan(fresh.id, guild.id, userId);
        results.push({ guildId: guild.id, status: "unbanned" });
        continue;
      }
      if (logEach) {
        db.addLog({
          communityId: fresh.id,
          kind: "error",
          guildId: guild.id,
          userId,
          actorId,
          detail: `Could not unban user ${userId} on ${guild.name} (${error.code || "error"}).`,
        });
      }
      results.push({ guildId: guild.id, status: "error" });
    }
  }
  return results;
}

export async function syncAllBans(db, client, community, { actorId = null, guildIds = null } = {}) {
  const fresh = db.getCommunity(community.id);
  if (!fresh?.banSyncEnabled) return { ok: false, text: "Ban sync is turned off." };
  const master = client.guilds.cache.get(fresh.masterGuildId);
  if (!master) {
    db.addLog({
      communityId: fresh.id,
      kind: "error",
      actorId,
      detail: "The bot is not in the main server, so bans were not synced.",
    });
    return { ok: false, text: "The bot is not in the main server." };
  }

  let bans;
  try {
    bans = await master.bans.fetch();
  } catch (error) {
    db.addLog({
      communityId: fresh.id,
      kind: "error",
      actorId,
      detail: `Could not read bans on the main server (${error.code || "error"}).`,
    });
    return { ok: false, text: "Could not read bans on the main server." };
  }

  const requested = (guildIds ?? fresh.linkedGuildIds).filter((id) => fresh.linkedGuildIds.includes(id));
  const lines = [];
  for (const guildId of requested) {
    if (guildId !== fresh.appealsGuildId) continue;
    const name = client.guilds.cache.get(guildId)?.name || "The ban appeals server";
    const detail = `${name} is the ban appeals server, so main-server bans are not copied there.`;
    db.addLog({ communityId: fresh.id, kind: "ban", guildId, actorId, detail });
    lines.push(detail);
  }
  const targets = [];
  for (const guildId of requested) {
    if (guildId === fresh.appealsGuildId) continue;
    if (client.guilds.cache.has(guildId)) {
      targets.push(guildId);
      continue;
    }
    db.addLog({
      communityId: fresh.id,
      kind: "error",
      guildId,
      actorId,
      detail: "The bot is not in this server, so bans were not synced.",
    });
  }
  const counts = new Map(targets.map((guildId) => [guildId, emptyCounts()]));

  for (const ban of bans.values()) {
    const results = await propagateBan(db, client, fresh, ban.user.id, ban.reason, {
      guildIds: targets,
      actorId,
      logEach: false,
    });
    for (const result of results) addCount(counts, result.guildId, result.status);
  }

  const staleUsers = new Set(
    db
      .listSyncedBans(fresh.id)
      .filter((row) => targets.includes(row.guild_id) && !bans.has(row.user_id))
      .map((row) => row.user_id)
  );
  for (const userId of staleUsers) {
    const results = await propagateUnban(db, client, fresh, userId, {
      actorId,
      logEach: false,
      guildIds: targets,
    });
    for (const result of results) {
      if (result.status === "unbanned") addCount(counts, result.guildId, "unbanned");
      else addCount(counts, result.guildId, result.status);
    }
  }

  for (const guildId of targets) {
    const guild = client.guilds.cache.get(guildId);
    const name = guild?.name || "a linked server";
    const count = counts.get(guildId) || emptyCounts();
    const changed = count.banned + count.preexisting + count.unbanned + count.error > 0;
    const detail = changed
      ? `Ban sync finished for ${name}. Banned ${count.banned}. Left ${count.preexisting} local ${count.preexisting === 1 ? "ban" : "bans"} alone. Removed ${count.unbanned} synced ${count.unbanned === 1 ? "ban" : "bans"}. Failed ${count.error}.`
      : `Ban sync finished for ${name}. No changes.`;
    db.addLog({ communityId: fresh.id, kind: "ban", guildId, actorId, detail });
    lines.push(detail);
  }
  if (lines.length === 0) return { ok: true, text: "This community has no linked servers yet." };
  return { ok: true, text: lines.join("\n") };
}

export async function acceptBanAppeal(db, client, community, userId, actorId = null) {
  const fresh = db.getCommunity(community.id);
  if (!fresh?.appealUnbanEnabled || !fresh.appealsGuildId) {
    return { ok: false, text: "The unban command is turned off." };
  }
  const master = client.guilds.cache.get(fresh.masterGuildId);
  if (!master) {
    db.addLog({
      communityId: fresh.id,
      kind: "error",
      guildId: fresh.appealsGuildId,
      userId,
      actorId,
      detail: "The bot is not in the main server, so the ban appeal was not applied.",
    });
    return { ok: false, text: "The bot is not in the main server, so the ban was not removed." };
  }
  if (userId === client.user?.id) {
    return { ok: false, text: "That user cannot be unbanned." };
  }

  let banned = false;
  try {
    await master.bans.fetch(userId);
    banned = true;
  } catch (error) {
    if (error.code !== UNKNOWN_BAN) {
      db.addLog({
        communityId: fresh.id,
        kind: "error",
        guildId: fresh.appealsGuildId,
        userId,
        actorId,
        detail: `Could not read the main-server ban list (${error.code || "error"}).`,
      });
      return { ok: false, text: "Could not read the main-server ban list." };
    }
  }

  const synced = db.listSyncedBansForUser(fresh.id, userId);
  if (!banned && synced.length === 0) {
    return { ok: false, text: "That person is not banned on the main server." };
  }

  if (banned) {
    try {
      await master.members.unban(userId, "[GuildLink] Ban appeal accepted");
    } catch (error) {
      if (error.code !== UNKNOWN_BAN) {
        db.addLog({
          communityId: fresh.id,
          kind: "error",
          guildId: master.id,
          userId,
          actorId,
          detail: `Could not remove the ban for user ${userId} on ${master.name} (${error.code || "error"}).`,
        });
        return { ok: false, text: "Could not remove the ban on the main server." };
      }
    }
  }

  await propagateUnban(db, client, fresh, userId, {
    actorId,
    logEach: true,
    force: true,
    reason: "[GuildLink] Ban appeal accepted",
  });
  const detail = banned
    ? `Ban appeal accepted for user ${userId}. The main-server ban was removed.`
    : `Ban appeal accepted for user ${userId}. GuildLink bans on the other servers were removed.`;
  db.addLog({
    communityId: fresh.id,
    kind: "unban",
    guildId: fresh.appealsGuildId,
    userId,
    actorId,
    detail,
  });
  return {
    ok: true,
    text: `Removed the main-server ban. Bans GuildLink created on the other servers were removed too.`,
  };
}

export async function liftSyncedBans(db, client, community, guildId, actorId = null) {
  const fresh = db.getCommunity(community.id);
  if (!fresh || fresh.appealsGuildId !== guildId) {
    return { ok: false, text: "That server is not the ban appeals server." };
  }
  const userIds = [
    ...new Set(db.listSyncedBans(fresh.id).filter((row) => row.guild_id === guildId).map((row) => row.user_id)),
  ];
  const guild = client.guilds.cache.get(guildId);
  const name = guild?.name || "The ban appeals server";
  if (!guild) {
    const detail = `${name} is the ban appeals server. The bot is not in that server, so synced bans there were left in place.`;
    db.addLog({ communityId: fresh.id, kind: "error", guildId, actorId, detail });
    return { ok: false, text: detail };
  }

  let removed = 0;
  let failed = 0;
  for (const userId of userIds) {
    const results = await propagateUnban(db, client, fresh, userId, {
      actorId,
      logEach: false,
      guildIds: [guildId],
      force: true,
      reason: "[GuildLink] This server is exempt so banned people can appeal",
    });
    for (const result of results) {
      if (result.status === "unbanned") removed += 1;
      else failed += 1;
    }
  }

  const detail = failed
    ? `${name} is the ban appeals server. Removed ${removed} synced bans. ${failed} could not be removed.`
    : removed
      ? `${name} is the ban appeals server. Removed ${removed} synced ${removed === 1 ? "ban" : "bans"} so people can appeal.`
      : `${name} is the ban appeals server. Main-server bans will not be copied there.`;
  db.addLog({ communityId: fresh.id, kind: failed ? "error" : "ban", guildId, actorId, detail });
  return { ok: failed === 0, text: detail };
}

async function ensureBan({ db, community, guild, userId, reason, actorId, logEach }) {
  if (userId === clientId(guild) ) return "skipped";
  if (guild.ownerId === userId) {
    if (logEach) {
      db.addLog({
        communityId: community.id,
        kind: "error",
        guildId: guild.id,
        userId,
        actorId,
        detail: `The owner of ${guild.name} cannot be banned.`,
      });
    }
    return "skipped";
  }

  let existing = null;
  try {
    existing = await guild.bans.fetch(userId);
  } catch (error) {
    if (error.code !== UNKNOWN_BAN) {
      if (logEach) {
        db.addLog({
          communityId: community.id,
          kind: "error",
          guildId: guild.id,
          userId,
          actorId,
          detail: `Could not read bans on ${guild.name} (${error.code || "error"}).`,
        });
      }
      return "error";
    }
  }

  const row = db.getSyncedBan(community.id, guild.id, userId);
  if (existing) {
    if (!row) {
      if (logEach) {
        db.addLog({
          communityId: community.id,
          kind: "ban",
          guildId: guild.id,
          userId,
          actorId,
          detail: `${guild.name} already had a ban for user ${userId}. It was left in place.`,
        });
      }
      return "preexisting";
    }
    if ((existing.reason || "") !== reason) {
      try {
        await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
      } catch (error) {
        if (logEach) {
          db.addLog({
            communityId: community.id,
            kind: "error",
            guildId: guild.id,
            userId,
            actorId,
            detail: `Could not update the ban note for user ${userId} on ${guild.name} (${error.code || "error"}).`,
          });
        }
        return "error";
      }
      db.upsertSyncedBan({ communityId: community.id, guildId: guild.id, userId, reason });
    }
    return "kept";
  }

  try {
    await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
  } catch (error) {
    if (logEach) {
      db.addLog({
        communityId: community.id,
        kind: "error",
        guildId: guild.id,
        userId,
        actorId,
        detail: `Could not ban user ${userId} on ${guild.name} (${error.code || "error"}).`,
      });
    }
    return "error";
  }

  db.upsertSyncedBan({ communityId: community.id, guildId: guild.id, userId, reason });
  if (logEach) {
    db.addLog({
      communityId: community.id,
      kind: "ban",
      guildId: guild.id,
      userId,
      actorId,
      detail: `Banned user ${userId} on ${guild.name}.`,
    });
  }
  return "banned";
}

function clientId(guild) {
  return guild.client.user?.id || null;
}

function emptyCounts() {
  return { banned: 0, preexisting: 0, kept: 0, unbanned: 0, error: 0, skipped: 0 };
}

function addCount(counts, guildId, status) {
  const bucket = counts.get(guildId) || emptyCounts();
  if (bucket[status] == null) bucket[status] = 0;
  bucket[status] += 1;
  counts.set(guildId, bucket);
}
