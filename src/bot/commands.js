import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { queueAcceptBanAppeal, queueFullBanSync } from "./banSync.js";
import { queueFullRoleSync } from "./roleSync.js";

const definition = new SlashCommandBuilder()
  .setName("guildlink")
  .setDescription("GuildLink tools for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show how this server is linked"))
  .addSubcommand((subcommand) =>
    subcommand.setName("sync-roles").setDescription("Sync roles from the main server for the servers you can manage")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("sync-bans").setDescription("Push main-server bans out to linked servers")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("unban")
      .setDescription("Remove a main-server ban from the ban appeals server")
      .addUserOption((option) =>
        option.setName("user").setDescription("The person whose ban should be removed").setRequired(true)
      )
  );

export async function registerCommands(guild) {
  await guild.commands.set([definition.toJSON()]);
}

export async function handleCommand(interaction, { db, config }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "guildlink") return;
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: "Use this command inside a server.", ephemeral: true });
    return;
  }

  const isAdminHere =
    interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdminHere) {
    await interaction.reply({
      content: "You need Administrator on this server to use GuildLink here.",
      ephemeral: true,
    });
    return;
  }

  const community = db.findCommunityByGuild(interaction.guildId);
  if (!community) {
    await interaction.reply({
      content: `This server is not part of a GuildLink community yet. Set that up in the panel: ${config.publicUrl}`,
      ephemeral: true,
    });
    return;
  }

  const onMain = community.masterGuildId === interaction.guildId;
  const mainAdmin = onMain || (await isMainServerAdmin(interaction.client, community, interaction.user.id));
  const sub = interaction.options.getSubcommand();

  if (sub === "status") {
    await interaction.reply({
      content: statusText({ community, db, guild: interaction.guild, mainAdmin, onMain, panelUrl: config.publicUrl }),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (sub === "sync-roles") {
      if (!community.roleSyncEnabled) {
        await interaction.editReply("Role sync is turned off in the panel.");
        return;
      }
      const guildIds = mainAdmin ? null : [interaction.guildId];
      const result = await queueFullRoleSync(db, interaction.client, community, {
        guildIds,
        actorId: interaction.user.id,
      });
      await interaction.editReply(clip(result.text));
      return;
    }
    if (sub === "sync-bans") {
      if (!mainAdmin) {
        await interaction.editReply("Only an administrator of the main server can sync bans.");
        return;
      }
      if (!community.banSyncEnabled) {
        await interaction.editReply("Ban sync is turned off in the panel.");
        return;
      }
      const result = await queueFullBanSync(db, interaction.client, community, { actorId: interaction.user.id });
      await interaction.editReply(clip(result.text));
      return;
    }
    if (sub === "unban") {
      if (community.appealsGuildId !== interaction.guildId) {
        await interaction.editReply("This command only works in the ban appeals server.");
        return;
      }
      if (!community.appealUnbanEnabled) {
        await interaction.editReply(
          "The unban command is turned off. An administrator of the main server can turn it on in the panel."
        );
        return;
      }
      const allowedRoles = db.listAppealUnbanRoles(community.id);
      if (allowedRoles.length === 0) {
        await interaction.editReply(
          "No roles are allowed to run /guildlink unban yet. An administrator of the main server chooses them in the panel."
        );
        return;
      }
      const held = memberRoleIds(interaction.member);
      if (!allowedRoles.some((roleId) => held.has(roleId))) {
        await interaction.editReply("You need a role that is allowed to run /guildlink unban.");
        return;
      }
      const user = interaction.options.getUser("user", true);
      const result = await queueAcceptBanAppeal(db, interaction.client, community, user.id, interaction.user.id);
      await interaction.editReply(clip(result.text));
      return;
    }
    await interaction.editReply("Unknown command.");
  } catch (error) {
    console.error(`[guildlink] command failed: ${error.message}`);
    await interaction.editReply("That sync failed. Check the activity log in the panel.");
  }
}

function statusText({ community, db, guild, mainAdmin, onMain, panelUrl }) {
  const lines = [
    community.name,
    onMain ? `${guild.name} is the main server.` : `${guild.name} is a linked server.`,
    `Role sync is ${community.roleSyncEnabled ? "on" : "off"}. Ban sync is ${community.banSyncEnabled ? "on" : "off"}.`,
  ];
  if (community.appealsGuildId === guild.id) {
    lines.push("This server is the ban appeals server. Main-server bans are not copied here.");
    lines.push(unbanStatusLine(community, db, guild));
  } else if (mainAdmin && community.appealsGuildId) {
    const appealsName = guild.client.guilds.cache.get(community.appealsGuildId)?.name || "A linked server";
    lines.push(`${appealsName} is the ban appeals server, so main-server bans are not copied there.`);
  }
  if (mainAdmin) {
    const names = community.linkedGuildIds.map((id) => guild.client.guilds.cache.get(id)?.name || id);
    const roleCount = db.listNamedRoles(community.id).length;
    lines.push(
      names.length > 0 ? `Linked servers: ${names.join(", ")}` : "No linked servers yet.",
      `${roleCount} GuildLink ${roleCount === 1 ? "role" : "roles"}.`
    );
  } else {
    const chosen = db.listNamedRoleDestinations(community.id).filter((item) => item.guildId === guild.id);
    lines.push(
      `${chosen.length} Discord ${chosen.length === 1 ? "role is" : "roles are"} chosen on this server.`,
      "You can change this server in the panel. Community-wide settings stay with an administrator of the main server."
    );
  }
  lines.push(panelUrl);
  return clip(lines.join("\n"));
}

function unbanStatusLine(community, db, guild) {
  if (!community.appealUnbanEnabled) return "The unban command is turned off.";
  const roleIds = db.listAppealUnbanRoles(community.id);
  if (roleIds.length === 0) return "The unban command is on, but no roles are allowed to use it yet.";
  const names = roleIds.map((id) => guild.roles.cache.get(id)?.name || "a deleted role");
  return `Administrators with ${names.join(", ")} can run /guildlink unban to remove a main-server ban.`;
}

function memberRoleIds(member) {
  if (member?.roles?.cache) return new Set(member.roles.cache.keys());
  if (Array.isArray(member?.roles)) return new Set(member.roles.map(String));
  return new Set();
}

async function isMainServerAdmin(client, community, userId) {
  const guild = client.guilds.cache.get(community.masterGuildId);
  if (!guild) return false;
  if (guild.ownerId === userId) return true;
  try {
    const member = await guild.members.fetch(userId);
    return member.permissions.has(PermissionFlagsBits.Administrator);
  } catch {
    return false;
  }
}

function clip(text) {
  if (text.length <= 1900) return text;
  return `${text.slice(0, 1897)}...`;
}
