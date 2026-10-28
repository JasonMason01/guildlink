const ADMINISTRATOR = 1n << 3n;

/**
 * Panel access for one community.
 *
 * Administrator (or ownership) on the main server can change settings for
 * every server in the community. Without that, Administrator on a linked
 * server only covers the linked servers where that user is an admin.
 * Manage Server alone does not grant access.
 */
export function resolveAccess({ userGuilds, masterGuildId, linkedGuildIds }) {
  const adminIds = new Set((userGuilds || []).filter(isGuildAdmin).map((guild) => String(guild.id)));
  const linked = (linkedGuildIds || []).map(String);
  const isMainAdmin = adminIds.has(String(masterGuildId));

  if (isMainAdmin) {
    return {
      level: "main",
      isMainAdmin: true,
      canManageCommunity: true,
      editableGuildIds: linked,
    };
  }

  const editableGuildIds = linked.filter((id) => adminIds.has(id));
  if (editableGuildIds.length === 0) {
    return {
      level: "none",
      isMainAdmin: false,
      canManageCommunity: false,
      editableGuildIds: [],
    };
  }

  return {
    level: "linked",
    isMainAdmin: false,
    canManageCommunity: false,
    editableGuildIds,
  };
}

export function isGuildAdmin(guild) {
  if (!guild || guild.id == null) return false;
  if (guild.owner === true) return true;
  if (guild.permissions == null || guild.permissions === "") return false;
  try {
    const bits = typeof guild.permissions === "bigint" ? guild.permissions : BigInt(guild.permissions);
    return (bits & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export function canEditLinkedGuild(access, guildId) {
  return access.editableGuildIds.includes(String(guildId));
}

export function accessSummary({ isMainAdmin, editableGuildIds }, names) {
  if (isMainAdmin) {
    return `You have Administrator on ${names.master}, the main server, so you can change settings for every server in this community.`;
  }
  const list = editableGuildIds.map((id) => names[id] || "a linked server");
  const servers = formatList(list);
  const those = list.length === 1 ? "that server" : "those servers";
  return `You have Administrator on ${servers}, so you can change settings for ${those} only.`;
}

export function formatList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
