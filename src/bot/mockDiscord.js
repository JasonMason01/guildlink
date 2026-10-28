import { EventEmitter } from "node:events";

const BOT_ID = "900000000000000001";
const OWNER_ID = "200000000000000099";
const JORDAN = "200000000000000001";
const AVERY = "200000000000000002";
const SAM = "200000000000000003";
const CASEY = "200000000000000004";

const GOVERNMENT = "100000000000000001";
const POLICE = "100000000000000002";
const COURTS = "100000000000000003";
const APPEALS = "100000000000000004";

const MODERATOR = "300000000000000001";
const POLICE_COMMAND = "300000000000000002";
const CITIZEN = "300000000000000003";
const BOOSTER = "300000000000000004";
const STAFF = "400000000000000001";
const COMMAND = "400000000000000002";
const HIGH_COMMAND = "400000000000000003";
const CADET = "400000000000000009";
const BAILIFF = "400000000000000011";
const CLERK = "400000000000000012";
const APPELLANT = "400000000000000021";

export function createMockClient() {
  const client = new EventEmitter();
  client.mock = true;
  client.user = { id: BOT_ID, username: "GuildLink", tag: "GuildLink#0000", bot: true };
  client.destroy = () => {};
  const guilds = [
    makeGuild(client, {
      id: GOVERNMENT,
      name: "San Andreas Government",
      roles: [
        role(MODERATOR, "Moderator", 20, 0xe2b45a),
        role(POLICE_COMMAND, "Police Command", 22, 0x8ed0c6),
        role(CITIZEN, "Citizen", 5, 0x9aaba0),
        role(BOOSTER, "Server Booster", 8, 0xf47fff, true),
      ],
      members: [
        person(JORDAN, "jordan", [MODERATOR]),
        person(AVERY, "avery", [POLICE_COMMAND]),
        person(SAM, "sam", [CITIZEN]),
      ],
      bans: [{ userId: CASEY, reason: "Fail RP" }],
    }),
    makeGuild(client, {
      id: POLICE,
      name: "Los Santos Police",
      roles: [
        role(STAFF, "Staff", 10, 0x6ea8fe),
        role(COMMAND, "Command", 12, 0xe2b45a, false, "4"),
        role(HIGH_COMMAND, "High Command", 80, 0xe08a7c, false, "8"),
        role(CADET, "Cadet", 4, 0x9aaba0),
      ],
      members: [
        person(JORDAN, "jordan", [CADET]),
        person(AVERY, "avery", []),
      ],
    }),
    makeGuild(client, {
      id: COURTS,
      name: "Blaine County Courts",
      roles: [role(BAILIFF, "Bailiff", 10, 0x8ed0c6), role(CLERK, "Clerk", 8, 0x9aaba0)],
      members: [person(JORDAN, "jordan", []), person(AVERY, "avery", [])],
    }),
    makeGuild(client, {
      id: APPEALS,
      name: "Ban Appeals",
      roles: [role(APPELLANT, "Appellant", 10, 0xe2b45a)],
      members: [person(SAM, "sam", []), person(CASEY, "casey", [])],
    }),
  ];
  client.guilds = { cache: new Map(guilds.map((guild) => [guild.id, guild])) };
  const channelCache = new Map();
  for (const guild of guilds) {
    for (const channel of guild.channels.cache.values()) channelCache.set(channel.id, channel);
  }
  client.channels = {
    cache: channelCache,
    async fetch(id) {
      const channel = channelCache.get(String(id));
      if (!channel) throw new Error("Unknown Channel");
      return channel;
    },
  };
  return client;
}

function textChannels(guildId) {
  const tail = String(guildId).slice(-3);
  return new Map(
    [
      textChannel(`500000000000000${tail}`, "mod-log", 0),
      textChannel(`500000000000001${tail}`, "announcements", 5),
      textChannel(`500000000000002${tail}`, "voice", 2),
    ].map((channel) => [channel.id, channel])
  );
}

function textChannel(id, name, type) {
  return {
    id,
    name,
    type,
    messages: [],
    async send(payload) {
      const content = typeof payload === "string" ? payload : payload?.content || "";
      this.messages.push(content);
      return { id: String(this.messages.length), content };
    },
  };
}

function makeGuild(client, { id, name, roles, members, bans = [] }) {
  const roleMap = new Map(roles.map((item) => [item.id, item]));
  const botMember = makeMember(client, { id: BOT_ID, username: "GuildLink", bot: true }, [role("bot", "GuildLink", 40, 0x8fce96)], roleMap);
  botMember.roles.highest = { position: 40 };
  botMember.permissions = (1n << 3n).toString();
  for (const item of roleMap.values()) {
    item.edit = async ({ permissions } = {}) => {
      if (permissions != null) item.permissions = permissionString(permissions);
      return item;
    };
    item.setPermissions = async (permissions) => item.edit({ permissions });
  }
  const memberMap = new Map([[BOT_ID, botMember]]);
  for (const spec of members) {
    memberMap.set(spec.user.id, makeMember(client, spec.user, spec.roleIds.map((roleId) => roleMap.get(roleId)).filter(Boolean), roleMap));
  }
  const banMap = new Map(
    bans.map((ban) => [ban.userId, { user: { id: ban.userId }, reason: ban.reason }])
  );
  const guild = {
    id,
    name,
    ownerId: OWNER_ID,
    client,
    iconURL() {
      return null;
    },
    roles: { cache: roleMap },
    commands: { set: async () => {} },
    members: {
      me: botMember,
      cache: memberMap,
      async fetch(userId) {
        if (!userId) return memberMap;
        const member = memberMap.get(userId);
        if (!member) throw coded(10007, "Unknown Member");
        return member;
      },
      async fetchMe() {
        return botMember;
      },
      async ban(userId, options = {}) {
        if (userId === OWNER_ID) throw coded(50013, "Missing Permissions");
        banMap.set(String(userId), { user: { id: String(userId) }, reason: options.reason || null });
        memberMap.delete(String(userId));
      },
      async unban(userId) {
        if (!banMap.has(String(userId))) throw coded(10026, "Unknown Ban");
        banMap.delete(String(userId));
      },
    },
    bans: {
      async fetch(userId) {
        if (!userId) return banMap;
        const ban = banMap.get(String(userId));
        if (!ban) throw coded(10026, "Unknown Ban");
        return ban;
      },
    },
    channels: { cache: textChannels(id) },
  };
  botMember.guild = guild;
  for (const member of memberMap.values()) member.guild = guild;
  return guild;
}

function makeMember(client, user, roles, roleMap) {
  const cache = new Map(roles.filter(Boolean).map((item) => [item.id, item]));
  return {
    id: user.id,
    guild: null,
    pending: false,
    user: { id: user.id, username: user.username, bot: Boolean(user.bot) },
    roles: {
      cache,
      highest: { position: Math.max(0, ...roles.map((item) => item?.position || 0)) },
      async add(ids) {
        for (const roleId of asList(ids)) {
          const found = roleMap.get(roleId);
          if (found) cache.set(roleId, found);
        }
      },
      async remove(ids) {
        for (const roleId of asList(ids)) cache.delete(roleId);
      },
    },
    client,
  };
}

function person(id, username, roleIds) {
  return { user: { id, username, bot: false }, roleIds };
}

function role(id, name, position, color, managed = false, permissions = "0") {
  return { id, name, position, color, managed, permissions };
}

function asList(ids) {
  return Array.isArray(ids) ? ids.map(String) : [String(ids)];
}

function permissionString(permissions) {
  if (typeof permissions === "bigint") return permissions.toString();
  if (permissions?.bitfield != null) return BigInt(permissions.bitfield).toString();
  return BigInt(permissions ?? 0).toString();
}

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
