import { bitsAfterGrantPlan, botCanEditRole, permissionGrantPlan, permissionLabel } from "../categoryRules.js";

/**
 * Give each Discord role that is set up for a required GuildLink role the
 * permissions its categories currently need, and take back only bits GuildLink recorded adding.
 */
export async function reconcileRolePermissions(db, client, community, { guildIds = null, actorId = null } = {}) {
  const fresh = db.getCommunity(community.id);
  if (!fresh) return { ok: false, errors: ["That community was not found."] };
  const namedRoles = db.listNamedRoles(fresh.id);
  const destinations = db.listNamedRoleDestinations(fresh.id);
  const categories = db.listCategories(fresh.id);
  const categoryByGuild = new Map(db.listGuildCategories(fresh.id).map((row) => [row.guildId, row.categoryId]));
  const scope = guildIds ? new Set(guildIds.map(String)) : null;
  const guilds = new Set([fresh.masterGuildId, ...fresh.linkedGuildIds]);
  const errors = [];
  let updated = 0;

  for (const guildId of guilds) {
    if (scope && !scope.has(guildId)) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const category = categories.find((item) => item.id === categoryByGuild.get(guildId)) || null;
    const requiredByRole = new Map();
    for (const named of namedRoles) {
      const roleId = setupRoleId(named, guildId, destinations);
      if (!roleId || !category) continue;
      const requirement = category.roles.find((role) => role.namedRoleId === named.id);
      if (!requirement) continue;
      if (!requiredByRole.has(roleId)) requiredByRole.set(roleId, new Set());
      for (const permission of requirement.permissions) requiredByRole.get(roleId).add(permission);
    }
    const recorded = db.listPermissionGrants(fresh.id, guildId);
    const roleIds = new Set([...requiredByRole.keys(), ...recorded.keys()]);
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      const requiredNames = [...(requiredByRole.get(roleId) || [])];
      const recordedNames = recorded.get(roleId) || [];
      if (!role) {
        if (recordedNames.length > 0 && requiredNames.length === 0) db.setPermissionGrants(fresh.id, guildId, roleId, []);
        continue;
      }
      const plan = permissionGrantPlan({
        currentBits: role.permissions,
        requiredNames,
        recordedNames,
      });
      if (plan.toAdd.length === 0 && plan.toRemove.length === 0) {
        db.setPermissionGrants(fresh.id, guildId, roleId, plan.keepRecorded);
        continue;
      }
      const blocked = botCanEditRole(guild, role);
      if (blocked) {
        errors.push(blocked);
        db.addLog({ communityId: fresh.id, kind: "error", guildId, actorId, detail: blocked });
        continue;
      }
      const next = bitsAfterGrantPlan(role.permissions, plan);
      try {
        if (typeof role.setPermissions === "function") await role.setPermissions(next, "GuildLink category permissions");
        else await role.edit({ permissions: next, reason: "GuildLink category permissions" });
      } catch (error) {
        const detail = `Could not update ${role.name} on ${guild.name} (${error.code || "error"}).`;
        errors.push(detail);
        db.addLog({ communityId: fresh.id, kind: "error", guildId, actorId, detail });
        continue;
      }
      db.setPermissionGrants(fresh.id, guildId, roleId, plan.keepRecorded);
      updated += 1;
      const parts = [];
      if (plan.toAdd.length > 0) parts.push(`added ${plan.toAdd.map(permissionLabel).join(", ")}`);
      if (plan.toRemove.length > 0) parts.push(`removed ${plan.toRemove.map(permissionLabel).join(", ")}`);
      db.addLog({
        communityId: fresh.id,
        kind: "config",
        guildId,
        actorId,
        detail: `Updated ${role.name} on ${guild.name}: ${parts.join("; ")}.`,
      });
    }
  }
  return { ok: errors.length === 0, updated, errors };
}

export function setupRoleId(named, guildId, destinations) {
  if (!named) return "";
  if (named.parentGuildId === guildId && named.parentRoleId) return named.parentRoleId;
  const dest = destinations.find((item) => item.namedRoleId === named.id && item.guildId === guildId);
  return dest?.roleId || "";
}
