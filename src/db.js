import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const MAX_NAME = 80;
const MAX_DETAIL = 500;

export function openDatabase(filePath) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite);
  return createApi(sqlite);
}

function migrate(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS communities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      master_guild_id TEXT NOT NULL UNIQUE,
      role_sync_enabled INTEGER NOT NULL DEFAULT 1,
      ban_sync_enabled INTEGER NOT NULL DEFAULT 1,
      appeals_guild_id TEXT,
      appeal_unban_enabled INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS linked_guilds (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL UNIQUE,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS source_roles (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_links (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      master_role_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      target_role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, master_role_id, guild_id, target_role_id)
    );

    CREATE TABLE IF NOT EXISTS synced_bans (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      guild_id TEXT,
      user_id TEXT,
      actor_id TEXT,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_community ON sync_log(community_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_role_links_guild ON role_links(community_id, guild_id);

    CREATE TABLE IF NOT EXISTS role_parents (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      master_role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id, role_id, master_role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_role_parents_guild ON role_parents(community_id, guild_id);

    CREATE TABLE IF NOT EXISTS parent_grants (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      master_role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, user_id, master_role_id)
    );

    CREATE TABLE IF NOT EXISTS appeal_unban_roles (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS linked_sync_roles (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS linked_sync_grants (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      source_guild_id TEXT NOT NULL,
      source_role_id TEXT NOT NULL,
      target_guild_id TEXT NOT NULL,
      target_role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_linked_sync_grants_source
      ON linked_sync_grants(community_id, source_guild_id);

    CREATE TABLE IF NOT EXISTS sync_grant_applied (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, user_id, guild_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name
      ON categories(community_id, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS category_roles (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_role_permissions (
      category_role_id INTEGER NOT NULL REFERENCES category_roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY (category_role_id, permission)
    );

    CREATE TABLE IF NOT EXISTS guild_category_roles (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      category_role_id INTEGER NOT NULL REFERENCES category_roles(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id, category_role_id)
    );

    CREATE TABLE IF NOT EXISTS source_role_categories (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (community_id, role_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS named_roles (
      id INTEGER PRIMARY KEY,
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_guild_id TEXT,
      parent_role_id TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_named_roles_name
      ON named_roles(community_id, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS named_role_destinations (
      named_role_id INTEGER NOT NULL REFERENCES named_roles(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (named_role_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS guild_extra_roles (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      named_role_id INTEGER NOT NULL REFERENCES named_roles(id) ON DELETE CASCADE,
      PRIMARY KEY (community_id, guild_id, named_role_id)
    );

    CREATE TABLE IF NOT EXISTS named_role_categories (
      named_role_id INTEGER NOT NULL REFERENCES named_roles(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (named_role_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS category_required_roles (
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      named_role_id INTEGER NOT NULL REFERENCES named_roles(id) ON DELETE CASCADE,
      PRIMARY KEY (category_id, named_role_id)
    );

    CREATE TABLE IF NOT EXISTS category_required_permissions (
      category_id INTEGER NOT NULL,
      named_role_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (category_id, named_role_id, permission),
      FOREIGN KEY (category_id, named_role_id)
        REFERENCES category_required_roles(category_id, named_role_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS named_role_grants (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      named_role_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (community_id, named_role_id, user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS permission_grants (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (community_id, guild_id, role_id, permission)
    );
  `);
  ensureColumn(sqlite, "communities", "appeals_guild_id", "TEXT");
  ensureColumn(sqlite, "communities", "appeal_unban_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "communities", "audit_guild_id", "TEXT");
  ensureColumn(sqlite, "communities", "audit_channel_id", "TEXT");
  ensureColumn(sqlite, "linked_guilds", "category_id", "INTEGER REFERENCES categories(id) ON DELETE SET NULL");
  sqlite.exec(`

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL,
      csrf TEXT NOT NULL,
      flash TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureColumn(sqlite, table, column, type) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function createApi(sqlite) {
  const insertCommunity = sqlite.prepare(`
    INSERT INTO communities (name, master_guild_id, role_sync_enabled, ban_sync_enabled, created_by, created_at)
    VALUES (@name, @masterGuildId, 1, 1, @createdBy, @createdAt)
  `);
  const selectCommunity = sqlite.prepare(`SELECT * FROM communities WHERE id = ?`);
  const selectByMaster = sqlite.prepare(`SELECT * FROM communities WHERE master_guild_id = ?`);
  const selectByLinked = sqlite.prepare(`
    SELECT c.* FROM communities c
    JOIN linked_guilds g ON g.community_id = c.id
    WHERE g.guild_id = ?
  `);
  const selectAll = sqlite.prepare(`SELECT * FROM communities ORDER BY name COLLATE NOCASE`);
  const selectInstall = sqlite.prepare(`SELECT * FROM communities ORDER BY id LIMIT 1`);
  const updateCommunity = sqlite.prepare(`
    UPDATE communities
    SET name = @name, role_sync_enabled = @roleSyncEnabled, ban_sync_enabled = @banSyncEnabled
    WHERE id = @id
  `);
  const deleteCommunityStmt = sqlite.prepare(`DELETE FROM communities WHERE id = ?`);
  const setAppealsGuildStmt = sqlite.prepare(
    `UPDATE communities SET appeals_guild_id = ?, appeal_unban_enabled = ? WHERE id = ?`
  );
  const selectAppealUnbanRoles = sqlite.prepare(
    `SELECT role_id FROM appeal_unban_roles WHERE community_id = ? ORDER BY role_id`
  );
  const deleteAppealUnbanRoles = sqlite.prepare(`DELETE FROM appeal_unban_roles WHERE community_id = ?`);
  const insertAppealUnbanRole = sqlite.prepare(
    `INSERT OR IGNORE INTO appeal_unban_roles (community_id, role_id) VALUES (?, ?)`
  );
  const setAuditChannelStmt = sqlite.prepare(
    `UPDATE communities SET audit_guild_id = ?, audit_channel_id = ? WHERE id = ?`
  );
  const logListeners = [];
  const clearAppeals = sqlite.prepare(
    `UPDATE communities SET appeals_guild_id = NULL WHERE id = ? AND appeals_guild_id = ?`
  );

  const insertLinked = sqlite.prepare(`
    INSERT INTO linked_guilds (community_id, guild_id, added_by, added_at)
    VALUES (?, ?, ?, ?)
  `);
  const deleteLinked = sqlite.prepare(`DELETE FROM linked_guilds WHERE community_id = ? AND guild_id = ?`);
  const selectLinked = sqlite.prepare(`SELECT guild_id FROM linked_guilds WHERE community_id = ? ORDER BY added_at, guild_id`);
  const claimed = sqlite.prepare(`
    SELECT 1 AS ok FROM communities WHERE master_guild_id = ?
    UNION ALL
    SELECT 1 FROM linked_guilds WHERE guild_id = ?
    LIMIT 1
  `);

  const insertSource = sqlite.prepare(`INSERT OR IGNORE INTO source_roles (community_id, role_id) VALUES (?, ?)`);
  const deleteSource = sqlite.prepare(`DELETE FROM source_roles WHERE community_id = ? AND role_id = ?`);
  const selectSources = sqlite.prepare(`SELECT role_id FROM source_roles WHERE community_id = ? ORDER BY role_id`);
  const deleteLinksForSource = sqlite.prepare(`DELETE FROM role_links WHERE community_id = ? AND master_role_id = ?`);
  const deleteParentsForSource = sqlite.prepare(`DELETE FROM role_parents WHERE community_id = ? AND master_role_id = ?`);

  const selectLinks = sqlite.prepare(`
    SELECT master_role_id, guild_id, target_role_id
    FROM role_links
    WHERE community_id = ?
    ORDER BY guild_id, master_role_id, target_role_id
  `);
  const selectLinksForGuild = sqlite.prepare(`
    SELECT master_role_id, guild_id, target_role_id
    FROM role_links
    WHERE community_id = ? AND guild_id = ?
  `);
  const deleteLinksForGuild = sqlite.prepare(`DELETE FROM role_links WHERE community_id = ? AND guild_id = ?`);
  const deleteParentsForGuild = sqlite.prepare(`DELETE FROM role_parents WHERE community_id = ? AND guild_id = ?`);
  const selectSyncSources = sqlite.prepare(`
    SELECT guild_id, role_id FROM linked_sync_roles
    WHERE community_id = ?
    ORDER BY guild_id, role_id
  `);
  const selectSyncSourcesForGuild = sqlite.prepare(`
    SELECT guild_id, role_id FROM linked_sync_roles
    WHERE community_id = ? AND guild_id = ?
    ORDER BY role_id
  `);
  const insertSyncSource = sqlite.prepare(`
    INSERT INTO linked_sync_roles (community_id, guild_id, role_id) VALUES (?, ?, ?)
  `);
  const deleteSyncSource = sqlite.prepare(`
    DELETE FROM linked_sync_roles WHERE community_id = ? AND guild_id = ? AND role_id = ?
  `);
  const deleteSyncSourcesForGuild = sqlite.prepare(`
    DELETE FROM linked_sync_roles WHERE community_id = ? AND guild_id = ?
  `);
  const selectSyncGrants = sqlite.prepare(`
    SELECT source_guild_id, source_role_id, target_guild_id, target_role_id
    FROM linked_sync_grants
    WHERE community_id = ?
    ORDER BY source_guild_id, source_role_id, target_guild_id, target_role_id
  `);
  const selectSyncGrantsForSource = sqlite.prepare(`
    SELECT source_guild_id, source_role_id, target_guild_id, target_role_id
    FROM linked_sync_grants
    WHERE community_id = ? AND source_guild_id = ?
  `);
  const deleteSyncGrantsForTarget = sqlite.prepare(`
    DELETE FROM linked_sync_grants
    WHERE community_id = ? AND source_guild_id = ? AND target_guild_id = ?
  `);
  const deleteSyncGrantsForSourceGuild = sqlite.prepare(`
    DELETE FROM linked_sync_grants WHERE community_id = ? AND source_guild_id = ?
  `);
  const deleteSyncGrantsForTargetGuild = sqlite.prepare(`
    DELETE FROM linked_sync_grants WHERE community_id = ? AND target_guild_id = ?
  `);
  const deleteSyncGrantsForRole = sqlite.prepare(`
    DELETE FROM linked_sync_grants
    WHERE community_id = ? AND source_guild_id = ? AND source_role_id = ?
  `);
  const insertSyncGrant = sqlite.prepare(`
    INSERT OR IGNORE INTO linked_sync_grants (
      community_id, source_guild_id, source_role_id, target_guild_id, target_role_id
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const selectApplied = sqlite.prepare(`
    SELECT guild_id, role_id FROM sync_grant_applied WHERE community_id = ? AND user_id = ?
  `);
  const selectAllApplied = sqlite.prepare(`
    SELECT user_id, guild_id, role_id FROM sync_grant_applied WHERE community_id = ?
  `);
  const insertApplied = sqlite.prepare(`
    INSERT OR IGNORE INTO sync_grant_applied (community_id, user_id, guild_id, role_id) VALUES (?, ?, ?, ?)
  `);
  const deleteApplied = sqlite.prepare(`
    DELETE FROM sync_grant_applied WHERE community_id = ? AND user_id = ? AND guild_id = ? AND role_id = ?
  `);
  const deleteAppliedForGuild = sqlite.prepare(`
    DELETE FROM sync_grant_applied WHERE community_id = ? AND guild_id = ?
  `);
  const selectParents = sqlite.prepare(`
    SELECT guild_id, role_id, master_role_id
    FROM role_parents
    WHERE community_id = ?
    ORDER BY guild_id, master_role_id, role_id
  `);
  const selectParentsForGuild = sqlite.prepare(`
    SELECT guild_id, role_id, master_role_id
    FROM role_parents
    WHERE community_id = ? AND guild_id = ?
  `);
  const insertParent = sqlite.prepare(`
    INSERT OR IGNORE INTO role_parents (community_id, guild_id, role_id, master_role_id)
    VALUES (?, ?, ?, ?)
  `);
  const selectGrantsForUser = sqlite.prepare(`
    SELECT master_role_id FROM parent_grants WHERE community_id = ? AND user_id = ?
  `);
  const selectAllGrants = sqlite.prepare(`
    SELECT user_id, master_role_id FROM parent_grants WHERE community_id = ?
  `);
  const insertGrant = sqlite.prepare(`
    INSERT OR IGNORE INTO parent_grants (community_id, user_id, master_role_id) VALUES (?, ?, ?)
  `);
  const deleteGrant = sqlite.prepare(`
    DELETE FROM parent_grants WHERE community_id = ? AND user_id = ? AND master_role_id = ?
  `);
  const deleteGrantsForRole = sqlite.prepare(`
    DELETE FROM parent_grants WHERE community_id = ? AND master_role_id = ?
  `);
  const insertLink = sqlite.prepare(`
    INSERT OR IGNORE INTO role_links (community_id, master_role_id, guild_id, target_role_id)
    VALUES (?, ?, ?, ?)
  `);

  const selectBan = sqlite.prepare(`
    SELECT * FROM synced_bans WHERE community_id = ? AND guild_id = ? AND user_id = ?
  `);
  const selectBansForUser = sqlite.prepare(`
    SELECT * FROM synced_bans WHERE community_id = ? AND user_id = ?
  `);
  const selectAllBans = sqlite.prepare(`SELECT * FROM synced_bans WHERE community_id = ?`);
  const upsertBan = sqlite.prepare(`
    INSERT INTO synced_bans (community_id, guild_id, user_id, reason, created_at)
    VALUES (@communityId, @guildId, @userId, @reason, @createdAt)
    ON CONFLICT(community_id, guild_id, user_id) DO UPDATE SET reason = excluded.reason
  `);
  const deleteBan = sqlite.prepare(`
    DELETE FROM synced_bans WHERE community_id = ? AND guild_id = ? AND user_id = ?
  `);
  const deleteBansForGuild = sqlite.prepare(`DELETE FROM synced_bans WHERE community_id = ? AND guild_id = ?`);

  const insertLog = sqlite.prepare(`
    INSERT INTO sync_log (community_id, kind, guild_id, user_id, actor_id, detail, created_at)
    VALUES (@communityId, @kind, @guildId, @userId, @actorId, @detail, @createdAt)
  `);

  const insertSession = sqlite.prepare(`
    INSERT INTO sessions (
      id, user_id, username, global_name, avatar, access_token, refresh_token,
      token_expires_at, csrf, flash, created_at
    ) VALUES (
      @id, @userId, @username, @globalName, @avatar, @accessToken, @refreshToken,
      @tokenExpiresAt, @csrf, NULL, @createdAt
    )
  `);
  const selectSession = sqlite.prepare(`SELECT * FROM sessions WHERE id = ?`);
  const deleteSessionStmt = sqlite.prepare(`DELETE FROM sessions WHERE id = ?`);
  const updateTokens = sqlite.prepare(`
    UPDATE sessions
    SET access_token = @accessToken, refresh_token = @refreshToken, token_expires_at = @tokenExpiresAt
    WHERE id = @id
  `);
  const setFlashStmt = sqlite.prepare(`UPDATE sessions SET flash = ? WHERE id = ?`);
  const clearFlash = sqlite.prepare(`UPDATE sessions SET flash = NULL WHERE id = ?`);

  const replaceGuildLinks = sqlite.transaction((communityId, guildId, links) => {
    deleteLinksForGuild.run(communityId, guildId);
    for (const link of links) {
      insertLink.run(communityId, link.masterRoleId, guildId, link.targetRoleId);
    }
  });

  const replaceGuildParents = sqlite.transaction((communityId, guildId, parents) => {
    deleteParentsForGuild.run(communityId, guildId);
    for (const parent of parents) {
      insertParent.run(communityId, guildId, parent.roleId, parent.masterRoleId);
    }
  });

  const replaceSyncGrants = sqlite.transaction((communityId, sourceGuildId, grants, targetGuildIds) => {
    for (const targetGuildId of targetGuildIds) {
      deleteSyncGrantsForTarget.run(communityId, sourceGuildId, targetGuildId);
    }
    for (const grant of grants) {
      insertSyncGrant.run(
        communityId,
        sourceGuildId,
        grant.sourceRoleId,
        grant.targetGuildId,
        grant.targetRoleId
      );
    }
  });

  const deleteRoleLimits = sqlite.prepare(
    `DELETE FROM source_role_categories WHERE community_id = ? AND role_id = ?`
  );
  const insertRoleLimit = sqlite.prepare(
    `INSERT OR IGNORE INTO source_role_categories (community_id, role_id, category_id) VALUES (?, ?, ?)`
  );
  const selectRoleLimits = sqlite.prepare(
    `SELECT role_id, category_id FROM source_role_categories WHERE community_id = ? ORDER BY role_id, category_id`
  );
  const selectNamedRoles = sqlite.prepare(
    `SELECT id, community_id, name, parent_guild_id, parent_role_id FROM named_roles WHERE community_id = ? ORDER BY name COLLATE NOCASE, id`
  );
  const selectNamedRole = sqlite.prepare(
    `SELECT id, community_id, name, parent_guild_id, parent_role_id FROM named_roles WHERE id = ? AND community_id = ?`
  );
  const insertNamedRole = sqlite.prepare(`INSERT INTO named_roles (community_id, name) VALUES (?, ?)`);
  const updateNamedParent = sqlite.prepare(
    `UPDATE named_roles SET parent_guild_id = ?, parent_role_id = ? WHERE id = ? AND community_id = ?`
  );
  const updateNamedRoleName = sqlite.prepare(`UPDATE named_roles SET name = ? WHERE id = ? AND community_id = ?`);
  const deleteNamedRoleRow = sqlite.prepare(`DELETE FROM named_roles WHERE id = ? AND community_id = ?`);
  const selectDestinations = sqlite.prepare(`
    SELECT d.named_role_id, d.guild_id, d.role_id
    FROM named_role_destinations d
    JOIN named_roles n ON n.id = d.named_role_id
    WHERE n.community_id = ?
    ORDER BY d.guild_id, d.named_role_id
  `);
  const upsertDestination = sqlite.prepare(`
    INSERT INTO named_role_destinations (named_role_id, guild_id, role_id)
    VALUES (?, ?, ?)
    ON CONFLICT(named_role_id, guild_id) DO UPDATE SET role_id = excluded.role_id
  `);
  const deleteDestination = sqlite.prepare(`DELETE FROM named_role_destinations WHERE named_role_id = ? AND guild_id = ?`);
  const deleteDestinationsForGuild = sqlite.prepare(`
    DELETE FROM named_role_destinations
    WHERE guild_id = ? AND named_role_id IN (SELECT id FROM named_roles WHERE community_id = ?)
  `);
  const selectGuildExtras = sqlite.prepare(`
    SELECT guild_id, named_role_id FROM guild_extra_roles WHERE community_id = ? ORDER BY guild_id, named_role_id
  `);
  const insertGuildExtra = sqlite.prepare(`
    INSERT INTO guild_extra_roles (community_id, guild_id, named_role_id) VALUES (?, ?, ?)
  `);
  const deleteGuildExtra = sqlite.prepare(`
    DELETE FROM guild_extra_roles WHERE community_id = ? AND guild_id = ? AND named_role_id = ?
  `);
  const deleteGuildExtrasForGuild = sqlite.prepare(`
    DELETE FROM guild_extra_roles WHERE community_id = ? AND guild_id = ?
  `);
  const selectNamedLimits = sqlite.prepare(`
    SELECT c.named_role_id, c.category_id
    FROM named_role_categories c
    JOIN named_roles n ON n.id = c.named_role_id
    WHERE n.community_id = ?
    ORDER BY c.named_role_id, c.category_id
  `);
  const deleteNamedLimits = sqlite.prepare(`DELETE FROM named_role_categories WHERE named_role_id = ?`);
  const insertNamedLimit = sqlite.prepare(
    `INSERT OR IGNORE INTO named_role_categories (named_role_id, category_id) VALUES (?, ?)`
  );
  const selectRequirements = sqlite.prepare(`
    SELECT r.category_id, r.named_role_id, n.name
    FROM category_required_roles r
    JOIN named_roles n ON n.id = r.named_role_id
    JOIN categories c ON c.id = r.category_id
    WHERE c.community_id = ?
    ORDER BY n.name COLLATE NOCASE, r.named_role_id
  `);
  const selectRequirementsForCategory = sqlite.prepare(
    `SELECT named_role_id FROM category_required_roles WHERE category_id = ? ORDER BY named_role_id`
  );
  const insertRequirement = sqlite.prepare(
    `INSERT INTO category_required_roles (category_id, named_role_id) VALUES (?, ?)`
  );
  const deleteRequirement = sqlite.prepare(
    `DELETE FROM category_required_roles WHERE category_id = ? AND named_role_id = ?`
  );
  const selectRequirementPerms = sqlite.prepare(`
    SELECT p.category_id, p.named_role_id, p.permission
    FROM category_required_permissions p
    JOIN categories c ON c.id = p.category_id
    WHERE c.community_id = ?
    ORDER BY p.permission
  `);
  const deleteRequirementPerms = sqlite.prepare(
    `DELETE FROM category_required_permissions WHERE category_id = ? AND named_role_id = ?`
  );
  const insertRequirementPerm = sqlite.prepare(
    `INSERT OR IGNORE INTO category_required_permissions (category_id, named_role_id, permission) VALUES (?, ?, ?)`
  );
  const selectNamedGrantsForUser = sqlite.prepare(`
    SELECT named_role_id, guild_id, role_id FROM named_role_grants WHERE community_id = ? AND user_id = ?
  `);
  const selectAllNamedGrants = sqlite.prepare(`
    SELECT user_id, named_role_id, guild_id, role_id FROM named_role_grants WHERE community_id = ?
  `);
  const insertNamedGrant = sqlite.prepare(`
    INSERT OR IGNORE INTO named_role_grants (community_id, named_role_id, user_id, guild_id, role_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteNamedGrant = sqlite.prepare(`
    DELETE FROM named_role_grants WHERE community_id = ? AND named_role_id = ? AND user_id = ? AND guild_id = ?
  `);
  const deleteNamedGrantsForGuild = sqlite.prepare(
    `DELETE FROM named_role_grants WHERE community_id = ? AND guild_id = ?`
  );
  const selectPermissionGrants = sqlite.prepare(`
    SELECT role_id, permission FROM permission_grants WHERE community_id = ? AND guild_id = ? ORDER BY permission
  `);
  const deletePermissionGrantsForRole = sqlite.prepare(
    `DELETE FROM permission_grants WHERE community_id = ? AND guild_id = ? AND role_id = ?`
  );
  const deletePermissionGrantsForGuild = sqlite.prepare(
    `DELETE FROM permission_grants WHERE community_id = ? AND guild_id = ?`
  );
  const insertPermissionGrant = sqlite.prepare(
    `INSERT OR IGNORE INTO permission_grants (community_id, guild_id, role_id, permission) VALUES (?, ?, ?, ?)`
  );
  const selectCategories = sqlite.prepare(
    `SELECT id, name FROM categories WHERE community_id = ? ORDER BY name COLLATE NOCASE, id`
  );
  const selectCategory = sqlite.prepare(`SELECT id, community_id, name FROM categories WHERE id = ?`);
  const insertCategory = sqlite.prepare(`INSERT INTO categories (community_id, name) VALUES (?, ?)`);
  const updateCategoryName = sqlite.prepare(`UPDATE categories SET name = ? WHERE id = ? AND community_id = ?`);
  const deleteCategoryById = sqlite.prepare(`DELETE FROM categories WHERE id = ? AND community_id = ?`);
  const clearGuildsForCategory = sqlite.prepare(`UPDATE linked_guilds SET category_id = NULL WHERE category_id = ?`);
  const selectCategoryRoles = sqlite.prepare(`
    SELECT r.id, r.category_id, r.name
    FROM category_roles r
    JOIN categories c ON c.id = r.category_id
    WHERE c.community_id = ?
    ORDER BY r.id
  `);
  const selectRolesForCategory = sqlite.prepare(
    `SELECT id, category_id, name FROM category_roles WHERE category_id = ? ORDER BY id`
  );
  const selectCategoryRole = sqlite.prepare(`
    SELECT r.id, r.category_id, r.name, c.community_id
    FROM category_roles r
    JOIN categories c ON c.id = r.category_id
    WHERE r.id = ?
  `);
  const insertCategoryRole = sqlite.prepare(`INSERT INTO category_roles (category_id, name) VALUES (?, ?)`);
  const deleteCategoryRoleById = sqlite.prepare(`DELETE FROM category_roles WHERE id = ? AND category_id = ?`);
  const selectCategoryPerms = sqlite.prepare(`
    SELECT p.category_role_id, p.permission
    FROM category_role_permissions p
    JOIN category_roles r ON r.id = p.category_role_id
    JOIN categories c ON c.id = r.category_id
    WHERE c.community_id = ?
    ORDER BY p.permission
  `);
  const deleteSlotPerms = sqlite.prepare(`DELETE FROM category_role_permissions WHERE category_role_id = ?`);
  const insertSlotPerm = sqlite.prepare(
    `INSERT OR IGNORE INTO category_role_permissions (category_role_id, permission) VALUES (?, ?)`
  );
  const selectLinkedCategory = sqlite.prepare(
    `SELECT guild_id, category_id FROM linked_guilds WHERE community_id = ? AND guild_id = ?`
  );
  const selectLinkedCategories = sqlite.prepare(
    `SELECT guild_id, category_id FROM linked_guilds WHERE community_id = ? ORDER BY guild_id`
  );
  const updateGuildCategory = sqlite.prepare(
    `UPDATE linked_guilds SET category_id = ? WHERE community_id = ? AND guild_id = ?`
  );
  const deleteGuildSlots = sqlite.prepare(
    `DELETE FROM guild_category_roles WHERE community_id = ? AND guild_id = ?`
  );
  const insertGuildSlot = sqlite.prepare(
    `INSERT INTO guild_category_roles (community_id, guild_id, category_role_id, role_id) VALUES (?, ?, ?, ?)`
  );
  const selectGuildSlots = sqlite.prepare(`
    SELECT community_id, guild_id, category_role_id, role_id
    FROM guild_category_roles
    WHERE community_id = ?
    ORDER BY guild_id, category_role_id
  `);

  const removeSyncSourceTx = sqlite.transaction((communityId, guildId, roleId) => {
    deleteSyncSource.run(communityId, guildId, roleId);
    deleteSyncGrantsForRole.run(communityId, guildId, roleId);
    deleteRoleLimits.run(communityId, roleId);
  });

  const removeSourceRoleTx = sqlite.transaction((communityId, roleId) => {
    deleteSource.run(communityId, roleId);
    deleteLinksForSource.run(communityId, roleId);
    deleteParentsForSource.run(communityId, roleId);
    deleteGrantsForRole.run(communityId, roleId);
    deleteRoleLimits.run(communityId, roleId);
  });

  const replaceAppealUnbanRoles = sqlite.transaction((communityId, roleIds) => {
    deleteAppealUnbanRoles.run(communityId);
    for (const roleId of roleIds) insertAppealUnbanRole.run(communityId, roleId);
  });

  const removeLinkedTx = sqlite.transaction((communityId, guildId) => {
    const cleared = clearAppeals.run(communityId, guildId);
    if (cleared.changes) deleteAppealUnbanRoles.run(communityId);
    deleteLinked.run(communityId, guildId);
    deleteLinksForGuild.run(communityId, guildId);
    deleteParentsForGuild.run(communityId, guildId);
    for (const row of selectSyncSourcesForGuild.all(communityId, guildId)) {
      deleteRoleLimits.run(communityId, row.role_id);
    }
    deleteSyncSourcesForGuild.run(communityId, guildId);
    deleteSyncGrantsForSourceGuild.run(communityId, guildId);
    deleteSyncGrantsForTargetGuild.run(communityId, guildId);
    deleteAppliedForGuild.run(communityId, guildId);
    deleteDestinationsForGuild.run(guildId, communityId);
    deleteGuildExtrasForGuild.run(communityId, guildId);
    deleteNamedGrantsForGuild.run(communityId, guildId);
    deletePermissionGrantsForGuild.run(communityId, guildId);
    deleteBansForGuild.run(communityId, guildId);
    deleteGuildSlots.run(communityId, guildId);
  });

  const replaceRoleCategories = sqlite.transaction((communityId, roleId, categoryIds) => {
    deleteRoleLimits.run(communityId, roleId);
    for (const categoryId of categoryIds) insertRoleLimit.run(communityId, roleId, categoryId);
  });

  const replaceNamedLimits = sqlite.transaction((namedRoleId, categoryIds) => {
    deleteNamedLimits.run(namedRoleId);
    for (const categoryId of categoryIds) insertNamedLimit.run(namedRoleId, categoryId);
  });

  const replaceRequirementPerms = sqlite.transaction((categoryId, namedRoleId, permissions) => {
    deleteRequirementPerms.run(categoryId, namedRoleId);
    for (const permission of permissions) insertRequirementPerm.run(categoryId, namedRoleId, permission);
  });

  const replaceCategoryRequirements = sqlite.transaction((categoryId, namedRoleIds) => {
    const current = selectRequirementsForCategory.all(categoryId).map((row) => row.named_role_id);
    const next = new Set(namedRoleIds);
    for (const id of current) {
      if (!next.has(id)) deleteRequirement.run(categoryId, id);
    }
    for (const id of namedRoleIds) {
      if (!current.includes(id)) insertRequirement.run(categoryId, id);
    }
  });

  const replacePermissionGrantRows = sqlite.transaction((communityId, guildId, roleId, permissions) => {
    deletePermissionGrantsForRole.run(communityId, guildId, roleId);
    for (const permission of permissions) insertPermissionGrant.run(communityId, guildId, roleId, permission);
  });

  const replaceSlotPerms = sqlite.transaction((categoryRoleId, permissions) => {
    deleteSlotPerms.run(categoryRoleId);
    for (const permission of permissions) insertSlotPerm.run(categoryRoleId, permission);
  });

  const replaceGuildSlots = sqlite.transaction((communityId, guildId, links) => {
    deleteGuildSlots.run(communityId, guildId);
    for (const link of links) {
      insertGuildSlot.run(communityId, guildId, link.categoryRoleId, link.roleId);
    }
  });

  const deleteCategoryTx = sqlite.transaction((communityId, categoryId) => {
    clearGuildsForCategory.run(categoryId);
    return deleteCategoryById.run(categoryId, communityId);
  });

  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      masterGuildId: row.master_guild_id,
      roleSyncEnabled: row.role_sync_enabled === 1,
      banSyncEnabled: row.ban_sync_enabled === 1,
      appealsGuildId: row.appeals_guild_id || null,
      appealUnbanEnabled: row.appeal_unban_enabled === 1,
      auditGuildId: row.audit_guild_id || null,
      auditChannelId: row.audit_channel_id || null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      linkedGuildIds: selectLinked.all(row.id).map((item) => item.guild_id),
    };
  }

  function mapLink(row) {
    return {
      masterRoleId: row.master_role_id,
      guildId: row.guild_id,
      targetRoleId: row.target_role_id,
    };
  }

  return {
    sqlite,
    close() {
      sqlite.close();
    },
    createCommunity({ name, masterGuildId, createdBy }) {
      const cleanName = cleanCommunityName(name);
      if (!cleanName) throw new Error("Enter a community name.");
      if (selectAll.all().length > 0) {
        throw new Error("This GuildLink already has a community.");
      }
      if (this.guildIsClaimed(masterGuildId)) {
        throw new Error("That server is already part of a community.");
      }
      try {
        const result = insertCommunity.run({
          name: cleanName,
          masterGuildId,
          createdBy,
          createdAt: now(),
        });
        return this.getCommunity(Number(result.lastInsertRowid));
      } catch (error) {
        if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
          throw new Error("That server is already part of a community.");
        }
        throw error;
      }
    },
    getCommunity(id) {
      return hydrate(selectCommunity.get(id));
    },
    listCommunities() {
      return selectAll.all().map(hydrate);
    },
    getInstallCommunity() {
      return hydrate(selectInstall.get());
    },
    findCommunityByGuild(guildId) {
      return hydrate(selectByMaster.get(guildId) || selectByLinked.get(guildId));
    },
    guildIsClaimed(guildId) {
      return Boolean(claimed.get(guildId, guildId));
    },
    updateCommunity(id, { name, roleSyncEnabled, banSyncEnabled }) {
      const cleanName = cleanCommunityName(name);
      if (!cleanName) throw new Error("Enter a community name.");
      updateCommunity.run({
        id,
        name: cleanName,
        roleSyncEnabled: roleSyncEnabled ? 1 : 0,
        banSyncEnabled: banSyncEnabled ? 1 : 0,
      });
      return this.getCommunity(id);
    },
    setAppealsGuild(communityId, guildId, appealUnbanEnabled = false) {
      const community = this.getCommunity(communityId);
      if (!community) throw new Error("That community was not found.");
      if (guildId && !community.linkedGuildIds.includes(guildId)) {
        throw new Error("Choose a linked server for ban appeals.");
      }
      const nextGuildId = guildId || null;
      setAppealsGuildStmt.run(nextGuildId, nextGuildId && appealUnbanEnabled ? 1 : 0, communityId);
      if ((community.appealsGuildId || null) !== nextGuildId) deleteAppealUnbanRoles.run(communityId);
      return this.getCommunity(communityId);
    },
    listAppealUnbanRoles(communityId) {
      return selectAppealUnbanRoles.all(communityId).map((row) => row.role_id);
    },
    setAppealUnbanRoles(communityId, roleIds) {
      if (roleIds.length > 50) throw new Error("Too many roles are allowed to unban.");
      replaceAppealUnbanRoles(communityId, roleIds);
    },
    listCategories(communityId) {
      const permsByRequirement = new Map();
      for (const row of selectRequirementPerms.all(communityId)) {
        const key = `${row.category_id}:${row.named_role_id}`;
        if (!permsByRequirement.has(key)) permsByRequirement.set(key, []);
        permsByRequirement.get(key).push(row.permission);
      }
      const rolesByCategory = new Map();
      for (const row of selectRequirements.all(communityId)) {
        if (!rolesByCategory.has(row.category_id)) rolesByCategory.set(row.category_id, []);
        rolesByCategory.get(row.category_id).push({
          namedRoleId: row.named_role_id,
          name: row.name,
          permissions: permsByRequirement.get(`${row.category_id}:${row.named_role_id}`) || [],
        });
      }
      return selectCategories.all(communityId).map((row) => ({
        id: row.id,
        name: row.name,
        roles: rolesByCategory.get(row.id) || [],
      }));
    },
    createCategory(communityId, name) {
      const clean = cleanCommunityName(name);
      if (!clean) throw new Error("Enter a category name.");
      const existing = selectCategories.all(communityId);
      if (existing.length >= 30) throw new Error("This community already has 30 categories.");
      if (existing.some((row) => row.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
        throw new Error("A category with that name already exists.");
      }
      const result = insertCategory.run(communityId, clean);
      return Number(result.lastInsertRowid);
    },
    renameCategory(communityId, categoryId, name) {
      const clean = cleanCommunityName(name);
      if (!clean) throw new Error("Enter a category name.");
      const current = selectCategory.get(categoryId);
      if (!current || current.community_id !== communityId) throw new Error("That category was not found.");
      const existing = selectCategories.all(communityId);
      if (existing.some((row) => row.id !== current.id && row.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
        throw new Error("A category with that name already exists.");
      }
      updateCategoryName.run(clean, categoryId, communityId);
    },
    deleteCategory(communityId, categoryId) {
      const current = selectCategory.get(categoryId);
      if (!current || current.community_id !== communityId) throw new Error("That category was not found.");
      deleteCategoryTx(communityId, categoryId);
    },
    addCategoryRole(communityId, categoryId, name) {
      const category = selectCategory.get(categoryId);
      if (!category || category.community_id !== communityId) throw new Error("That category was not found.");
      const clean = cleanCommunityName(name);
      if (!clean) throw new Error("Enter a role name.");
      const roles = selectRolesForCategory.all(categoryId);
      if (roles.length >= 30) throw new Error("This category already has 30 required roles.");
      if (roles.some((row) => row.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
        throw new Error("That category already has a role with this name.");
      }
      const result = insertCategoryRole.run(categoryId, clean);
      return Number(result.lastInsertRowid);
    },
    removeCategoryRole(communityId, categoryId, categoryRoleId) {
      const role = selectCategoryRole.get(categoryRoleId);
      if (!role || role.community_id !== communityId || role.category_id !== categoryId) {
        throw new Error("That required role was not found.");
      }
      deleteCategoryRoleById.run(categoryRoleId, categoryId);
    },
    setCategoryRolePermissions(communityId, categoryRoleId, permissions) {
      const role = selectCategoryRole.get(categoryRoleId);
      if (!role || role.community_id !== communityId) throw new Error("That required role was not found.");
      const unique = [];
      const seen = new Set();
      for (const permission of permissions) {
        const name = String(permission);
        if (seen.has(name)) continue;
        seen.add(name);
        unique.push(name);
      }
      replaceSlotPerms(categoryRoleId, unique);
    },
    listGuildCategories(communityId) {
      return selectLinkedCategories.all(communityId).map((row) => ({
        guildId: row.guild_id,
        categoryId: row.category_id == null ? null : Number(row.category_id),
      }));
    },
    setGuildCategory(communityId, guildId, categoryId) {
      const community = this.getCommunity(communityId);
      if (!community) throw new Error("That community was not found.");
      if (!community.linkedGuildIds.includes(guildId)) throw new Error("That server is not linked.");
      const next = categoryId == null || categoryId === "" ? null : Number(categoryId);
      if (next != null) {
        const category = selectCategory.get(next);
        if (!category || category.community_id !== communityId) throw new Error("Choose a category from this community.");
      }
      const current = selectLinkedCategory.get(communityId, guildId);
      const previous = current?.category_id == null ? null : Number(current.category_id);
      updateGuildCategory.run(next, communityId, guildId);
      if (previous !== next) deleteGuildSlots.run(communityId, guildId);
    },
    listGuildCategoryRoles(communityId) {
      return selectGuildSlots.all(communityId).map((row) => ({
        guildId: row.guild_id,
        categoryRoleId: row.category_role_id,
        roleId: row.role_id,
      }));
    },
    setGuildCategoryRoles(communityId, guildId, links) {
      const current = selectLinkedCategory.get(communityId, guildId);
      const categoryId = current?.category_id == null ? null : Number(current.category_id);
      if (categoryId == null) {
        if (links.length > 0) throw new Error("Assign a category before linking its required roles.");
        deleteGuildSlots.run(communityId, guildId);
        return;
      }
      const slots = new Set(selectRolesForCategory.all(categoryId).map((row) => row.id));
      const unique = [];
      const seen = new Set();
      for (const link of links) {
        const categoryRoleId = Number(link.categoryRoleId);
        if (!slots.has(categoryRoleId) || seen.has(categoryRoleId)) continue;
        seen.add(categoryRoleId);
        unique.push({ categoryRoleId, roleId: String(link.roleId) });
      }
      replaceGuildSlots(communityId, guildId, unique);
    },
    listRoleCategoryLimits(communityId) {
      return selectRoleLimits.all(communityId).map((row) => ({
        roleId: row.role_id,
        categoryId: Number(row.category_id),
      }));
    },
    listNamedRoles(communityId) {
      return selectNamedRoles.all(communityId).map(mapNamedRole);
    },
    getNamedRole(communityId, namedRoleId) {
      return mapNamedRole(selectNamedRole.get(namedRoleId, communityId));
    },
    createNamedRole(communityId, name) {
      const raw = String(name ?? "").replace(/\s+/g, " ").trim();
      if (raw.length > MAX_NAME) throw new Error("Enter a role name up to 80 characters.");
      const clean = cleanCommunityName(name);
      if (!clean) throw new Error("Enter a role name.");
      const existing = selectNamedRoles.all(communityId);
      if (existing.length >= 50) throw new Error("This community already has 50 roles.");
      const match = existing.find((row) => row.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
      if (match) throw new Error(`A role named ${match.name} already exists.`);
      try {
        const result = insertNamedRole.run(communityId, clean);
        return this.getNamedRole(communityId, Number(result.lastInsertRowid));
      } catch (error) {
        if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
          throw new Error(`A role named ${clean} already exists.`);
        }
        throw error;
      }
    },
    renameNamedRole(communityId, namedRoleId, name) {
      const raw = String(name ?? "").replace(/\s+/g, " ").trim();
      if (raw.length > MAX_NAME) throw new Error("Enter a role name up to 80 characters.");
      const clean = cleanCommunityName(name);
      if (!clean) throw new Error("Enter a role name.");
      const current = selectNamedRole.get(namedRoleId, communityId);
      if (!current) throw new Error("That role was not found.");
      const match = selectNamedRoles
        .all(communityId)
        .find((row) => row.id !== current.id && row.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
      if (match) throw new Error(`A role named ${match.name} already exists.`);
      try {
        updateNamedRoleName.run(clean, namedRoleId, communityId);
      } catch (error) {
        if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
          throw new Error(`A role named ${clean} already exists.`);
        }
        throw error;
      }
      return this.getNamedRole(communityId, namedRoleId);
    },
    deleteNamedRole(communityId, namedRoleId) {
      const current = selectNamedRole.get(namedRoleId, communityId);
      if (!current) throw new Error("That role was not found.");
      deleteNamedRoleRow.run(namedRoleId, communityId);
    },
    setNamedRoleParent(communityId, namedRoleId, guildId, roleId) {
      const current = selectNamedRole.get(namedRoleId, communityId);
      if (!current) throw new Error("That role was not found.");
      const community = this.getCommunity(communityId);
      const allowed = new Set([community.masterGuildId, ...community.linkedGuildIds]);
      if (!allowed.has(String(guildId))) throw new Error("Choose a server in this community.");
      if (!roleId) throw new Error("Choose a Discord role on that server.");
      updateNamedParent.run(String(guildId), String(roleId), namedRoleId, communityId);
      deleteDestination.run(namedRoleId, String(guildId));
      return this.getNamedRole(communityId, namedRoleId);
    },
    listNamedRoleDestinations(communityId) {
      return selectDestinations.all(communityId).map((row) => ({
        namedRoleId: row.named_role_id,
        guildId: row.guild_id,
        roleId: row.role_id,
      }));
    },
    listGuildExtraRoles(communityId) {
      return selectGuildExtras.all(communityId).map((row) => ({
        guildId: row.guild_id,
        namedRoleId: row.named_role_id,
      }));
    },
    addGuildExtraRole(communityId, guildId, namedRoleId) {
      const named = selectNamedRole.get(namedRoleId, communityId);
      if (!named) throw new Error("Choose a GuildLink role.");
      const community = this.getCommunity(communityId);
      const allowed = new Set([community.masterGuildId, ...community.linkedGuildIds]);
      if (!allowed.has(String(guildId))) throw new Error("Choose a server in this community.");
      if (named.parent_guild_id === String(guildId)) throw new Error(`${named.name} comes from this server.`);
      const existing = selectGuildExtras.all(communityId);
      if (existing.some((row) => row.guild_id === String(guildId) && row.named_role_id === named.id)) {
        throw new Error(`${named.name} is already on this server.`);
      }
      insertGuildExtra.run(communityId, String(guildId), named.id);
    },
    removeGuildExtraRole(communityId, guildId, namedRoleId) {
      deleteGuildExtra.run(communityId, String(guildId), namedRoleId);
      deleteDestination.run(namedRoleId, String(guildId));
    },
    setNamedRoleDestination(communityId, namedRoleId, guildId, roleId) {
      const current = selectNamedRole.get(namedRoleId, communityId);
      if (!current) throw new Error("That role was not found.");
      const community = this.getCommunity(communityId);
      const allowed = new Set([community.masterGuildId, ...community.linkedGuildIds]);
      if (!allowed.has(String(guildId))) throw new Error("Choose a server in this community.");
      if (current.parent_guild_id === String(guildId)) {
        throw new Error(`${current.name} comes from this server.`);
      }
      if (!roleId) {
        deleteDestination.run(namedRoleId, String(guildId));
        return;
      }
      upsertDestination.run(namedRoleId, String(guildId), String(roleId));
    },
    listNamedRoleCategoryLimits(communityId) {
      return selectNamedLimits.all(communityId).map((row) => ({
        namedRoleId: row.named_role_id,
        categoryId: Number(row.category_id),
      }));
    },
    setNamedRoleCategoryLimit(communityId, namedRoleId, categoryIds) {
      const current = selectNamedRole.get(namedRoleId, communityId);
      if (!current) throw new Error("That role was not found.");
      const known = new Set(selectCategories.all(communityId).map((row) => row.id));
      const unique = [];
      const seen = new Set();
      for (const categoryId of categoryIds) {
        const id = Number(categoryId);
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      if (categoryIds.length > 0 && unique.length === 0) {
        throw new Error("Choose a category from this community.");
      }
      replaceNamedLimits(namedRoleId, unique);
    },
    addCategoryRequirement(communityId, categoryId, namedRoleId) {
      const category = selectCategory.get(categoryId);
      if (!category || category.community_id !== communityId) throw new Error("That category was not found.");
      const named = selectNamedRole.get(namedRoleId, communityId);
      if (!named) throw new Error("Choose a GuildLink role.");
      const current = selectRequirementsForCategory.all(categoryId);
      if (current.some((row) => row.named_role_id === namedRoleId)) {
        throw new Error(`${named.name} is already required in this category.`);
      }
      if (current.length >= 30) throw new Error("This category already has 30 required roles.");
      insertRequirement.run(categoryId, namedRoleId);
    },
    setCategoryRequirements(communityId, categoryId, namedRoleIds) {
      const category = selectCategory.get(categoryId);
      if (!category || category.community_id !== communityId) throw new Error("That category was not found.");
      const known = new Map(selectNamedRoles.all(communityId).map((row) => [row.id, row]));
      const unique = [];
      const seen = new Set();
      for (const namedRoleId of namedRoleIds) {
        const id = Number(namedRoleId);
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      if (namedRoleIds.length > 0 && unique.length === 0) throw new Error("Choose a GuildLink role.");
      if (unique.length > 30) throw new Error("A category can require up to 30 GuildLink roles.");
      replaceCategoryRequirements(categoryId, unique);
    },
    removeCategoryRequirement(communityId, categoryId, namedRoleId) {
      const category = selectCategory.get(categoryId);
      if (!category || category.community_id !== communityId) throw new Error("That category was not found.");
      deleteRequirement.run(categoryId, namedRoleId);
    },
    setCategoryRequirementPermissions(communityId, categoryId, namedRoleId, permissions) {
      const category = selectCategory.get(categoryId);
      if (!category || category.community_id !== communityId) throw new Error("That category was not found.");
      const required = selectRequirementsForCategory.all(categoryId);
      if (!required.some((row) => row.named_role_id === namedRoleId)) {
        throw new Error("That required role was not found.");
      }
      const unique = [];
      const seen = new Set();
      for (const permission of permissions) {
        const name = String(permission);
        if (seen.has(name)) continue;
        seen.add(name);
        unique.push(name);
      }
      replaceRequirementPerms(categoryId, namedRoleId, unique);
    },
    listNamedRoleGrants(communityId, userId) {
      return selectNamedGrantsForUser.all(communityId, userId).map((row) => ({
        namedRoleId: row.named_role_id,
        guildId: row.guild_id,
        roleId: row.role_id,
      }));
    },
    namedRoleGrantsByUser(communityId) {
      const map = new Map();
      for (const row of selectAllNamedGrants.all(communityId)) {
        if (!map.has(row.user_id)) map.set(row.user_id, []);
        map.get(row.user_id).push({
          namedRoleId: row.named_role_id,
          guildId: row.guild_id,
          roleId: row.role_id,
        });
      }
      return map;
    },
    rememberNamedRoleGrant(communityId, namedRoleId, userId, guildId, roleId) {
      insertNamedGrant.run(communityId, namedRoleId, userId, guildId, roleId);
    },
    forgetNamedRoleGrant(communityId, namedRoleId, userId, guildId) {
      deleteNamedGrant.run(communityId, namedRoleId, userId, guildId);
    },
    listPermissionGrants(communityId, guildId) {
      const map = new Map();
      for (const row of selectPermissionGrants.all(communityId, guildId)) {
        if (!map.has(row.role_id)) map.set(row.role_id, []);
        map.get(row.role_id).push(row.permission);
      }
      return map;
    },
    setPermissionGrants(communityId, guildId, roleId, permissions) {
      replacePermissionGrantRows(communityId, guildId, roleId, permissions);
    },
    setRoleCategoryLimit(communityId, roleId, categoryIds) {
      const known = new Set(selectCategories.all(communityId).map((row) => row.id));
      const unique = [];
      const seen = new Set();
      for (const categoryId of categoryIds) {
        const id = Number(categoryId);
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      if (categoryIds.length > 0 && unique.length === 0) {
        throw new Error("Choose a category from this community.");
      }
      replaceRoleCategories(communityId, roleId, unique);
    },
    deleteCommunity(id) {
      deleteCommunityStmt.run(id);
    },
    addLinkedGuild({ communityId, guildId, addedBy, masterGuildId }) {
      if (guildId === masterGuildId) throw new Error("The main server is already in the community.");
      if (this.guildIsClaimed(guildId)) throw new Error("That server is already part of a community.");
      try {
        insertLinked.run(communityId, guildId, addedBy, now());
      } catch (error) {
        if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
          throw new Error("That server is already part of a community.");
        }
        throw error;
      }
    },
    removeLinkedGuild(communityId, guildId) {
      const community = this.getCommunity(communityId);
      removeLinkedTx(communityId, guildId);
      if (community?.auditGuildId === String(guildId)) setAuditChannelStmt.run(null, null, communityId);
    },
    addSourceRole(communityId, roleId) {
      const count = selectSources.all(communityId).length;
      if (count >= 50) throw new Error("This community already tracks 50 main-server roles.");
      insertSource.run(communityId, roleId);
    },
    removeSourceRole(communityId, roleId) {
      removeSourceRoleTx(communityId, roleId);
    },
    listSourceRoles(communityId) {
      return selectSources.all(communityId).map((row) => row.role_id);
    },
    listLinks(communityId, guildId = null) {
      const rows = guildId ? selectLinksForGuild.all(communityId, guildId) : selectLinks.all(communityId);
      return rows.map(mapLink);
    },
    setGuildLinks(communityId, guildId, links) {
      if (links.length > 200) throw new Error("That server has too many role mappings.");
      replaceGuildLinks(communityId, guildId, links);
    },
    listParents(communityId, guildId = null) {
      const rows = guildId ? selectParentsForGuild.all(communityId, guildId) : selectParents.all(communityId);
      return rows.map((row) => ({
        guildId: row.guild_id,
        roleId: row.role_id,
        masterRoleId: row.master_role_id,
      }));
    },
    setGuildParents(communityId, guildId, parents) {
      if (parents.length > 200) throw new Error("That server has too many parent roles.");
      replaceGuildParents(communityId, guildId, parents);
    },
    listSyncSources(communityId, guildId = null) {
      const rows = guildId
        ? selectSyncSourcesForGuild.all(communityId, guildId)
        : selectSyncSources.all(communityId);
      return rows.map((row) => ({ guildId: row.guild_id, roleId: row.role_id }));
    },
    addSyncSource(communityId, guildId, roleId) {
      const existing = selectSyncSourcesForGuild.all(communityId, guildId);
      if (existing.some((row) => row.role_id === roleId)) {
        throw new Error("That role is already set to sync.");
      }
      if (existing.length >= 50) throw new Error("This server already syncs 50 roles.");
      insertSyncSource.run(communityId, guildId, roleId);
    },
    removeSyncSource(communityId, guildId, roleId) {
      removeSyncSourceTx(communityId, guildId, roleId);
    },
    listSyncGrants(communityId, sourceGuildId = null) {
      const rows = sourceGuildId
        ? selectSyncGrantsForSource.all(communityId, sourceGuildId)
        : selectSyncGrants.all(communityId);
      return rows.map((row) => ({
        sourceGuildId: row.source_guild_id,
        sourceRoleId: row.source_role_id,
        targetGuildId: row.target_guild_id,
        targetRoleId: row.target_role_id,
      }));
    },
    setSyncGrants(communityId, sourceGuildId, grants, targetGuildIds) {
      const targets = [...new Set(targetGuildIds.map(String))];
      const incoming = grants.filter(
        (grant) => targets.includes(grant.targetGuildId) && grant.targetGuildId !== sourceGuildId
      );
      const existing = selectSyncGrantsForSource.all(communityId, sourceGuildId);
      const kept = existing.filter((row) => !targets.includes(row.target_guild_id)).length;
      if (kept + incoming.length > 200) throw new Error("That server has too many role grants.");
      replaceSyncGrants(communityId, sourceGuildId, incoming, targets);
    },
    syncGrantAppliedByUser(communityId) {
      const map = new Map();
      for (const row of selectAllApplied.all(communityId)) {
        if (!map.has(row.user_id)) map.set(row.user_id, []);
        map.get(row.user_id).push({ guildId: row.guild_id, roleId: row.role_id });
      }
      return map;
    },
    listSyncGrantApplied(communityId, userId) {
      return selectApplied.all(communityId, userId).map((row) => ({
        guildId: row.guild_id,
        roleId: row.role_id,
      }));
    },
    rememberSyncGrant(communityId, userId, guildId, roleId) {
      insertApplied.run(communityId, userId, guildId, roleId);
    },
    forgetSyncGrant(communityId, userId, guildId, roleId) {
      deleteApplied.run(communityId, userId, guildId, roleId);
    },
    parentGrantsByUser(communityId) {
      const map = new Map();
      for (const row of selectAllGrants.all(communityId)) {
        if (!map.has(row.user_id)) map.set(row.user_id, []);
        map.get(row.user_id).push(row.master_role_id);
      }
      return map;
    },
    listParentGrants(communityId, userId) {
      return selectGrantsForUser.all(communityId, userId).map((row) => row.master_role_id);
    },
    rememberParentGrant(communityId, userId, masterRoleId) {
      insertGrant.run(communityId, userId, masterRoleId);
    },
    forgetParentGrant(communityId, userId, masterRoleId) {
      deleteGrant.run(communityId, userId, masterRoleId);
    },
    getSyncedBan(communityId, guildId, userId) {
      return selectBan.get(communityId, guildId, userId) || null;
    },
    listSyncedBansForUser(communityId, userId) {
      return selectBansForUser.all(communityId, userId);
    },
    listSyncedBans(communityId) {
      return selectAllBans.all(communityId);
    },
    upsertSyncedBan({ communityId, guildId, userId, reason }) {
      upsertBan.run({
        communityId,
        guildId,
        userId,
        reason: reason ? clipDetail(reason) : null,
        createdAt: now(),
      });
    },
    deleteSyncedBan(communityId, guildId, userId) {
      deleteBan.run(communityId, guildId, userId);
    },
    addLog({ communityId, kind, guildId = null, userId = null, actorId = null, detail }) {
      const createdAt = now();
      const clipped = clipDetail(detail);
      const result = insertLog.run({
        communityId,
        kind,
        guildId,
        userId,
        actorId,
        detail: clipped,
        createdAt,
      });
      const entry = {
        id: Number(result.lastInsertRowid),
        communityId,
        kind,
        guildId,
        userId,
        actorId,
        detail: clipped,
        createdAt,
      };
      for (const listener of logListeners) {
        Promise.resolve(listener(entry)).catch((error) => {
          console.error(`[guildlink] ${error.message}`);
        });
      }
    },
    onLog(listener) {
      logListeners.push(listener);
    },
    setAuditChannel(communityId, guildId, channelId) {
      const community = this.getCommunity(communityId);
      if (!community) throw new Error("That community was not found.");
      if (!guildId || !channelId) {
        setAuditChannelStmt.run(null, null, communityId);
        return this.getCommunity(communityId);
      }
      const allowed = new Set([community.masterGuildId, ...community.linkedGuildIds]);
      if (!allowed.has(String(guildId))) throw new Error("Choose a server in this community.");
      setAuditChannelStmt.run(String(guildId), String(channelId), communityId);
      return this.getCommunity(communityId);
    },
    listLogs(communityId, { guildIds = null, limit = 40 } = {}) {
      const capped = Math.min(Math.max(limit, 1), 100);
      if (!guildIds) {
        return sqlite
          .prepare(`SELECT * FROM sync_log WHERE community_id = ? ORDER BY id DESC LIMIT ?`)
          .all(communityId, capped)
          .map(mapLog);
      }
      if (guildIds.length === 0) return [];
      const marks = guildIds.map(() => "?").join(", ");
      return sqlite
        .prepare(
          `SELECT * FROM sync_log
           WHERE community_id = ? AND guild_id IN (${marks})
           ORDER BY id DESC LIMIT ?`
        )
        .all(communityId, ...guildIds, capped)
        .map(mapLog);
    },
    createSession(session) {
      insertSession.run({
        ...session,
        globalName: session.globalName || null,
        avatar: session.avatar || null,
        createdAt: now(),
      });
    },
    getSession(id) {
      return selectSession.get(id) || null;
    },
    deleteSession(id) {
      deleteSessionStmt.run(id);
    },
    updateSessionTokens(id, { accessToken, refreshToken, tokenExpiresAt }) {
      updateTokens.run({ id, accessToken, refreshToken, tokenExpiresAt });
    },
    setFlash(id, flash) {
      setFlashStmt.run(clipDetail(flash), id);
    },
    takeFlash(id) {
      const row = selectSession.get(id);
      if (!row?.flash) return null;
      clearFlash.run(id);
      return row.flash;
    },
  };
}

function mapNamedRole(row) {
  if (!row) return null;
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    parentGuildId: row.parent_guild_id || null,
    parentRoleId: row.parent_role_id || null,
  };
}

function mapLog(row) {
  return {
    id: row.id,
    communityId: row.community_id,
    kind: row.kind,
    guildId: row.guild_id,
    userId: row.user_id,
    actorId: row.actor_id,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function cleanCommunityName(name) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_NAME) return "";
  return clean;
}

function clipDetail(detail) {
  const text = String(detail ?? "").trim();
  if (text.length <= MAX_DETAIL) return text;
  return `${text.slice(0, MAX_DETAIL - 1)}…`;
}

function now() {
  return new Date().toISOString();
}
