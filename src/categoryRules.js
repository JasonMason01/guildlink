import { formatList } from "./permissions.js";

const ADMINISTRATOR = 1n << 3n;

export const CATEGORY_PERMISSIONS = [
  { name: "Administrator", bit: ADMINISTRATOR, label: "Administrator" },
  { name: "ManageGuild", bit: 1n << 5n, label: "Manage Guild" },
  { name: "ManageRoles", bit: 1n << 28n, label: "Manage Roles" },
  { name: "ManageChannels", bit: 1n << 4n, label: "Manage Channels" },
  { name: "KickMembers", bit: 1n << 1n, label: "Kick Members" },
  { name: "BanMembers", bit: 1n << 2n, label: "Ban Members" },
  { name: "ModerateMembers", bit: 1n << 40n, label: "Moderate Members" },
  { name: "ManageMessages", bit: 1n << 13n, label: "Manage Messages" },
  { name: "ManageNicknames", bit: 1n << 27n, label: "Manage Nicknames" },
  { name: "MentionEveryone", bit: 1n << 17n, label: "Mention Everyone" },
];

const byName = new Map(CATEGORY_PERMISSIONS.map((item) => [item.name, item]));

export function knownPermission(name) {
  return byName.has(String(name));
}

export function permissionLabel(name) {
  return byName.get(String(name))?.label || String(name);
}

export function permissionBits(value) {
  const raw = value?.bitfield ?? value ?? 0;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export function missingPermissionLabels(rolePermissions, requiredNames) {
  const bits = permissionBits(rolePermissions);
  if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return [];
  const missing = [];
  for (const name of requiredNames || []) {
    const spec = byName.get(String(name));
    if (!spec) continue;
    if ((bits & spec.bit) !== spec.bit) missing.push(spec.label);
  }
  return missing;
}

/**
 * Empty allowedCategoryIds means the link applies on every server.
 * A ticked list applies only on servers assigned one of those categories.
 */
export function linkAllowed(guildCategoryId, allowedCategoryIds) {
  const allowed = allowedCategoryIds || [];
  if (allowed.length === 0) return true;
  if (guildCategoryId == null || guildCategoryId === "") return false;
  return allowed.some((id) => String(id) === String(guildCategoryId));
}

export function guildRequirementIssues({ slots, linkedRoleIdBySlot, rolesById }) {
  const issues = [];
  for (const slot of slots || []) {
    const roleId = linkedRoleIdBySlot.get(String(slot.id)) || "";
    if (!roleId) {
      issues.push(`Link a local role for ${slot.name}.`);
      continue;
    }
    const role = rolesById.get(roleId);
    if (!role) {
      issues.push(`Choose a role on this server for ${slot.name}.`);
      continue;
    }
    const missing = missingPermissionLabels(role.permissions, slot.permissions);
    if (missing.length > 0) {
      issues.push(`${slot.name} is linked to ${role.name}, which is missing ${formatList(missing)}.`);
    }
  }
  return issues;
}

/**
 * Permissions to add or remove on one Discord role.
 * requiredNames are the permissions every category currently applied to this
 * role on this server still needs. recordedNames are bits GuildLink added.
 * A bit the role already had is left in place and is not recorded.
 */
export function permissionGrantPlan({ currentBits, requiredNames, recordedNames }) {
  const required = new Set((requiredNames || []).filter(knownPermission));
  const recorded = new Set((recordedNames || []).filter(knownPermission));
  const current = permissionBits(currentBits);
  const toAdd = [];
  const toRemove = [];
  const keepRecorded = [];
  for (const name of required) {
    const bit = byName.get(name).bit;
    if ((current & bit) === bit) {
      if (recorded.has(name)) keepRecorded.push(name);
    } else {
      toAdd.push(name);
      keepRecorded.push(name);
    }
  }
  for (const name of recorded) {
    if (required.has(name)) continue;
    const bit = byName.get(name).bit;
    if ((current & bit) === bit) toRemove.push(name);
  }
  return { toAdd, toRemove, keepRecorded };
}

export function bitsAfterGrantPlan(currentBits, plan) {
  let bits = permissionBits(currentBits);
  for (const name of plan.toAdd || []) bits |= byName.get(name).bit;
  for (const name of plan.toRemove || []) bits &= ~byName.get(name).bit;
  return bits;
}

const ADMINISTRATOR_BIT = 1n << 3n;

export function botCanEditRole(guild, role) {
  if (!guild) return "That server is not available.";
  if (!role || role.id === guild.id) return `@everyone on ${guild.name} cannot be edited.`;
  if (role.managed) return `${role.name} is managed by Discord on ${guild.name}.`;
  const me = guild.members?.me;
  if (!me) return `GuildLink is not in ${guild.name}.`;
  if ((permissionBits(me.permissions) & ADMINISTRATOR_BIT) !== ADMINISTRATOR_BIT) {
    return `GuildLink needs Administrator on ${guild.name} to update ${role.name}.`;
  }
  const top = me.roles?.highest?.position ?? 0;
  if (top <= (role.position || 0)) return `Move the GuildLink role above ${role.name} on ${guild.name}.`;
  return "";
}

export function slotStatusLine({ slot, role }) {
  if (!role) return `Link a local role for ${slot.name}.`;
  if (!slot.permissions?.length) return `${role.name} fills ${slot.name}.`;
  const missing = missingPermissionLabels(role.permissions, slot.permissions);
  if (missing.length === 0) return `${role.name} has the required permissions.`;
  return `${role.name} is missing ${formatList(missing)}.`;
}
