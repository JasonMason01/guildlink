import { permissionBits } from "../categoryRules.js";

export async function describeGuild(client, guildId) {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return {
      id: String(guildId),
      name: "Server the bot has left",
      icon: null,
      present: false,
      roles: [],
    };
  }

  let me = guild.members.me;
  if (!me) {
    try {
      me = await guild.members.fetchMe();
    } catch {
      me = null;
    }
  }
  const top = me?.roles.highest?.position ?? 0;
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name))
    .map((role) => {
      let problem = null;
      if (role.managed) problem = "Discord manages this role, so GuildLink cannot assign it.";
      else if (!me || top <= role.position) problem = "Move the GuildLink role above this one.";
      return {
        id: role.id,
        name: role.name,
        color: role.color,
        permissions: permissionBits(role.permissions).toString(),
        assignable: problem == null,
        problem,
      };
    });

  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 64, extension: "png" }),
    present: true,
    roles,
  };
}
