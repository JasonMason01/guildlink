/**
 * Named roles whose parent Discord role the member currently holds.
 * A parent server that cannot be read is omitted so its grants stay in place.
 * communityGuildIds limits parents to servers still in the community.
 */
export function heldNamedRoleIds(heldByGuild, namedRoles, { unreadableGuildIds = [], communityGuildIds = null } = {}) {
  const unread = unreadableGuildIds instanceof Set ? unreadableGuildIds : new Set(unreadableGuildIds || []);
  const community = communityGuildIds instanceof Set ? communityGuildIds : communityGuildIds ? new Set(communityGuildIds) : null;
  const held = new Set();
  for (const role of namedRoles) {
    if (!role.parentGuildId || !role.parentRoleId) continue;
    if (community && !community.has(role.parentGuildId)) continue;
    if (unread.has(role.parentGuildId)) continue;
    if (heldByGuild.get(role.parentGuildId)?.has(role.parentRoleId)) held.add(role.id);
  }
  return held;
}

/**
 * Discord roles to grant on one server for named roles the member holds.
 * The parent server is not a destination for that same named role.
 * Two named roles can grant the same Discord role. It stays while either applies.
 */
export function desiredGuildRoleIds(activeNamedRoleIds, destinations, guildId) {
  const active = activeNamedRoleIds instanceof Set ? activeNamedRoleIds : new Set(activeNamedRoleIds);
  const desired = new Set();
  for (const dest of destinations) {
    if (dest.guildId !== guildId) continue;
    if (dest.parentGuildId && dest.parentGuildId === guildId) continue;
    if (active.has(dest.namedRoleId)) desired.add(dest.roleId);
  }
  return desired;
}

/**
 * Only roles GuildLink recorded granting are added or removed.
 * Other roles on the member are left alone.
 */
export function roleDelta({ currentRoleIds, desiredRoleIds, managedRoleIds }) {
  const current = new Set(currentRoleIds);
  const desired = new Set(desiredRoleIds);
  const managed = new Set(managedRoleIds);
  return {
    toAdd: [...desired].filter((id) => !current.has(id)),
    toRemove: [...managed].filter((id) => current.has(id) && !desired.has(id)),
  };
}
