import { linkAllowed } from "../categoryRules.js";
import { desiredGuildRoleIds, heldNamedRoleIds, roleDelta } from "../roleMath.js";
import { enqueue } from "./jobs.js";

const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

export function queueUserRoleSync(db, client, community, userId, options = {}) {
  return enqueue(`roles:${community.id}`, () => syncUserRoles(db, client, community, userId, options));
}

export function queueFullRoleSync(db, client, community, options = {}) {
  return enqueue(`roles:${community.id}`, () => syncAllRoles(db, client, community, options));
}

export async function syncUserRoles(db, client, community, userId, { guildIds = null, actorId = null } = {}) {
  const fresh = db.getCommunity(community.id);
  if (!fresh?.roleSyncEnabled) return { ok: false, text: "Role sync is turned off." };
  if (userId === client.user?.id) return { ok: true, text: "Skipped the bot." };

  const namedRoles = db.listNamedRoles(fresh.id);
  const destinations = db.listNamedRoleDestinations(fresh.id);
  const scope = loadScope(db, fresh.id);
  const communityGuilds = communityGuildSet(fresh);
  const { held, unreadable } = await readHeldRoles(client, parentGuildIds(namedRoles, communityGuilds), userId);
  if (unreadable.length > 0) {
    db.addLog({
      communityId: fresh.id,
      kind: "error",
      userId,
      actorId,
      detail: "A parent server could not be read, so roles from that parent were left unchanged.",
    });
  }
  const recorded = db.listNamedRoleGrants(fresh.id, userId);
  const targets = syncTargetIds(fresh, guildIds, namedRoles, destinations);
  for (const guildId of targets) {
    await syncMemberOnGuild({
      db,
      client,
      community: fresh,
      guildId,
      userId,
      namedRoles,
      destinations,
      held,
      unreadable: new Set(unreadable),
      communityGuilds,
      scope,
      recorded,
      actorId,
    });
  }
  return { ok: true, text: "Role sync finished." };
}

export async function syncAllRoles(db, client, community, { guildIds = null, actorId = null } = {}) {
  const fresh = db.getCommunity(community.id);
  if (!fresh?.roleSyncEnabled) return { ok: false, text: "Role sync is turned off." };
  const namedRoles = db.listNamedRoles(fresh.id);
  const destinations = db.listNamedRoleDestinations(fresh.id);
  const scope = loadScope(db, fresh.id);
  const communityGuilds = communityGuildSet(fresh);
  const targets = syncTargetIds(fresh, guildIds, namedRoles, destinations);
  const unreadable = new Set();
  const loaded = new Map();
  const lines = [];

  for (const guildId of new Set([...targets, ...parentGuildIds(namedRoles, communityGuilds)])) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      unreadable.add(guildId);
      if (targets.includes(guildId)) {
        db.addLog({
          communityId: fresh.id,
          kind: "error",
          guildId,
          actorId,
          detail: "The bot is not in this server, so roles were not synced.",
        });
        lines.push("A server is missing the bot.");
      }
      continue;
    }
    try {
      await guild.members.fetch();
      loaded.set(guildId, guild);
    } catch (error) {
      unreadable.add(guildId);
      db.addLog({
        communityId: fresh.id,
        kind: "error",
        guildId,
        actorId,
        detail: `Could not load members on ${guild.name} (${error.code || "error"}).`,
      });
      if (targets.includes(guildId)) lines.push(`Could not load members on ${guild.name}.`);
    }
  }

  const grantsByUser = db.namedRoleGrantsByUser(fresh.id);
  const userIds = new Set(grantsByUser.keys());
  for (const guild of loaded.values()) {
    for (const member of guild.members.cache.values()) {
      if (!member.user?.bot && !member.pending) userIds.add(member.id);
    }
  }

  const stats = new Map(targets.filter((id) => loaded.has(id)).map((id) => [id, { updated: 0, blocked: new Set() }]));
  for (const userId of userIds) {
    if (userId === client.user?.id) continue;
    const held = heldFromLoaded(loaded, parentGuildIds(namedRoles, communityGuilds), userId);
    const recorded = grantsByUser.get(userId) || [];
    for (const guildId of targets) {
      const guild = loaded.get(guildId);
      const tally = stats.get(guildId);
      if (!guild || !tally) continue;
      const member = guild.members.cache.get(userId);
      if (!member || member.user?.bot || member.pending) continue;
      const result = await applyNamedRoles({
        db,
        community: fresh,
        guild,
        member,
        namedRoles,
        destinations,
        held,
        unreadable,
        communityGuilds,
        scope,
        recorded,
        actorId,
        announceBlocked: false,
      });
      if (result.changed) tally.updated += 1;
      for (const roleId of result.blocked) tally.blocked.add(roleId);
    }
  }

  for (const [guildId, tally] of stats) {
    const guild = loaded.get(guildId);
    const blockedNote =
      tally.blocked.size > 0
        ? ` ${tally.blocked.size} mapped ${tally.blocked.size === 1 ? "role" : "roles"} could not be changed. Move GuildLink's role higher, or stop mapping managed roles.`
        : "";
    const detail = `Role sync finished for ${guild.name}. Updated ${tally.updated} ${tally.updated === 1 ? "member" : "members"}.${blockedNote}`;
    db.addLog({ communityId: fresh.id, kind: "role", guildId, actorId, detail });
    lines.push(detail);
  }

  if (lines.length === 0) return { ok: true, text: "This community has no linked servers yet." };
  return { ok: true, text: lines.join("\n") };
}

async function syncMemberOnGuild({
  db,
  client,
  community,
  guildId,
  userId,
  namedRoles,
  destinations,
  held,
  unreadable,
  communityGuilds,
  scope,
  recorded,
  actorId,
}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    db.addLog({
      communityId: community.id,
      kind: "error",
      guildId,
      userId,
      actorId,
      detail: "The bot is not in this server, so roles were not synced.",
    });
    return;
  }
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (error) {
    if (error.code === UNKNOWN_MEMBER || error.code === UNKNOWN_USER) return;
    db.addLog({
      communityId: community.id,
      kind: "error",
      guildId,
      userId,
      actorId,
      detail: `Could not load this member on ${guild.name} (${error.code || "error"}).`,
    });
    return;
  }
  if (member.user.bot || member.pending) return;
  await applyNamedRoles({
    db,
    community,
    guild,
    member,
    namedRoles,
    destinations,
    held,
    unreadable,
    communityGuilds,
    scope,
    recorded,
    actorId,
    announceBlocked: true,
  });
}

async function applyNamedRoles({
  db,
  community,
  guild,
  member,
  namedRoles,
  destinations,
  held,
  unreadable,
  communityGuilds,
  scope,
  recorded,
  actorId,
  announceBlocked,
}) {
  const plan = planGuildRoles({
    namedRoles,
    destinations,
    held,
    unreadable,
    communityGuilds,
    scope,
    recorded,
    guildId: guild.id,
  });
  let result = { changed: false, blocked: [], added: [], removed: [], failed: false };
  if (plan.desired.size > 0 || plan.managed.size > 0) {
    result = await applyManagedSet({
      db,
      community,
      guild,
      member,
      desired: plan.desired,
      managed: [...plan.managed],
      actorId,
      announceBlocked,
    });
  }
  if (!result.failed) settleGrants(db, community.id, member, plan, result);
  return result;
}

function planGuildRoles({ namedRoles, destinations, held, unreadable, communityGuilds, scope, recorded, guildId }) {
  const unread = unreadable instanceof Set ? unreadable : new Set(unreadable || []);
  const active = heldNamedRoleIds(held, namedRoles, { unreadableGuildIds: unread, communityGuildIds: communityGuilds });
  const inScope = [];
  const frozenRoleIds = new Set();
  const knownIds = new Set(namedRoles.map((role) => role.id));
  for (const named of namedRoles) {
    if (named.parentGuildId === guildId) continue;
    const allowed = linkAllowed(scope.categoryByGuild.get(guildId) ?? null, scope.allowedByRole.get(named.id) || []);
    const parentKnown = Boolean(named.parentGuildId);
    const parentHere = parentKnown && communityGuilds.has(named.parentGuildId) && !unread.has(named.parentGuildId);
    const mine = recorded.filter((grant) => grant.guildId === guildId && grant.namedRoleId === named.id);
    if (!allowed || (parentKnown && !parentHere)) {
      for (const grant of mine) frozenRoleIds.add(grant.roleId);
      continue;
    }
    if (!named.parentGuildId || !named.parentRoleId) continue;
    const dest = destinations.find((item) => item.namedRoleId === named.id && item.guildId === guildId);
    if (dest && active.has(named.id)) inScope.push({ ...dest, parentGuildId: named.parentGuildId });
  }
  for (const grant of recorded) {
    if (grant.guildId !== guildId) continue;
    if (!knownIds.has(grant.namedRoleId)) continue;
  }
  const desired = desiredGuildRoleIds(
    active,
    inScope,
    guildId
  );
  const managed = new Set();
  for (const grant of recorded) {
    if (grant.guildId !== guildId) continue;
    if (frozenRoleIds.has(grant.roleId)) continue;
    const named = namedRoles.find((role) => role.id === grant.namedRoleId);
    if (named && !linkAllowed(scope.categoryByGuild.get(guildId) ?? null, scope.allowedByRole.get(named.id) || [])) continue;
    if (named?.parentGuildId && (!communityGuilds.has(named.parentGuildId) || unread.has(named.parentGuildId))) continue;
    managed.add(grant.roleId);
  }
  const wantedByNamed = new Map();
  for (const dest of inScope) {
    if (active.has(dest.namedRoleId)) wantedByNamed.set(dest.namedRoleId, dest.roleId);
  }
  return { desired, managed, frozenRoleIds, wantedByNamed };
}

function settleGrants(db, communityId, member, plan, result) {
  const guildId = member.guild.id;
  const userId = member.id;
  if (result.changed) {
    for (const roleId of result.added) {
      for (const [namedRoleId, destRoleId] of plan.wantedByNamed) {
        if (destRoleId === roleId) db.rememberNamedRoleGrant(communityId, namedRoleId, userId, guildId, roleId);
      }
    }
  }
  const recorded = db.listNamedRoleGrants(communityId, userId).filter((grant) => grant.guildId === guildId);
  for (const grant of recorded) {
    if (plan.frozenRoleIds.has(grant.roleId)) continue;
    const still = plan.wantedByNamed.get(grant.namedRoleId) === grant.roleId && member.roles.cache.has(grant.roleId);
    if (still) continue;
    if (member.roles.cache.has(grant.roleId) && plan.desired.has(grant.roleId)) {
      db.forgetNamedRoleGrant(communityId, grant.namedRoleId, userId, guildId);
      continue;
    }
    if (!member.roles.cache.has(grant.roleId)) db.forgetNamedRoleGrant(communityId, grant.namedRoleId, userId, guildId);
  }
}

function parentGuildIds(namedRoles, communityGuilds) {
  return [...new Set(namedRoles.map((role) => role.parentGuildId).filter((id) => id && communityGuilds.has(id)))];
}

function communityGuildSet(community) {
  return new Set([community.masterGuildId, ...community.linkedGuildIds]);
}

function syncTargetIds(community, guildIds, namedRoles, destinations) {
  const communityGuilds = communityGuildSet(community);
  if (!guildIds) return [...communityGuilds];
  const set = new Set(guildIds.filter((id) => communityGuilds.has(id)));
  for (const named of namedRoles) {
    if (!set.has(named.parentGuildId)) continue;
    for (const dest of destinations) {
      if (dest.namedRoleId === named.id && communityGuilds.has(dest.guildId) && dest.guildId !== named.parentGuildId) {
        set.add(dest.guildId);
      }
    }
  }
  return [...set];
}

async function readHeldRoles(client, guildIds, userId) {
  const held = new Map();
  const unreadable = [];
  for (const guildId of guildIds) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      unreadable.push(guildId);
      continue;
    }
    try {
      const member = await guild.members.fetch(userId);
      if (member.user?.bot || member.pending) continue;
      held.set(guildId, new Set(member.roles.cache.keys()));
    } catch (error) {
      if (error.code === UNKNOWN_MEMBER || error.code === UNKNOWN_USER) continue;
      unreadable.push(guildId);
    }
  }
  return { held, unreadable };
}

function heldFromLoaded(loaded, guildIds, userId) {
  const held = new Map();
  for (const guildId of guildIds) {
    if (!loaded.has(guildId)) continue;
    const member = loaded.get(guildId).members.cache.get(userId);
    if (!member || member.user?.bot || member.pending) continue;
    held.set(guildId, new Set(member.roles.cache.keys()));
  }
  return held;
}

function loadScope(db, communityId) {
  const categoryByGuild = new Map();
  for (const row of db.listGuildCategories(communityId)) {
    if (row.categoryId != null) categoryByGuild.set(row.guildId, row.categoryId);
  }
  const allowedByRole = new Map();
  for (const row of db.listNamedRoleCategoryLimits(communityId)) {
    if (!allowedByRole.has(row.namedRoleId)) allowedByRole.set(row.namedRoleId, []);
    allowedByRole.get(row.namedRoleId).push(row.categoryId);
  }
  return { categoryByGuild, allowedByRole };
}

async function applyManagedSet({ db, community, guild, member, desired, managed, actorId, announceBlocked }) {
  const assignable = new Set();
  for (const roleId of new Set([...desired, ...managed])) {
    if (canAssign(guild, roleId)) assignable.add(roleId);
  }
  const raw = roleDelta({
    currentRoleIds: member.roles.cache.keys(),
    desiredRoleIds: desired,
    managedRoleIds: managed,
  });
  const { toAdd, toRemove } = roleDelta({
    currentRoleIds: member.roles.cache.keys(),
    desiredRoleIds: [...desired].filter((id) => assignable.has(id)),
    managedRoleIds: managed.filter((id) => assignable.has(id)),
  });
  const blocked = [...raw.toAdd, ...raw.toRemove].filter((id) => !assignable.has(id));

  if (toAdd.length === 0 && toRemove.length === 0) {
    if (announceBlocked && blocked.length > 0) {
      db.addLog({
        communityId: community.id,
        kind: "error",
        guildId: guild.id,
        userId: member.id,
        actorId,
        detail: `${personLabel(member.user)} on ${guild.name}: mapped roles could not be changed. Move the GuildLink role above them.`,
      });
    }
    return { changed: false, blocked, added: [], removed: [], failed: false };
  }

  try {
    if (toAdd.length > 0) await member.roles.add(toAdd, "GuildLink role sync");
    if (toRemove.length > 0) await member.roles.remove(toRemove, "GuildLink role sync");
  } catch (error) {
    db.addLog({
      communityId: community.id,
      kind: "error",
      guildId: guild.id,
      userId: member.id,
      actorId,
      detail: `Could not update roles for ${personLabel(member.user)} on ${guild.name} (${error.code || "error"}).`,
    });
    return { changed: false, blocked, added: [], removed: [], failed: true };
  }

  const parts = [];
  if (toAdd.length > 0) parts.push(`Gave ${names(guild, toAdd)}`);
  if (toRemove.length > 0) parts.push(`Removed ${names(guild, toRemove)}`);
  db.addLog({
    communityId: community.id,
    kind: "role",
    guildId: guild.id,
    userId: member.id,
    actorId,
    detail: `${personLabel(member.user)} on ${guild.name}: ${parts.join(". ")}.`,
  });
  return { changed: true, blocked, added: toAdd, removed: toRemove, failed: false };
}

function canAssign(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role || role.managed || role.id === guild.id) return false;
  const me = guild.members.me;
  if (!me) return false;
  return me.roles.highest.position > role.position;
}

function names(guild, roleIds) {
  return roleIds.map((id) => guild.roles.cache.get(id)?.name || "a deleted role").join(", ");
}

function personLabel(user) {
  if (user?.username) return `${user.username} (${user.id})`;
  return `user ${user?.id || "unknown"}`;
}
