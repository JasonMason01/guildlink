const KINDS = { role: "Role", ban: "Ban", unban: "Unban", error: "Error", config: "Settings" };

export function attachAuditChannel(db, client) {
  db.onLog((entry) => postAudit(db, client, entry));
}

export async function listAuditServers(client, community) {
  const ids = [community.masterGuildId, ...community.linkedGuildIds];
  const servers = [];
  for (const guildId of ids) {
    const guild = client.guilds?.cache?.get(String(guildId));
    if (!guild) continue;
    let channels = guild.channels?.cache;
    if ((!channels || channels.size === 0) && guild.channels?.fetch) {
      try {
        channels = await guild.channels.fetch();
      } catch {
        channels = guild.channels?.cache;
      }
    }
    const list = [...(channels?.values?.() || [])]
      .filter(isAuditChannel)
      .map((channel) => ({ id: channel.id, name: channel.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
    servers.push({ id: guild.id, name: guild.name, channels: list });
  }
  return servers;
}

export async function postAudit(db, client, entry) {
  const community = db.getCommunity(entry.communityId);
  const channelId = community?.auditChannelId;
  if (!channelId) return;
  let channel = client.channels?.cache?.get(channelId) || null;
  if (!channel && client.channels?.fetch) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }
  if (!channel?.send) return;
  const kind = KINDS[entry.kind] || "Audit";
  const content = `**${kind}** · ${entry.detail}`.slice(0, 2000);
  try {
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`[guildlink] Could not post the audit line: ${error.message}`);
  }
}

function isAuditChannel(channel) {
  return channel?.type === 0 || channel?.type === 5 || channel?.type === "GuildText" || channel?.type === "GuildAnnouncement";
}
