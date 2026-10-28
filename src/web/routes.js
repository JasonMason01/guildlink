import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { queueFullBanSync, queueLiftAppealsBans } from "../bot/banSync.js";
import { listAuditServers } from "../bot/auditChannel.js";
import { reconcileRolePermissions, setupRoleId } from "../bot/rolePermissions.js";
import { queueFullRoleSync } from "../bot/roleSync.js";
import { knownPermission, linkAllowed } from "../categoryRules.js";
import { botInviteUrl } from "../links.js";
import { accessSummary, canEditLinkedGuild, isGuildAdmin, resolveAccess } from "../permissions.js";
import { isSnowflake } from "../text.js";
import {
  authorizeUrl,
  avatarUrl,
  clearCookie,
  clearGuildCache,
  exchangeCode,
  fetchDiscordUser,
  fetchUserGuilds,
  newId,
  readCookies,
  refreshTokens,
  rememberState,
  sameSecret,
  sessionCookie,
  sessionSeconds,
  setCookie,
  stateCookie,
  takeState,
} from "./auth.js";
import { describeGuild } from "./present.js";
import { renderAudit, renderAuditChannel, renderBans, renderCategories, renderCategoryRoleSettings, renderCategorySettings, renderCommunity, renderGuildRoleSettings, renderGuildRoles, renderHome, renderLogin, renderRoleSettings, renderRoles, renderServers, renderStatus } from "./render.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const betaSessions = new WeakMap();

const loginErrors = {
  denied: "Discord sign-in was cancelled.",
  state: "That sign-in expired. Try again.",
  session: "Your session expired. Sign in again.",
  failed: "Discord sign-in failed. Try again.",
};

export function createApp({ db, client, config, botState, box, started = null }) {
  const app = express();
  const betaState = { csrf: newId(), flash: null, view: "main" };
  betaSessions.set(app, betaState);
  app.set("betaOpenPanel", Boolean(config.betaOpenPanel));
  app.set("betaMock", Boolean(client.mock));
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: true, limit: "200kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
    );
    next();
  });
  app.use(express.static(publicDir, { index: false, dotfiles: "deny", maxAge: 0 }));
  app.use(sessionGate({ db, config, box }));

  app.get("/healthz", (req, res) => {
    const body = { ok: true, bot: botState.ready };
    if (started != null) body.started = started;
    res.json(body);
  });

  app.get("/login", (req, res) => {
    if (config.betaOpenPanel || req.viewer) return res.redirect(303, "/");
    const error = loginErrors[String(req.query.error || "")] || null;
    sendHtml(res, 200, renderLogin({ error, inviteUrl: botInviteUrl(config.clientId) }));
  });

  app.get("/auth/discord", (req, res) => {
    if (config.betaOpenPanel) return res.redirect(303, "/");
    const state = newId();
    rememberState(state);
    setCookie(res, stateCookie(), state, { maxAge: 600, secure: config.secureCookies });
    res.redirect(authorizeUrl(config, state));
  });

  app.get("/auth/callback", asyncRoute(async (req, res) => {
    if (config.betaOpenPanel) return res.redirect(303, "/");
    if (req.query.error) return res.redirect(303, "/login?error=denied");
    const state = String(req.query.state || "");
    const cookies = readCookies(req.headers.cookie);
    clearCookie(res, stateCookie(), config.secureCookies);
    if (!req.query.code || !takeState(state) || !sameSecret(cookies[stateCookie()], state)) {
      return res.redirect(303, "/login?error=state");
    }
    try {
      const tokens = await exchangeCode(config, String(req.query.code));
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("Discord did not return a session.");
      }
      const user = await fetchDiscordUser(tokens.access_token);
      const sessionId = newId();
      db.createSession({
        id: sessionId,
        userId: user.id,
        username: user.username,
        globalName: user.global_name || null,
        avatar: avatarUrl(user),
        accessToken: box.seal(tokens.access_token),
        refreshToken: box.seal(tokens.refresh_token),
        tokenExpiresAt: Date.now() + Number(tokens.expires_in) * 1000,
        csrf: newId(),
      });
      clearGuildCache(user.id);
      setCookie(res, sessionCookie(), sessionId, { maxAge: sessionSeconds(), secure: config.secureCookies });
      res.redirect(303, "/");
    } catch (error) {
      console.error(`[guildlink] sign-in failed: ${error.message}`);
      res.redirect(303, "/login?error=failed");
    }
  }));

  app.post("/beta/view", (req, res) => {
    if (!config.betaOpenPanel || !req.viewer?.beta) return res.redirect(303, "/");
    if (!csrfOk(req, res)) return;
    const state = betaSessions.get(req.app);
    if (state) state.view = req.body.view === "linked" ? "linked" : "main";
    res.redirect(303, "/");
  });

  app.post("/logout", (req, res) => {
    if (config.betaOpenPanel) return res.redirect(303, "/");
    if (!req.viewer) return res.redirect(303, "/login");
    if (!csrfOk(req, res)) return;
    clearGuildCache(req.viewer.id);
    db.deleteSession(req.viewer.sessionId);
    clearCookie(res, sessionCookie(), config.secureCookies);
    res.redirect(303, "/login");
  });

  app.get("/", asyncRoute(async (req, res) => {
    if (!req.viewer) return res.redirect(303, "/login");
    const userGuilds = await loadGuilds(req, res, db, config, client);
    if (!userGuilds) return;
    const community = db.getInstallCommunity();
    if (community) {
      const access = resolveAccess({
        userGuilds,
        masterGuildId: community.masterGuildId,
        linkedGuildIds: community.linkedGuildIds,
      });
      if (access.level !== "none") return res.redirect(303, `/c/${community.id}`);
      return sendHtml(
        res,
        200,
        renderHome({
          ...frame(req),
          notice: takeNotice(req, db),
          creatableGuilds: [],
          missingBotGuilds: [],
          inviteUrl: botInviteUrl(config.clientId),
          botMessage: connectionMessage(botState),
          blocked: "This GuildLink already has a community. You need Administrator on the main server or on a linked server.",
        })
      );
    }
    const notice = takeNotice(req, db);
    const creatableGuilds = [];
    const missingBotGuilds = [];
    if (botState.ready) {
      for (const guild of userGuilds) {
        if (!isGuildAdmin(guild)) continue;
        if (!client.guilds.cache.has(guild.id)) {
          missingBotGuilds.push(guild.name);
          continue;
        }
        if (db.guildIsClaimed(guild.id)) continue;
        creatableGuilds.push({
          id: guild.id,
          name: client.guilds.cache.get(guild.id)?.name || guild.name,
        });
      }
      creatableGuilds.sort((a, b) => a.name.localeCompare(b.name));
    }
    sendHtml(
      res,
      200,
      renderHome({
        ...frame(req),
        notice,
        creatableGuilds,
        missingBotGuilds,
        inviteUrl: botInviteUrl(config.clientId),
        botMessage: connectionMessage(botState),
      })
    );
  }));

  app.post("/communities", asyncRoute(async (req, res) => {
    if (!req.viewer) return res.redirect(303, "/login");
    if (!csrfOk(req, res)) return;
    const userGuilds = await loadGuilds(req, res, db, config, client);
    if (!userGuilds) return;
    const masterGuildId = String(req.body.masterGuildId || "");
    const allowed =
      isSnowflake(masterGuildId) &&
      userGuilds.some((guild) => guild.id === masterGuildId && isGuildAdmin(guild)) &&
      client.guilds.cache.has(masterGuildId);
    if (!allowed) {
      return go(db, res, req.viewer.sessionId, "/", "Choose a server where you have Administrator and GuildLink is a member.");
    }
    try {
      const community = db.createCommunity({
        name: req.body.name,
        masterGuildId,
        createdBy: req.viewer.id,
      });
      const masterName = client.guilds.cache.get(masterGuildId)?.name || "the main server";
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: `Created the community with ${masterName} as the main server.`,
      });
      go(db, res, req.viewer.sessionId, `/c/${community.id}`, "Community created. Open Roles to add a GuildLink role and choose its parent.");
    } catch (error) {
      go(db, res, req.viewer.sessionId, "/", error.message);
    }
  }));

  app.get("/c/:id", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    const view = await communityView({ db, client, ...loaded });
    sendHtml(
      res,
      200,
      renderCommunity({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
      })
    );
  }));

  app.get("/c/:id/categories/:categoryId/roles/:roleId", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    const categoryId = parseCommunityId(req.params.categoryId);
    const namedRoleId = parseCommunityId(req.params.roleId);
    const category = view.categories.find((item) => item.id === categoryId);
    const role = category?.roles.find((item) => item.namedRoleId === namedRoleId);
    if (!category || !role) {
      const back = category ? `/c/${loaded.community.id}/categories/${category.id}` : `/c/${loaded.community.id}/categories`;
      return go(db, res, req.viewer.sessionId, back, "That required role was not found.");
    }
    sendHtml(
      res,
      200,
      renderCategoryRoleSettings({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        category,
        role,
      })
    );
  }));

  app.get("/c/:id/categories/:categoryId", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    const categoryId = parseCommunityId(req.params.categoryId);
    const category = view.categories.find((item) => item.id === categoryId);
    if (!category) return go(db, res, req.viewer.sessionId, `/c/${loaded.community.id}/categories`, "That category was not found.");
    sendHtml(
      res,
      200,
      renderCategorySettings({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        category,
      })
    );
  }));

  app.get("/c/:id/categories", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    sendHtml(
      res,
      200,
      renderCategories({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
      })
    );
  }));

  app.get("/c/:id/servers", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    sendHtml(
      res,
      200,
      renderServers({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
      })
    );
  }));

  app.get("/c/:id/roles/:roleId", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    const namedRoleId = parseCommunityId(req.params.roleId);
    const role = view.namedRoles.find((item) => item.id === namedRoleId);
    if (!role) return go(db, res, req.viewer.sessionId, `/c/${loaded.community.id}/roles`, "That role was not found.");
    sendHtml(
      res,
      200,
      renderRoleSettings({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        role,
      })
    );
  }));

  app.get("/c/:id/roles", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    sendHtml(
      res,
      200,
      renderRoles({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
      })
    );
  }));

  app.get("/c/:id/bans", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    sendHtml(
      res,
      200,
      renderBans({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
      })
    );
  }));

  app.get("/c/:id/audit/channel", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    const auditServers = await listAuditServers(client, loaded.community);
    sendHtml(
      res,
      200,
      renderAuditChannel({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        auditServers,
      })
    );
  }));

  app.get("/c/:id/audit", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    if (mainOnly(res, loaded.access, loaded.community.id)) return;
    const view = await communityView({ db, client, ...loaded });
    const auditServers = loaded.access.canManageCommunity ? await listAuditServers(client, loaded.community) : [];
    sendHtml(
      res,
      200,
      renderAudit({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        auditServers,
      })
    );
  }));

  app.post("/c/:id/audit-channel", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const home = `/c/${community.id}/audit/channel`;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const guildId = String(req.body.guildId || "");
    const channelId = String(req.body.channelId || "");
    if (!guildId && !channelId) {
      db.setAuditChannel(community.id, null, null);
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: "Audit stays in the panel.",
      });
      return go(db, res, req.viewer.sessionId, home, "Saved. Audit stays in the panel.");
    }
    if (!isSnowflake(guildId) || !isSnowflake(channelId)) {
      return go(db, res, req.viewer.sessionId, home, "Choose a server and a channel.");
    }
    const servers = await listAuditServers(client, community);
    const server = servers.find((item) => item.id === guildId);
    const channel = server?.channels.find((item) => item.id === channelId);
    if (!channel) return go(db, res, req.viewer.sessionId, home, "Choose a channel GuildLink can post in.");
    try {
      db.setAuditChannel(community.id, guildId, channelId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, home, error.message);
    }
    db.addLog({
      communityId: community.id,
      kind: "config",
      actorId: req.viewer.id,
      detail: `Audit will also post to #${channel.name} on ${server.name}.`,
    });
    go(db, res, req.viewer.sessionId, home, `Saved. Audit will also post to #${channel.name}.`);
  }));

  app.get("/c/:id/guilds/:guildId/roles/:roleId", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    const guildId = String(req.params.guildId || "");
    if (!isSnowflake(guildId) || !canEditLinkedGuild(loaded.access, guildId)) {
      return denyGuild(req, res, loaded.community.id);
    }
    const view = await communityView({ db, client, ...loaded });
    const guild = view.guilds.find((item) => item.id === guildId);
    const serverPage = `/c/${loaded.community.id}/guilds/${guildId}/roles`;
    if (!guild) return denyGuild(req, res, loaded.community.id);
    const namedRoleId = parseCommunityId(req.params.roleId);
    const role = (guild.namedRoles || []).find((item) => item.id === namedRoleId);
    if (!role) return go(db, res, req.viewer.sessionId, serverPage, "That role was not found.");
    if (role.parentGuildId === guildId) {
      return go(db, res, req.viewer.sessionId, serverPage, `${role.name} comes from ${guild.name}.`);
    }
    if (!linkAllowed(guild.categoryId ?? null, role.allowedCategoryIds || [])) {
      return go(db, res, req.viewer.sessionId, serverPage, `${role.name} is set up on servers in ${categoryNameList(view.categories, role.allowedCategoryIds || [])}.`);
    }
    if (!guildRoleListed(guild, role, view.categories)) {
      return go(db, res, req.viewer.sessionId, serverPage, `Add ${role.name} on this server.`);
    }
    sendHtml(
      res,
      200,
      renderGuildRoleSettings({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        guild,
        role,
      })
    );
  }));

  app.post("/c/:id/guilds/:guildId/extra-roles", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const guildId = String(req.params.guildId || "");
    const home = `/c/${community.id}/guilds/${guildId}/roles`;
    if (!isSnowflake(guildId) || !canEditLinkedGuild(access, guildId)) return denyGuild(req, res, community.id);
    if (!community.linkedGuildIds.includes(guildId)) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, "That server is not linked.");
    }
    const namedRoleId = parseCommunityId(req.body.namedRoleId);
    const named = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!named) return go(db, res, req.viewer.sessionId, home, "Choose a GuildLink role.");
    const profile = await describeGuild(client, guildId);
    const categoryId = db.listGuildCategories(community.id).find((row) => row.guildId === guildId)?.categoryId ?? null;
    const category = categoryId ? db.listCategories(community.id).find((item) => item.id === categoryId) : null;
    if (category?.roles.some((role) => role.namedRoleId === named.id)) {
      return go(db, res, req.viewer.sessionId, home, `${named.name} is already required on ${profile.name}.`);
    }
    const limits = limitsByNamedRole(db, community.id);
    if (!linkAllowed(categoryId, limits.get(named.id) || [])) {
      const allowed = categoryNameList(db.listCategories(community.id), limits.get(named.id) || []);
      return go(db, res, req.viewer.sessionId, home, `${named.name} is set up on servers in ${allowed}.`);
    }
    try {
      db.addGuildExtraRole(community.id, guildId, named.id);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, home, error.message);
    }
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Added ${named.name} on ${profile.name}.`,
    });
    go(db, res, req.viewer.sessionId, home, `Added ${named.name} on ${profile.name}.`);
  }));

  app.post("/c/:id/guilds/:guildId/extra-roles/:roleId/remove", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const guildId = String(req.params.guildId || "");
    const home = `/c/${community.id}/guilds/${guildId}/roles`;
    if (!isSnowflake(guildId) || !canEditLinkedGuild(access, guildId)) return denyGuild(req, res, community.id);
    const namedRoleId = parseCommunityId(req.params.roleId);
    const named = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!named) return go(db, res, req.viewer.sessionId, home, "That role was not found.");
    const categoryId = db.listGuildCategories(community.id).find((row) => row.guildId === guildId)?.categoryId ?? null;
    const category = categoryId ? db.listCategories(community.id).find((item) => item.id === categoryId) : null;
    if (category?.roles.some((role) => role.namedRoleId === named.id)) {
      return go(db, res, req.viewer.sessionId, home, `${named.name} is required on this server.`);
    }
    const profile = await describeGuild(client, guildId);
    db.removeGuildExtraRole(community.id, guildId, named.id);
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Removed ${named.name} from ${profile.name}.`,
    });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    go(db, res, req.viewer.sessionId, home, `Removed ${named.name} from ${profile.name}.`);
  }));

  app.get("/c/:id/guilds/:guildId/roles", asyncRoute(async (req, res) => {
    const loaded = await loadAccess(req, res, db, config, client);
    if (!loaded) return;
    const guildId = String(req.params.guildId || "");
    if (!isSnowflake(guildId) || !canEditLinkedGuild(loaded.access, guildId)) {
      return denyGuild(req, res, loaded.community.id);
    }
    const view = await communityView({ db, client, ...loaded });
    const guild = view.guilds.find((item) => item.id === guildId);
    if (!guild) return denyGuild(req, res, loaded.community.id);
    sendHtml(
      res,
      200,
      renderGuildRoles({
        ...frame(req),
        notice: takeNotice(req, db),
        botMessage: connectionMessage(botState),
        ...view,
        guild,
      })
    );
  }));

  app.post("/c/:id/settings", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const onBans = req.body.returnTo === "bans";
    const roleSyncEnabled = onBans ? community.roleSyncEnabled : req.body.roleSync === "1";
    const banSyncEnabled = onBans ? req.body.banSync === "1" : community.banSyncEnabled;
    const name = onBans ? community.name : req.body.name;
    const destination = onBans ? `/c/${community.id}/bans` : `/c/${community.id}`;
    try {
      db.updateCommunity(community.id, { name, roleSyncEnabled, banSyncEnabled });
    } catch (error) {
      return go(db, res, req.viewer.sessionId, destination, error.message);
    }
    const fresh = db.getCommunity(community.id);
    if (fresh.name !== community.name) {
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: `Renamed the community to ${fresh.name}.`,
      });
    }
    if (roleSyncEnabled !== community.roleSyncEnabled) {
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: `Turned role sync ${roleSyncEnabled ? "on" : "off"}.`,
      });
    }
    if (banSyncEnabled !== community.banSyncEnabled) {
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: `Turned ban sync ${banSyncEnabled ? "on" : "off"}.`,
      });
    }
    await finishSync(req, [
      !community.roleSyncEnabled && roleSyncEnabled ? queueFullRoleSync(db, client, fresh, { actorId: req.viewer.id }) : null,
      !community.banSyncEnabled && banSyncEnabled ? queueFullBanSync(db, client, fresh, { actorId: req.viewer.id }) : null,
    ]);
    const started = (!community.roleSyncEnabled && roleSyncEnabled) || (!community.banSyncEnabled && banSyncEnabled);
    const saved = onBans ? "Saved ban sync." : "Saved settings.";
    go(db, res, req.viewer.sessionId, destination, started ? "Saved. Sync is running." : saved);
  }));

  app.post("/c/:id/named-roles", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/roles`;
    try {
      const created = db.createNamedRole(community.id, req.body.name);
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: `Added the GuildLink role ${created.name}.`,
      });
      go(db, res, req.viewer.sessionId, `/c/${community.id}/roles/${created.id}`, `Added ${created.name}. Choose its parent server and Discord role.`);
    } catch (error) {
      go(db, res, req.viewer.sessionId, home, error.message);
    }
  }));

  app.post("/c/:id/named-roles/:roleId", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/roles`;
    const namedRoleId = parseCommunityId(req.params.roleId);
    const editor = namedRoleId ? `${home}/${namedRoleId}` : home;
    const current = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!current) return go(db, res, req.viewer.sessionId, home, "That role was not found.");
    try {
      const renamed = db.renameNamedRole(community.id, namedRoleId, req.body.name);
      if (renamed.name !== current.name) {
        db.addLog({
          communityId: community.id,
          kind: "config",
          actorId: req.viewer.id,
          detail: `Renamed the GuildLink role ${current.name} to ${renamed.name}.`,
        });
      }
      go(db, res, req.viewer.sessionId, editor, `Saved ${renamed.name}.`);
    } catch (error) {
      go(db, res, req.viewer.sessionId, editor, error.message);
    }
  }));

  app.post("/c/:id/named-roles/:roleId/remove", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/roles`;
    const namedRoleId = parseCommunityId(req.params.roleId);
    const current = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!current) return go(db, res, req.viewer.sessionId, home, "That role was not found.");
    db.deleteNamedRole(community.id, namedRoleId);
    db.addLog({
      communityId: community.id,
      kind: "config",
      actorId: req.viewer.id,
      detail: `Deleted the GuildLink role ${current.name}.`,
    });
    const permission = await reconcileRolePermissions(db, client, community, { actorId: req.viewer.id });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(
      db,
      res,
      req.viewer.sessionId,
      home,
      community.roleSyncEnabled
        ? `Deleted ${current.name}. Role sync will remove the Discord roles GuildLink added for it.${extra}`
        : `Deleted ${current.name}. Role sync is off, so members stay as they are.${extra}`
    );
  }));

  app.post("/c/:id/named-roles/:roleId/parent", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/roles`;
    const namedRoleId = parseCommunityId(req.params.roleId);
    const editor = namedRoleId ? `${home}/${namedRoleId}` : home;
    const current = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!current) return go(db, res, req.viewer.sessionId, home, "That role was not found.");
    const guildId = String(req.body.parentGuildId || "");
    const roleId = String(req.body.parentRoleId || "");
    const allowed = new Set([community.masterGuildId, ...community.linkedGuildIds]);
    if (!isSnowflake(guildId) || !allowed.has(guildId)) {
      return go(db, res, req.viewer.sessionId, editor, "Choose a server in this community.");
    }
    const profile = await describeGuild(client, guildId);
    const discordRole = profile.roles.find((item) => item.id === roleId);
    if (!profile.present || !isSnowflake(roleId) || !discordRole) {
      return go(db, res, req.viewer.sessionId, editor, "Choose a Discord role on that server.");
    }
    try {
      db.setNamedRoleParent(community.id, namedRoleId, guildId, roleId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, editor, error.message);
    }
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Set the parent for ${current.name} to ${discordRole.name} on ${profile.name}.`,
    });
    const permission = await reconcileRolePermissions(db, client, community, { guildIds: [guildId], actorId: req.viewer.id });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    const updating = permission.updated > 0 || permission.errors.length > 0 ? " Discord roles are being updated." : "";
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(
      db,
      res,
      req.viewer.sessionId,
      editor,
      `Saved the parent for ${current.name}. People with ${discordRole.name} on ${profile.name} have ${current.name}.${updating}${extra}`
    );
  }));

  app.post("/c/:id/named-roles/:roleId/categories", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/roles`;
    const namedRoleId = parseCommunityId(req.params.roleId);
    const editor = namedRoleId ? `${home}/${namedRoleId}` : home;
    const current = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    if (!current) return go(db, res, req.viewer.sessionId, home, "That role was not found.");
    const categoryIds = asList(req.body.categoryId).map((value) => parseCommunityId(value)).filter(Boolean);
    try {
      db.setNamedRoleCategoryLimit(community.id, namedRoleId, categoryIds);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, editor, error.message);
    }
    const fresh = db.getCommunity(community.id);
    await finishSync(req, [
      fresh?.roleSyncEnabled ? queueFullRoleSync(db, client, fresh, { actorId: req.viewer.id }) : null,
    ]);
    const names = categoryNames(db, community.id, categoryIds);
    go(
      db,
      res,
      req.viewer.sessionId,
      editor,
      names ? `${current.name} is set up on servers in ${names}.` : `${current.name} is set up on every server.`
    );
  }));

  app.post("/c/:id/categories", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    let categoryId;
    try {
      categoryId = db.createCategory(community.id, req.body.name);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/categories`, error.message);
    }
    go(db, res, req.viewer.sessionId, `/c/${community.id}/categories/${categoryId}`, "Category created. Choose the GuildLink roles it requires.");
  }));

  app.post("/c/:id/categories/:categoryId", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const categoryId = parseCommunityId(req.params.categoryId);
    const settings = categoryId ? `/c/${community.id}/categories/${categoryId}` : `/c/${community.id}/categories`;
    if (!categoryId) return go(db, res, req.viewer.sessionId, settings, "That category was not found.");
    try {
      db.renameCategory(community.id, categoryId, req.body.name);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, settings, error.message);
    }
    go(db, res, req.viewer.sessionId, settings, "Category renamed.");
  }));

  app.post("/c/:id/categories/:categoryId/delete", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const categoryId = parseCommunityId(req.params.categoryId);
    const settings = categoryId ? `/c/${community.id}/categories/${categoryId}` : `/c/${community.id}/categories`;
    if (!categoryId) return go(db, res, req.viewer.sessionId, `/c/${community.id}/categories`, "That category was not found.");
    if (req.body.confirm !== "1") {
      return go(db, res, req.viewer.sessionId, settings, "Confirm that you want to delete the category.");
    }
    const name = db.listCategories(community.id).find((item) => item.id === categoryId)?.name || "That category";
    try {
      db.deleteCategory(community.id, categoryId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/categories`, error.message);
    }
    const fresh = db.getCommunity(community.id);
    const permission = await reconcileRolePermissions(db, client, fresh || community, { actorId: req.viewer.id });
    await finishSync(req, [
      fresh?.roleSyncEnabled ? queueFullRoleSync(db, client, fresh, { actorId: req.viewer.id }) : null,
    ]);
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(db, res, req.viewer.sessionId, `/c/${community.id}/categories`, `Deleted ${name}. Servers that used it now have no category. Discord roles are being updated.${extra}`);
  }));

  app.post("/c/:id/categories/:categoryId/requirements", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/categories`;
    const categoryId = parseCommunityId(req.params.categoryId);
    if (!categoryId) return go(db, res, req.viewer.sessionId, home, "That category was not found.");
    const editor = `${home}/${categoryId}`;
    const namedRoleIds = asList(req.body.namedRoleId).map((value) => parseCommunityId(value)).filter(Boolean);
    if (!namedRoleIds.length) return go(db, res, req.viewer.sessionId, editor, "Choose a GuildLink role.");
    try {
      for (const namedRoleId of namedRoleIds) db.addCategoryRequirement(community.id, categoryId, namedRoleId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, editor, error.message);
    }
    const permission = await reconcileRolePermissions(db, client, community, { actorId: req.viewer.id });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    const saved = db.listCategories(community.id).find((item) => item.id === categoryId);
    const names = (saved?.roles || []).map((role) => role.name);
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    const message = names.length
      ? `This category requires ${names.join(", ")}. Set Discord permissions for each role when it should receive them.${extra}`
      : `This category has no required roles. It works as a label.${extra}`;
    go(db, res, req.viewer.sessionId, editor, message);
  }));

  app.post("/c/:id/categories/:categoryId/requirements/:roleId/remove", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/categories`;
    const categoryId = parseCommunityId(req.params.categoryId);
    const namedRoleId = parseCommunityId(req.params.roleId);
    const editor = categoryId ? `${home}/${categoryId}` : home;
    if (!categoryId || !namedRoleId) return go(db, res, req.viewer.sessionId, home, "That required role was not found.");
    const name = db.getNamedRole(community.id, namedRoleId)?.name || "That role";
    try {
      db.removeCategoryRequirement(community.id, categoryId, namedRoleId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, editor, error.message);
    }
    const permission = await reconcileRolePermissions(db, client, community, { actorId: req.viewer.id });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(db, res, req.viewer.sessionId, editor, `Removed ${name} from this category. Discord roles are being updated.${extra}`);
  }));

  app.post("/c/:id/categories/:categoryId/requirements/:roleId/permissions", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const home = `/c/${community.id}/categories`;
    const categoryId = parseCommunityId(req.params.categoryId);
    const namedRoleId = parseCommunityId(req.params.roleId);
    const editor = categoryId && namedRoleId ? `${home}/${categoryId}/roles/${namedRoleId}` : home;
    if (!categoryId || !namedRoleId) return go(db, res, req.viewer.sessionId, home, "That required role was not found.");
    const permissions = [...new Set(asList(req.body.permission).filter(knownPermission))];
    try {
      db.setCategoryRequirementPermissions(community.id, categoryId, namedRoleId, permissions);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, editor, error.message);
    }
    const permission = await reconcileRolePermissions(db, client, community, { actorId: req.viewer.id });
    const name = db.getNamedRole(community.id, namedRoleId)?.name || "That role";
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(db, res, req.viewer.sessionId, editor, `Saved permissions for ${name}. Discord roles are being updated.${extra}`);
  }));

  app.post("/c/:id/guilds", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const guildId = String(req.body.guildId || "");
    const guild = isSnowflake(guildId) ? client.guilds.cache.get(guildId) : null;
    if (!guild) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, "Invite GuildLink to that server before linking it.");
    }
    try {
      db.addLinkedGuild({
        communityId: community.id,
        guildId,
        addedBy: req.viewer.id,
        masterGuildId: community.masterGuildId,
      });
    } catch (error) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, error.message);
    }
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Linked ${guild.name}.`,
    });
    const fresh = db.getCommunity(community.id);
    await finishSync(req, [
      fresh.roleSyncEnabled ? queueFullRoleSync(db, client, fresh, { guildIds: [guildId], actorId: req.viewer.id }) : null,
      fresh.banSyncEnabled ? queueFullBanSync(db, client, fresh, { guildIds: [guildId], actorId: req.viewer.id }) : null,
    ]);
    const named = db.listNamedRoles(community.id);
    const prompt = named.length
      ? `Linked ${guild.name}. Choose a Discord role for each GuildLink role on this server.`
      : `Linked ${guild.name}. Add a GuildLink role when this server should grant one.`;
    go(db, res, req.viewer.sessionId, `/c/${community.id}/guilds/${guildId}/roles`, prompt);
  }));

  app.post("/c/:id/guilds/:guildId/remove", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const guildId = req.params.guildId;
    if (!community.linkedGuildIds.includes(guildId)) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, "That server is not linked.");
    }
    if (req.body.confirm !== "1") {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/guilds/${guildId}/roles`, "Confirm that you want to remove the server.");
    }
    const name = client.guilds.cache.get(guildId)?.name || "that server";
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Removed ${name}. Roles and bans already applied were left in place.`,
    });
    db.removeLinkedGuild(community.id, guildId);
    go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, `Removed ${name}.`);
  }));

  app.post("/c/:id/guilds/:guildId/category", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const guildId = req.params.guildId;
    const home = req.body.returnTo === "servers"
      ? `/c/${community.id}/servers`
      : `/c/${community.id}/guilds/${guildId}/roles`;
    if (!isSnowflake(guildId) || !community.linkedGuildIds.includes(guildId)) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/roles`, "That server is not linked.");
    }
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const raw = String(req.body.categoryId || "");
    const categoryId = raw ? parseCommunityId(raw) : null;
    if (raw && !categoryId) return go(db, res, req.viewer.sessionId, home, "Choose a category from this community.");
    try {
      db.setGuildCategory(community.id, guildId, categoryId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, home, error.message);
    }
    const fresh = db.getCommunity(community.id);
    const permission = await reconcileRolePermissions(db, client, fresh || community, { guildIds: [guildId], actorId: req.viewer.id });
    await finishSync(req, [
      fresh?.roleSyncEnabled ? queueFullRoleSync(db, client, fresh, { actorId: req.viewer.id }) : null,
    ]);
    const name = client.guilds.cache.get(guildId)?.name || "That server";
    const categoryName = categoryId ? db.listCategories(community.id).find((item) => item.id === categoryId)?.name : "";
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    const updating = categoryName ? " Discord roles are being updated." : "";
    go(
      db,
      res,
      req.viewer.sessionId,
      home,
      (categoryName ? `${name} is in ${categoryName}.${updating}` : `${name} has no category. Discord roles are being updated.`) + extra
    );
  }));

  app.post("/c/:id/guilds/:guildId/named-roles/:roleId", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const guildId = String(req.params.guildId || "");
    const onMain = guildId === community.masterGuildId;
    const namedRoleId = parseCommunityId(req.params.roleId);
    const named = namedRoleId ? db.getNamedRole(community.id, namedRoleId) : null;
    const list = onMain ? `/c/${community.id}/roles` : `/c/${community.id}/guilds/${guildId}/roles`;
    const home = named ? `${list}/${named.id}` : list;
    if (!isSnowflake(guildId) || (onMain ? !access.canManageCommunity : !canEditLinkedGuild(access, guildId))) {
      return onMain ? denyCommunity(req, res, community.id) : denyGuild(req, res, community.id);
    }
    if (!onMain && !community.linkedGuildIds.includes(guildId)) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/roles`, "That server is not linked.");
    }
    if (!named) return go(db, res, req.viewer.sessionId, list, "That role was not found.");
    const profile = await describeGuild(client, guildId);
    if (!profile.present) {
      return go(db, res, req.viewer.sessionId, home, "Invite GuildLink back to that server before changing its roles.");
    }
    if (named.parentGuildId === guildId) {
      return go(db, res, req.viewer.sessionId, list, `${named.name} comes from ${profile.name}.`);
    }
    const roleId = String(req.body.roleId || "");
    const categoryId = db.listGuildCategories(community.id).find((row) => row.guildId === guildId)?.categoryId ?? null;
    const category = categoryId ? db.listCategories(community.id).find((item) => item.id === categoryId) : null;
    const required = Boolean(category?.roles.some((role) => role.namedRoleId === named.id));
    const added = db.listGuildExtraRoles(community.id).some((item) => item.guildId === guildId && item.namedRoleId === named.id);
    const hasDestination = db.listNamedRoleDestinations(community.id).some((item) => item.namedRoleId === named.id && item.guildId === guildId);
    if (!required && !added && !hasDestination) {
      return go(db, res, req.viewer.sessionId, list, `Add ${named.name} on ${profile.name}.`);
    }
    if (!roleId) {
      if (required) return go(db, res, req.viewer.sessionId, home, `${named.name} needs a Discord role on ${profile.name}.`);
      try {
        db.setNamedRoleDestination(community.id, named.id, guildId, "");
      } catch (error) {
        return go(db, res, req.viewer.sessionId, home, error.message);
      }
      const permission = await reconcileRolePermissions(db, client, community, { guildIds: [guildId], actorId: req.viewer.id });
      await finishSync(req, [
        community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
      ]);
      const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
      return go(db, res, req.viewer.sessionId, home, `${profile.name} does not grant ${named.name} yet. Discord roles are being updated.${extra}`);
    }
    const discordRole = profile.roles.find((item) => item.id === roleId);
    if (!isSnowflake(roleId) || !discordRole) {
      return go(db, res, req.viewer.sessionId, home, "Choose a Discord role on this server.");
    }
    if (discordRole.assignable === false) {
      const existing = db.listNamedRoleDestinations(community.id).find((item) => item.namedRoleId === named.id && item.guildId === guildId);
      if (!existing || existing.roleId !== roleId) {
        return go(db, res, req.viewer.sessionId, home, discordRole.problem || `GuildLink cannot assign ${discordRole.name} on ${profile.name}.`);
      }
    }
    const limits = limitsByNamedRole(db, community.id);
    if (!linkAllowed(categoryId, limits.get(named.id) || [])) {
      const allowed = categoryNameList(db.listCategories(community.id), limits.get(named.id) || []);
      return go(db, res, req.viewer.sessionId, list, `${named.name} is set up on servers in ${allowed}.`);
    }
    try {
      db.setNamedRoleDestination(community.id, named.id, guildId, roleId);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, home, error.message);
    }
    db.addLog({
      communityId: community.id,
      kind: "config",
      guildId,
      actorId: req.viewer.id,
      detail: `Chose ${discordRole.name} as ${named.name} on ${profile.name}.`,
    });
    const permission = await reconcileRolePermissions(db, client, community, { guildIds: [guildId], actorId: req.viewer.id });
    await finishSync(req, [
      community.roleSyncEnabled ? queueFullRoleSync(db, client, community, { actorId: req.viewer.id }) : null,
    ]);
    const extra = permission.errors[0] ? ` ${permission.errors[0]}` : "";
    go(
      db,
      res,
      req.viewer.sessionId,
      home,
      `Saved ${discordRole.name} as ${named.name} on ${profile.name}. Discord roles are being updated.${extra}`
    );
  }));

  app.post("/c/:id/guilds/:guildId/sync-roles", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    const guildId = req.params.guildId;
    if (!isSnowflake(guildId) || !canEditLinkedGuild(access, guildId)) return denyGuild(req, res, community.id);
    if (!community.roleSyncEnabled) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/guilds/${guildId}/roles`, "Role sync is off. An administrator of the main server can turn it on.");
    }
    await finishSync(req, [queueFullRoleSync(db, client, community, { guildIds: [guildId], actorId: req.viewer.id })]);
    const name = client.guilds.cache.get(guildId)?.name || "that server";
    go(db, res, req.viewer.sessionId, `/c/${community.id}/guilds/${guildId}/roles`, `Role sync is running for ${name}.`);
  }));

  app.post("/c/:id/sync-roles", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    if (!community.roleSyncEnabled) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, "Turn role sync on before running it.");
    }
    await finishSync(req, [queueFullRoleSync(db, client, community, { actorId: req.viewer.id })]);
    go(db, res, req.viewer.sessionId, `/c/${community.id}/servers`, "Role sync is running for every linked server.");
  }));

  app.post("/c/:id/sync-bans", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    if (!community.banSyncEnabled) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, "Turn ban sync on before running it.");
    }
    await finishSync(req, [queueFullBanSync(db, client, community, { actorId: req.viewer.id })]);
    const skipped = community.appealsGuildId ? " The ban appeals server is skipped." : "";
    go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, `Ban sync is running for every linked server.${skipped}`);
  }));

  app.post("/c/:id/appeals", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    const next = String(req.body.appealsGuildId || "");
    if (next && (!isSnowflake(next) || !community.linkedGuildIds.includes(next))) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, "Choose a linked server for ban appeals.");
    }
    const unbanRequested = req.body.appealUnban === "1";
    if (unbanRequested && !next) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, "Choose the ban appeals server before allowing the unban command.");
    }
    const previous = community.appealsGuildId;
    const nextId = next || null;
    const nextFlag = Boolean(nextId && unbanRequested);
    const guildChanged = (previous || null) !== nextId;
    let unbanRoles = [];
    if (nextId && !guildChanged) {
      const known = new Set(client.guilds.cache.get(nextId)?.roles.cache.keys() || []);
      const seen = new Set();
      for (const roleId of asList(req.body.unbanRole)) {
        if (!isSnowflake(roleId) || roleId === nextId || !known.has(roleId) || seen.has(roleId)) continue;
        seen.add(roleId);
        unbanRoles.push(roleId);
      }
    }
    const previousRoles = db.listAppealUnbanRoles(community.id);
    const sameRoles =
      previousRoles.length === unbanRoles.length && previousRoles.every((roleId, index) => roleId === [...unbanRoles].sort()[index]);
    if (!guildChanged && nextFlag === Boolean(community.appealUnbanEnabled) && sameRoles) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, "Ban appeals is already set that way.");
    }
    let fresh;
    try {
      fresh = db.setAppealsGuild(community.id, nextId, nextFlag);
    } catch (error) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, error.message);
    }
    const nextName = client.guilds.cache.get(next)?.name || "That server";
    const previousName = client.guilds.cache.get(previous)?.name || "The previous server";
    if (guildChanged) {
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: next
          ? `Set ${nextName} as the ban appeals server. Main-server bans are not copied there.`
          : `Cleared the ban appeals server. ${previousName} will receive main-server bans again.`,
      });
      await finishSync(req, [
        next ? queueLiftAppealsBans(db, client, fresh, next, req.viewer.id) : null,
        previous && community.banSyncEnabled ? queueFullBanSync(db, client, fresh, { guildIds: [previous], actorId: req.viewer.id }) : null,
      ]);
    }
    if (!guildChanged) {
      try {
        db.setAppealUnbanRoles(community.id, unbanRoles);
      } catch (error) {
        return go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, error.message);
      }
    }
    if (nextFlag !== Boolean(community.appealUnbanEnabled)) {
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail: nextFlag
          ? "Turned on /guildlink unban in the ban appeals server."
          : "Turned off /guildlink unban in the ban appeals server.",
      });
    }
    if (!guildChanged && !sameRoles) {
      const allowedNames = unbanRoles.map((roleId) => client.guilds.cache.get(nextId)?.roles.cache.get(roleId)?.name || "a deleted role");
      db.addLog({
        communityId: community.id,
        kind: "config",
        actorId: req.viewer.id,
        detail:
          allowedNames.length > 0
            ? `Allowed ${allowedNames.join(", ")} to run /guildlink unban.`
            : "Cleared the roles that can run /guildlink unban. Nobody can use it until a role is selected.",
      });
    }
    const parts = [];
    if (guildChanged) {
      parts.push(
        next
          ? `${nextName} is the ban appeals server. GuildLink will not copy bans there, and it is removing bans it already applied.`
          : `Ban appeals is off. ${previousName} will receive main-server bans again.`
      );
    }
    if (nextFlag !== Boolean(community.appealUnbanEnabled)) {
      parts.push(nextFlag ? "The unban command is on." : "The unban command is off.");
    }
    if (!guildChanged && !sameRoles) {
      parts.push(
        unbanRoles.length > 0
          ? "Saved the roles that can run /guildlink unban."
          : "No roles can run /guildlink unban until you tick at least one."
      );
    }
    go(db, res, req.viewer.sessionId, `/c/${community.id}/bans`, parts.join(" "));
  }));

  app.post("/c/:id/delete", asyncRoute(async (req, res) => {
    const loaded = await postAccess(req, res, db, config, client);
    if (!loaded) return;
    const { community, access } = loaded;
    if (!access.canManageCommunity) return denyCommunity(req, res, community.id);
    if (req.body.confirmName !== community.name) {
      return go(db, res, req.viewer.sessionId, `/c/${community.id}`, "Type the community name exactly to delete it.");
    }
    db.deleteCommunity(community.id);
    go(db, res, req.viewer.sessionId, "/", "Deleted the community. Discord roles and bans were left as they are.");
  }));

  app.use((req, res) => {
    sendHtml(
      res,
      404,
      renderStatus({
        title: "Not found",
        message: "That page doesn't exist, or you don't have Administrator on a server in that community.",
        ...frame(req),
      })
    );
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(`[guildlink] ${error.message}`);
    sendHtml(
      res,
      500,
      renderStatus({
        title: "Something went wrong",
        message: "GuildLink hit an unexpected error. Try again.",
        ...frame(req),
      })
    );
  });

  return app;
}

function sessionGate({ db, config, box }) {
  return async function session(req, res, next) {
    if (req.app.get("betaOpenPanel")) {
      const betaState = betaSessions.get(req.app);
      req.viewer = {
        sessionId: "beta",
        csrf: betaState.csrf,
        id: "beta",
        username: "beta",
        globalName: "Beta tester",
        avatarUrl: null,
        accessToken: null,
        beta: true,
      };
      return next();
    }
    req.viewer = null;
    const sessionId = readCookies(req.headers.cookie)[sessionCookie()];
    if (!sessionId) return next();
    const row = db.getSession(sessionId);
    if (!row) return next();
    try {
      let accessToken = box.open(row.access_token);
      let refreshToken = box.open(row.refresh_token);
      let tokenExpiresAt = row.token_expires_at;
      if (tokenExpiresAt < Date.now() + 60_000) {
        const tokens = await refreshTokens(config, refreshToken);
        accessToken = tokens.access_token;
        refreshToken = tokens.refresh_token || refreshToken;
        tokenExpiresAt = Date.now() + Number(tokens.expires_in) * 1000;
        db.updateSessionTokens(sessionId, {
          accessToken: box.seal(accessToken),
          refreshToken: box.seal(refreshToken),
          tokenExpiresAt,
        });
      }
      req.viewer = {
        sessionId,
        csrf: row.csrf,
        id: row.user_id,
        username: row.username,
        globalName: row.global_name,
        avatarUrl: row.avatar,
        accessToken,
      };
      next();
    } catch (error) {
      console.error(`[guildlink] session failed: ${error.message}`);
      db.deleteSession(sessionId);
      clearCookie(res, sessionCookie(), config.secureCookies);
      req.viewer = null;
      next();
    }
  };
}

async function loadGuilds(req, res, db, config, client) {
  if (req.viewer?.beta) {
    await refreshServers(client);
    return [...client.guilds.cache.values()].map((guild) => ({
      id: guild.id,
      name: guild.name,
      owner: true,
      permissions: "8",
    }));
  }
  try {
    return await fetchUserGuilds(req.viewer.accessToken, req.viewer.id);
  } catch (error) {
    if (error.status === 401) {
      db.deleteSession(req.viewer.sessionId);
      clearCookie(res, sessionCookie(), config.secureCookies);
      res.redirect(303, "/login?error=session");
      return null;
    }
    console.error(`[guildlink] could not load Discord servers: ${error.message}`);
    sendHtml(
      res,
      502,
      renderStatus({
        title: "Discord is unavailable",
        message: "GuildLink could not check which servers you administer. Try again in a moment.",
        ...frame(req),
      })
    );
    return null;
  }
}

async function loadAccess(req, res, db, config, client) {
  if (!req.viewer) {
    res.redirect(303, "/login");
    return null;
  }
  const id = parseCommunityId(req.params.id);
  const only = db.getInstallCommunity();
  const community = id && only && only.id === id ? only : null;
  if (!community) {
    notFound(req, res);
    return null;
  }
  const userGuilds = await loadGuilds(req, res, db, config, client);
  if (!userGuilds) return null;
  const access = betaLinkedAccess(req, community, resolveAccess({
    userGuilds,
    masterGuildId: community.masterGuildId,
    linkedGuildIds: community.linkedGuildIds,
  }));
  if (access.level === "none") {
    notFound(req, res);
    return null;
  }
  return { community, access };
}

async function postAccess(req, res, db, config, client) {
  if (!req.viewer) {
    res.redirect(303, "/login");
    return null;
  }
  if (!csrfOk(req, res)) return null;
  return loadAccess(req, res, db, config, client);
}

async function communityView({ db, client, community, access }) {
  const master = await describeGuild(client, community.masterGuildId);
  const categories = db.listCategories(community.id);
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const guildCategory = new Map(db.listGuildCategories(community.id).map((row) => [row.guildId, row.categoryId]));
  const limits = limitsByNamedRole(db, community.id);
  const destinations = db.listNamedRoleDestinations(community.id);
  const extraRoles = db.listGuildExtraRoles(community.id);
  const storedRoles = db.listNamedRoles(community.id);
  const serverIds = [community.masterGuildId, ...community.linkedGuildIds];
  const profiles = new Map();
  for (const guildId of serverIds) profiles.set(guildId, await describeGuild(client, guildId));
  const roleServers = [...profiles.values()]
    .filter((profile) => profile.present)
    .map((profile) => ({ id: profile.id, name: profile.name, roles: profile.roles }));
  const namedRoles = storedRoles.map((role) => {
    const parent = role.parentGuildId ? profiles.get(role.parentGuildId) : null;
    const parentRole = parent?.roles.find((item) => item.id === role.parentRoleId);
    const mainDest = destinations.find((item) => item.namedRoleId === role.id && item.guildId === community.masterGuildId);
    return {
      ...role,
      parentGuildName: parent?.name || "",
      parentRoleName: parentRole?.name || "",
      allowedCategoryIds: limits.get(role.id) || [],
      mainRoleId: mainDest?.roleId || "",
    };
  });
  const guilds = [];
  for (const guildId of access.editableGuildIds) {
    const profile = profiles.get(guildId) || (await describeGuild(client, guildId));
    const categoryId = guildCategory.get(guildId) ?? null;
    const category = categoryId != null ? categoryById.get(categoryId) : null;
    const localRoles = namedRoles.map((role) => {
      const local = destinations.find((item) => item.namedRoleId === role.id && item.guildId === guildId);
      return { ...role, localRoleId: role.parentGuildId === guildId ? "" : local?.roleId || "" };
    });
    guilds.push({
      ...profile,
      categoryId,
      categoryName: category?.name || "",
      requirementIssues: requirementIssues(category, namedRoles, guildId, destinations),
      extraRoleIds: extraRoles.filter((item) => item.guildId === guildId).map((item) => item.namedRoleId),
      namedRoles: localRoles,
    });
  }
  const names = { master: master.name };
  for (const guild of guilds) names[guild.id] = guild.name;
  const addableGuilds = [];
  if (access.canManageCommunity) {
    for (const guild of client.guilds.cache.values()) {
      if (!db.guildIsClaimed(guild.id)) addableGuilds.push({ id: guild.id, name: guild.name });
    }
    addableGuilds.sort((left, right) => left.name.localeCompare(right.name));
  }
  return {
    community,
    access,
    summary: accessSummary(access, names),
    master,
    namedRoles,
    roleServers,
    categories,
    guilds,
    addableGuilds,
    appealUnbanRoleIds: db.listAppealUnbanRoles(community.id),
    logs: db.listLogs(
      community.id,
      access.isMainAdmin ? { limit: 40 } : { guildIds: access.editableGuildIds, limit: 40 }
    ),
  };
}

function csrfOk(req, res) {
  if (sameSecret(req.body?.csrf, req.viewer?.csrf)) return true;
  sendHtml(
    res,
    403,
    renderStatus({
      title: "Form expired",
      message: "That form is no longer valid. Go back and try again.",
      ...frame(req),
    })
  );
  return false;
}

function mainOnly(res, access, communityId) {
  if (access.canManageCommunity) return false;
  res.redirect(303, `/c/${communityId}`);
  return true;
}

function denyCommunity(req, res, communityId) {
  sendHtml(
    res,
    403,
    renderStatus({
      title: "Main server only",
      message: "You can only change servers where you have Administrator. Community-wide settings stay with an administrator of the main server.",
      ...frame(req),
      actionHref: `/c/${communityId}`,
      actionLabel: "Back to the community",
    })
  );
}

function denyGuild(req, res, communityId) {
  sendHtml(
    res,
    403,
    renderStatus({
      title: "Not your server",
      message: "You can only change servers where you have Administrator.",
      ...frame(req),
      actionHref: `/c/${communityId}`,
      actionLabel: "Back to the community",
    })
  );
}

function notFound(req, res) {
  sendHtml(
    res,
    404,
    renderStatus({
      title: "Not found",
      message: "That page doesn't exist, or you don't have Administrator on a server in that community.",
      ...frame(req),
    })
  );
}

function viewerView(viewer) {
  if (!viewer) return null;
  return { name: viewer.globalName || viewer.username, avatarUrl: viewer.avatarUrl };
}

function connectionMessage(botState) {
  if (botState.error) return botState.error;
  if (!botState.ready) return "The bot is still connecting to Discord. Server lists update when it is online.";
  return null;
}

function go(db, res, sessionId, location, message) {
  if (sessionId === "beta") {
    const betaState = betaSessions.get(res.app);
    if (betaState) betaState.flash = message;
    res.redirect(303, location);
    return;
  }
  db.setFlash(sessionId, message);
  res.redirect(303, location);
}

function takeNotice(req, db) {
  if (req.viewer?.beta) {
    const betaState = betaSessions.get(req.app);
    const message = betaState?.flash ?? null;
    if (betaState) betaState.flash = null;
    return message;
  }
  return db.takeFlash(req.viewer.sessionId);
}

function betaLinkedAccess(req, community, access) {
  if (!req.viewer?.beta || betaSessions.get(req.app)?.view !== "linked") return access;
  return {
    level: "linked",
    isMainAdmin: false,
    canManageCommunity: false,
    editableGuildIds: (community.linkedGuildIds || []).map(String),
  };
}

function frame(req) {
  return {
    viewer: viewerView(req.viewer),
    csrf: req.viewer?.csrf ?? null,
    beta: Boolean(req.app?.get("betaOpenPanel")),
    betaLinked: betaSessions.get(req.app)?.view === "linked",
    mock: Boolean(req.app?.get("betaMock")),
  };
}

function parseCommunityId(value) {
  if (!/^[0-9]+$/.test(String(value || ""))) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return [String(value)];
}

function limitsByNamedRole(db, communityId) {
  const map = new Map();
  for (const row of db.listNamedRoleCategoryLimits(communityId)) {
    if (!map.has(row.namedRoleId)) map.set(row.namedRoleId, []);
    map.get(row.namedRoleId).push(row.categoryId);
  }
  return map;
}

function guildRoleListed(guild, role, categories) {
  const category = (categories || []).find((item) => String(item.id) === String(guild.categoryId));
  const required = Boolean(category?.roles?.some((item) => String(item.namedRoleId) === String(role.id)));
  const extra = (guild.extraRoleIds || []).map(String).includes(String(role.id));
  return required || extra || Boolean(role.localRoleId);
}

function requirementIssues(category, namedRoles, guildId, destinations) {
  if (!category) return [];
  const issues = [];
  for (const required of category.roles || []) {
    const named = namedRoles.find((role) => role.id === required.namedRoleId);
    const roleId = setupRoleId(named, guildId, destinations);
    if (!roleId) issues.push(`${required.name} needs a Discord role on this server.`);
  }
  return issues;
}

function categoryNameList(categories, ids) {
  const names = (ids || [])
    .map((id) => categories.find((item) => String(item.id) === String(id))?.name)
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "the selected categories";
}

function categoryNames(db, communityId, ids) {
  if (!ids.length) return "";
  return categoryNameList(db.listCategories(communityId), ids);
}

function sendHtml(res, status, html) {
  res.status(status).set("Cache-Control", "no-store").type("html").send(html);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function report(error) {
  console.error(`[guildlink] ${error.message}`);
}

async function finishSync(req, tasks) {
  const pending = tasks.filter(Boolean);
  if (pending.length === 0) return;
  if (!req.app.get("betaOpenPanel")) {
    for (const task of pending) Promise.resolve(task).catch(report);
    return;
  }
  const results = await Promise.allSettled(pending);
  for (const result of results) {
    if (result.status === "rejected") report(result.reason);
  }
}

async function refreshServers(client) {
  if (!client?.betaRefresh) return;
  if (typeof client.guilds?.fetch === "function") {
    try {
      await client.guilds.fetch();
    } catch (error) {
      console.error(`[guildlink] could not refresh servers: ${error.message}`);
    }
  }
  for (const guild of client.guilds?.cache?.values?.() || []) {
    if (typeof guild.roles?.fetch !== "function") continue;
    try {
      await guild.roles.fetch();
    } catch (error) {
      console.error(`[guildlink] could not refresh roles on ${guild.name}: ${error.message}`);
    }
  }
}
