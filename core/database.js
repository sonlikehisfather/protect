'use strict';


const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');


let _db    = null;
let _stmts = {};

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  runMigrations(_db);


  _db.exec(`
    CREATE TABLE IF NOT EXISTS piconly_exempt_roles (
      guildId   TEXT NOT NULL,
      channelId TEXT NOT NULL,
      roleId    TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, channelId, roleId)
    );

    CREATE TABLE IF NOT EXISTS streaks (
      guildId    TEXT    NOT NULL,
      userId     TEXT    NOT NULL,
      streak     INTEGER NOT NULL DEFAULT 0,
      lastDate   TEXT,
      updatedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId)
    );

    CREATE TABLE IF NOT EXISTS birthdays (
      guildId         TEXT    NOT NULL,
      userId          TEXT    NOT NULL,
      day             INTEGER NOT NULL,
      month           INTEGER NOT NULL,
      timezone        TEXT,
      lastNotifiedAt  INTEGER,
      createdAt       INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId)
    );

    CREATE TABLE IF NOT EXISTS rainbow_roles (
      guildId      TEXT    NOT NULL,
      roleId       TEXT    NOT NULL,
      mode         TEXT    NOT NULL DEFAULT 'rainbow',
      paletteSize  INTEGER NOT NULL DEFAULT 7,
      active       INTEGER NOT NULL DEFAULT 1,
      interval     INTEGER NOT NULL DEFAULT 60,
      nextRun      TEXT,
      color        TEXT,
      createdAt    INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, roleId)
    );

    CREATE TABLE IF NOT EXISTS owners (
      guildId   TEXT NOT NULL,
      userId    TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, userId)
    );

    CREATE TABLE IF NOT EXISTS cmd_aliases (
      guildId     TEXT NOT NULL,
      alias       TEXT NOT NULL,
      commandName TEXT NOT NULL,
      createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (guildId, alias)
    );
  `);

  prepareStatements(_db);
  return _db;
}


const GUILD_CONFIG_KEYS = new Set([
  'prefix',
  'color',
  'language',
  'modLogChannel',
  'joinLogChannel',
  'leaveLogChannel',
  'messageLogChannel',
  'voiceLogChannel',
  'boostLogChannel',
  'roleLogChannel',
  'raidLogChannel',
  'errorLogChannel',
  'welcomeChannel',
  'welcomeMessage',
  'welcomeDmMessage',
  'welcomeDmEnabled',
  'welcomeAutoDeleteDelay',
  'welcomeAfterVerify',
  'welcomeSendMode',
  'leaveChannel',
  'leaveMessage',
  'leaveAutoDeleteDelay',
  'leaveSendMode',
  'verifyEnabled',
  'verifyType',
  'verifyChannel',
  'verifyMessageId',
  'verifyRoleId',
  'ticketCategory',
  'ticketLogChannel',
  'ticketMaxPerUser',
  'levelUpChannel',
  'levelUpMessage',
  'levelEnabled',
  'levelCumul',
  'antiraidEnabled',
  'giveawayEmoji',
  'giveawayColor',
  'giveawayButtonStyle',
  'embedLogChannel',
  'levelVocEnabled',
  'levelVocRate',
  'levelMsgRate',
  'suggestionEnabled',
  'suggestionChannel',
  'suggestionLogChannel',
  'suggestionAutoThread',
  'suggestionPendingChannel',
  'suggestionValidatedChannel',
  'autopublishEnabled',
  'boostEmbedEnabled',
  'boostEmbedJson',
  'vcEmbedJson',
  'boostEmbedChannelId',
  'boostEmbedMessage',
  'reportEnabled',
  'reportChannel',
  'reportReasonRequired',
  'reportReasons',
  'reportMentionRoles',
  'showPicsChannel',
  'showPicsInterval',
  'soutienEnabled',
  'soutienRoleId',
  'soutienKeyword',
  'soutienMode',
  'soutienTag',
  'soutienBadge',
  'modmailEnabled',
  'modmailChannel',
  'modmailCategory',
  'modmailLogChannel',
  'modmailPingRole',
  'modmailOpenCooldown',
  'modmailSpamLimit',
  'modmailSpamWindow',
  'modmailSpamBlockTime',
  'modmailUnavailableInterval',
  'autoDeleteDelay',
  'autoDeleteModCmds',
  'autoDeleteModReplies',
  'autoDeleteSnipeCmds',
  'autoDeleteSnipeReplies',
  'autoDeleteErrorReplies',
  'autoDeleteInfoCmds',
  'autoDeleteInfoReplies',
  'autoDeleteLockReplies',
  'autoDeleteRoleReplies',
  'autoDeleteStatsCmds',
  'autoDeleteStatsReplies',
  'useTimeout',
  'muteRoleId',
  'clearLimit',
  'publicEnabled',
  'ancienDuration',
  'autoDeleteRenewReply',
  'autoDeleteRenewDelay',
  'modDmEnabled',
  'modDmWarn',
  'modDmKick',
  'modDmBan',
  'modDmTempban',
  'modDmMute',
  'modDmUnmute',
  'modDmTemplateGlobal',
  'modDmTemplateWarn',
  'modDmTemplateKick',
  'modDmTemplateBan',
  'modDmTemplateTempban',
  'modDmTemplateMute',
  'modDmTemplateUnmute',
  'modDmModeGlobal',
  'modDmModeWarn',
  'modDmModeKick',
  'modDmModeBan',
  'modDmModeTempban',
  'modDmModeMute',
  'modDmModeUnmute',

  'welcomeEmbedEnabled',
  'welcomeEmbedJson',
  'leaveEmbedEnabled',
  'leaveEmbedJson',
  'helpType',
  'helpAliasEnabled',
  'helpMessage',
  'verifyDuration',
  'verifyLogChannel',
  'verifyButtonLabel',
  'verifyButtonEmoji',
  'verifyButtonStyle',
  'ticketRatingChannel',
  'ticketRatingEnabled',

  'counterMembersChannel',
  'counterOnlineChannel',
  'counterVoiceChannel',
  'counterChannelsChannel',
  'counterTextchannelsChannel',
  'counterVoicechannelsChannel',
  'counterThreadsChannel',
  'counterBoostsChannel',
  'counterBoostlevelChannel',
  'counterEmojisChannel',

  'ghostPingEnabled',
  'ghostPingChannels',
]);

const CUSTOM_COMMAND_KEYS = new Set([
  'response', 'enabled', 'deleteMsg', 'deleteDelay', 'embedData',
  'dmResponse', 'buttonsJson', 'reactionsJson', 'rolesJson',
  'requiredRoleId', 'deniedRoleId', 'cooldown', 'logEnabled',
  'triggerByMessage', 'selectsJson',
  'responseMode', 'responseChannelId', 'logChannelId', 'targetMemberEnabled',
  'componentsJson',
  'allowedChannelIds', 'blockedChannelIds',
  'componentsPagesJson',
  'customPerm', 'description',
]);

const ANTIRAID_CONFIG_KEYS = new Set([
  'antilinkEnabled',
  'antilinkPunish',
  'antilinkWhitelist',
  'antispamEnabled',
  'antispamThreshold',
  'antispamWindow',
  'antispamPunish',
  'antiEveryoneEnabled',
  'antiEveryonePunish',
  'antibotEnabled',
  'antibotPunish',
  'antiwebhookEnabled',
  'antichannelEnabled',
  'antichannelThreshold',
  'antichannelWindow',
  'antichannelPunish',
  'antibanEnabled',
  'antibanThreshold',
  'antibanWindow',
  'antibanPunish',
  'antiupdateEnabled',
  'antiupdatePunish',
  'antivanityEnabled',
  'antivanityPunish',
  'antidecoEnabled',
  'antidecoPunish',
  'antiroleEnabled',
  'antiroleThreshold',
  'antiroleWindow',
  'antirolePunish',
  'antitokenEnabled',
  'antitokenThreshold',
  'antitokenWindow',
  'antiunbanEnabled',
  'antiunbanPunish',
  'raidPingRole',
  'antibadwordEnabled',
  'badwordList',
  'antibadwordPunish',
  'antimassmentionEnabled',
  'antimassmentionThreshold',
  'antimassmentionPunish',
  'antiwebhookPunish',
  'antilinkMode',
  'punishSteps',
  'antidecoThreshold',
  'antidecoWindow',
  'antiEveryoneThreshold',
  'antiEveryoneWindow',
  'antitokenLocked',
  'creationLimit',
  'blrankMode',
  'blrankEnabled',
  'antiroleMode',
  'securInvite',
  'creationLimitPunish',
  'blrankPunish',
  'antilinkAllowedChannels',
  'antilinkAllowedCategories',
  'antilinkImageRoles',
  'antilinkMediaWhitelist',
  'antilinkMediaDomains',
  'antilinkSoftEnabled',
  'antilinkSoftWindow',
  'antilinkSoftThreshold',
]);

const TEMPVOC_CONFIG_KEYS = new Set([
  'enabled',
  'joinChannelId',
  'categoryId',
  'nameTemplate',
  'userLimit',
  'requiredRoles',
  'blockedRoles',
  'ownerManageChannel',
  'ownerManagePerms',
  'ownerMoveMembers',
  'defaultInvisible',
  'embedChannelId',
  'embedMessageId',
]);

function assertAllowedColumn(keySet, key, tableName) {
  if (!keySet.has(key)) {
    throw new Error(`Invalid column "${key}" for table "${tableName}"`);
  }
}


function _repairRoleMenusForSync(db) {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('role_menus','role_menus_old','role_menu_options')`
  ).all().map(r => r.name);

  const hasMenus    = tables.includes('role_menus');
  const hasMenusOld = tables.includes('role_menus_old');
  const hasOptions  = tables.includes('role_menu_options');


  if (!hasMenus && !hasMenusOld) return;

  const menusSql = hasMenus
    ? (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='role_menus'`).get()?.sql || '')
    : '';
  const optsSql  = hasOptions
    ? (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='role_menu_options'`).get()?.sql || '')
    : '';

  const menusHasSyncCheck    = menusSql.includes("'sync'");
  const optsRefsRoleMenusOld = optsSql.includes('role_menus_old');


  if (hasMenus && menusHasSyncCheck && !hasMenusOld && (!hasOptions || !optsRefsRoleMenusOld)) {
    return;
  }


  let createdStubOld = false;
  if (hasOptions && optsRefsRoleMenusOld && !hasMenusOld) {
    db.exec(`CREATE TABLE role_menus_old (id INTEGER PRIMARY KEY)`);
    createdStubOld = true;
  }

  const menusById = new Map();
  if (hasMenusOld) {
    try {
      for (const r of db.prepare(`SELECT * FROM role_menus_old`).all()) menusById.set(r.id, r);
    } catch {}
  }
  if (hasMenus) {
    try {
      for (const r of db.prepare(`SELECT * FROM role_menus`).all()) menusById.set(r.id, r);
    } catch {}
  }
  const menus = [...menusById.values()];


  let options = [];
  let beforeOptionsCount = 0;
  if (hasOptions) {
    options = db.prepare(`SELECT * FROM role_menu_options`).all();
    beforeOptionsCount = options.length;
  }


  db.exec(`PRAGMA defer_foreign_keys = ON`);

  if (hasOptions)                      db.exec(`DROP TABLE role_menu_options`);
  if (hasMenus)                        db.exec(`DROP TABLE role_menus`);
  if (hasMenusOld || createdStubOld)   db.exec(`DROP TABLE role_menus_old`);

  db.exec(`
    CREATE TABLE role_menus (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId     TEXT    NOT NULL,
      channelId   TEXT,
      messageId   TEXT UNIQUE,
      title       TEXT    NOT NULL DEFAULT 'Menu de rôles',
      description TEXT    NOT NULL DEFAULT 'Sélectionnez les rôles que vous souhaitez obtenir.',
      placeholder TEXT    NOT NULL DEFAULT 'Choisir un rôle',
      mode        TEXT    NOT NULL DEFAULT 'toggle' CHECK(mode IN ('toggle','add','remove','sync')),
      minValues   INTEGER NOT NULL DEFAULT 0,
      maxValues   INTEGER NOT NULL DEFAULT 1,
      createdBy   TEXT    NOT NULL,
      createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt   INTEGER NOT NULL DEFAULT (unixepoch()),
      componentType    TEXT NOT NULL DEFAULT 'select',
      buttonStyle      TEXT NOT NULL DEFAULT 'Secondary',
      roleSpacing      TEXT NOT NULL DEFAULT 'normal',
      roleSeparator    TEXT NOT NULL DEFAULT '・',
      roleFormat       TEXT NOT NULL DEFAULT '{emoji} {separator} {role}',
      requiredRoleIds  TEXT,
      forbiddenRoleIds TEXT,
      feedbackMode     TEXT NOT NULL DEFAULT 'ephemeral'
    );

    CREATE INDEX IF NOT EXISTS idx_role_menus_guild ON role_menus(guildId);

    CREATE TABLE role_menu_options (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      menuId      INTEGER NOT NULL REFERENCES role_menus(id) ON DELETE CASCADE,
      roleId      TEXT    NOT NULL,
      label       TEXT    NOT NULL,
      description TEXT,
      emoji       TEXT
    );
  `);


  const validModes = new Set(['toggle', 'add', 'remove', 'sync']);
  const now = Math.floor(Date.now() / 1000);
  const pick = (m, k, fb) => (m[k] !== undefined && m[k] !== null) ? m[k] : fb;

  const insMenu = db.prepare(`
    INSERT INTO role_menus (
      id, guildId, channelId, messageId, title, description, placeholder,
      mode, minValues, maxValues, createdBy, createdAt, updatedAt,
      componentType, buttonStyle, roleSpacing, roleSeparator, roleFormat,
      requiredRoleIds, forbiddenRoleIds, feedbackMode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of menus) {
    if (!m.guildId) continue;
    insMenu.run(
      m.id ?? null,
      m.guildId,
      m.channelId ?? null,
      m.messageId ?? null,
      pick(m, 'title',       'Menu de rôles'),
      pick(m, 'description', 'Sélectionnez les rôles que vous souhaitez obtenir.'),
      pick(m, 'placeholder', 'Choisir un rôle'),
      validModes.has(m.mode) ? m.mode : 'toggle',
      pick(m, 'minValues', 0),
      pick(m, 'maxValues', 1),
      pick(m, 'createdBy', '0'),
      pick(m, 'createdAt', now),
      pick(m, 'updatedAt', now),
      pick(m, 'componentType', 'select'),
      pick(m, 'buttonStyle',   'Secondary'),
      pick(m, 'roleSpacing',   'normal'),
      pick(m, 'roleSeparator', '・'),
      pick(m, 'roleFormat',    '{emoji} {separator} {role}'),
      m.requiredRoleIds  ?? null,
      m.forbiddenRoleIds ?? null,
      pick(m, 'feedbackMode', 'ephemeral'),
    );
  }


  const validMenuIds = new Set(
    db.prepare(`SELECT id FROM role_menus`).all().map(r => r.id)
  );

  const insOpt = db.prepare(`
    INSERT INTO role_menu_options (id, menuId, roleId, label, description, emoji)
    VALUES (?, ?, ?, ?, ?, ?)
  `);


  let skippedOrphan   = 0;
  let skippedCorrupt  = 0;
  let inserted        = 0;

  for (const o of options) {
    if (o.menuId == null || !validMenuIds.has(o.menuId)) { skippedOrphan++;  continue; }
    if (!o.roleId || !o.label)                           { skippedCorrupt++; continue; }
    insOpt.run(
      o.id ?? null,
      o.menuId,
      o.roleId,
      o.label,
      o.description ?? null,
      o.emoji ?? null,
    );
    inserted++;
  }


  const afterOptionsCount = db.prepare(`SELECT COUNT(*) AS c FROM role_menu_options`).get().c;

  if (beforeOptionsCount > 0 && afterOptionsCount === 0) {

    const allOrphan = options.every(o => o.menuId == null || !validMenuIds.has(o.menuId));
    if (!allOrphan) {
      throw new Error(
        `Rolemenu repair anti-loss: ${beforeOptionsCount} options en entrée, ` +
        `0 réinsérées (orphan=${skippedOrphan}, corrupt=${skippedCorrupt}, ` +
        `inserted=${inserted}). Rollback.`
      );
    }
  }


  const fkErrors = db.prepare(`PRAGMA foreign_key_check`).all();
  if (fkErrors.length) {
    throw new Error(`Rolemenu repair: foreign_key_check found ${fkErrors.length} violation(s)`);
  }
}


const MIGRATIONS = [

  {
    version: 1,
    up(db) {
      db.exec(`

        -- ── Config générale par guild ───────────────────────────────────────
        CREATE TABLE IF NOT EXISTS guild_config (
          guildId             TEXT    PRIMARY KEY,
          prefix              TEXT    NOT NULL DEFAULT '+',
          color               TEXT    NOT NULL DEFAULT '#2B2D31',
          language            TEXT    NOT NULL DEFAULT 'fr',
          modLogChannel       TEXT,
          joinLogChannel      TEXT,
          leaveLogChannel     TEXT,
          messageLogChannel   TEXT,
          voiceLogChannel     TEXT,
          boostLogChannel     TEXT,
          roleLogChannel      TEXT,
          raidLogChannel      TEXT,
          errorLogChannel     TEXT,
          welcomeChannel      TEXT,
          welcomeMessage      TEXT,
          welcomeDmMessage    TEXT,
          welcomeDmEnabled    INTEGER NOT NULL DEFAULT 0,
          leaveChannel        TEXT,
          leaveMessage        TEXT,
          verifyEnabled       INTEGER NOT NULL DEFAULT 0,
          verifyType          TEXT    NOT NULL DEFAULT 'button' CHECK(verifyType IN ('button','captcha')),
          verifyChannel       TEXT,
          verifyMessageId     TEXT,
          verifyRoleId        TEXT,
          ticketCategory      TEXT,
          ticketLogChannel    TEXT,
          ticketMaxPerUser    INTEGER NOT NULL DEFAULT 1,
          levelUpChannel      TEXT,
          levelUpMessage      TEXT    NOT NULL DEFAULT 'GG {user}, tu passes niveau **{level}** !',
          levelEnabled        INTEGER NOT NULL DEFAULT 1,
          levelCumul          INTEGER NOT NULL DEFAULT 0,
          antiraidEnabled     INTEGER NOT NULL DEFAULT 0,
          giveawayEmoji       TEXT    NOT NULL DEFAULT '🎉',
          giveawayColor       TEXT    NOT NULL DEFAULT '#2B2D31',
          giveawayButtonStyle TEXT    NOT NULL DEFAULT 'Secondary',
          embedLogChannel     TEXT,
          autoDeleteDelay        INTEGER NOT NULL DEFAULT 5,
          autoDeleteModCmds      INTEGER NOT NULL DEFAULT 0,
          autoDeleteModReplies   INTEGER NOT NULL DEFAULT 0,
          autoDeleteSnipeCmds    INTEGER NOT NULL DEFAULT 0,
          autoDeleteSnipeReplies INTEGER NOT NULL DEFAULT 0,
          autoDeleteErrorReplies INTEGER NOT NULL DEFAULT 1,
          autoDeleteInfoCmds     INTEGER NOT NULL DEFAULT 0,
          autoDeleteInfoReplies  INTEGER NOT NULL DEFAULT 0,
          autoDeleteLockReplies  INTEGER NOT NULL DEFAULT 0,
          autoDeleteRoleReplies  INTEGER NOT NULL DEFAULT 0,
          autoDeleteStatsCmds    INTEGER NOT NULL DEFAULT 0,
          autoDeleteStatsReplies INTEGER NOT NULL DEFAULT 0,
          useTimeout             INTEGER NOT NULL DEFAULT 0,
          clearLimit             INTEGER NOT NULL DEFAULT 100,
          publicEnabled          INTEGER NOT NULL DEFAULT 0,
          ancienDuration         INTEGER NOT NULL DEFAULT 604800,
          ghostPingEnabled       INTEGER NOT NULL DEFAULT 0,
          ghostPingChannels      TEXT,
          createdAt           INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt           INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ── Permissions ────────────────────────────────────────────────────

        CREATE TABLE IF NOT EXISTS perm_levels (
          guildId    TEXT    NOT NULL,
          level      INTEGER NOT NULL CHECK(level BETWEEN 1 AND 9),
          targetId   TEXT    NOT NULL,
          targetType TEXT    NOT NULL CHECK(targetType IN ('role','user')),
          createdAt  INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, level, targetId)
        );

        -- perm : 1-9 | 'owner' | 'buyer' | 'public' | 'everyone'
        CREATE TABLE IF NOT EXISTS cmd_perms (
          guildId     TEXT    NOT NULL,
          commandName TEXT    NOT NULL,
          perm        TEXT    NOT NULL DEFAULT 'owner',
          updatedAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, commandName)
        );

        CREATE TABLE IF NOT EXISTS cmd_targets (
          guildId     TEXT    NOT NULL,
          commandName TEXT    NOT NULL,
          targetId    TEXT    NOT NULL,
          targetType  TEXT    NOT NULL CHECK(targetType IN ('role','user')),
          addedAt     INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, commandName, targetId)
        );

        CREATE TABLE IF NOT EXISTS public_channels (
          guildId   TEXT    NOT NULL,
          channelId TEXT    NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, channelId)
        );

        CREATE TABLE IF NOT EXISTS nolog_channels (
          guildId   TEXT    NOT NULL,
          channelId TEXT    NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, channelId)
        );

        -- ── Sanctions ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS sanctions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          userId      TEXT    NOT NULL,
          moderatorId TEXT    NOT NULL,
          type        TEXT    NOT NULL CHECK(type IN ('warn','mute','kick','ban','unban','unmute')),
          reason      TEXT,
          duration    INTEGER,
          expiresAt   INTEGER,
          channelId   INTEGER,
          active      INTEGER NOT NULL DEFAULT 1,
          createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          deletedAt   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sanctions_guild_user
          ON sanctions(guildId, userId) WHERE deletedAt IS NULL;
        CREATE INDEX IF NOT EXISTS idx_sanctions_expires
          ON sanctions(expiresAt) WHERE active = 1 AND deletedAt IS NULL;

        -- ── Niveaux / XP ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS levels (
          guildId   TEXT    NOT NULL,
          userId    TEXT    NOT NULL,
          xp        INTEGER NOT NULL DEFAULT 0,
          level     INTEGER NOT NULL DEFAULT 0,
          messages  INTEGER NOT NULL DEFAULT 0,
          lastXpAt  INTEGER NOT NULL DEFAULT 0,
          updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_levels_xp ON levels(guildId, xp DESC);

        CREATE TABLE IF NOT EXISTS level_roles (
          guildId   TEXT    NOT NULL,
          level     INTEGER NOT NULL,
          roleId    TEXT    NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, level, roleId)
        );

        -- ── Tickets ───────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS tickets (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId   TEXT    NOT NULL,
          channelId TEXT    NOT NULL UNIQUE,
          userId    TEXT    NOT NULL,
          status    TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
          subject   TEXT,
          claimedBy TEXT,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
          closedAt  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guildId, status);

        CREATE TABLE IF NOT EXISTS ticket_panels (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId   TEXT    NOT NULL,
          channelId TEXT    NOT NULL,
          messageId TEXT,
          panelType TEXT    NOT NULL DEFAULT 'button' CHECK(panelType IN ('button','select')),
          createdAt INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS ticket_options (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          panelId   INTEGER NOT NULL REFERENCES ticket_panels(id) ON DELETE CASCADE,
          label     TEXT    NOT NULL,
          emoji     TEXT,
          channelId TEXT
        );

        -- ── Antiraid ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS antiraid_config (
          guildId               TEXT    PRIMARY KEY,
          antilinkEnabled       INTEGER NOT NULL DEFAULT 0,
          antilinkPunish        TEXT    NOT NULL DEFAULT 'delete',
          antilinkWhitelist     TEXT,
          antispamEnabled       INTEGER NOT NULL DEFAULT 0,
          antispamThreshold     INTEGER NOT NULL DEFAULT 5,
          antispamWindow        INTEGER NOT NULL DEFAULT 5,
          antispamPunish        TEXT    NOT NULL DEFAULT 'mute',
          antiEveryoneEnabled   INTEGER NOT NULL DEFAULT 0,
          antiEveryonePunish    TEXT    NOT NULL DEFAULT 'warn',
          antibotEnabled        INTEGER NOT NULL DEFAULT 0,
          antibotPunish         TEXT    NOT NULL DEFAULT 'kick',
          antiwebhookEnabled    INTEGER NOT NULL DEFAULT 0,
          antichannelEnabled    INTEGER NOT NULL DEFAULT 0,
          antichannelThreshold  INTEGER NOT NULL DEFAULT 3,
          antichannelWindow     INTEGER NOT NULL DEFAULT 10,
          antichannelPunish     TEXT    NOT NULL DEFAULT 'derank',
          antibanEnabled        INTEGER NOT NULL DEFAULT 0,
          antibanThreshold      INTEGER NOT NULL DEFAULT 3,
          antibanWindow         INTEGER NOT NULL DEFAULT 10,
          antibanPunish         TEXT    NOT NULL DEFAULT 'derank',
          antiupdateEnabled     INTEGER NOT NULL DEFAULT 0,
          antiupdatePunish      TEXT    NOT NULL DEFAULT 'derank',
          updatedAt             INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS antiraid_whitelist (
          guildId    TEXT    NOT NULL,
          targetId   TEXT    NOT NULL,
          targetType TEXT    NOT NULL CHECK(targetType IN ('user','role')),
          createdAt  INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, targetId)
        );

        -- ── Giveaways ─────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS giveaways (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          channelId   TEXT    NOT NULL,
          messageId   TEXT    UNIQUE,
          hostId      TEXT    NOT NULL,
          prize       TEXT    NOT NULL,
          winnerCount INTEGER NOT NULL DEFAULT 1,
          endsAt      INTEGER NOT NULL,
          ended       INTEGER NOT NULL DEFAULT 0,
          winners     TEXT,
          createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt   INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS giveaway_entries (
          giveawayId INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
          userId     TEXT    NOT NULL,
          createdAt  INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (giveawayId, userId)
        );

        -- ── Embeds sauvegardés ────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS saved_embeds (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId   TEXT    NOT NULL,
          name      TEXT    NOT NULL,
          data      TEXT    NOT NULL,
          createdBy TEXT    NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, name)
        );

        -- ── Role reactions ────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS role_reactions (
          guildId   TEXT    NOT NULL,
          messageId TEXT    NOT NULL,
          emoji     TEXT    NOT NULL,
          roleId    TEXT    NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, messageId, emoji)
        );

        -- ── Commandes custom ──────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS custom_commands (
          guildId     TEXT    NOT NULL,
          name        TEXT    NOT NULL,
          response    TEXT    NOT NULL,
          deleteMsg   INTEGER NOT NULL DEFAULT 0,
          deleteDelay INTEGER,
          embedData   TEXT,
          createdBy   TEXT    NOT NULL,
          createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, name)
        );

        -- ── Reminders ─────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS reminders (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId   TEXT    NOT NULL,
          userId    TEXT    NOT NULL,
          channelId TEXT    NOT NULL,
          message   TEXT    NOT NULL,
          remindAt  INTEGER NOT NULL,
          done      INTEGER NOT NULL DEFAULT 0,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_due
          ON reminders(remindAt) WHERE done = 0;

        -- ── Casino / Coins ────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS user_coins (
          guildId   TEXT    NOT NULL,
          userId    TEXT    NOT NULL,
          coins     INTEGER NOT NULL DEFAULT 0,
          lastDaily INTEGER DEFAULT 0,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_coins_guild ON user_coins(guildId, coins DESC);

      `);
    }
  },


  {
    version: 2,
    up(db) {
      db.exec(`
        ALTER TABLE antiraid_config ADD COLUMN antidecoEnabled      INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN antidecoPunish       TEXT    NOT NULL DEFAULT 'derank';
        ALTER TABLE antiraid_config ADD COLUMN antiroleEnabled      INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN antirolePunish       TEXT    NOT NULL DEFAULT 'derank';
        ALTER TABLE antiraid_config ADD COLUMN antitokenEnabled     INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN antitokenThreshold   INTEGER NOT NULL DEFAULT 10;
        ALTER TABLE antiraid_config ADD COLUMN antitokenWindow      INTEGER NOT NULL DEFAULT 10;
        ALTER TABLE antiraid_config ADD COLUMN antiunbanEnabled     INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN antiunbanPunish      TEXT    NOT NULL DEFAULT 'derank';
        ALTER TABLE antiraid_config ADD COLUMN raidPingRole         TEXT;
        ALTER TABLE antiraid_config ADD COLUMN antibadwordEnabled   INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN badwordList          TEXT;
        ALTER TABLE antiraid_config ADD COLUMN antibadwordPunish    TEXT DEFAULT 'warn';
        ALTER TABLE antiraid_config ADD COLUMN antimassmentionEnabled   INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE antiraid_config ADD COLUMN antimassmentionThreshold INTEGER NOT NULL DEFAULT 5;
        ALTER TABLE antiraid_config ADD COLUMN antilinkMode         TEXT NOT NULL DEFAULT 'all';
        ALTER TABLE antiraid_config ADD COLUMN punishSteps          TEXT;

        CREATE TABLE IF NOT EXISTS automod_strikes (
          guildId     TEXT    NOT NULL,
          userId      TEXT    NOT NULL,
          strikes     INTEGER NOT NULL DEFAULT 0,
          windowStart INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guildId, userId)
        );

        CREATE TABLE IF NOT EXISTS blacklist_rank (
          guildId TEXT NOT NULL,
          roleId  TEXT NOT NULL,
          PRIMARY KEY (guildId, roleId)
        );

        ALTER TABLE guild_config ADD COLUMN levelVocEnabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE guild_config ADD COLUMN levelVocRate    INTEGER NOT NULL DEFAULT 5;
        ALTER TABLE guild_config ADD COLUMN levelMsgRate    INTEGER NOT NULL DEFAULT 20;

        CREATE TABLE IF NOT EXISTS level_channel_rates (
          guildId   TEXT    NOT NULL,
          channelId TEXT    NOT NULL,
          rateType  TEXT    NOT NULL CHECK(rateType IN ('message','voice')),
          rate      INTEGER NOT NULL DEFAULT 0,
          muteRate  INTEGER,
          PRIMARY KEY (guildId, channelId, rateType)
        );
      `);
    }
  },

  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS blacklist (
          userId      TEXT    PRIMARY KEY,
          reason      TEXT,
          addedBy     TEXT    NOT NULL,
          addedAt     INTEGER NOT NULL DEFAULT (unixepoch()),
          deletedAt   INTEGER
        );
      `);
    }
  },

  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS global_owners (
          userId    TEXT PRIMARY KEY,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `);
    }
  },

  {
    version: 5,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS blacklist_rank (
          guildId TEXT NOT NULL,
          roleId  TEXT NOT NULL,
          PRIMARY KEY (guildId, roleId)
        );
      `);
    }
  },

  {
    version: 7,
    up(db) {
      db.exec(`
        ALTER TABLE ticket_options ADD COLUMN description  TEXT;
        ALTER TABLE ticket_options ADD COLUMN categoryId   TEXT;
        ALTER TABLE ticket_options ADD COLUMN mentionRoles TEXT;
        ALTER TABLE ticket_options ADD COLUMN staffRoles   TEXT;
        ALTER TABLE ticket_options ADD COLUMN logChannelId TEXT;
        ALTER TABLE ticket_options ADD COLUMN openMessage  TEXT;
        ALTER TABLE ticket_options ADD COLUMN nameTemplate TEXT;
      `);
    }
  },

  {
    version: 7,
    up(db) {
      const hasColumn = (table, column) => {
        return !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
      };

      if (!hasColumn('tickets', 'panelId')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN panelId INTEGER').run();
      }
      if (!hasColumn('tickets', 'optionId')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN optionId INTEGER').run();
      }
      if (!hasColumn('tickets', 'claimedAt')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN claimedAt INTEGER').run();
      }
      if (!hasColumn('tickets', 'closedBy')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN closedBy TEXT').run();
      }
      if (!hasColumn('tickets', 'closeReason')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN closeReason TEXT').run();
      }
      if (!hasColumn('tickets', 'deleteAt')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN deleteAt INTEGER').run();
      }
      if (!hasColumn('tickets', 'renamedBy')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN renamedBy TEXT').run();
      }
      if (!hasColumn('tickets', 'lastMessageId')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN lastMessageId TEXT').run();
      }
      if (!hasColumn('tickets', 'transcriptUrl')) {
        db.prepare('ALTER TABLE tickets ADD COLUMN transcriptUrl TEXT').run();
      }

      if (!hasColumn('ticket_panels', 'placeholder')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN placeholder TEXT').run();
      }
      if (!hasColumn('ticket_panels', 'embedJson')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN embedJson TEXT').run();
      }
      if (!hasColumn('ticket_panels', 'requiredRoles')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN requiredRoles TEXT').run();
      }
      if (!hasColumn('ticket_panels', 'blockedRoles')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN blockedRoles TEXT').run();
      }
      if (!hasColumn('ticket_panels', 'claimMode')) {
        db.prepare(`ALTER TABLE ticket_panels ADD COLUMN claimMode TEXT NOT NULL DEFAULT 'off'`).run();
      }
      if (!hasColumn('ticket_panels', 'showClaimButton')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN showClaimButton INTEGER NOT NULL DEFAULT 1').run();
      }
      if (!hasColumn('ticket_panels', 'showCloseButton')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN showCloseButton INTEGER NOT NULL DEFAULT 1').run();
      }
      if (!hasColumn('ticket_panels', 'maxOpenPerUser')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN maxOpenPerUser INTEGER NOT NULL DEFAULT 1').run();
      }
      if (!hasColumn('ticket_panels', 'autoCloseSeconds')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN autoCloseSeconds INTEGER').run();
      }
      if (!hasColumn('ticket_panels', 'autoDeleteSeconds')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN autoDeleteSeconds INTEGER').run();
      }
      if (!hasColumn('ticket_panels', 'transcriptDm')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN transcriptDm INTEGER NOT NULL DEFAULT 0').run();
      }
      if (!hasColumn('ticket_panels', 'closeOnLeave')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN closeOnLeave INTEGER NOT NULL DEFAULT 0').run();
      }
      if (!hasColumn('ticket_panels', 'logChannelId')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN logChannelId TEXT').run();
      }
      if (!hasColumn('ticket_panels', 'updatedAt')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT (unixepoch())').run();
      }

      if (!hasColumn('ticket_options', 'openEmbedJson')) {
        db.prepare('ALTER TABLE ticket_options ADD COLUMN openEmbedJson TEXT').run();
      }
    }
  },

  {
    version: 8,
    up(db) {
      const hasColumn = (table, col) =>
        db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

      if (!hasColumn('ticket_panels', 'bypassRoles')) {
        db.prepare('ALTER TABLE ticket_panels ADD COLUMN bypassRoles TEXT').run();
      }
    }
  },

  {
    version: 9,
    up(db) {
      const hasColumn = (table, col) =>
        db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
      const hasTable = (name) =>
        !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);


      if (!hasColumn('guild_config', 'suggestionEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionEnabled INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'suggestionChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionChannel TEXT`).run();
      if (!hasColumn('guild_config', 'suggestionLogChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionLogChannel TEXT`).run();
      if (!hasColumn('guild_config', 'suggestionAutoThread'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionAutoThread INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'suggestionPendingChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionPendingChannel TEXT`).run();
      if (!hasColumn('guild_config', 'suggestionValidatedChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN suggestionValidatedChannel TEXT`).run();


      if (hasTable('suggestions') && !hasColumn('suggestions', 'validatedMessageId'))
        db.prepare(`ALTER TABLE suggestions ADD COLUMN validatedMessageId TEXT`).run();

      if (!hasColumn('guild_config', 'autopublishEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autopublishEnabled INTEGER NOT NULL DEFAULT 0`).run();


      if (!hasColumn('guild_config', 'boostEmbedEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN boostEmbedEnabled INTEGER NOT NULL DEFAULT 1`).run();
      if (!hasColumn('guild_config', 'boostEmbedJson'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN boostEmbedJson TEXT`).run();

      if (!hasColumn('guild_config', 'reportEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN reportEnabled INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'reportChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN reportChannel TEXT`).run();

      if (!hasColumn('guild_config', 'showPicsChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN showPicsChannel TEXT`).run();
      if (!hasColumn('guild_config', 'showPicsInterval'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN showPicsInterval INTEGER NOT NULL DEFAULT 60`).run();

      if (!hasColumn('guild_config', 'soutienEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienEnabled INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'soutienRoleId'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienRoleId TEXT`).run();
      if (!hasColumn('guild_config', 'soutienKeyword'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienKeyword TEXT`).run();

      if (!hasColumn('guild_config', 'modmailEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailEnabled INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'modmailChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailChannel TEXT`).run();
      if (!hasColumn('guild_config', 'modmailCategory'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailCategory TEXT`).run();
      if (!hasColumn('guild_config', 'modmailLogChannel'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailLogChannel TEXT`).run();
      if (!hasColumn('guild_config', 'modmailPingRole'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailPingRole TEXT`).run();

      if (!hasColumn('guild_config', 'autoDeleteDelay'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteDelay INTEGER NOT NULL DEFAULT 5`).run();
      if (!hasColumn('guild_config', 'autoDeleteModCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteModCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteModReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteModReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteSnipeCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteSnipeCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteSnipeReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteSnipeReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteErrorReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteErrorReplies INTEGER NOT NULL DEFAULT 1`).run();
      if (!hasColumn('guild_config', 'autoDeleteInfoCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteInfoCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteInfoReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteInfoReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteLockReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteLockReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteRoleReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteRoleReplies INTEGER NOT NULL DEFAULT 0`).run();


      if (!hasColumn('guild_config', 'useTimeout'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN useTimeout INTEGER NOT NULL DEFAULT 0`).run();

      if (!hasColumn('guild_config', 'clearLimit'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN clearLimit INTEGER NOT NULL DEFAULT 100`).run();

      if (!hasColumn('guild_config', 'publicEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN publicEnabled INTEGER NOT NULL DEFAULT 0`).run();

      if (!hasColumn('guild_config', 'ancienDuration'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN ancienDuration INTEGER NOT NULL DEFAULT 604800`).run();

      if (!hasColumn('guild_config', 'ghostPingEnabled'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN ghostPingEnabled INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'ghostPingChannels'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN ghostPingChannels TEXT`).run();

      if (!hasColumn('guild_config', 'muteRoleId'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN muteRoleId TEXT`).run();

      if (!hasColumn('guild_config', 'autoDeleteRenewReply'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteRenewReply INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteRenewDelay'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteRenewDelay INTEGER`).run();

      if (!hasColumn('guild_config', 'vcEmbedJson')) {
      db.prepare('ALTER TABLE guild_config ADD COLUMN vcEmbedJson TEXT').run();
    }


      if (!hasColumn('antiraid_config', 'antidecoThreshold'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoThreshold INTEGER NOT NULL DEFAULT 5`).run();
      if (!hasColumn('antiraid_config', 'antidecoWindow'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoWindow INTEGER NOT NULL DEFAULT 10`).run();

      if (!hasColumn('antiraid_config', 'antiEveryoneThreshold'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryoneThreshold INTEGER NOT NULL DEFAULT 3`).run();
      if (!hasColumn('antiraid_config', 'antiEveryoneWindow'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryoneWindow INTEGER NOT NULL DEFAULT 10`).run();

      if (!hasColumn('antiraid_config', 'antitokenLocked'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antitokenLocked INTEGER NOT NULL DEFAULT 0`).run();

      if (!hasColumn('antiraid_config', 'creationLimit'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN creationLimit INTEGER NOT NULL DEFAULT 0`).run();

      if (!hasColumn('antiraid_config', 'blrankMode'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN blrankMode TEXT NOT NULL DEFAULT 'all'`).run();
      if (!hasColumn('antiraid_config', 'blrankEnabled'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN blrankEnabled INTEGER NOT NULL DEFAULT 0`).run();

      if (!hasColumn('antiraid_config', 'antiroleMode'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiroleMode TEXT NOT NULL DEFAULT 'all'`).run();


      if (!hasColumn('antiraid_config', 'securInvite'))
        db.prepare(`ALTER TABLE antiraid_config ADD COLUMN securInvite INTEGER NOT NULL DEFAULT 0`).run();


      if (!hasTable('suggestions')) {
        db.exec(`
          CREATE TABLE suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId     TEXT    NOT NULL,
            userId      TEXT    NOT NULL,
            channelId   TEXT    NOT NULL,
            messageId   TEXT    UNIQUE,
            content     TEXT    NOT NULL,
            upvotes     INTEGER NOT NULL DEFAULT 0,
            downvotes   INTEGER NOT NULL DEFAULT 0,
            status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending','approved','refused','implemented')),
            response    TEXT,
            respondedBy TEXT,
            threadId    TEXT,
            createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
            updatedAt   INTEGER NOT NULL DEFAULT (unixepoch())
          );
          CREATE INDEX IF NOT EXISTS idx_suggestions_guild
            ON suggestions(guildId, status);
          CREATE INDEX IF NOT EXISTS idx_suggestions_msg
            ON suggestions(messageId);

          CREATE TABLE suggestion_votes (
            suggestionId INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
            userId       TEXT    NOT NULL,
            vote         INTEGER NOT NULL CHECK(vote IN (1, -1)),
            createdAt    INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (suggestionId, userId)
          );
        `);
      }


      if (!hasTable('temp_roles')) {
        db.exec(`
          CREATE TABLE temp_roles (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId   TEXT    NOT NULL,
            userId    TEXT    NOT NULL,
            roleId    TEXT    NOT NULL,
            expiresAt INTEGER NOT NULL,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(guildId, userId, roleId)
          );
          CREATE INDEX IF NOT EXISTS idx_temp_roles_expires
            ON temp_roles(expiresAt);
        `);
      }


      if (!hasTable('piconly_channels')) {
        db.exec(`
          CREATE TABLE piconly_channels (
            guildId   TEXT NOT NULL,
            channelId TEXT NOT NULL,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId)
          );
        `);
      }


      if (!hasTable('piconly_exempt_roles')) {
        db.exec(`
          CREATE TABLE piconly_exempt_roles (
            guildId   TEXT NOT NULL,
            channelId TEXT NOT NULL,
            roleId    TEXT NOT NULL,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId, roleId)
          );
        `);
      }


      if (!hasTable('noderank_roles')) {
        db.exec(`
          CREATE TABLE noderank_roles (
            guildId   TEXT NOT NULL,
            roleId    TEXT NOT NULL,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, roleId)
          );
        `);
      }


      if (!hasTable('autoreact')) {
        db.exec(`
          CREATE TABLE autoreact (
            guildId   TEXT NOT NULL,
            channelId TEXT NOT NULL,
            emoji     TEXT NOT NULL,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId, emoji)
          );
        `);
      }


      if (!hasTable('public_channel_overrides')) {
        db.exec(`
          CREATE TABLE public_channel_overrides (
            guildId   TEXT    NOT NULL,
            channelId TEXT    NOT NULL,
            state     TEXT    NOT NULL CHECK(state IN ('allow','deny')),
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId)
          );
        `);
      }


      if (!hasTable('antispam_channel_overrides')) {
        db.exec(`
          CREATE TABLE antispam_channel_overrides (
            guildId   TEXT    NOT NULL,
            channelId TEXT    NOT NULL,
            state     TEXT    NOT NULL CHECK(state IN ('allow','deny')),
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId)
          );
        `);
      }


      if (!hasTable('antilink_channel_overrides')) {
        db.exec(`
          CREATE TABLE antilink_channel_overrides (
            guildId   TEXT    NOT NULL,
            channelId TEXT    NOT NULL,
            state     TEXT    NOT NULL CHECK(state IN ('allow','deny')),
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, channelId)
          );
        `);
      }


      if (!hasTable('formulaires')) {
        db.exec(`
          CREATE TABLE formulaires (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId     TEXT    NOT NULL,
            name        TEXT    NOT NULL,
            buttonLabel TEXT    NOT NULL DEFAULT 'Répondre',
            buttonEmoji TEXT,
            logChannel  TEXT,
            questions   TEXT    NOT NULL DEFAULT '[]',
            messageId   TEXT,
            channelId   TEXT,
            createdBy   TEXT    NOT NULL,
            createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
            updatedAt   INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(guildId, name)
          );

          CREATE TABLE formulaire_responses (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            formulaireId INTEGER NOT NULL REFERENCES formulaires(id) ON DELETE CASCADE,
            userId       TEXT    NOT NULL,
            answers      TEXT    NOT NULL DEFAULT '[]',
            createdAt    INTEGER NOT NULL DEFAULT (unixepoch())
          );
        `);
      }


      if (!hasTable('modmails')) {
        db.exec(`
          CREATE TABLE modmails (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId   TEXT    NOT NULL,
            userId    TEXT    NOT NULL,
            channelId TEXT    NOT NULL UNIQUE,
            status    TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
            claimedBy TEXT,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            closedAt  INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_modmails_guild
            ON modmails(guildId, status);
        `);
      }


      if (!hasTable('punish_steps')) {
        db.exec(`
          CREATE TABLE punish_steps (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId   TEXT    NOT NULL,
            strikes   INTEGER NOT NULL,
            window    INTEGER NOT NULL DEFAULT 3600,
            sanction  TEXT    NOT NULL CHECK(sanction IN ('warn','mute','kick','ban','tempban')),
            duration  INTEGER,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(guildId, strikes)
          );
        `);
      }


      if (!hasTable('strike_triggers')) {
        db.exec(`
          CREATE TABLE strike_triggers (
            guildId   TEXT    NOT NULL,
            trigger   TEXT    NOT NULL,
            strikes   INTEGER NOT NULL DEFAULT 1,
            ancienStr INTEGER NOT NULL DEFAULT 1,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, trigger)
          );
        `);
      }


      if (!hasTable('twitch_alerts')) {
        db.exec(`
          CREATE TABLE twitch_alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId     TEXT    NOT NULL,
            twitchLogin TEXT    NOT NULL,
            channelId   TEXT    NOT NULL,
            roleId      TEXT,
            message     TEXT,
            lastLiveId  TEXT,
            createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(guildId, twitchLogin)
          );
        `);
      }


      if (!hasTable('snipe_cache')) {
        db.exec(`
          CREATE TABLE snipe_cache (
            channelId   TEXT PRIMARY KEY,
            guildId     TEXT NOT NULL,
            content     TEXT,
            authorId    TEXT NOT NULL,
            authorTag   TEXT NOT NULL,
            attachments TEXT,
            deletedAt   INTEGER NOT NULL DEFAULT (unixepoch())
          );
        `);
      }


      if (hasTable('blacklist_rank') && !hasColumn('blacklist_rank', 'addedAt'))
        db.prepare(`ALTER TABLE blacklist_rank ADD COLUMN addedAt INTEGER NOT NULL DEFAULT (unixepoch())`).run();


      if (!hasColumn('sanctions', 'userTag'))
        db.prepare(`ALTER TABLE sanctions ADD COLUMN userTag TEXT`).run();
      if (!hasColumn('sanctions', 'moderatorTag'))
        db.prepare(`ALTER TABLE sanctions ADD COLUMN moderatorTag TEXT`).run();
    }
  },


  {
    version: 10,
    up(db) {
      const hasColumn = (table, col) =>
        db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

      if (!hasColumn('guild_config', 'autoDeleteDelay'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteDelay INTEGER NOT NULL DEFAULT 5`).run();
      if (!hasColumn('guild_config', 'autoDeleteModCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteModCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteModReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteModReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteSnipeCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteSnipeCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteSnipeReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteSnipeReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteErrorReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteErrorReplies INTEGER NOT NULL DEFAULT 1`).run();
      if (!hasColumn('guild_config', 'autoDeleteInfoCmds'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteInfoCmds INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteInfoReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteInfoReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteLockReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteLockReplies INTEGER NOT NULL DEFAULT 0`).run();
      if (!hasColumn('guild_config', 'autoDeleteRoleReplies'))
        db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteRoleReplies INTEGER NOT NULL DEFAULT 0`).run();
    }
  },

  {
    version: 11,
    up(db) {
      const hasTable = (name) =>
        !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

      if (!hasTable('warn_thresholds')) {
        db.exec(`
          CREATE TABLE warn_thresholds (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            guildId   TEXT    NOT NULL,
            threshold INTEGER NOT NULL,
            sanction  TEXT    NOT NULL CHECK(sanction IN ('mute','kick','ban','tempban')),
            duration  INTEGER,
            createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(guildId, threshold)
          );
          CREATE INDEX IF NOT EXISTS idx_warn_thresholds_guild
            ON warn_thresholds(guildId, threshold ASC);
        `);
      }
    }
  },


  {
  version: 12,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'autoDeleteRenewReply')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN autoDeleteRenewReply INTEGER NOT NULL DEFAULT 0
      `).run();
    }

    if (!hasColumn('guild_config', 'autoDeleteRenewDelay')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN autoDeleteRenewDelay INTEGER
      `).run();
    }

  }
},

{
  version: 13,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'useTimeout')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN useTimeout INTEGER NOT NULL DEFAULT 0
      `).run();
    }

    if (!hasColumn('guild_config', 'muteRoleId')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN muteRoleId TEXT
      `).run();
    }
  }
},

{
version: 14,
up(db) {
  const hasColumn = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

  if (!hasColumn('guild_config', 'modDmEnabled')) {
    db.prepare(`
      ALTER TABLE guild_config
      ADD COLUMN modDmEnabled INTEGER NOT NULL DEFAULT 1
      `).run();
    }
  }
},

{
  version: 15,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('sanctions', 'channelId')) {
      db.prepare(`ALTER TABLE sanctions ADD COLUMN channelId INTEGER`).run();
    }
  }
},


{
  version: 16,
  up(db) {
    db.exec(`
      ALTER TABLE sanctions RENAME TO sanctions_old;

      CREATE TABLE sanctions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId      TEXT    NOT NULL,
        userId       TEXT    NOT NULL,
        moderatorId  TEXT    NOT NULL,
        type         TEXT    NOT NULL CHECK(type IN (
          'warn','mute','cmute','kick','ban','tempban','unban','unmute','uncmute'
        )),
        reason       TEXT,
        duration     INTEGER,
        expiresAt    INTEGER,
        channelId    TEXT,
        active       INTEGER NOT NULL DEFAULT 1,
        createdAt    INTEGER NOT NULL DEFAULT (unixepoch()),
        updatedAt    INTEGER NOT NULL DEFAULT (unixepoch()),
        deletedAt    INTEGER,
        userTag      TEXT,
        moderatorTag TEXT
      );

      INSERT INTO sanctions (
        id, guildId, userId, moderatorId, type, reason, duration,
        expiresAt, channelId, active, createdAt, updatedAt, deletedAt,
        userTag, moderatorTag
      )
      SELECT
        id,
        guildId,
        userId,
        moderatorId,
        CASE
          WHEN type NOT IN ('warn','mute','cmute','kick','ban','tempban','unban','unmute','uncmute')
          THEN 'warn'
          ELSE type
        END,
        reason,
        duration,
        expiresAt,
        channelId,
        active,
        createdAt,
        updatedAt,
        deletedAt,
        userTag,
        moderatorTag
      FROM sanctions_old;

      DROP TABLE sanctions_old;

      CREATE INDEX IF NOT EXISTS idx_sanctions_guild_user
        ON sanctions(guildId, userId)
        WHERE deletedAt IS NULL;

      CREATE INDEX IF NOT EXISTS idx_sanctions_expires
        ON sanctions(expiresAt)
        WHERE active = 1 AND deletedAt IS NULL;
    `);
  }
},


{
  version: 17,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('antiraid_config', 'badwordList')) {
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN badwordList TEXT`).run();
    }
  }
},

{
  version: 18,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);


    if (!hasColumn('antiraid_config', 'antilinkEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antilinkEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antispamEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antispamEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiEveryoneEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryoneEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antibotEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibotEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiwebhookEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiwebhookEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antichannelEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antichannelEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antibanEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibanEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiupdateEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiupdateEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antidecoEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiroleEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiroleEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiunbanEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiunbanEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antibadwordEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibadwordEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antimassmentionEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antimassmentionEnabled INTEGER NOT NULL DEFAULT 0`).run();


    if (!hasColumn('antiraid_config', 'raidPingRole'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN raidPingRole TEXT`).run();
    if (!hasColumn('antiraid_config', 'creationLimit'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN creationLimit INTEGER NOT NULL DEFAULT 0`).run();

    if (!hasColumn('antiraid_config', 'antichannelThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antichannelThreshold INTEGER NOT NULL DEFAULT 3`).run();
    if (!hasColumn('antiraid_config', 'antichannelWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antichannelWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antichannelPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antichannelPunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antibanThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibanThreshold INTEGER NOT NULL DEFAULT 3`).run();
    if (!hasColumn('antiraid_config', 'antibanWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibanWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antibanPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibanPunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antidecoThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoThreshold INTEGER NOT NULL DEFAULT 5`).run();
    if (!hasColumn('antiraid_config', 'antidecoWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antidecoPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoPunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antiroleThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiroleThreshold INTEGER NOT NULL DEFAULT 3`).run();
    if (!hasColumn('antiraid_config', 'antiroleWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiroleWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antirolePunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antirolePunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antiunbanPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiunbanPunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antiwebhookPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiwebhookPunish TEXT NOT NULL DEFAULT 'derank'`).run();
    if (!hasColumn('antiraid_config', 'antimassmentionPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antimassmentionPunish TEXT NOT NULL DEFAULT 'warn'`).run();
    if (!hasColumn('antiraid_config', 'antitokenEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antitokenEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antitokenThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antitokenThreshold INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antitokenWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antitokenWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antilinkMode'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antilinkMode TEXT NOT NULL DEFAULT 'all'`).run();
    if (!hasColumn('antiraid_config', 'antimassmentionThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antimassmentionThreshold INTEGER NOT NULL DEFAULT 5`).run();
    if (!hasColumn('antiraid_config', 'antibotPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibotPunish TEXT NOT NULL DEFAULT 'kick'`).run();
    if (!hasColumn('antiraid_config', 'antiEveryonePunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryonePunish TEXT NOT NULL DEFAULT 'warn'`).run();
    if (!hasColumn('antiraid_config', 'antibadwordPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antibadwordPunish TEXT DEFAULT 'warn'`).run();
    if (!hasColumn('antiraid_config', 'badwordList'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN badwordList TEXT`).run();
  }
},


{
  version: 19,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('antiraid_config', 'punishSteps'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN punishSteps TEXT`).run();

    if (!hasColumn('antiraid_config', 'antidecoThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoThreshold INTEGER NOT NULL DEFAULT 5`).run();
    if (!hasColumn('antiraid_config', 'antidecoWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antidecoWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antiEveryoneThreshold'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryoneThreshold INTEGER NOT NULL DEFAULT 3`).run();
    if (!hasColumn('antiraid_config', 'antiEveryoneWindow'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiEveryoneWindow INTEGER NOT NULL DEFAULT 10`).run();
    if (!hasColumn('antiraid_config', 'antitokenLocked'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antitokenLocked INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'blrankMode'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN blrankMode TEXT NOT NULL DEFAULT 'all'`).run();
    if (!hasColumn('antiraid_config', 'blrankEnabled'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN blrankEnabled INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('antiraid_config', 'antiroleMode'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN antiroleMode TEXT NOT NULL DEFAULT 'all'`).run();
    if (!hasColumn('antiraid_config', 'securInvite'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN securInvite INTEGER NOT NULL DEFAULT 0`).run();
  }
},


{
  version: 20,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mute_role_backup (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId   TEXT    NOT NULL,
        userId    TEXT    NOT NULL,
        roleIds   TEXT    NOT NULL,
        restoreAt INTEGER NOT NULL,
        source    TEXT    NOT NULL DEFAULT 'automod',
        createdAt INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_mute_role_backup_restore
        ON mute_role_backup(restoreAt);
    `);
  }
},


{
  version: 21,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'soutienMode'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienMode TEXT NOT NULL DEFAULT 'status'`).run();
    if (!hasColumn('guild_config', 'soutienTag'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienTag TEXT`).run();
    if (!hasColumn('guild_config', 'soutienBadge'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN soutienBadge TEXT`).run();
  }
},


{
  version: 22,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'boostEmbedChannelId'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN boostEmbedChannelId TEXT`).run();
    if (!hasColumn('guild_config', 'boostEmbedMessage'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN boostEmbedMessage TEXT`).run();
  }
},

{
  version: 23,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'modmailOpenCooldown')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailOpenCooldown INTEGER NOT NULL DEFAULT 300`).run();
    }
    if (!hasColumn('guild_config', 'modmailSpamLimit')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailSpamLimit INTEGER NOT NULL DEFAULT 5`).run();
    }
    if (!hasColumn('guild_config', 'modmailSpamWindow')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailSpamWindow INTEGER NOT NULL DEFAULT 30`).run();
    }
    if (!hasColumn('guild_config', 'modmailSpamBlockTime')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailSpamBlockTime INTEGER NOT NULL DEFAULT 300`).run();
    }
  }
},


{
  version: 24,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('giveaways', 'emoji')) {
      db.prepare(`ALTER TABLE giveaways ADD COLUMN emoji TEXT NOT NULL DEFAULT '🎉'`).run();
    }
    if (!hasColumn('giveaways', 'entryMode')) {
      db.prepare(`ALTER TABLE giveaways ADD COLUMN entryMode TEXT NOT NULL DEFAULT 'button'`).run();
    }
  }
},

{
  version: 25,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'welcomeEmbedEnabled')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN welcomeEmbedEnabled INTEGER NOT NULL DEFAULT 0
      `).run();
    }

    if (!hasColumn('guild_config', 'welcomeEmbedJson')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN welcomeEmbedJson TEXT
      `).run();
    }

    if (!hasColumn('guild_config', 'leaveEmbedEnabled')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN leaveEmbedEnabled INTEGER NOT NULL DEFAULT 0
      `).run();
    }

    if (!hasColumn('guild_config', 'leaveEmbedJson')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN leaveEmbedJson TEXT
      `).run();
    }
  }
},

{
  version: 26,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tempvoc_config (
        guildId       TEXT PRIMARY KEY,
        enabled       INTEGER NOT NULL DEFAULT 0,
        joinChannelId TEXT,
        categoryId    TEXT,
        nameTemplate  TEXT NOT NULL DEFAULT 'Vocal de {username}',
        userLimit     INTEGER NOT NULL DEFAULT 0,
        createdAt     INTEGER NOT NULL DEFAULT (unixepoch()),
        updatedAt     INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS tempvoc_channels (
        guildId   TEXT NOT NULL,
        channelId TEXT PRIMARY KEY,
        ownerId   TEXT NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_tempvoc_channels_guild
        ON tempvoc_channels(guildId);
    `);
  }
},

{
  version: 27,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS role_menus (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId     TEXT    NOT NULL,
        channelId   TEXT,
        messageId   TEXT UNIQUE,
        title       TEXT    NOT NULL DEFAULT 'Menu de rôles',
        description TEXT    NOT NULL DEFAULT 'Sélectionnez les rôles que vous souhaitez obtenir.',
        placeholder TEXT    NOT NULL DEFAULT 'Choisir un rôle',
        mode        TEXT    NOT NULL DEFAULT 'toggle' CHECK(mode IN ('toggle','add','remove')),
        minValues   INTEGER NOT NULL DEFAULT 0,
        maxValues   INTEGER NOT NULL DEFAULT 1,
        createdBy   TEXT    NOT NULL,
        createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
        updatedAt   INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_role_menus_guild
        ON role_menus(guildId);

      CREATE TABLE IF NOT EXISTS role_menu_options (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        menuId      INTEGER NOT NULL REFERENCES role_menus(id) ON DELETE CASCADE,
        roleId      TEXT    NOT NULL,
        label       TEXT    NOT NULL,
        description TEXT,
        emoji       TEXT,
        createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(menuId, roleId)
      );

      CREATE INDEX IF NOT EXISTS idx_role_menu_options_menu
        ON role_menu_options(menuId);
    `);
  }
},


{
  version: 28,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('role_menus', 'componentType')) {
      db.prepare(`
        ALTER TABLE role_menus
        ADD COLUMN componentType TEXT NOT NULL DEFAULT 'select'
      `).run();


      if (hasColumn('role_menus', 'panelType')) {
        db.prepare(`
          UPDATE role_menus
          SET componentType = CASE
            WHEN panelType = 'button' THEN 'button'
            WHEN panelType = 'select' THEN 'select'
            ELSE 'select'
          END
        `).run();
      }
    }

    if (!hasColumn('role_menus', 'buttonStyle')) {
      db.prepare(`
        ALTER TABLE role_menus
        ADD COLUMN buttonStyle TEXT NOT NULL DEFAULT 'Secondary'
      `).run();
    }
  }
},

{
  version: 29,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('role_menus', 'roleSpacing')) {
      db.prepare(`
        ALTER TABLE role_menus
        ADD COLUMN roleSpacing TEXT NOT NULL DEFAULT 'normal'
      `).run();
    }

    if (!hasColumn('role_menus', 'roleSeparator')) {
      db.prepare(`
        ALTER TABLE role_menus
        ADD COLUMN roleSeparator TEXT NOT NULL DEFAULT '・'
      `).run();
    }

    if (!hasColumn('role_menus', 'roleFormat')) {
      db.prepare(`
        ALTER TABLE role_menus
        ADD COLUMN roleFormat TEXT NOT NULL DEFAULT '{emoji} {separator} {role}'
      `).run();
    }
  }
},

{
  version: 30,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS autoroles (
        guildId   TEXT    NOT NULL,
        roleId    TEXT    NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guildId, roleId)
      );

      CREATE INDEX IF NOT EXISTS idx_autoroles_guild
        ON autoroles(guildId);
    `);
  }
},

{
  version: 31,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'helpType')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN helpType TEXT NOT NULL DEFAULT 'hybrid'
      `).run();
    }

    if (!hasColumn('guild_config', 'helpAliasEnabled')) {
      db.prepare(`
        ALTER TABLE guild_config
        ADD COLUMN helpAliasEnabled INTEGER NOT NULL DEFAULT 1
      `).run();
    }
  }
},


{
  version: 32,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS command_cooldowns (
        guildId     TEXT    NOT NULL,
        commandName TEXT    NOT NULL,
        cooldownMs  INTEGER NOT NULL DEFAULT 0,
        updatedAt   INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (guildId, commandName)
      );
    `);
  }
},

{
  version: 33,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'vcEmbedJson')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN vcEmbedJson TEXT`).run();
    }
  }
},

{
  version: 34,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    const adds = [
      ['custom_commands', 'enabled',        'INTEGER NOT NULL DEFAULT 1'],
      ['custom_commands', 'dmResponse',     'INTEGER NOT NULL DEFAULT 0'],
      ['custom_commands', 'buttonsJson',    'TEXT'],
      ['custom_commands', 'reactionsJson',  'TEXT'],
      ['custom_commands', 'rolesJson',      'TEXT'],
      ['custom_commands', 'requiredRoleId', 'TEXT'],
      ['custom_commands', 'deniedRoleId',   'TEXT'],
      ['custom_commands', 'cooldown',       'INTEGER NOT NULL DEFAULT 0'],
      ['custom_commands', 'logEnabled',     'INTEGER NOT NULL DEFAULT 0'],
    ];

    for (const [table, col, type] of adds) {
      if (!hasColumn(table, col)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    }
  }
},


{
  version: 35,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
},

{
  version: 36,
  up(db) {
    db.prepare(`UPDATE antiraid_config SET blrankMode = 'all' WHERE blrankMode = 'blacklist'`).run();
  }
},

{
  version: 37,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS soutien_tracking (
        guildId    TEXT    NOT NULL,
        userId     TEXT    NOT NULL,
        grantedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guildId, userId)
      );

      CREATE TABLE IF NOT EXISTS voice_stats (
        guildId      TEXT    NOT NULL,
        userId       TEXT    NOT NULL,
        totalSeconds INTEGER NOT NULL DEFAULT 0,
        channelId    TEXT,
        joinedAt     INTEGER,
        PRIMARY KEY (guildId, userId)
      );
    `);
  }
},

{
  version: 38,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('soutien_tracking', 'roleGrantedAt'))
      db.exec('ALTER TABLE soutien_tracking ADD COLUMN roleGrantedAt INTEGER');
    if (!hasColumn('soutien_tracking', 'statusValidSince'))
      db.exec('ALTER TABLE soutien_tracking ADD COLUMN statusValidSince INTEGER');
    if (!hasColumn('soutien_tracking', 'tagValidSince'))
      db.exec('ALTER TABLE soutien_tracking ADD COLUMN tagValidSince INTEGER');
    if (!hasColumn('soutien_tracking', 'lastCheckedAt'))
      db.exec('ALTER TABLE soutien_tracking ADD COLUMN lastCheckedAt INTEGER');
    if (!hasColumn('voice_stats', 'lastStaleClearAt'))
      db.exec('ALTER TABLE voice_stats ADD COLUMN lastStaleClearAt INTEGER');


    if (hasColumn('soutien_tracking', 'grantedAt')) {
      db.prepare('UPDATE soutien_tracking SET roleGrantedAt = COALESCE(roleGrantedAt, grantedAt) WHERE grantedAt IS NOT NULL').run();
    }
  }
},

{
  version: 39,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('giveaways', 'requiredRoleId'))
      db.exec('ALTER TABLE giveaways ADD COLUMN requiredRoleId TEXT');
    if (!hasColumn('giveaways', 'deniedRoleId'))
      db.exec('ALTER TABLE giveaways ADD COLUMN deniedRoleId TEXT');
    if (!hasColumn('giveaways', 'soutienRequired'))
      db.exec('ALTER TABLE giveaways ADD COLUMN soutienRequired INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('giveaways', 'statusRequired'))
      db.exec('ALTER TABLE giveaways ADD COLUMN statusRequired INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('giveaways', 'tagRequired'))
      db.exec('ALTER TABLE giveaways ADD COLUMN tagRequired INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('giveaways', 'requireBeforeStart'))
      db.exec('ALTER TABLE giveaways ADD COLUMN requireBeforeStart INTEGER NOT NULL DEFAULT 1');
    if (!hasColumn('giveaways', 'minLevel'))
      db.exec('ALTER TABLE giveaways ADD COLUMN minLevel INTEGER');
    if (!hasColumn('giveaways', 'voiceRequired'))
      db.exec('ALTER TABLE giveaways ADD COLUMN voiceRequired INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('giveaways', 'minVoiceSeconds'))
      db.exec('ALTER TABLE giveaways ADD COLUMN minVoiceSeconds INTEGER');
  }
},

{
  version: 40,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS giveaway_config_presets (
        guildId    TEXT    NOT NULL,
        prizeKey   TEXT    NOT NULL,
        prizeLabel TEXT    NOT NULL,
        configJson TEXT    NOT NULL,
        createdAt  INTEGER NOT NULL DEFAULT (unixepoch()),
        updatedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guildId, prizeKey)
      )
    `);
  }
},

{
  version: 41,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'autoDeleteStatsCmds'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteStatsCmds INTEGER NOT NULL DEFAULT 0`).run();
    if (!hasColumn('guild_config', 'autoDeleteStatsReplies'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN autoDeleteStatsReplies INTEGER NOT NULL DEFAULT 0`).run();
  }
},


{
  version: 42,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('role_menus', 'requiredRoleIds'))
      db.prepare(`ALTER TABLE role_menus ADD COLUMN requiredRoleIds TEXT`).run();
    if (!hasColumn('role_menus', 'forbiddenRoleIds'))
      db.prepare(`ALTER TABLE role_menus ADD COLUMN forbiddenRoleIds TEXT`).run();
  }
},

{
  version: 43,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('reminders', 'customCommandName'))
      db.prepare(`ALTER TABLE reminders ADD COLUMN customCommandName TEXT`).run();
    if (!hasColumn('reminders', 'repeatEvery'))
      db.prepare(`ALTER TABLE reminders ADD COLUMN repeatEvery INTEGER`).run();
  }
},

{
  version: 44,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('ticket_panels', 'inactiveCloseDelay'))
      db.prepare('ALTER TABLE ticket_panels ADD COLUMN inactiveCloseDelay INTEGER').run();

    if (!hasColumn('tickets', 'lastActivityAt'))
      db.prepare('ALTER TABLE tickets ADD COLUMN lastActivityAt INTEGER').run();

    db.prepare(`UPDATE tickets SET lastActivityAt = COALESCE(updatedAt, createdAt, unixepoch()) WHERE status = 'open' AND lastActivityAt IS NULL`).run();
  }
},

{
  version: 45,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('custom_commands', 'triggerByMessage'))
      db.prepare('ALTER TABLE custom_commands ADD COLUMN triggerByMessage INTEGER NOT NULL DEFAULT 1').run();
  }
},

{
  version: 46,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'leaveAutoDeleteDelay'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN leaveAutoDeleteDelay INTEGER NOT NULL DEFAULT 0').run();
  }
},

{
  version: 47,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'welcomeAutoDeleteDelay'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN welcomeAutoDeleteDelay INTEGER NOT NULL DEFAULT 0').run();
  }
},

{
  version: 48,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'welcomeAfterVerify'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN welcomeAfterVerify INTEGER NOT NULL DEFAULT 0').run();
  }
},


{
  version: 49,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('soutien_tracking', 'lazyGranted'))
      db.exec('ALTER TABLE soutien_tracking ADD COLUMN lazyGranted INTEGER NOT NULL DEFAULT 0');
  }
},


{
  version: 50,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('guild_config', 'helpMessage'))
      db.exec('ALTER TABLE guild_config ADD COLUMN helpMessage TEXT');
  }
},


{
  version: 51,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('guild_config', 'verifyDuration'))
      db.exec('ALTER TABLE guild_config ADD COLUMN verifyDuration INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('guild_config', 'verifyLogChannel'))
      db.exec('ALTER TABLE guild_config ADD COLUMN verifyLogChannel TEXT');
    if (!hasColumn('guild_config', 'verifyButtonLabel'))
      db.exec('ALTER TABLE guild_config ADD COLUMN verifyButtonLabel TEXT');
    if (!hasColumn('guild_config', 'verifyButtonEmoji'))
      db.exec('ALTER TABLE guild_config ADD COLUMN verifyButtonEmoji TEXT');
    if (!hasColumn('guild_config', 'verifyButtonStyle'))
      db.exec('ALTER TABLE guild_config ADD COLUMN verifyButtonStyle TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_verifications (
        guildId   TEXT    NOT NULL,
        userId    TEXT    NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guildId, userId)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_verifications_expires
        ON pending_verifications(expiresAt);
    `);
  }
},


{
  version: 52,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('guild_config', 'welcomeSendMode')) {
      db.exec("ALTER TABLE guild_config ADD COLUMN welcomeSendMode TEXT NOT NULL DEFAULT 'message'");
    }
  }
},


{
  version: 53,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('guild_config', 'leaveSendMode')) {
      db.exec('ALTER TABLE guild_config ADD COLUMN leaveSendMode TEXT');
    }
  }
},


{
  version: 54,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('custom_commands', 'selectsJson')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN selectsJson TEXT');
    }
  }
},


{
  version: 55,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);


    if (!tableExists('custom_commands')) return;

    if (!hasColumn('custom_commands', 'responseMode')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN responseMode TEXT');
    }
    if (!hasColumn('custom_commands', 'responseChannelId')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN responseChannelId TEXT');
    }
    if (!hasColumn('custom_commands', 'logChannelId')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN logChannelId TEXT');
    }
    if (!hasColumn('custom_commands', 'targetMemberEnabled')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN targetMemberEnabled INTEGER NOT NULL DEFAULT 0');
    }


    if (hasColumn('custom_commands', 'dmResponse')) {
      db.exec(`
        UPDATE custom_commands
           SET responseMode = CASE WHEN dmResponse = 1 THEN 'dm' ELSE 'local' END
         WHERE responseMode IS NULL OR responseMode = ''
      `);
    } else {
      db.exec(`
        UPDATE custom_commands
           SET responseMode = 'local'
         WHERE responseMode IS NULL OR responseMode = ''
      `);
    }
  }
},

{
  version: 56,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_component_drafts (
        guildId   TEXT NOT NULL,
        ownerId   TEXT NOT NULL,
        json      TEXT NOT NULL DEFAULT '[]',
        updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (guildId, ownerId)
      )
    `);
  }
},


{
  version: 57,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!tableExists('custom_commands')) return;
    if (!hasColumn('custom_commands', 'componentsJson')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN componentsJson TEXT DEFAULT NULL');
    }
  }
},

{
  version: 61,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!tableExists('custom_commands')) return;
    if (!hasColumn('custom_commands', 'customPerm')) {
      db.exec("ALTER TABLE custom_commands ADD COLUMN customPerm TEXT NOT NULL DEFAULT 'everyone'");
    }
    if (!hasColumn('custom_commands', 'description')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN description TEXT DEFAULT NULL');
    }
  },
},

{
  version: 60,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!tableExists('custom_commands')) return;
    if (!hasColumn('custom_commands', 'componentsPagesJson')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN componentsPagesJson TEXT DEFAULT NULL');
    }
  },
},


{
  version: 59,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!tableExists('custom_commands')) return;
    if (!hasColumn('custom_commands', 'allowedChannelIds')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN allowedChannelIds TEXT DEFAULT NULL');
    }
    if (!hasColumn('custom_commands', 'blockedChannelIds')) {
      db.exec('ALTER TABLE custom_commands ADD COLUMN blockedChannelIds TEXT DEFAULT NULL');
    }
  },
},

{
  version: 58,
  up(db) {
    const tableExists = (table) =>
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!tableExists('custom_commands')) return;

    const adds = [
      ['enabled',             'INTEGER NOT NULL DEFAULT 1'],
      ['deleteMsg',           'INTEGER NOT NULL DEFAULT 0'],
      ['deleteDelay',         'INTEGER'],
      ['embedData',           'TEXT'],
      ['dmResponse',          'INTEGER NOT NULL DEFAULT 0'],
      ['buttonsJson',         'TEXT'],
      ['reactionsJson',       'TEXT'],
      ['rolesJson',           'TEXT'],
      ['requiredRoleId',      'TEXT'],
      ['deniedRoleId',        'TEXT'],
      ['cooldown',            'INTEGER NOT NULL DEFAULT 0'],
      ['logEnabled',          'INTEGER NOT NULL DEFAULT 0'],
      ['triggerByMessage',    'INTEGER NOT NULL DEFAULT 1'],
      ['selectsJson',         'TEXT'],
      ['responseMode',        `TEXT DEFAULT 'local'`],
      ['responseChannelId',   'TEXT'],
      ['logChannelId',        'TEXT'],
      ['targetMemberEnabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['componentsJson',      'TEXT DEFAULT NULL'],
    ];

    for (const [col, type] of adds) {
      if (!hasColumn('custom_commands', col)) {
        db.exec(`ALTER TABLE custom_commands ADD COLUMN ${col} ${type}`);
      }
    }


    if (hasColumn('custom_commands', 'responseMode')) {
      if (hasColumn('custom_commands', 'dmResponse')) {
        db.exec(`
          UPDATE custom_commands
             SET responseMode = CASE WHEN dmResponse = 1 THEN 'dm' ELSE 'local' END
           WHERE responseMode IS NULL OR responseMode = ''
        `);
      } else {
        db.exec(`
          UPDATE custom_commands
             SET responseMode = 'local'
           WHERE responseMode IS NULL OR responseMode = ''
        `);
      }
    }
  }
},

{
  version: 62,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('role_menus', 'feedbackMode'))
      db.prepare("ALTER TABLE role_menus ADD COLUMN feedbackMode TEXT NOT NULL DEFAULT 'ephemeral'").run();
  },
},


{
  version: 63,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('tempvoc_config', 'requiredRoles'))
      db.exec("ALTER TABLE tempvoc_config ADD COLUMN requiredRoles TEXT DEFAULT '[]'");
    if (!hasColumn('tempvoc_config', 'blockedRoles'))
      db.exec("ALTER TABLE tempvoc_config ADD COLUMN blockedRoles TEXT DEFAULT '[]'");
    if (!hasColumn('tempvoc_config', 'ownerManageChannel'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN ownerManageChannel INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('tempvoc_config', 'ownerManagePerms'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN ownerManagePerms INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('tempvoc_config', 'ownerMoveMembers'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN ownerMoveMembers INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('tempvoc_config', 'defaultInvisible'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN defaultInvisible INTEGER NOT NULL DEFAULT 0');
  },
},


{
  version: 64,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);
    const hasTable = (name) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

    if (!hasColumn('guild_config', 'suggestionPendingChannel'))
      db.exec('ALTER TABLE guild_config ADD COLUMN suggestionPendingChannel TEXT');
    if (!hasColumn('guild_config', 'suggestionValidatedChannel'))
      db.exec('ALTER TABLE guild_config ADD COLUMN suggestionValidatedChannel TEXT');
    if (hasTable('suggestions') && !hasColumn('suggestions', 'validatedMessageId'))
      db.exec('ALTER TABLE suggestions ADD COLUMN validatedMessageId TEXT');
  },
},

{
  version: 65,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('giveaways', 'forcedWinners'))
      db.exec('ALTER TABLE giveaways ADD COLUMN forcedWinners TEXT');
    if (!hasColumn('giveaways', 'requiredGuildIds'))
      db.exec('ALTER TABLE giveaways ADD COLUMN requiredGuildIds TEXT');
  },
},

{
  version: 67,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('antiraid_config', 'creationLimitPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN creationLimitPunish TEXT NOT NULL DEFAULT 'kick'`).run();

    if (!hasColumn('antiraid_config', 'blrankPunish'))
      db.prepare(`ALTER TABLE antiraid_config ADD COLUMN blrankPunish TEXT NOT NULL DEFAULT 'derank'`).run();
  },
},

{
  version: 66,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_activity (
        id       INTEGER PRIMARY KEY CHECK (id = 1),
        type     TEXT,
        messages TEXT,
        url      TEXT,
        status   TEXT DEFAULT 'online',
        removed  INTEGER DEFAULT 0
      )
    `);
  },
},

{
  version: 68,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'modDmWarn'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmWarn INTEGER NOT NULL DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmKick'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmKick INTEGER NOT NULL DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmBan'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmBan INTEGER NOT NULL DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmTempban'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTempban INTEGER NOT NULL DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmMute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmMute INTEGER NOT NULL DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmUnmute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmUnmute INTEGER NOT NULL DEFAULT 1`).run();
  },
},

{
  version: 69,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'modDmTemplateGlobal'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateGlobal TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateWarn'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateWarn TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateKick'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateKick TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateBan'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateBan TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateTempban'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateTempban TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateMute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateMute TEXT`).run();

    if (!hasColumn('guild_config', 'modDmTemplateUnmute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmTemplateUnmute TEXT`).run();
  },
},

{
  version: 70,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'modDmModeGlobal'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeGlobal INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeWarn'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeWarn INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeKick'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeKick INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeBan'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeBan INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeTempban'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeTempban INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeMute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeMute INTEGER DEFAULT 1`).run();

    if (!hasColumn('guild_config', 'modDmModeUnmute'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modDmModeUnmute INTEGER DEFAULT 1`).run();
  },
},


{
  version: 72,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'modmailUnavailableInterval')) {
      db.prepare(`ALTER TABLE guild_config ADD COLUMN modmailUnavailableInterval INTEGER NOT NULL DEFAULT 3600`).run();
    }
  }
},


{
  version: 71,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS buyer_recovery (
        id        INTEGER PRIMARY KEY,
        codeHash  TEXT    NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS bot_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
},

{
  version: 73,
  up(db) {
    const hasColumn = (table, col) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

    if (!hasColumn('guild_config', 'reportReasonRequired'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN reportReasonRequired INTEGER NOT NULL DEFAULT 1`).run();
    if (!hasColumn('guild_config', 'reportReasons'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN reportReasons TEXT`).run();
    if (!hasColumn('guild_config', 'reportMentionRoles'))
      db.prepare(`ALTER TABLE guild_config ADD COLUMN reportMentionRoles TEXT`).run();

    db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId         TEXT    NOT NULL,
        reporterId      TEXT    NOT NULL,
        targetId        TEXT    NOT NULL,
        targetMessageId TEXT,
        targetChannelId TEXT,
        reason          TEXT    NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'open',
        handledBy       TEXT,
        handledAt       INTEGER,
        createdAt       INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_reports_guild    ON reports(guildId);
      CREATE INDEX IF NOT EXISTS idx_reports_target   ON reports(guildId, targetId);
      CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(guildId, reporterId);
      CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(guildId, status);
    `);
  },
},


{
  version: 74,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_guild_purges (
        guildId   TEXT PRIMARY KEY,
        markedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
        reason    TEXT
      );
    `);
  },
},


{
  version: 76,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('antiraid_config', 'antivanityEnabled'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antivanityEnabled INTEGER NOT NULL DEFAULT 0').run();
    if (!hasColumn('antiraid_config', 'antivanityPunish'))
      db.prepare("ALTER TABLE antiraid_config ADD COLUMN antivanityPunish TEXT NOT NULL DEFAULT 'derank'").run();
  },
},

{
  version: 77,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('antiraid_config', 'antilinkAllowedChannels'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkAllowedChannels TEXT').run();
    if (!hasColumn('antiraid_config', 'antilinkAllowedCategories'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkAllowedCategories TEXT').run();
    if (!hasColumn('antiraid_config', 'antilinkImageRoles'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkImageRoles TEXT').run();
  },
},

{
  version: 78,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('antiraid_config', 'antilinkMediaWhitelist'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkMediaWhitelist TEXT').run();
  },
},


{
  version: 75,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS soutien_manual_ignored (
        guildId   TEXT    NOT NULL,
        userId    TEXT    NOT NULL,
        roleId    TEXT    NOT NULL,
        ignoredAt INTEGER NOT NULL DEFAULT (unixepoch()),
        ignoredBy TEXT,
        PRIMARY KEY (guildId, userId, roleId)
      );
    `);
  },
},


{
  version: 79,
  up(db) {
    _repairRoleMenusForSync(db);
  },
},


{
  version: 80,
  up(db) {
    _repairRoleMenusForSync(db);
  },
},


{
  version: 81,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('antiraid_config', 'antilinkMediaDomains'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkMediaDomains TEXT').run();
  },
},

{
  version: 82,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('antiraid_config', 'antilinkSoftEnabled'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkSoftEnabled INTEGER NOT NULL DEFAULT 1').run();
    if (!hasColumn('antiraid_config', 'antilinkSoftWindow'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkSoftWindow INTEGER NOT NULL DEFAULT 600').run();
    if (!hasColumn('antiraid_config', 'antilinkSoftThreshold'))
      db.prepare('ALTER TABLE antiraid_config ADD COLUMN antilinkSoftThreshold INTEGER NOT NULL DEFAULT 3').run();
  },
},

{
  version: 83,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS xp_ignored_channels (
        guildId   TEXT NOT NULL,
        channelId TEXT NOT NULL,
        PRIMARY KEY (guildId, channelId)
      );

      CREATE TABLE IF NOT EXISTS xp_role_multipliers (
        guildId    TEXT    NOT NULL,
        roleId     TEXT    NOT NULL,
        multiplier REAL    NOT NULL DEFAULT 1.0,
        PRIMARY KEY (guildId, roleId)
      );

      CREATE TABLE IF NOT EXISTS xp_channel_cooldowns (
        guildId   TEXT    NOT NULL,
        channelId TEXT    NOT NULL,
        cooldown  INTEGER NOT NULL DEFAULT 60,
        PRIMARY KEY (guildId, channelId)
      );
    `);

    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('tickets', 'rating'))
      db.prepare('ALTER TABLE tickets ADD COLUMN rating INTEGER').run();
    if (!hasColumn('tickets', 'ratingComment'))
      db.prepare('ALTER TABLE tickets ADD COLUMN ratingComment TEXT').run();
    if (!hasColumn('tickets', 'messageCount'))
      db.prepare('ALTER TABLE tickets ADD COLUMN messageCount INTEGER NOT NULL DEFAULT 0').run();
    if (!hasColumn('guild_config', 'ticketRatingChannel'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN ticketRatingChannel TEXT').run();
    if (!hasColumn('guild_config', 'ticketRatingEnabled'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN ticketRatingEnabled INTEGER NOT NULL DEFAULT 1').run();
  },
},

{
  version: 84,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    if (!hasColumn('guild_config', 'ticketRatingChannel'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN ticketRatingChannel TEXT').run();
    if (!hasColumn('guild_config', 'ticketRatingEnabled'))
      db.prepare('ALTER TABLE guild_config ADD COLUMN ticketRatingEnabled INTEGER NOT NULL DEFAULT 1').run();
  },
},

{
  version: 85,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

    const counterColumns = [
      'counterMembersChannel',
      'counterOnlineChannel',
      'counterVoiceChannel',
      'counterChannelsChannel',
      'counterTextchannelsChannel',
      'counterVoicechannelsChannel',
      'counterThreadsChannel',
      'counterBoostsChannel',
      'counterBoostlevelChannel',
      'counterEmojisChannel',
    ];

    for (const col of counterColumns) {
      if (!hasColumn('guild_config', col)) {
        db.prepare(`ALTER TABLE guild_config ADD COLUMN ${col} TEXT`).run();
      }
    }
  },
},

{
  version: 86,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_buyers (
        userId    TEXT PRIMARY KEY,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  },
},
{
  version: 87,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);
    if (!hasColumn('tempvoc_config', 'embedChannelId'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN embedChannelId TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tempvoc_bans (
        guildId   TEXT NOT NULL,
        channelId TEXT NOT NULL,
        userId    TEXT NOT NULL,
        createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (channelId, userId)
      );
      CREATE INDEX IF NOT EXISTS idx_tempvoc_bans_channel
        ON tempvoc_bans(channelId);
    `);
  },
},

{
  version: 88,
  up(db) {
    const hasColumn = (table, col) =>
      !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);
    if (!hasColumn('tempvoc_config', 'embedMessageId'))
      db.exec('ALTER TABLE tempvoc_config ADD COLUMN embedMessageId TEXT');
  },
},

{
  version: 89,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS invite_tracking (
        guildId   TEXT    NOT NULL,
        userId    TEXT    NOT NULL,
        inviterId TEXT,
        joinedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
        leftAt    INTEGER,
        PRIMARY KEY (guildId, userId)
      );

      CREATE TABLE IF NOT EXISTS invite_bonus (
        guildId TEXT    NOT NULL,
        userId  TEXT    NOT NULL,
        bonus   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guildId, userId)
      );

      CREATE TABLE IF NOT EXISTS invite_rewards (
        guildId   TEXT    NOT NULL,
        threshold INTEGER NOT NULL,
        roleId    TEXT    NOT NULL,
        PRIMARY KEY (guildId, threshold)
      );

      CREATE INDEX IF NOT EXISTS idx_invite_tracking_inviter
        ON invite_tracking(guildId, inviterId);
    `);
  },
},
  {
    version: 90,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prevnames (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          userId    TEXT    NOT NULL,
          guildId   TEXT,
          type      TEXT    NOT NULL CHECK(type IN ('username','globalname','nickname')),
          name      TEXT    NOT NULL,
          changedAt INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_prevnames_user
          ON prevnames(userId, changedAt DESC);

        CREATE INDEX IF NOT EXISTS idx_prevnames_guild_user
          ON prevnames(guildId, userId, changedAt DESC);
      `);
    },
  },

  {
    version: 91,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS seen (
          userId    TEXT    NOT NULL,
          guildId   TEXT    NOT NULL,
          seenAt    INTEGER NOT NULL DEFAULT (unixepoch()),
          channelId TEXT,
          PRIMARY KEY (userId, guildId)
        );

        CREATE INDEX IF NOT EXISTS idx_seen_guild
          ON seen(guildId, seenAt DESC);
      `);
    },
  },

  {
    version: 92,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rolelog (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          userId    TEXT    NOT NULL,
          guildId   TEXT    NOT NULL,
          roleId    TEXT    NOT NULL,
          action    TEXT    NOT NULL CHECK(action IN ('add','remove')),
          changedAt INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_rolelog_user_guild
          ON rolelog(userId, guildId, changedAt DESC);
      `);
    },
  },

  {
    version: 93,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS keywords (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          userId  TEXT    NOT NULL,
          guildId TEXT    NOT NULL,
          keyword TEXT    NOT NULL COLLATE NOCASE,
          UNIQUE(userId, guildId, keyword)
        );

        CREATE INDEX IF NOT EXISTS idx_keywords_guild
          ON keywords(guildId);
      `);
    },
  },

  {
    version: 94,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS msgcount (
          userId  TEXT    NOT NULL,
          guildId TEXT    NOT NULL,
          day     TEXT    NOT NULL,
          count   INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (userId, guildId, day)
        );

        CREATE INDEX IF NOT EXISTS idx_msgcount_guild_day
          ON msgcount(guildId, day);
      `);
    },
  },

  // ── Migration 95 : Seen lastMessage column ────────────────────────────────
  {
    version: 95,
    up(db) {
      const cols = db.prepare(`PRAGMA table_info(seen)`).all();
      if (!cols.some(c => c.name === 'lastMessage')) {
        db.exec(`ALTER TABLE seen ADD COLUMN lastMessage TEXT;`);
      }
    },
  },

  // ── Migration 96 : Keywords ownerId + targetUserId ────────────────────────
  {
    version: 96,
    up(db) {
      const cols = db.prepare(`PRAGMA table_info(keywords)`).all();
      const names = cols.map(c => c.name);
      if (!names.includes('ownerId')) {
        db.exec(`ALTER TABLE keywords ADD COLUMN ownerId TEXT;`);
        db.exec(`UPDATE keywords SET ownerId = userId WHERE ownerId IS NULL;`);
      }
      if (!names.includes('targetUserId')) {
        db.exec(`ALTER TABLE keywords ADD COLUMN targetUserId TEXT;`);
        db.exec(`UPDATE keywords SET targetUserId = userId WHERE targetUserId IS NULL;`);
      }
    },
  },

  {
    version: 97,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS keywords2 (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          ownerId      TEXT    NOT NULL,
          guildId      TEXT    NOT NULL,
          keyword      TEXT    NOT NULL COLLATE NOCASE,
          targetUserId TEXT    NOT NULL,
          UNIQUE(ownerId, guildId, keyword, targetUserId)
        );
        CREATE INDEX IF NOT EXISTS idx_keywords2_guild ON keywords2(guildId);
        CREATE INDEX IF NOT EXISTS idx_keywords2_owner ON keywords2(ownerId, guildId);
      `);
      db.exec(`
        INSERT OR IGNORE INTO keywords2 (ownerId, guildId, keyword, targetUserId)
        SELECT COALESCE(ownerId, userId), guildId, keyword, COALESCE(targetUserId, userId)
        FROM keywords;
      `);
    },
  },

  // ── Migration 98 : Confessions ────────────────────────────────────────────
  {
    version: 98,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS confession_config (
          guildId           TEXT    PRIMARY KEY,
          enabled           INTEGER NOT NULL DEFAULT 0,
          channelId         TEXT,
          reviewChannelId   TEXT,
          reviewEnabled     INTEGER NOT NULL DEFAULT 0,
          revealAllowed     INTEGER NOT NULL DEFAULT 1,
          reactionsEnabled  INTEGER NOT NULL DEFAULT 1,
          replyEnabled      INTEGER NOT NULL DEFAULT 1,
          cooldownSeconds   INTEGER NOT NULL DEFAULT 300,
          blacklist         TEXT    NOT NULL DEFAULT '',
          buttonMsgId       TEXT,
          allowAnonymousReply INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS confessions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          authorId    TEXT    NOT NULL,
          content     TEXT    NOT NULL,
          status      TEXT    NOT NULL DEFAULT 'pending',
          messageId   TEXT,
          reviewMsgId TEXT,
          createdAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          number      INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_confessions_guild
          ON confessions(guildId, status);
      `);
    },
  },

  {
    version: 99,
    up(db) {
      const streakCols = db.prepare("PRAGMA table_info(streaks)").all().map(r => r.name);
      if (streakCols.length && (!streakCols.includes('streak') || !streakCols.includes('lastDate'))) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS streaks_new (
            guildId   TEXT    NOT NULL,
            userId    TEXT    NOT NULL,
            streak    INTEGER NOT NULL DEFAULT 0,
            lastDate  TEXT,
            updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (guildId, userId)
          );
          INSERT INTO streaks_new (guildId, userId, streak, lastDate, updatedAt)
          SELECT guildId, userId,
            COALESCE(currentStreak, 0),
            CASE
              WHEN lastUsedAt IS NOT NULL THEN date(lastUsedAt, 'unixepoch')
              ELSE NULL
            END,
            COALESCE(lastUsedAt, unixepoch())
          FROM streaks;
          DROP TABLE streaks;
          ALTER TABLE streaks_new RENAME TO streaks;
        `);
      }

      const birthdayCols = db.prepare("PRAGMA table_info(birthdays)").all().map(r => r.name);
      if (birthdayCols.length) {
        if (!birthdayCols.includes('timezone')) {
          db.exec('ALTER TABLE birthdays ADD COLUMN timezone TEXT');
        }
        if (!birthdayCols.includes('updatedAt')) {
          db.exec('ALTER TABLE birthdays ADD COLUMN updatedAt INTEGER');
          db.exec('UPDATE birthdays SET updatedAt = COALESCE(createdAt, unixepoch())');
        }
      }

      const rainbowCols = db.prepare("PRAGMA table_info(rainbow_roles)").all().map(r => r.name);
      if (rainbowCols.length) {
        if (!rainbowCols.includes('paletteSize')) {
          db.exec('ALTER TABLE rainbow_roles ADD COLUMN paletteSize INTEGER NOT NULL DEFAULT 7');
          rainbowCols.push('paletteSize');
        }

        if (!rainbowCols.includes('active') || !rainbowCols.includes('interval') || !rainbowCols.includes('nextRun') || !rainbowCols.includes('color')) {
          db.exec(`
            CREATE TABLE IF NOT EXISTS rainbow_roles_new (
              guildId      TEXT    NOT NULL,
              roleId       TEXT    NOT NULL,
              mode         TEXT    NOT NULL DEFAULT 'rainbow',
              paletteSize  INTEGER NOT NULL DEFAULT 7,
              active       INTEGER NOT NULL DEFAULT 1,
              interval     INTEGER NOT NULL DEFAULT 60,
              nextRun      TEXT,
              color        TEXT,
              createdAt    INTEGER NOT NULL DEFAULT (unixepoch()),
              updatedAt    INTEGER NOT NULL DEFAULT (unixepoch()),
              PRIMARY KEY (guildId, roleId)
            );
            INSERT INTO rainbow_roles_new (guildId, roleId, mode, paletteSize, active, interval, nextRun, color, createdAt, updatedAt)
            SELECT guildId, roleId,
              COALESCE(mode, 'rainbow'),
              7,
              1,
              COALESCE(speedSeconds, 60),
              datetime(lastUpdatedAt, 'unixepoch', '+' || COALESCE(speedSeconds, 60) || ' seconds'),
              NULL,
              COALESCE(lastUpdatedAt, unixepoch()),
              COALESCE(lastUpdatedAt, unixepoch())
            FROM rainbow_roles;
            DROP TABLE rainbow_roles;
            ALTER TABLE rainbow_roles_new RENAME TO rainbow_roles;
          `);
        }
      }
    },
  },

  {
    version: 100,
    up(db) {
      const rainbowCols = db.prepare("PRAGMA table_info(rainbow_roles)").all().map(r => r.name);
      if (rainbowCols.length && !rainbowCols.includes('paletteSize')) {
        db.exec('ALTER TABLE rainbow_roles ADD COLUMN paletteSize INTEGER NOT NULL DEFAULT 7');
      }
    },
  },

  {
    version: 101,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS owners (
          guildId   TEXT NOT NULL,
          userId    TEXT NOT NULL,
          createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );
      `);
    },
  },

  {
    version: 102,
    up(db) {
      const cols = db.prepare(`PRAGMA table_info(guild_config)`).all().map(r => r.name);
      if (!cols.includes('ghostPingEnabled'))
        db.exec(`ALTER TABLE guild_config ADD COLUMN ghostPingEnabled INTEGER NOT NULL DEFAULT 0`);
      if (!cols.includes('ghostPingChannels'))
        db.exec(`ALTER TABLE guild_config ADD COLUMN ghostPingChannels TEXT`);
    },
  },

  {
    version: 103,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cmd_targets (
          guildId     TEXT    NOT NULL,
          commandName TEXT    NOT NULL,
          targetId    TEXT    NOT NULL,
          targetType  TEXT    NOT NULL CHECK(targetType IN ('role','user')),
          addedAt     INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, commandName, targetId)
        );
      `);
    },
  },

  {
    version: 104,
    up(db) {
      const hasColumn = (table, col) =>
        !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col);

      if (!hasColumn('ticket_options', 'buttonStyle')) {
        db.exec('ALTER TABLE ticket_options ADD COLUMN buttonStyle TEXT');
      }
    },
  },

  {
    version: 105,
    up(db) {
      db.exec(`
        -- ── Casino Config Avancée ────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_config (
          guildId             TEXT    PRIMARY KEY,
          enabled             INTEGER NOT NULL DEFAULT 0,
          panelChannelId      TEXT,
          panelMessageId      TEXT,
          rulesChannelId      TEXT,
          rulesMessageId      TEXT,
          allowedChannels     TEXT,
          logChannelGains     TEXT,
          logChannelGames     TEXT,
          roleRequired        TEXT,
          roleMultiplierId    TEXT,
          statusMultiplier    INTEGER DEFAULT 0,
          statusText          TEXT    DEFAULT '.gg/shibuya',
          publicVocMultiplier INTEGER NOT NULL DEFAULT 2,
          coinsPerVocHour     INTEGER NOT NULL DEFAULT 2000,
          drawsPerVocHour     INTEGER NOT NULL DEFAULT 2,
          coinsPerMsg         INTEGER NOT NULL DEFAULT 20,
          msgsForCoins        INTEGER NOT NULL DEFAULT 100,
          coinsPerMsgPack     INTEGER NOT NULL DEFAULT 2000,
          drawPrice           INTEGER NOT NULL DEFAULT 15000,
          dailyCoins          INTEGER NOT NULL DEFAULT 2000,
          dailyDraws          INTEGER NOT NULL DEFAULT 1,
          coteBlackjack       REAL    DEFAULT 2.0,
          coteBlackjackBonus  REAL    DEFAULT 2.5,
          coteCoinflip        REAL    DEFAULT 2.0,
          coteCoinflipBonus   REAL    DEFAULT 2.5,
          coteBonusRole       TEXT,
          updatedAt           INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ── Casino Users (Profils avec équipement) ───────────────────────────
        CREATE TABLE IF NOT EXISTS casino_users (
          guildId          TEXT    NOT NULL,
          userId           TEXT    NOT NULL,
          coins            INTEGER NOT NULL DEFAULT 0,
          draws            INTEGER NOT NULL DEFAULT 0,
          xp               INTEGER NOT NULL DEFAULT 0,
          level            INTEGER NOT NULL DEFAULT 1,
          totalSpent       INTEGER NOT NULL DEFAULT 0,
          totalWon         INTEGER NOT NULL DEFAULT 0,
          totalDraws       INTEGER NOT NULL DEFAULT 0,
          totalGamesWon    INTEGER NOT NULL DEFAULT 0,
          totalGamesLost   INTEGER NOT NULL DEFAULT 0,
          vocMinutes       INTEGER NOT NULL DEFAULT 0,
          msgCount         INTEGER NOT NULL DEFAULT 0,
          lastDaily        INTEGER DEFAULT 0,
          lastCollect      INTEGER DEFAULT 0,
          equippedColorId  INTEGER,
          equippedBadgeId  INTEGER,
          equippedDecorId  INTEGER,
          equippedSuccessId INTEGER,
          vipTier          INTEGER NOT NULL DEFAULT 0,
          createdAt        INTEGER NOT NULL DEFAULT (unixepoch()),
          updatedAt        INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_casino_users_guild ON casino_users(guildId, coins DESC);
        CREATE INDEX IF NOT EXISTS idx_casino_users_xp ON casino_users(guildId, xp DESC);

        -- ── Casino Level Roles ───────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_level_roles (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          level       INTEGER NOT NULL,
          roleId      TEXT    NOT NULL,
          UNIQUE(guildId, level)
        );

        -- ── Casino Managers ─────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_managers (
          guildId  TEXT NOT NULL,
          userId   TEXT NOT NULL,
          addedBy  TEXT NOT NULL,
          addedAt  INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );

        -- ── Casino Blacklist ────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_blacklist (
          guildId     TEXT NOT NULL,
          userId      TEXT NOT NULL,
          reason      TEXT,
          addedBy     TEXT NOT NULL,
          addedAt     INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (guildId, userId)
        );

        -- ── Casino Shop Items ───────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_shop (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId      TEXT    NOT NULL,
          name         TEXT    NOT NULL,
          description  TEXT,
          price        INTEGER NOT NULL,
          type         TEXT    NOT NULL CHECK(type IN ('role','color','badge','decor','item','draws','pillages','xp','sabotage','nitro')),
          itemType     TEXT    DEFAULT NULL,
          roleId       TEXT,
          colorHex     TEXT,
          stock        INTEGER DEFAULT -1,
          quantity     INTEGER DEFAULT 1,
          limited      INTEGER NOT NULL DEFAULT 0,
          active       INTEGER NOT NULL DEFAULT 1,
          createdAt    INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, name)
        );

        -- ── Casino Inventory ───────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_inventory (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          userId      TEXT    NOT NULL,
          itemId      INTEGER NOT NULL REFERENCES casino_shop(id),
          quantity    INTEGER NOT NULL DEFAULT 1,
          equipped    INTEGER NOT NULL DEFAULT 0,
          equippedAt  INTEGER,
          acquiredAt  INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, userId, itemId)
        );

        -- ── Casino Gacha Pool (Tirages) ────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_gacha_pool (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          name        TEXT    NOT NULL,
          type        TEXT    NOT NULL CHECK(type IN ('coins','role','color','badge','decor','draws','pillages','xp','sabotage','item','nitro')),
          tier        TEXT    DEFAULT 'common' CHECK(tier IN ('common','rare','epic','legendary','secret')),
          value       INTEGER,
          roleId      TEXT,
          weight      INTEGER NOT NULL DEFAULT 1,
          limited     INTEGER NOT NULL DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1
        );

        -- ── Casino History ───────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_history (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId     TEXT    NOT NULL,
          userId      TEXT    NOT NULL,
          type        TEXT    NOT NULL,
          amount      INTEGER,
          result      TEXT,
          details     TEXT,
          createdAt   INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_casino_history_user ON casino_history(guildId, userId, createdAt DESC);

        -- ── Casino Duels ────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_duels (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId       TEXT    NOT NULL,
          challengerId  TEXT    NOT NULL,
          opponentId    TEXT    NOT NULL,
          bet           INTEGER NOT NULL,
          game          TEXT    NOT NULL,
          status        TEXT    NOT NULL DEFAULT 'pending',
          winnerId      TEXT,
          createdAt     INTEGER NOT NULL DEFAULT (unixepoch()),
          endedAt       INTEGER
        );

        -- ── Giveaway Coins ─────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS giveaway_coins (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId       TEXT    NOT NULL,
          channelId     TEXT    NOT NULL,
          messageId     TEXT,
          hostId        TEXT    NOT NULL,
          amount        INTEGER NOT NULL,
          winnersCount  INTEGER NOT NULL DEFAULT 1,
          durationMs    INTEGER NOT NULL,
          endsAt        INTEGER NOT NULL,
          status        TEXT    NOT NULL DEFAULT 'active',
          entrants      TEXT    DEFAULT '[]',
          winners       TEXT    DEFAULT '[]',
          createdAt     INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `);
    },
  },

  {
    version: 106,
    up(db) {
      db.exec(`
        -- ── Casino Achievements ─────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_achievements (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId       TEXT    NOT NULL,
          key           TEXT    NOT NULL,
          name          TEXT    NOT NULL,
          description   TEXT    NOT NULL DEFAULT '',
          icon          TEXT    NOT NULL DEFAULT '[*]',
          requirement   INTEGER NOT NULL DEFAULT 0,
          rewardCoins   INTEGER NOT NULL DEFAULT 0,
          rewardDraws   INTEGER NOT NULL DEFAULT 0
        );

        -- ── Casino User Achievements ────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS casino_user_achievements (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId       TEXT    NOT NULL,
          userId        TEXT    NOT NULL,
          achievementKey TEXT   NOT NULL,
          unlockedAt    INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, userId, achievementKey)
        );
      `);
    },
  },

  {
    version: 108,
    up(db) {
      const cols = db.prepare('PRAGMA table_info(casino_gacha_pool)').all().map(r => r.name);
      if (!cols.includes('chance'))   db.exec('ALTER TABLE casino_gacha_pool ADD COLUMN chance   REAL    NOT NULL DEFAULT 100');
      if (!cols.includes('valueMax')) db.exec('ALTER TABLE casino_gacha_pool ADD COLUMN valueMax INTEGER');
      db.exec(`
        CREATE TABLE IF NOT EXISTS casino_gacha_owned (
          guildId TEXT    NOT NULL,
          userId  TEXT    NOT NULL,
          itemId  INTEGER NOT NULL,
          wonAt   INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, userId, itemId)
        );
      `);
    },
  },

  {
    version: 107,
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS casino_user_achievements;
        CREATE TABLE casino_user_achievements (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId       TEXT    NOT NULL,
          userId        TEXT    NOT NULL,
          achievementKey TEXT   NOT NULL,
          unlockedAt    INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(guildId, userId, achievementKey)
        );
      `);
    },
  },

  {
    version: 108,
    up(db) {
      db.exec(`
        ALTER TABLE casino_config ADD COLUMN coteBlackjack REAL DEFAULT 2.0;
        ALTER TABLE casino_config ADD COLUMN coteBlackjackBonus REAL DEFAULT 2.5;
        ALTER TABLE casino_config ADD COLUMN coteCoinflip REAL DEFAULT 2.0;
        ALTER TABLE casino_config ADD COLUMN coteCoinflipBonus REAL DEFAULT 2.5;
        ALTER TABLE casino_config ADD COLUMN coteBonusRole TEXT;
      `);
    },
  },

];


function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      appliedAt INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const current = db.prepare('SELECT MAX(version) as v FROM schema_version').get().v || 0;
  const pending = MIGRATIONS.filter(m => m.version > current);

  if (pending.length > 0) {
    db.transaction(() => {
      for (const migration of pending) {
        migration.up(db);
        db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(migration.version);
      }
    })();
  }

  repairCasinoSchema(db);
}


function repairCasinoSchema(db) {
  const hasColumn = (table, col) => {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
    } catch (e) {
      return false;
    }
  };

  const casinoConfigColumns = [
    { name: 'panelMessageId', type: 'TEXT', dflt: 'NULL' },
    { name: 'rulesChannelId', type: 'TEXT', dflt: 'NULL' },
    { name: 'rulesMessageId', type: 'TEXT', dflt: 'NULL' },
    { name: 'coinsPerMsgPack', type: 'INTEGER', dflt: '2000' },
    { name: 'drawPrice', type: 'INTEGER', dflt: '15000' },
    { name: 'coteBlackjack', type: 'REAL', dflt: '2.0' },
    { name: 'coteBlackjackBonus', type: 'REAL', dflt: '2.5' },
    { name: 'coteCoinflip', type: 'REAL', dflt: '2.0' },
    { name: 'coteCoinflipBonus', type: 'REAL', dflt: '2.5' },
    { name: 'coteBonusRole', type: 'TEXT', dflt: 'NULL' },
    { name: 'restrictedCommands', type: 'TEXT', dflt: 'NULL' },
    { name: 'coteBlackjackStatus', type: 'REAL', dflt: '2.5' },
    { name: 'coteCoinflipStatus', type: 'REAL', dflt: '2.5' },
    { name: 'statusVocMultiplier', type: 'REAL', dflt: '2.0' },
    { name: 'statusMsgMultiplier', type: 'REAL', dflt: '2.0' },
    { name: 'coinsPerVocMin',      type: 'INTEGER', dflt: '50' },
    { name: 'collectBonusRate',    type: 'REAL', dflt: '0.5' },
    { name: 'limitBjMin',         type: 'INTEGER', dflt: '0' },
    { name: 'limitBjMax',         type: 'INTEGER', dflt: '0' },
    { name: 'limitCfMin',         type: 'INTEGER', dflt: '0' },
    { name: 'limitCfMax',         type: 'INTEGER', dflt: '0' },
    { name: 'limitRlMin',         type: 'INTEGER', dflt: '0' },
    { name: 'limitRlMax',         type: 'INTEGER', dflt: '0' },
    { name: 'cooldownBj',         type: 'INTEGER', dflt: '0' },
    { name: 'cooldownCf',         type: 'INTEGER', dflt: '0' },
    { name: 'cooldownRl',         type: 'INTEGER', dflt: '0' },
    { name: 'cooldownDaily',      type: 'INTEGER', dflt: '0' },
    { name: 'cooldownCollect',    type: 'INTEGER', dflt: '0' },
    { name: 'limitMaxCoins',      type: 'INTEGER', dflt: '0' },
    { name: 'limitGainsPeriod',   type: 'INTEGER', dflt: '0' },
    { name: 'limitGainsMax',      type: 'INTEGER', dflt: '0' },
    { name: 'limitDrawsPeriod',   type: 'INTEGER', dflt: '0' },
    { name: 'limitDrawsMax',      type: 'INTEGER', dflt: '0' },
    { name: 'limitMaxDraws',      type: 'INTEGER', dflt: '0' },
    { name: 'giftMin',            type: 'INTEGER', dflt: '100' },
    { name: 'giftMax',            type: 'INTEGER', dflt: '1000' },
    { name: 'dailyMin',           type: 'INTEGER', dflt: '0' },
    { name: 'dailyMax',           type: 'INTEGER', dflt: '0' },
    { name: 'casinoRules',        type: 'TEXT',    dflt: 'NULL' },
    { name: 'casinoPanelContent', type: 'TEXT',    dflt: 'NULL' },
    { name: 'cooldownVol',        type: 'INTEGER', dflt: '3600' },
    { name: 'volMinPercent',      type: 'INTEGER', dflt: '1' },
    { name: 'volMaxPercent',      type: 'INTEGER', dflt: '5' },
    { name: 'volStealXp',         type: 'INTEGER', dflt: '1' },
    { name: 'volSuccessRate',     type: 'INTEGER', dflt: '60' },
    { name: 'xpBjWin',            type: 'INTEGER', dflt: '50' },
    { name: 'xpBjLoss',           type: 'INTEGER', dflt: '15' },
    { name: 'xpBjPush',           type: 'INTEGER', dflt: '5' },
    { name: 'xpCfWin',            type: 'INTEGER', dflt: '30' },
    { name: 'xpCfLoss',           type: 'INTEGER', dflt: '10' },
    { name: 'xpRlWin',            type: 'INTEGER', dflt: '40' },
    { name: 'xpRlLoss',           type: 'INTEGER', dflt: '15' },
    { name: 'shieldPrice1',       type: 'INTEGER', dflt: '15000' },
    { name: 'shieldPrice3',       type: 'INTEGER', dflt: '40000' },
    { name: 'shieldPrice5',       type: 'INTEGER', dflt: '60000' },
    { name: 'shieldPrice10',      type: 'INTEGER', dflt: '115000' },
    { name: 'jackpotAmount',      type: 'INTEGER', dflt: '0' },
    { name: 'jackpotNumber',      type: 'INTEGER', dflt: '0' },
    { name: 'jackpotCost',        type: 'INTEGER', dflt: '10000' },
    { name: 'cooldownGift',       type: 'INTEGER', dflt: '0' },
    { name: 'cooldownRussian',    type: 'INTEGER', dflt: '0' },
    { name: 'cooldownMine',       type: 'INTEGER', dflt: '0' },
    { name: 'limitRussianMin',    type: 'INTEGER', dflt: '0' },
    { name: 'limitRussianMax',    type: 'INTEGER', dflt: '0' },
    { name: 'limitMineMin',       type: 'INTEGER', dflt: '0' },
    { name: 'limitMineMax',       type: 'INTEGER', dflt: '0' },
    { name: 'limitMineBombs',     type: 'INTEGER', dflt: '3' },
    { name: 'cooldownPlinko',     type: 'INTEGER', dflt: '0' },
    { name: 'limitPlinkoMin',     type: 'INTEGER', dflt: '0' },
    { name: 'limitPlinkoMax',     type: 'INTEGER', dflt: '0' },
    { name: 'cooldownTower',      type: 'INTEGER', dflt: '0' },
    { name: 'limitTowerMin',      type: 'INTEGER', dflt: '0' },
    { name: 'limitTowerMax',      type: 'INTEGER', dflt: '0' },
    { name: 'creationBonus',      type: 'INTEGER', dflt: '0' },
    { name: 'cooldownDice',       type: 'INTEGER', dflt: '0' },
    { name: 'limitDiceMin',       type: 'INTEGER', dflt: '0' },
    { name: 'limitDiceMax',       type: 'INTEGER', dflt: '0' },
  ];

  for (const col of casinoConfigColumns) {
    if (!hasColumn('casino_config', col.name)) {
      db.exec(`ALTER TABLE casino_config ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.dflt}`);
    }
  }

  if (!hasColumn('casino_users', 'shields')) {
    db.exec(`ALTER TABLE casino_users ADD COLUMN shields INTEGER NOT NULL DEFAULT 0`);
  }

  if (!hasColumn('giveaway_coins', 'durationMs')) {
    db.exec(`ALTER TABLE giveaway_coins ADD COLUMN durationMs INTEGER NOT NULL DEFAULT 0`);
  }

  if (hasColumn('casino_duels', 'targetId') || !hasColumn('casino_duels', 'opponentId')) {
    db.exec(`DROP TABLE IF EXISTS casino_duels`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS casino_duels (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId       TEXT    NOT NULL,
        challengerId  TEXT    NOT NULL,
        opponentId    TEXT    NOT NULL,
        bet           INTEGER NOT NULL,
        game          TEXT    NOT NULL,
        status        TEXT    NOT NULL DEFAULT 'pending',
        winnerId      TEXT,
        createdAt     INTEGER NOT NULL DEFAULT (unixepoch()),
        endedAt       INTEGER
      );
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS casino_pending_bets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId     TEXT    NOT NULL,
      userId      TEXT    NOT NULL,
      amount      INTEGER NOT NULL,
      game        TEXT    NOT NULL,
      createdAt   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}


function prepareStatements(db) {
  _stmts = {

    getGuildConfig   : db.prepare('SELECT * FROM guild_config WHERE guildId = ?'),
    insertGuildConfig: db.prepare('INSERT OR IGNORE INTO guild_config (guildId) VALUES (?)'),

    insertPrevName : db.prepare(`
      INSERT INTO prevnames (userId, guildId, type, name)
      VALUES (?, ?, ?, ?)
    `),
    getPrevNamesGlobal : db.prepare(`
      SELECT * FROM prevnames
      WHERE userId = ? AND type IN ('username','globalname')
      ORDER BY changedAt DESC
      LIMIT ?
    `),
    getPrevNamesNick : db.prepare(`
      SELECT * FROM prevnames
      WHERE userId = ? AND guildId = ? AND type = 'nickname'
      ORDER BY changedAt DESC
      LIMIT ?
    `),
    getPrevNamesAll : db.prepare(`
      SELECT * FROM prevnames
      WHERE userId = ? AND (type IN ('username','globalname') OR (type = 'nickname' AND guildId = ?))
      ORDER BY changedAt DESC
      LIMIT ?
    `),
    getLastPrevName : db.prepare(`
      SELECT name FROM prevnames
      WHERE userId = ? AND type = ?
      ORDER BY changedAt DESC
      LIMIT 1
    `),
    getLastPrevNameNick : db.prepare(`
      SELECT name FROM prevnames
      WHERE userId = ? AND guildId = ? AND type = 'nickname'
      ORDER BY changedAt DESC
      LIMIT 1
    `),
    countPrevNamesGlobal : db.prepare(`
      SELECT COUNT(*) as c FROM prevnames
      WHERE userId = ? AND type IN ('username','globalname')
    `),
    prunePrevNames : db.prepare(`
      DELETE FROM prevnames
      WHERE userId = ? AND type = ? AND id NOT IN (
        SELECT id FROM prevnames WHERE userId = ? AND type = ?
        ORDER BY changedAt DESC LIMIT 50
      )
    `),
    prunePrevNamesNick : db.prepare(`
      DELETE FROM prevnames
      WHERE userId = ? AND guildId = ? AND type = 'nickname' AND id NOT IN (
        SELECT id FROM prevnames WHERE userId = ? AND guildId = ? AND type = 'nickname'
        ORDER BY changedAt DESC LIMIT 50
      )
    `),

    clearPrevNamesAll : db.prepare(`
      DELETE FROM prevnames WHERE userId = ?
    `),
    clearPrevNamesGuild : db.prepare(`
      DELETE FROM prevnames WHERE userId = ? AND (guildId = ? OR guildId IS NULL)
    `),
    clearPrevNamesType : db.prepare(`
      DELETE FROM prevnames WHERE userId = ? AND type = ?
    `),
    clearPrevNamesTypeGuild : db.prepare(`
      DELETE FROM prevnames WHERE userId = ? AND guildId = ? AND type = ?
    `),

    upsertSeen : db.prepare(`
      INSERT INTO seen (userId, guildId, seenAt, channelId, lastMessage)
      VALUES (?, ?, unixepoch(), ?, ?)
      ON CONFLICT(userId, guildId) DO UPDATE SET seenAt = unixepoch(), channelId = excluded.channelId, lastMessage = excluded.lastMessage
    `),
    getSeen : db.prepare(`
      SELECT seenAt, channelId, lastMessage FROM seen WHERE userId = ? AND guildId = ?
    `),

    insertRolelog : db.prepare(`
      INSERT INTO rolelog (userId, guildId, roleId, action) VALUES (?, ?, ?, ?)
    `),
    getRolelog : db.prepare(`
      SELECT roleId, action, changedAt FROM rolelog
      WHERE userId = ? AND guildId = ?
      ORDER BY changedAt DESC
      LIMIT ?
    `),
    pruneRolelog : db.prepare(`
      DELETE FROM rolelog
      WHERE userId = ? AND guildId = ? AND id NOT IN (
        SELECT id FROM rolelog WHERE userId = ? AND guildId = ?
        ORDER BY changedAt DESC LIMIT 200
      )
    `),

    insertKeyword : db.prepare(`
      INSERT OR IGNORE INTO keywords2 (ownerId, guildId, keyword, targetUserId) VALUES (?, ?, ?, ?)
    `),
    deleteKeyword : db.prepare(`
      DELETE FROM keywords2 WHERE ownerId = ? AND guildId = ? AND keyword = ? COLLATE NOCASE
    `),
    deleteKeywordTarget : db.prepare(`
      DELETE FROM keywords2 WHERE ownerId = ? AND guildId = ? AND keyword = ? COLLATE NOCASE AND targetUserId = ?
    `),
    getKeywords : db.prepare(`
      SELECT keyword, GROUP_CONCAT(targetUserId) as targets
      FROM keywords2 WHERE ownerId = ? AND guildId = ?
      GROUP BY keyword ORDER BY keyword
    `),
    countKeywords : db.prepare(`
      SELECT COUNT(DISTINCT keyword) as c FROM keywords2 WHERE ownerId = ? AND guildId = ?
    `),
    getGuildKeywords : db.prepare(`
      SELECT targetUserId as userId, keyword FROM keywords2 WHERE guildId = ?
    `),
    clearKeywords : db.prepare(`
      DELETE FROM keywords2 WHERE ownerId = ? AND guildId = ?
    `),
    setKeywordTargets : db.prepare(`
      DELETE FROM keywords2 WHERE ownerId = ? AND guildId = ? AND keyword = ? COLLATE NOCASE
    `),
    insertKeywordTarget : db.prepare(`
      INSERT OR IGNORE INTO keywords2 (ownerId, guildId, keyword, targetUserId) VALUES (?, ?, ?, ?)
    `),

    getConfessionConfig : db.prepare(`SELECT * FROM confession_config WHERE guildId = ?`),
    upsertConfessionConfig : db.prepare(`
      INSERT INTO confession_config (guildId) VALUES (?)
      ON CONFLICT(guildId) DO NOTHING
    `),
    setConfessionField : db.prepare(`UPDATE confession_config SET enabled=?, channelId=?, reviewChannelId=?, reviewEnabled=?, revealAllowed=?, reactionsEnabled=?, replyEnabled=?, cooldownSeconds=?, blacklist=?, buttonMsgId=?, allowAnonymousReply=? WHERE guildId=?`),
    insertConfession : db.prepare(`
      INSERT INTO confessions (guildId, authorId, content, status, number)
      VALUES (?, ?, ?, 'pending', (SELECT COALESCE(MAX(number),0)+1 FROM confessions WHERE guildId=?))
    `),
    getConfession : db.prepare(`SELECT * FROM confessions WHERE id = ?`),
    getConfessionByMsgId : db.prepare(`SELECT * FROM confessions WHERE messageId = ? OR reviewMsgId = ?`),
    updateConfessionStatus : db.prepare(`UPDATE confessions SET status=?, messageId=?, reviewMsgId=? WHERE id=?`),
    getLastConfessionTime : db.prepare(`SELECT MAX(createdAt) as last FROM confessions WHERE guildId=? AND authorId=?`),
    getLastApprovedConfession : db.prepare(`SELECT * FROM confessions WHERE guildId=? AND status='approved' ORDER BY id DESC LIMIT 1 OFFSET 1`),
    countConfessions : db.prepare(`SELECT COUNT(*) as c FROM confessions WHERE guildId=? AND status='approved'`),

    upsertMsgcount : db.prepare(`
      INSERT INTO msgcount (userId, guildId, day, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(userId, guildId, day) DO UPDATE SET count = count + 1
    `),
    getTopMsgs : db.prepare(`
      SELECT userId, SUM(count) as total
      FROM msgcount
      WHERE guildId = ? AND day >= ?
      GROUP BY userId
      ORDER BY total DESC
      LIMIT ?
    `),

    insertStreak : db.prepare(`
      INSERT INTO streaks (guildId, userId, streak, lastDate, updatedAt)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(guildId, userId) DO UPDATE SET
        streak    = excluded.streak,
        lastDate  = excluded.lastDate,
        updatedAt = unixepoch()
    `),
    getStreak : db.prepare('SELECT * FROM streaks WHERE guildId = ? AND userId = ?'),

    getBirthdayByUser : db.prepare('SELECT * FROM birthdays WHERE guildId = ? AND userId = ?'),
    getBirthdaysByGuild : db.prepare(`
      SELECT * FROM birthdays
      WHERE guildId = ?
      ORDER BY month, day, userId
    `),
    getBirthdaysByDate : db.prepare(`
      SELECT * FROM birthdays
      WHERE guildId = ? AND month = ? AND day = ?
    `),
    insertBirthday : db.prepare(`
      INSERT INTO birthdays (guildId, userId, month, day, timezone, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(guildId, userId) DO UPDATE SET
        month     = excluded.month,
        day       = excluded.day,
        timezone  = excluded.timezone,
        updatedAt = unixepoch()
    `),
    deleteBirthday : db.prepare('DELETE FROM birthdays WHERE guildId = ? AND userId = ?'),

    insertRainbowRole : db.prepare(`
      INSERT INTO rainbow_roles (guildId, roleId, mode, paletteSize, active, interval, nextRun, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(guildId, roleId) DO UPDATE SET
        mode        = excluded.mode,
        paletteSize = excluded.paletteSize,
        active      = excluded.active,
        interval    = excluded.interval,
        nextRun     = excluded.nextRun,
        color       = excluded.color,
        updatedAt   = unixepoch()
    `),
    getRainbowRole : db.prepare('SELECT * FROM rainbow_roles WHERE guildId = ? AND roleId = ?'),
    getRainbowRolesByGuild : db.prepare('SELECT * FROM rainbow_roles WHERE guildId = ? ORDER BY roleId ASC'),
    getActiveRainbowRoles : db.prepare('SELECT * FROM rainbow_roles WHERE guildId = ? AND active = 1 ORDER BY roleId ASC'),
    updateRainbowRole : db.prepare(`
      UPDATE rainbow_roles
      SET mode        = COALESCE(?, mode),
          paletteSize = COALESCE(?, paletteSize),
          active      = COALESCE(?, active),
          interval    = COALESCE(?, interval),
          nextRun     = COALESCE(?, nextRun),
          color       = COALESCE(?, color),
          updatedAt   = unixepoch()
      WHERE guildId = ? AND roleId = ?
    `),
    deleteRainbowRole : db.prepare('DELETE FROM rainbow_roles WHERE guildId = ? AND roleId = ?'),

    insertSanction     : db.prepare('INSERT INTO sanctions (guildId, userId, moderatorId, type, reason, duration, expiresAt, channelId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getSanctions       : db.prepare('SELECT * FROM sanctions WHERE guildId = ? AND userId = ? AND deletedAt IS NULL ORDER BY createdAt DESC'),
    getActiveSanction  : db.prepare('SELECT * FROM sanctions WHERE guildId = ? AND userId = ? AND type = ? AND active = 1 AND deletedAt IS NULL'),
    getActiveSanctionsByType: db.prepare('SELECT * FROM sanctions WHERE guildId = ? AND userId = ? AND type = ? AND active = 1 AND deletedAt IS NULL ORDER BY createdAt DESC'),
    getActiveSanctionUserIdsByType: db.prepare('SELECT DISTINCT userId FROM sanctions WHERE guildId = ? AND type = ? AND active = 1 AND deletedAt IS NULL'),
    expireSanction     : db.prepare('UPDATE sanctions SET active = 0, updatedAt = unixepoch() WHERE id = ?'),
    softDeleteSanction : db.prepare('UPDATE sanctions SET deletedAt = unixepoch(), updatedAt = unixepoch() WHERE id = ?'),
    getExpiredSanctions: db.prepare('SELECT * FROM sanctions WHERE active = 1 AND expiresAt IS NOT NULL AND expiresAt <= ? AND deletedAt IS NULL'),

    getLevel      : db.prepare('SELECT * FROM levels WHERE guildId = ? AND userId = ?'),
    insertLevel   : db.prepare('INSERT OR IGNORE INTO levels (guildId, userId) VALUES (?, ?)'),
    addXp         : db.prepare('UPDATE levels SET xp = xp + ?, messages = messages + 1, lastXpAt = ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?'),
    setLevel      : db.prepare('UPDATE levels SET level = ?, xp = ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?'),
    getLeaderboard: db.prepare('SELECT * FROM levels WHERE guildId = ? ORDER BY xp DESC LIMIT ?'),

    insertGiveaway              : db.prepare(`
      INSERT INTO giveaways (guildId, channelId, hostId, prize, winnerCount, endsAt, emoji, entryMode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getGiveaway                 : db.prepare('SELECT * FROM giveaways WHERE messageId = ?'),
    getActiveGiveaways          : db.prepare('SELECT * FROM giveaways WHERE ended = 0'),
    getGiveawayById             : db.prepare('SELECT * FROM giveaways WHERE id = ?'),
    getActiveGiveawayByMsg      : db.prepare('SELECT * FROM giveaways WHERE messageId = ? AND ended = 0'),
    getActiveGiveawaysByChannel : db.prepare('SELECT * FROM giveaways WHERE channelId = ? AND ended = 0'),
    endGiveaway                 : db.prepare('UPDATE giveaways SET ended = 1, winners = ?, updatedAt = unixepoch() WHERE id = ?'),
    tryClaimGiveawayEnd         : db.prepare('UPDATE giveaways SET ended = 1, updatedAt = unixepoch() WHERE id = ? AND ended = 0'),
    setGiveawayWinners          : db.prepare('UPDATE giveaways SET winners = ?, updatedAt = unixepoch() WHERE id = ?'),
    setGiveawayMsgId            : db.prepare('UPDATE giveaways SET messageId = ? WHERE id = ?'),
    updateGiveawayConditions    : db.prepare(`UPDATE giveaways SET requiredRoleId = ?, deniedRoleId = ?, soutienRequired = ?, statusRequired = ?, tagRequired = ?, requireBeforeStart = ?, minLevel = ?, voiceRequired = ?, minVoiceSeconds = ?, forcedWinners = ?, requiredGuildIds = ?, updatedAt = unixepoch() WHERE id = ?`),
    insertEntry                 : db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveawayId, userId) VALUES (?, ?)'),
    deleteEntry                 : db.prepare('DELETE FROM giveaway_entries WHERE giveawayId = ? AND userId = ?'),
    getEntries                  : db.prepare('SELECT userId FROM giveaway_entries WHERE giveawayId = ?'),
    hasEntry                    : db.prepare('SELECT 1 FROM giveaway_entries WHERE giveawayId = ? AND userId = ?'),

    getGwPreset                 : db.prepare('SELECT * FROM giveaway_config_presets WHERE guildId = ? AND prizeKey = ?'),
    setGwPreset                 : db.prepare('INSERT INTO giveaway_config_presets (guildId, prizeKey, prizeLabel, configJson) VALUES (?, ?, ?, ?) ON CONFLICT(guildId, prizeKey) DO UPDATE SET prizeLabel = excluded.prizeLabel, configJson = excluded.configJson, updatedAt = unixepoch()'),
    deleteGwPreset              : db.prepare('DELETE FROM giveaway_config_presets WHERE guildId = ? AND prizeKey = ?'),


    getGlobalOwners    : db.prepare('SELECT userId FROM global_owners ORDER BY createdAt ASC'),
    insertGlobalOwner  : db.prepare('INSERT OR IGNORE INTO global_owners (userId) VALUES (?)'),
    deleteGlobalOwner  : db.prepare('DELETE FROM global_owners WHERE userId = ?'),
    isGlobalOwner      : db.prepare('SELECT 1 FROM global_owners WHERE userId = ?'),

    getOwners          : db.prepare('SELECT userId FROM owners WHERE guildId = ? ORDER BY createdAt ASC'),
    insertOwner        : db.prepare('INSERT OR IGNORE INTO owners (guildId, userId) VALUES (?, ?)'),
    deleteOwner        : db.prepare('DELETE FROM owners WHERE guildId = ? AND userId = ?'),
    deleteGuildOwners  : db.prepare('DELETE FROM owners WHERE guildId = ?'),
    isOwner            : db.prepare('SELECT 1 FROM owners WHERE guildId = ? AND userId = ?'),

    getGlobalBuyers    : db.prepare('SELECT userId FROM global_buyers ORDER BY createdAt ASC'),
    insertGlobalBuyer  : db.prepare('INSERT OR IGNORE INTO global_buyers (userId) VALUES (?)'),
    deleteGlobalBuyer  : db.prepare('DELETE FROM global_buyers WHERE userId = ?'),
    isGlobalBuyer      : db.prepare('SELECT 1 FROM global_buyers WHERE userId = ?'),


    getBuyerRecovery       : db.prepare('SELECT codeHash, createdAt FROM buyer_recovery LIMIT 1'),
    deleteBuyerRecovery    : db.prepare('DELETE FROM buyer_recovery'),
    insertBuyerRecovery    : db.prepare('INSERT INTO buyer_recovery (codeHash) VALUES (?)'),
    getBotConfig           : db.prepare('SELECT value FROM bot_config WHERE key = ?'),
    setBotConfig           : db.prepare('INSERT INTO bot_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    deleteBotConfig        : db.prepare('DELETE FROM bot_config WHERE key = ?'),

    getCmdTargets      : db.prepare('SELECT * FROM cmd_targets WHERE guildId = ? AND commandName = ?'),
    addCmdTarget       : db.prepare('INSERT OR REPLACE INTO cmd_targets (guildId, commandName, targetId, targetType) VALUES (?, ?, ?, ?)'),
    removeCmdTarget    : db.prepare('DELETE FROM cmd_targets WHERE guildId = ? AND commandName = ? AND targetId = ?'),
    clearCmdTargets    : db.prepare('DELETE FROM cmd_targets WHERE guildId = ? AND commandName = ?'),
    getAllCmdTargets    : db.prepare('SELECT * FROM cmd_targets WHERE guildId = ?'),

    getPermLevels      : db.prepare('SELECT * FROM perm_levels WHERE guildId = ?'),
    getCmdPerm         : db.prepare('SELECT perm FROM cmd_perms WHERE guildId = ? AND commandName = ?'),
    setCmdPerm         : db.prepare('INSERT OR REPLACE INTO cmd_perms (guildId, commandName, perm, updatedAt) VALUES (?, ?, ?, unixepoch())'),
    getAllCmdPerms     : db.prepare('SELECT * FROM cmd_perms WHERE guildId = ?'),
    getPublicChannels  : db.prepare('SELECT channelId FROM public_channels WHERE guildId = ?'),
    insertPublicChannel: db.prepare('INSERT OR IGNORE INTO public_channels (guildId, channelId) VALUES (?, ?)'),
    deletePublicChannel: db.prepare('DELETE FROM public_channels WHERE guildId = ? AND channelId = ?'),
    clearPublicChannels: db.prepare('DELETE FROM public_channels WHERE guildId = ?'),
    getBlacklistRanks  : db.prepare('SELECT roleId FROM blacklist_rank WHERE guildId = ?'),

    getNoLogChannels  : db.prepare('SELECT channelId FROM nolog_channels WHERE guildId = ?'),
    insertNoLogChannel: db.prepare('INSERT OR IGNORE INTO nolog_channels (guildId, channelId) VALUES (?, ?)'),
    deleteNoLogChannel: db.prepare('DELETE FROM nolog_channels WHERE guildId = ? AND channelId = ?'),
    isNoLogChannel    : db.prepare('SELECT 1 FROM nolog_channels WHERE guildId = ? AND channelId = ?'),

    insertTicket : db.prepare(`
      INSERT INTO tickets (
        guildId,
        channelId,
        userId,
        subject,
        panelId,
        optionId,
        claimedBy,
        status,
        createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, 'open', unixepoch(), unixepoch())
    `),

    getTicket : db.prepare('SELECT * FROM tickets WHERE channelId = ?'),

    getOpenTickets : db.prepare(`
      SELECT * FROM tickets
      WHERE guildId = ?
      AND userId = ?
      AND status = 'open'
    `),

    getTicketsPendingDelete : db.prepare(`
      SELECT * FROM tickets
      WHERE status = 'closed'
      AND deleteAt IS NOT NULL
    `),

    updateTicketActivity : db.prepare(`
      UPDATE tickets
      SET lastActivityAt = ?,
          updatedAt      = unixepoch()
      WHERE channelId = ?
      AND status = 'open'
    `),

    getInactiveTickets : db.prepare(`
      SELECT t.*, tp.inactiveCloseDelay, tp.autoDeleteSeconds
      FROM tickets t
      JOIN ticket_panels tp ON tp.id = t.panelId
      WHERE t.status = 'open'
      AND tp.inactiveCloseDelay IS NOT NULL
      AND tp.inactiveCloseDelay > 0
      AND t.lastActivityAt IS NOT NULL
      AND (? - t.lastActivityAt) >= tp.inactiveCloseDelay
    `),

    closeTicketCore : db.prepare(`
      UPDATE tickets
      SET
        status      = 'closed',
        closedBy    = ?,
        closedAt    = ?,
        closeReason = ?,
        deleteAt    = ?,
        updatedAt   = ?
      WHERE channelId = ?
    `),

    updateTicketCore : db.prepare(`
      UPDATE tickets
      SET
        status        = COALESCE(?, status),
        claimedBy     = COALESCE(?, claimedBy),
        claimedAt     = COALESCE(?, claimedAt),
        closedBy      = COALESCE(?, closedBy),
        closedAt      = COALESCE(?, closedAt),
        closeReason   = COALESCE(?, closeReason),
        deleteAt      = COALESCE(?, deleteAt),
        renamedBy     = COALESCE(?, renamedBy),
        lastMessageId = COALESCE(?, lastMessageId),
        transcriptUrl = COALESCE(?, transcriptUrl),
        subject       = COALESCE(?, subject),
        updatedAt     = unixepoch()
      WHERE channelId = ?
    `),

    clearTicketClaim : db.prepare(`
      UPDATE tickets
      SET claimedBy = NULL,
          claimedAt = NULL,
          updatedAt = unixepoch()
      WHERE channelId = ?
      AND status = 'open'
    `),

    clearTicketDeleteAt : db.prepare(`
      UPDATE tickets
      SET deleteAt  = NULL,
          updatedAt = unixepoch()
      WHERE channelId = ?
    `),

    reopenTicket : db.prepare(`
      UPDATE tickets
      SET status      = 'open',
          closedBy    = NULL,
          closedAt    = NULL,
          closeReason = NULL,
          deleteAt    = NULL,
          claimedBy   = NULL,
          claimedAt   = NULL,
          updatedAt   = unixepoch()
      WHERE channelId = ?
    `),

    insertTicketPanel : db.prepare(`
      INSERT INTO ticket_panels (guildId, channelId, panelType)
      VALUES (?, ?, ?)
    `),

    getTicketPanels : db.prepare(`
      SELECT * FROM ticket_panels
      WHERE guildId = ?
      ORDER BY id ASC
    `),

    getTicketPanelById : db.prepare('SELECT * FROM ticket_panels WHERE id = ?'),
    deleteTicketPanel  : db.prepare('DELETE FROM ticket_panels WHERE id = ?'),
    getTicketPanelMessageId : db.prepare('SELECT messageId FROM ticket_panels WHERE id = ?'),
    getTicketPanelByMessageId : db.prepare('SELECT * FROM ticket_panels WHERE messageId = ?'),
    resetTicketPanelSequence : db.prepare("DELETE FROM sqlite_sequence WHERE name = 'ticket_panels'"),
    resetTicketOptionSequence : db.prepare("DELETE FROM sqlite_sequence WHERE name = 'ticket_options'"),

    updateTicketPanelCore : db.prepare(`
      UPDATE ticket_panels
      SET
        channelId         = COALESCE(?, channelId),
        messageId         = COALESCE(?, messageId),
        panelType         = COALESCE(?, panelType),
        placeholder       = COALESCE(?, placeholder),
        embedJson         = COALESCE(?, embedJson),
        requiredRoles     = COALESCE(?, requiredRoles),
        blockedRoles      = COALESCE(?, blockedRoles),
        bypassRoles       = COALESCE(?, bypassRoles),
        claimMode         = COALESCE(?, claimMode),
        showClaimButton   = COALESCE(?, showClaimButton),
        showCloseButton   = COALESCE(?, showCloseButton),
        maxOpenPerUser    = COALESCE(?, maxOpenPerUser),
        autoCloseSeconds  = COALESCE(?, autoCloseSeconds),
        autoDeleteSeconds = COALESCE(?, autoDeleteSeconds),
        transcriptDm      = COALESCE(?, transcriptDm),
        closeOnLeave      = COALESCE(?, closeOnLeave),
        logChannelId      = COALESCE(?, logChannelId),
        inactiveCloseDelay = COALESCE(?, inactiveCloseDelay),
        updatedAt         = unixepoch()
      WHERE id = ?
    `),

    resetTicketPanelEmbed : db.prepare(`
      UPDATE ticket_panels
      SET embedJson = NULL,
          updatedAt = unixepoch()
      WHERE id = ?
    `),

    clearTicketPanelMessage : db.prepare(`
      UPDATE ticket_panels
      SET messageId = NULL,
          updatedAt = unixepoch()
      WHERE id = ?
    `),

    clearTicketPanelChannel : db.prepare(`
      UPDATE ticket_panels
      SET messageId = NULL,
          channelId = NULL,
          updatedAt = unixepoch()
      WHERE id = ?
    `),

    insertTicketOption : db.prepare(`
      INSERT INTO ticket_options (
        panelId, label, emoji, description, categoryId,
        mentionRoles, staffRoles, logChannelId,
        openMessage, openEmbedJson, nameTemplate, buttonStyle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    getTicketOptionsByPanel : db.prepare(`
      SELECT * FROM ticket_options
      WHERE panelId = ?
      ORDER BY id ASC
    `),

    getTicketOptionById : db.prepare('SELECT * FROM ticket_options WHERE id = ?'),
    deleteTicketOption  : db.prepare('DELETE FROM ticket_options WHERE id = ?'),

    updateTicketOptionCore : db.prepare(`
      UPDATE ticket_options
      SET
        label         = COALESCE(?, label),
        emoji         = COALESCE(?, emoji),
        description   = COALESCE(?, description),
        categoryId    = COALESCE(?, categoryId),
        mentionRoles  = COALESCE(?, mentionRoles),
        staffRoles    = COALESCE(?, staffRoles),
        logChannelId  = COALESCE(?, logChannelId),
        openMessage   = COALESCE(?, openMessage),
        openEmbedJson = COALESCE(?, openEmbedJson),
        nameTemplate  = COALESCE(?, nameTemplate),
        buttonStyle   = COALESCE(?, buttonStyle)
      WHERE id = ?
    `),

    getRoleReactions   : db.prepare('SELECT * FROM role_reactions WHERE guildId = ? AND messageId = ?'),
    getAllRoleReactions: db.prepare('SELECT * FROM role_reactions WHERE guildId = ?'),
    insertRoleReaction : db.prepare('INSERT OR REPLACE INTO role_reactions (guildId, messageId, emoji, roleId) VALUES (?, ?, ?, ?)'),
    deleteRoleReaction : db.prepare('DELETE FROM role_reactions WHERE guildId = ? AND messageId = ? AND emoji = ?'),

    insertReminder  : db.prepare('INSERT INTO reminders (guildId, userId, channelId, message, remindAt) VALUES (?, ?, ?, ?, ?)'),
    getDueReminders : db.prepare('SELECT * FROM reminders WHERE done = 0 AND remindAt <= ?'),
    markReminderDone: db.prepare('UPDATE reminders SET done = 1 WHERE id = ?'),
    getReminderById      : db.prepare('SELECT * FROM reminders WHERE id = ?'),
    getRemindersByGuild  : db.prepare('SELECT * FROM reminders WHERE guildId = ? AND done = 0 ORDER BY remindAt ASC'),
    getRemindersByChannel: db.prepare('SELECT * FROM reminders WHERE guildId = ? AND channelId = ? AND done = 0 ORDER BY remindAt ASC'),
    deleteReminder       : db.prepare('DELETE FROM reminders WHERE id = ?'),
    updateReminderCore   : db.prepare(`
      UPDATE reminders SET
        channelId         = ?,
        message           = ?,
        remindAt          = ?,
        customCommandName = ?,
        repeatEvery       = ?
      WHERE id = ?
    `),
    rescheduleReminder   : db.prepare('UPDATE reminders SET remindAt = ?, done = 0 WHERE id = ?'),


    getAntiraidWhitelist   : db.prepare('SELECT * FROM antiraid_whitelist WHERE guildId = ?'),
    insertAntiraidWhitelist: db.prepare('INSERT OR IGNORE INTO antiraid_whitelist (guildId, targetId, targetType) VALUES (?, ?, ?)'),
    deleteAntiraidWhitelist: db.prepare('DELETE FROM antiraid_whitelist WHERE guildId = ? AND targetId = ?'),

    insertSuggestion    : db.prepare('INSERT INTO suggestions (guildId, userId, channelId, content) VALUES (?, ?, ?, ?)'),
    getSuggestion       : db.prepare('SELECT * FROM suggestions WHERE id = ?'),
    getSuggestionByMsg  : db.prepare('SELECT * FROM suggestions WHERE messageId = ? OR validatedMessageId = ?'),
    setSuggestionMsgId  : db.prepare('UPDATE suggestions SET messageId = ?, updatedAt = unixepoch() WHERE id = ?'),
    setSuggestionValidatedMsgId : db.prepare('UPDATE suggestions SET validatedMessageId = ?, updatedAt = unixepoch() WHERE id = ?'),
    setSuggestionThread : db.prepare('UPDATE suggestions SET threadId = ?, updatedAt = unixepoch() WHERE id = ?'),
    updateSuggestionStatus: db.prepare('UPDATE suggestions SET status = ?, response = ?, respondedBy = ?, updatedAt = unixepoch() WHERE id = ?'),
    updateSuggestionVotes : db.prepare('UPDATE suggestions SET upvotes = ?, downvotes = ?, updatedAt = unixepoch() WHERE id = ?'),
    getTopSuggestions   : db.prepare('SELECT * FROM suggestions WHERE guildId = ? AND status = ? ORDER BY upvotes DESC LIMIT ?'),
    getAllSuggestions    : db.prepare('SELECT * FROM suggestions WHERE guildId = ? ORDER BY createdAt DESC'),
    getSuggestionVote   : db.prepare('SELECT vote FROM suggestion_votes WHERE suggestionId = ? AND userId = ?'),
    upsertSuggestionVote: db.prepare('INSERT OR REPLACE INTO suggestion_votes (suggestionId, userId, vote) VALUES (?, ?, ?)'),
    deleteSuggestionVote: db.prepare('DELETE FROM suggestion_votes WHERE suggestionId = ? AND userId = ?'),
    getSuggestionVotes  : db.prepare('SELECT SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) as up, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) as down FROM suggestion_votes WHERE suggestionId = ?'),

    insertTempRole     : db.prepare('INSERT OR REPLACE INTO temp_roles (guildId, userId, roleId, expiresAt) VALUES (?, ?, ?, ?)'),
    deleteTempRole     : db.prepare('DELETE FROM temp_roles WHERE guildId = ? AND userId = ? AND roleId = ?'),
    getTempRoles       : db.prepare('SELECT * FROM temp_roles WHERE guildId = ? AND userId = ?'),
    getExpiredTempRoles: db.prepare('SELECT * FROM temp_roles WHERE expiresAt <= ?'),
    getAllTempRoles     : db.prepare('SELECT * FROM temp_roles WHERE guildId = ?'),

    insertPiconlyChannel: db.prepare('INSERT OR IGNORE INTO piconly_channels (guildId, channelId) VALUES (?, ?)'),
    deletePiconlyChannel: db.prepare('DELETE FROM piconly_channels WHERE guildId = ? AND channelId = ?'),
    getPiconlyChannels  : db.prepare('SELECT channelId FROM piconly_channels WHERE guildId = ?'),
    isPiconlyChannel    : db.prepare('SELECT 1 FROM piconly_channels WHERE guildId = ? AND channelId = ?'),

    insertPiconlyExemptRole    : db.prepare('INSERT OR IGNORE INTO piconly_exempt_roles (guildId, channelId, roleId) VALUES (?, ?, ?)'),
    deletePiconlyExemptRole    : db.prepare('DELETE FROM piconly_exempt_roles WHERE guildId = ? AND channelId = ? AND roleId = ?'),
    getPiconlyExemptRoles      : db.prepare('SELECT * FROM piconly_exempt_roles WHERE guildId = ? AND channelId = ?'),
    deleteAllPiconlyExemptRoles: db.prepare('DELETE FROM piconly_exempt_roles WHERE guildId = ? AND channelId = ?'),

    insertReport           : db.prepare('INSERT INTO reports (guildId, reporterId, targetId, targetMessageId, targetChannelId, reason) VALUES (?, ?, ?, ?, ?, ?)'),
    getReportById          : db.prepare('SELECT * FROM reports WHERE id = ?'),
    updateReportStatus     : db.prepare("UPDATE reports SET status = ?, handledBy = ?, handledAt = unixepoch() WHERE id = ?"),
    countReportsAgainst    : db.prepare("SELECT COUNT(*) AS n FROM reports WHERE guildId = ? AND targetId = ?"),

    insertNoderankRole: db.prepare('INSERT OR IGNORE INTO noderank_roles (guildId, roleId) VALUES (?, ?)'),
    deleteNoderankRole: db.prepare('DELETE FROM noderank_roles WHERE guildId = ? AND roleId = ?'),
    getNoderankRoles  : db.prepare('SELECT roleId FROM noderank_roles WHERE guildId = ?'),

    insertAutoreact: db.prepare('INSERT OR IGNORE INTO autoreact (guildId, channelId, emoji) VALUES (?, ?, ?)'),
    deleteAutoreact: db.prepare('DELETE FROM autoreact WHERE guildId = ? AND channelId = ? AND emoji = ?'),
    getAutoreacts  : db.prepare('SELECT * FROM autoreact WHERE guildId = ?'),
    getChannelAutoreacts: db.prepare('SELECT emoji FROM autoreact WHERE guildId = ? AND channelId = ?'),

    setPublicOverride   : db.prepare('INSERT OR REPLACE INTO public_channel_overrides (guildId, channelId, state) VALUES (?, ?, ?)'),
    deletePublicOverride: db.prepare('DELETE FROM public_channel_overrides WHERE guildId = ? AND channelId = ?'),
    getPublicOverride   : db.prepare('SELECT state FROM public_channel_overrides WHERE guildId = ? AND channelId = ?'),

    setAntispamOverride   : db.prepare('INSERT OR REPLACE INTO antispam_channel_overrides (guildId, channelId, state) VALUES (?, ?, ?)'),
    deleteAntispamOverride: db.prepare('DELETE FROM antispam_channel_overrides WHERE guildId = ? AND channelId = ?'),
    getAntispamOverride   : db.prepare('SELECT state FROM antispam_channel_overrides WHERE guildId = ? AND channelId = ?'),

    setAntilinkOverride   : db.prepare('INSERT OR REPLACE INTO antilink_channel_overrides (guildId, channelId, state) VALUES (?, ?, ?)'),
    deleteAntilinkOverride: db.prepare('DELETE FROM antilink_channel_overrides WHERE guildId = ? AND channelId = ?'),
    getAntilinkOverride   : db.prepare('SELECT state FROM antilink_channel_overrides WHERE guildId = ? AND channelId = ?'),
    listAntilinkOverrides : db.prepare('SELECT channelId, state FROM antilink_channel_overrides WHERE guildId = ? ORDER BY state, channelId'),
    listAntispamOverrides : db.prepare('SELECT channelId, state FROM antispam_channel_overrides WHERE guildId = ? ORDER BY state, channelId'),

    insertWarnThreshold : db.prepare('INSERT OR REPLACE INTO warn_thresholds (guildId, threshold, sanction, duration) VALUES (?, ?, ?, ?)'),
    deleteWarnThreshold : db.prepare('DELETE FROM warn_thresholds WHERE guildId = ? AND threshold = ?'),
    getWarnThresholds   : db.prepare('SELECT * FROM warn_thresholds WHERE guildId = ? ORDER BY threshold ASC'),
    clearWarnThresholds : db.prepare('DELETE FROM warn_thresholds WHERE guildId = ?'),

    insertPunishStep: db.prepare('INSERT OR REPLACE INTO punish_steps (guildId, strikes, window, sanction, duration) VALUES (?, ?, ?, ?, ?)'),
    deletePunishStep: db.prepare('DELETE FROM punish_steps WHERE guildId = ? AND strikes = ?'),
    getPunishSteps  : db.prepare('SELECT * FROM punish_steps WHERE guildId = ? ORDER BY strikes ASC'),
    clearPunishSteps: db.prepare('DELETE FROM punish_steps WHERE guildId = ?'),

    setStrikeTrigger   : db.prepare('INSERT OR REPLACE INTO strike_triggers (guildId, trigger, strikes, ancienStr) VALUES (?, ?, ?, ?)'),
    getStrikeTriggers  : db.prepare('SELECT * FROM strike_triggers WHERE guildId = ?'),
    getStrikeTrigger   : db.prepare('SELECT * FROM strike_triggers WHERE guildId = ? AND trigger = ?'),


    setSnipe   : db.prepare('INSERT OR REPLACE INTO snipe_cache (channelId, guildId, content, authorId, authorTag, attachments, deletedAt) VALUES (?, ?, ?, ?, ?, ?, unixepoch())'),
    getSnipe   : db.prepare('SELECT * FROM snipe_cache WHERE channelId = ?'),
    deleteSnipe: db.prepare('DELETE FROM snipe_cache WHERE channelId = ?'),

    insertBlacklistRank: db.prepare('INSERT OR IGNORE INTO blacklist_rank (guildId, roleId) VALUES (?, ?)'),
    deleteBlacklistRank: db.prepare('DELETE FROM blacklist_rank WHERE guildId = ? AND roleId = ?'),
    clearBlacklistRank : db.prepare('DELETE FROM blacklist_rank WHERE guildId = ?'),

    insertModmail: db.prepare('INSERT INTO modmails (guildId, userId, channelId) VALUES (?, ?, ?)'),
    getModmail   : db.prepare('SELECT * FROM modmails WHERE channelId = ?'),
    getModmailByUser: db.prepare("SELECT * FROM modmails WHERE guildId = ? AND userId = ? AND status = 'open'"),
    closeModmail : db.prepare("UPDATE modmails SET status = 'closed', closedAt = unixepoch() WHERE channelId = ?"),
    claimModmail : db.prepare("UPDATE modmails SET claimedBy = ? WHERE channelId = ?"),
    getAllOpenModmails: db.prepare("SELECT * FROM modmails WHERE guildId = ? AND status = 'open' ORDER BY createdAt DESC"),

    getBotSetting : db.prepare('SELECT value FROM bot_settings WHERE key = ?'),
    setBotSetting : db.prepare('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)'),


    markGuildPendingPurge   : db.prepare('INSERT OR IGNORE INTO pending_guild_purges (guildId, reason) VALUES (?, ?)'),
    unmarkGuildPendingPurge : db.prepare('DELETE FROM pending_guild_purges WHERE guildId = ?'),
    getGuildPendingPurge    : db.prepare('SELECT * FROM pending_guild_purges WHERE guildId = ?'),
    getDuePendingPurges     : db.prepare('SELECT * FROM pending_guild_purges WHERE markedAt <= ? ORDER BY markedAt ASC'),

    insertTwitchAlert : db.prepare('INSERT OR REPLACE INTO twitch_alerts (guildId, twitchLogin, channelId, roleId, message) VALUES (?, ?, ?, ?, ?)'),
    deleteTwitchAlert : db.prepare('DELETE FROM twitch_alerts WHERE guildId = ? AND twitchLogin = ?'),
    getTwitchAlerts   : db.prepare('SELECT * FROM twitch_alerts WHERE guildId = ?'),
    getAllTwitchAlerts : db.prepare('SELECT * FROM twitch_alerts'),
    updateTwitchLastId: db.prepare('UPDATE twitch_alerts SET lastLiveId = ? WHERE guildId = ? AND twitchLogin = ?'),

    insertFormulaire  : db.prepare('INSERT OR REPLACE INTO formulaires (guildId, name, buttonLabel, buttonEmoji, logChannel, questions, createdBy, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())'),
    getFormulaire     : db.prepare('SELECT * FROM formulaires WHERE guildId = ? AND name = ?'),
    getFormulaireById : db.prepare('SELECT * FROM formulaires WHERE id = ?'),
    getFormulaires    : db.prepare('SELECT * FROM formulaires WHERE guildId = ?'),
    deleteFormulaire  : db.prepare('DELETE FROM formulaires WHERE guildId = ? AND name = ?'),
    setFormulaireMsg  : db.prepare('UPDATE formulaires SET messageId = ?, channelId = ?, updatedAt = unixepoch() WHERE id = ?'),
    insertFormulaireResponse: db.prepare('INSERT INTO formulaire_responses (formulaireId, userId, answers) VALUES (?, ?, ?)'),

    insertMuteRoleBackup  : db.prepare('INSERT INTO mute_role_backup (guildId, userId, roleIds, restoreAt, source) VALUES (?, ?, ?, ?, ?)'),
    getMuteRoleBackup     : db.prepare('SELECT * FROM mute_role_backup WHERE guildId = ? AND userId = ?'),
    getExpiredMuteBackups : db.prepare('SELECT * FROM mute_role_backup WHERE restoreAt <= ?'),
    clearMuteRoleBackup   : db.prepare('DELETE FROM mute_role_backup WHERE guildId = ? AND userId = ?'),

    insertTempvocConfig : db.prepare('INSERT OR IGNORE INTO tempvoc_config (guildId) VALUES (?)'),
    getTempvocConfig    : db.prepare('SELECT * FROM tempvoc_config WHERE guildId = ?'),
    insertTempvocChannel: db.prepare('INSERT OR REPLACE INTO tempvoc_channels (guildId, channelId, ownerId) VALUES (?, ?, ?)'),
    getTempvocChannel   : db.prepare('SELECT * FROM tempvoc_channels WHERE channelId = ?'),
    getTempvocChannels  : db.prepare('SELECT * FROM tempvoc_channels WHERE guildId = ?'),
    deleteTempvocChannel: db.prepare('DELETE FROM tempvoc_channels WHERE channelId = ?'),
    updateTempvocOwner  : db.prepare('UPDATE tempvoc_channels SET ownerId = ? WHERE channelId = ?'),

    insertTempvocBan    : db.prepare('INSERT OR IGNORE INTO tempvoc_bans (guildId, channelId, userId) VALUES (?, ?, ?)'),
    deleteTempvocBan    : db.prepare('DELETE FROM tempvoc_bans WHERE channelId = ? AND userId = ?'),
    getTempvocBans      : db.prepare('SELECT * FROM tempvoc_bans WHERE channelId = ?'),
    isTempvocBanned     : db.prepare('SELECT 1 FROM tempvoc_bans WHERE channelId = ? AND userId = ?'),
    deleteTempvocBansByChannel: db.prepare('DELETE FROM tempvoc_bans WHERE channelId = ?'),

    insertRoleMenu: db.prepare(`
      INSERT INTO role_menus (guildId, channelId, title, description, placeholder, mode, minValues, maxValues, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRoleMenu            : db.prepare('SELECT * FROM role_menus WHERE id = ?'),
    getRoleMenuByMessageId : db.prepare('SELECT * FROM role_menus WHERE messageId = ?'),
    getRoleMenus           : db.prepare('SELECT * FROM role_menus WHERE guildId = ? ORDER BY id ASC'),
    getRoleMenusByChannel  : db.prepare('SELECT * FROM role_menus WHERE guildId = ? AND channelId = ?'),
    clearRoleMenuMessage   : db.prepare('UPDATE role_menus SET messageId = NULL, updatedAt = unixepoch() WHERE id = ?'),
    deleteRoleMenu         : db.prepare('DELETE FROM role_menus WHERE id = ?'),
    updateRoleMenuCore: db.prepare(`
      UPDATE role_menus
      SET
        channelId     = COALESCE(?, channelId),
        messageId     = COALESCE(?, messageId),
        title         = COALESCE(?, title),
        description   = COALESCE(?, description),
        placeholder   = COALESCE(?, placeholder),
        mode          = COALESCE(?, mode),
        minValues     = COALESCE(?, minValues),
        maxValues     = COALESCE(?, maxValues),
        componentType = COALESCE(?, componentType),
        buttonStyle   = COALESCE(?, buttonStyle),
        roleSpacing   = COALESCE(?, roleSpacing),
        roleSeparator = COALESCE(?, roleSeparator),
        roleFormat    = COALESCE(?, roleFormat),
        feedbackMode  = COALESCE(?, feedbackMode),
        updatedAt     = unixepoch()
      WHERE id = ?
    `),
    insertRoleMenuOption      : db.prepare(`
      INSERT OR IGNORE INTO role_menu_options (menuId, roleId, label, description, emoji)
      VALUES (?, ?, ?, ?, ?)
    `),
    getRoleMenuOptions        : db.prepare('SELECT * FROM role_menu_options WHERE menuId = ? ORDER BY id ASC'),
    getRoleMenuOptionByRole   : db.prepare('SELECT * FROM role_menu_options WHERE menuId = ? AND roleId = ?'),
    deleteRoleMenuOption      : db.prepare('DELETE FROM role_menu_options WHERE menuId = ? AND roleId = ?'),
    clearRoleMenuOptions      : db.prepare('DELETE FROM role_menu_options WHERE menuId = ?'),
    updateRoleMenuRestrictions: db.prepare('UPDATE role_menus SET requiredRoleIds = ?, forbiddenRoleIds = ?, updatedAt = unixepoch() WHERE id = ?'),

    insertAutorole: db.prepare('INSERT OR IGNORE INTO autoroles (guildId, roleId) VALUES (?, ?)'),
    deleteAutorole: db.prepare('DELETE FROM autoroles WHERE guildId = ? AND roleId = ?'),
    getAutoroles  : db.prepare('SELECT roleId FROM autoroles WHERE guildId = ? ORDER BY createdAt ASC'),
    clearAutoroles: db.prepare('DELETE FROM autoroles WHERE guildId = ?'),

    getSoutienTracking    : db.prepare('SELECT * FROM soutien_tracking WHERE guildId = ? AND userId = ?'),
    upsertSoutienTracking : db.prepare('INSERT OR IGNORE INTO soutien_tracking (guildId, userId) VALUES (?, ?)'),
    deleteSoutienTracking : db.prepare('DELETE FROM soutien_tracking WHERE guildId = ? AND userId = ?'),

    grantSoutienRoleLazy    : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, roleGrantedAt, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 1) ON CONFLICT(guildId, userId) DO UPDATE SET roleGrantedAt = COALESCE(soutien_tracking.roleGrantedAt, unixepoch()), lastCheckedAt = unixepoch()`),
    grantSoutienRoleReal    : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, roleGrantedAt, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 0) ON CONFLICT(guildId, userId) DO UPDATE SET roleGrantedAt = COALESCE(soutien_tracking.roleGrantedAt, unixepoch()), lastCheckedAt = unixepoch(), lazyGranted = 0`),
    revokeSoutienRole       : db.prepare('UPDATE soutien_tracking SET roleGrantedAt = NULL, lastCheckedAt = unixepoch(), lazyGranted = 0 WHERE guildId = ? AND userId = ?'),
    markSoutienStatusValidLazy : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, statusValidSince, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 1) ON CONFLICT(guildId, userId) DO UPDATE SET statusValidSince = COALESCE(soutien_tracking.statusValidSince, unixepoch()), lastCheckedAt = unixepoch()`),
    markSoutienStatusValidReal : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, statusValidSince, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 0) ON CONFLICT(guildId, userId) DO UPDATE SET statusValidSince = COALESCE(soutien_tracking.statusValidSince, unixepoch()), lastCheckedAt = unixepoch(), lazyGranted = 0`),
    clearSoutienStatusValid : db.prepare('UPDATE soutien_tracking SET statusValidSince = NULL, lastCheckedAt = unixepoch() WHERE guildId = ? AND userId = ?'),
    markSoutienTagValidLazy : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, tagValidSince, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 1) ON CONFLICT(guildId, userId) DO UPDATE SET tagValidSince = COALESCE(soutien_tracking.tagValidSince, unixepoch()), lastCheckedAt = unixepoch()`),
    markSoutienTagValidReal : db.prepare(`INSERT INTO soutien_tracking (guildId, userId, tagValidSince, lastCheckedAt, lazyGranted) VALUES (?, ?, unixepoch(), unixepoch(), 0) ON CONFLICT(guildId, userId) DO UPDATE SET tagValidSince = COALESCE(soutien_tracking.tagValidSince, unixepoch()), lastCheckedAt = unixepoch(), lazyGranted = 0`),
    clearSoutienTagValid    : db.prepare('UPDATE soutien_tracking SET tagValidSince = NULL, lastCheckedAt = unixepoch() WHERE guildId = ? AND userId = ?'),


    listSoutienTagOnly : db.prepare(`
      SELECT userId, roleGrantedAt, tagValidSince
      FROM soutien_tracking
      WHERE guildId          = ?
        AND roleGrantedAt    IS NOT NULL
        AND tagValidSince    IS NOT NULL
        AND statusValidSince IS NULL
      ORDER BY roleGrantedAt ASC, userId ASC
    `),

    getSoutienLeaderboard : db.prepare(`
      SELECT
        userId,
        roleGrantedAt,
        statusValidSince,
        tagValidSince,
        lazyGranted,
        COALESCE(roleGrantedAt, statusValidSince, tagValidSince) AS sortKey
      FROM soutien_tracking
      WHERE guildId = ?
        AND (
          roleGrantedAt    IS NOT NULL OR
          statusValidSince IS NOT NULL OR
          tagValidSince    IS NOT NULL
        )
      ORDER BY sortKey ASC, userId ASC
      LIMIT ? OFFSET ?
    `),
    countSoutienLeaderboard : db.prepare(`
      SELECT COUNT(*) AS total
      FROM soutien_tracking
      WHERE guildId = ?
        AND (
          roleGrantedAt    IS NOT NULL OR
          statusValidSince IS NOT NULL OR
          tagValidSince    IS NOT NULL
        )
    `),

    addSoutienManualIgnore    : db.prepare('INSERT OR REPLACE INTO soutien_manual_ignored (guildId, userId, roleId, ignoredAt, ignoredBy) VALUES (?, ?, ?, unixepoch(), ?)'),
    removeSoutienManualIgnore : db.prepare('DELETE FROM soutien_manual_ignored WHERE guildId = ? AND userId = ? AND roleId = ?'),
    getSoutienManualIgnore    : db.prepare('SELECT 1 FROM soutien_manual_ignored WHERE guildId = ? AND userId = ? AND roleId = ?'),

    getVoiceStats          : db.prepare('SELECT * FROM voice_stats WHERE guildId = ? AND userId = ?'),
    upsertVoiceJoin        : db.prepare('INSERT INTO voice_stats (guildId, userId, channelId, joinedAt) VALUES (?, ?, ?, unixepoch()) ON CONFLICT(guildId, userId) DO UPDATE SET channelId = excluded.channelId, joinedAt = COALESCE(voice_stats.joinedAt, unixepoch())'),
    voiceLeave             : db.prepare('UPDATE voice_stats SET totalSeconds = totalSeconds + (unixepoch() - joinedAt), channelId = NULL, joinedAt = NULL WHERE guildId = ? AND userId = ? AND joinedAt IS NOT NULL'),
    voiceMove              : db.prepare('UPDATE voice_stats SET channelId = ? WHERE guildId = ? AND userId = ?'),
    clearVoiceSession      : db.prepare('UPDATE voice_stats SET channelId = NULL, joinedAt = NULL WHERE guildId = ? AND userId = ?'),
    clearVoiceSessionStale : db.prepare('UPDATE voice_stats SET lastStaleClearAt = unixepoch(), channelId = NULL, joinedAt = NULL WHERE guildId = ? AND userId = ? AND joinedAt IS NOT NULL'),
    getActiveVoiceSessions : db.prepare('SELECT * FROM voice_stats WHERE guildId = ? AND joinedAt IS NOT NULL'),

    setPendingVerification     : db.prepare('INSERT INTO pending_verifications (guildId, userId, expiresAt) VALUES (?, ?, ?) ON CONFLICT(guildId, userId) DO UPDATE SET expiresAt = excluded.expiresAt'),
    deletePendingVerification  : db.prepare('DELETE FROM pending_verifications WHERE guildId = ? AND userId = ?'),
    getPendingVerification     : db.prepare('SELECT * FROM pending_verifications WHERE guildId = ? AND userId = ?'),
    getPendingVerifications    : db.prepare('SELECT * FROM pending_verifications'),
    clearGuildPendingVerifications: db.prepare('DELETE FROM pending_verifications WHERE guildId = ?'),

    getBotActivity   : db.prepare('SELECT * FROM bot_activity WHERE id = 1'),
    setBotActivity   : db.prepare(`
      INSERT INTO bot_activity (id, type, messages, url, status, removed)
      VALUES (1, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        type     = excluded.type,
        messages = excluded.messages,
        url      = excluded.url,
        status   = excluded.status,
        removed  = 0
    `),
    clearBotActivity : db.prepare('UPDATE bot_activity SET removed = 1 WHERE id = 1'),
  };
}


function _normalizeCommandCooldownName(commandName) {
  const name = String(commandName || '').trim().toLowerCase();
  return name || null;
}

function getCommandCooldown(guildId, commandName) {
  const name = _normalizeCommandCooldownName(commandName);
  if (!guildId || !name) return null;

  const row = getDb().prepare(`
    SELECT cooldownMs
    FROM command_cooldowns
    WHERE guildId = ? AND commandName = ?
  `).get(String(guildId), name);

  if (!row) return null;
  return Number(row.cooldownMs);
}

function setCommandCooldown(guildId, commandName, cooldownMs) {
  const name  = _normalizeCommandCooldownName(commandName);
  const value = Number(cooldownMs);

  if (!guildId || !name || !Number.isFinite(value) || value < 0) return false;

  getDb().prepare(`
    INSERT INTO command_cooldowns (guildId, commandName, cooldownMs, updatedAt)
    VALUES (?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(guildId, commandName)
    DO UPDATE SET
      cooldownMs = excluded.cooldownMs,
      updatedAt  = strftime('%s', 'now')
  `).run(String(guildId), name, Math.floor(value));

  return true;
}

function deleteCommandCooldown(guildId, commandName) {
  const name = _normalizeCommandCooldownName(commandName);
  if (!guildId || !name) return false;

  const info = getDb().prepare(`
    DELETE FROM command_cooldowns
    WHERE guildId = ? AND commandName = ?
  `).run(String(guildId), name);

  return info.changes > 0;
}

function getCommandCooldowns(guildId) {
  if (!guildId) return [];

  return getDb().prepare(`
    SELECT commandName, cooldownMs, updatedAt
    FROM command_cooldowns
    WHERE guildId = ?
    ORDER BY
      CASE WHEN commandName = '__default' THEN 0 ELSE 1 END,
      commandName COLLATE NOCASE ASC
  `).all(String(guildId));
}

function clearCommandCooldowns(guildId) {
  if (!guildId) return 0;

  const info = getDb().prepare(`
    DELETE FROM command_cooldowns
    WHERE guildId = ?
  `).run(String(guildId));

  return info.changes || 0;
}


const db = {


  getGuildConfig(guildId) {
    getDb();
    _stmts.insertGuildConfig.run(guildId);
    return _stmts.getGuildConfig.get(guildId);
  },

  setGuildConfig(guildId, key, value) {
    getDb();
    assertAllowedColumn(GUILD_CONFIG_KEYS, key, 'guild_config');
    getDb().prepare(`UPDATE guild_config SET ${key} = ?, updatedAt = unixepoch() WHERE guildId = ?`).run(value, guildId);
  },

  setGuildConfigValue(guildId, key, value) {
    return this.setGuildConfig(guildId, key, value);
  },


  getGlobalOwners() {
    getDb();
    return _stmts.getGlobalOwners.all().map(r => r.userId);
  },

  addGlobalOwner(userId) {
    getDb();
    _stmts.insertGlobalOwner.run(userId);
  },

  removeGlobalOwner(userId) {
    getDb();
    _stmts.deleteGlobalOwner.run(userId);
  },

  isGlobalOwner(userId) {
    getDb();
    return !!_stmts.isGlobalOwner.get(userId);
  },

  getOwners(guildId) {
    getDb();
    return _stmts.getOwners.all(guildId).map(r => r.userId);
  },


  getGlobalBuyers() {
    getDb();
    return _stmts.getGlobalBuyers.all().map(r => r.userId);
  },

  addGlobalBuyer(userId) {
    getDb();
    _stmts.insertGlobalBuyer.run(userId);
  },

  removeGlobalBuyer(userId) {
    getDb();
    _stmts.deleteGlobalBuyer.run(userId);
  },

  isGlobalBuyer(userId) {
    getDb();
    return !!_stmts.isGlobalBuyer.get(userId);
  },

  addOwner(guildId, userId) {
    getDb();
    _stmts.insertOwner.run(guildId, userId);
  },

  removeOwner(guildId, userId) {
    getDb();
    _stmts.deleteOwner.run(guildId, userId);
  },

  isOwner(guildId, userId) {
    getDb();
    return !!_stmts.isOwner.get(guildId, userId);
  },

  getBlacklistRanks(guildId) {
    getDb();
    return _stmts.getBlacklistRanks.all(guildId).map(r => r.roleId);
  },

  getCmdTargets(guildId, commandName) {
    getDb();
    return _stmts.getCmdTargets.all(guildId, commandName);
  },

  addCmdTarget(guildId, commandName, targetId, targetType) {
    getDb();
    _stmts.addCmdTarget.run(guildId, commandName, targetId, targetType);
  },

  removeCmdTarget(guildId, commandName, targetId) {
    getDb();
    _stmts.removeCmdTarget.run(guildId, commandName, targetId);
  },

  clearCmdTargets(guildId, commandName) {
    getDb();
    _stmts.clearCmdTargets.run(guildId, commandName);
  },

  getAllCmdTargets(guildId) {
    getDb();
    return _stmts.getAllCmdTargets.all(guildId);
  },

  getPermLevels(guildId) {
    getDb();
    return _stmts.getPermLevels.all(guildId);
  },

  setPermLevel(guildId, level, targetId, targetType) {
    getDb().prepare('INSERT OR REPLACE INTO perm_levels (guildId, level, targetId, targetType) VALUES (?, ?, ?, ?)').run(guildId, level, targetId, targetType);
  },

  removePermLevel(guildId, level, targetId) {
    getDb().prepare('DELETE FROM perm_levels WHERE guildId = ? AND level = ? AND targetId = ?').run(guildId, level, targetId);
  },

  clearPermLevels(guildId) {
    getDb().prepare('DELETE FROM perm_levels WHERE guildId = ?').run(guildId);
  },


  getBuyerRecoveryCode() {
    getDb();
    return _stmts.getBuyerRecovery.get() ?? null;
  },

  setBuyerRecoveryCode(codeHash) {
    const database = getDb();
    database.transaction(() => {
      _stmts.deleteBuyerRecovery.run();
      _stmts.insertBuyerRecovery.run(codeHash);
    })();
  },

  deleteBuyerRecoveryCode() {
    getDb();
    _stmts.deleteBuyerRecovery.run();
  },


  getBotConfig(key) {
    getDb();
    return _stmts.getBotConfig.get(key)?.value ?? null;
  },

  setBotConfig(key, value) {
    getDb();
    _stmts.setBotConfig.run(key, String(value));
  },

  deleteBotConfig(key) {
    getDb();
    _stmts.deleteBotConfig.run(key);
  },

  getCmdPerm(guildId, commandName) {
    getDb();
    return _stmts.getCmdPerm.get(guildId, commandName)?.perm ?? 'owner';
  },

  setCmdPerm(guildId, commandName, perm) {
    getDb();
    _stmts.setCmdPerm.run(guildId, commandName, perm);
  },

  getAllCmdPerms(guildId) {
    getDb();
    return _stmts.getAllCmdPerms.all(guildId);
  },

  resetCmdPerms(guildId) {
    getDb().prepare('DELETE FROM cmd_perms WHERE guildId = ?').run(guildId);
  },

  moveCmdPerms(guildId, fromPerm, toPerm) {
    getDb().prepare('UPDATE cmd_perms SET perm = ?, updatedAt = unixepoch() WHERE guildId = ? AND perm = ?').run(toPerm, guildId, fromPerm);
  },

  getPublicChannels(guildId) {
    getDb();
    return _stmts.getPublicChannels.all(guildId).map(r => r.channelId);
  },

  addPublicChannel(guildId, channelId) {
    getDb();
    _stmts.insertPublicChannel.run(guildId, channelId);
  },

  removePublicChannel(guildId, channelId) {
    getDb();
    _stmts.deletePublicChannel.run(guildId, channelId);
  },

  clearPublicChannels(guildId) {
    getDb();
    _stmts.clearPublicChannels.run(guildId);
  },


  getNoLogChannels(guildId) {
    getDb();
    return _stmts.getNoLogChannels.all(guildId).map(r => r.channelId);
  },

  addNoLogChannel(guildId, channelId) {
    getDb();
    _stmts.insertNoLogChannel.run(guildId, channelId);
  },

  removeNoLogChannel(guildId, channelId) {
    getDb();
    _stmts.deleteNoLogChannel.run(guildId, channelId);
  },

  isNoLogChannel(guildId, channelId) {
    getDb();
    return !!_stmts.isNoLogChannel.get(guildId, channelId);
  },


  addSanction(guildId, userId, moderatorId, type, reason = null, duration = null, channelId = null) {
    getDb();
    const expiresAt = duration ? Math.floor(Date.now() / 1000) + duration : null;
    return _stmts.insertSanction.run(guildId, userId, moderatorId, type, reason, duration, expiresAt, channelId).lastInsertRowid;
  },

  getSanctions(guildId, userId) {
    getDb();
    return _stmts.getSanctions.all(guildId, userId);
  },

  getActiveSanction(guildId, userId, type) {
    getDb();
    return _stmts.getActiveSanction.get(guildId, userId, type);
  },

  expireSanction(id) {
    getDb();
    _stmts.expireSanction.run(id);
  },

  deleteSanction(id) {
    getDb();
    _stmts.softDeleteSanction.run(id);
  },

  getExpiredSanctions() {
    getDb();
    return _stmts.getExpiredSanctions.all(Math.floor(Date.now() / 1000));
  },

  clearSanctions(guildId, userId) {
    getDb().prepare('UPDATE sanctions SET active = 0, updatedAt = unixepoch() WHERE guildId = ? AND userId = ? AND deletedAt IS NULL').run(guildId, userId);
  },

  clearWarnSanctions(guildId, userId) {
    getDb().prepare(`
      UPDATE sanctions
      SET deletedAt = unixepoch(),
          updatedAt = unixepoch(),
          active = 0
      WHERE guildId = ?
        AND userId = ?
        AND type = 'warn'
        AND deletedAt IS NULL
    `).run(guildId, userId);
  },

  expireMuteSanctions(guildId, userId) {
    getDb().prepare(
      `UPDATE sanctions SET active = 0, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ? AND type = 'mute' AND active = 1 AND deletedAt IS NULL`
    ).run(guildId, userId);
  },

  expireBanSanctions(guildId, userId) {
    getDb().prepare(
      `UPDATE sanctions SET active = 0, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ? AND type IN ('ban', 'tempban') AND active = 1 AND deletedAt IS NULL`
    ).run(guildId, userId);
  },

  expireCmuteSanctions(guildId, userId, channelId) {
    getDb().prepare(`
      UPDATE sanctions
      SET active = 0, updatedAt = unixepoch()
      WHERE guildId = ?
        AND userId = ?
        AND type = 'cmute'
        AND channelId = ?
        AND active = 1
        AND deletedAt IS NULL
    `).run(guildId, userId, channelId);
  },

  expireSanctionsByTypes(guildId, userId, types = []) {
    if (!Array.isArray(types) || !types.length) return;
    const placeholders = types.map(() => '?').join(', ');
    getDb().prepare(`
      UPDATE sanctions
      SET active = 0, updatedAt = unixepoch()
      WHERE guildId = ?
        AND userId = ?
        AND type IN (${placeholders})
        AND active = 1
        AND deletedAt IS NULL
    `).run(guildId, userId, ...types);
  },

  getActiveSanctionsByType(guildId, userId, type) {
    getDb();
    return _stmts.getActiveSanctionsByType.all(guildId, userId, type);
  },


  getActiveSanctionUserIdsByType(guildId, type) {
    getDb();
    return _stmts.getActiveSanctionUserIdsByType.all(guildId, type).map(r => r.userId);
  },

  deleteTempBan(guildId, userId) {
    getDb().prepare(
      `UPDATE sanctions SET deletedAt = unixepoch(), updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ? AND type = 'tempban' AND active = 1 AND deletedAt IS NULL`
    ).run(guildId, userId);
  },


  getLevel(guildId, userId) {
    getDb();
    _stmts.insertLevel.run(guildId, userId);
    return _stmts.getLevel.get(guildId, userId);
  },

  addXp(guildId, userId, xp) {
    getDb();
    _stmts.addXp.run(xp, Math.floor(Date.now() / 1000), guildId, userId);
    const row = _stmts.getLevel.get(guildId, userId);
    if (row) {
      let level = 0, total = 0;
      const xpForLevel = (lvl) => 5 * (lvl ** 2) + 50 * lvl + 100;
      while (total + xpForLevel(level) <= (row.xp || 0)) {
        total += xpForLevel(level);
        level++;
      }
      if (level !== (row.level || 0)) {
        _stmts.setLevel.run(level, row.xp, guildId, userId);
      }
    }
  },

  removeXp(guildId, userId, xp) {
    getDb();
    const row = _stmts.getLevel.get(guildId, userId);
    if (!row) return;
    const newXp = Math.max(0, (row.xp || 0) - xp);
    let level = 0, total = 0;
    const xpForLevel = (lvl) => 5 * (lvl ** 2) + 50 * lvl + 100;
    while (total + xpForLevel(level) <= newXp) {
      total += xpForLevel(level);
      level++;
    }
    _stmts.setLevel.run(level, newXp, guildId, userId);
  },

  setLevel(guildId, userId, level, xp) {
    getDb();
    _stmts.setLevel.run(level, xp, guildId, userId);
  },

  resetXp(guildId, userId) {
    getDb().prepare('UPDATE levels SET xp = 0, level = 0, messages = 0, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(guildId, userId);
  },

  resetLevelUser(guildId, userId) {
    getDb().prepare(`
      UPDATE levels
      SET xp = 0,
          level = 0,
          messages = 0,
          lastXpAt = 0,
          updatedAt = unixepoch()
      WHERE guildId = ?
      AND userId = ?
    `).run(guildId, userId);
  },

  resetLevelsGuild(guildId) {
    getDb().prepare('DELETE FROM levels WHERE guildId = ?').run(guildId);
  },

  addXpDirect(guildId, userId, xp) {
    this.getLevel(guildId, userId);
    getDb().prepare(`
      UPDATE levels
      SET xp = xp + ?,
          updatedAt = unixepoch()
      WHERE guildId = ?
      AND userId = ?
    `).run(xp, guildId, userId);
  },

  removeXpDirect(guildId, userId, xp) {
    this.getLevel(guildId, userId);
    getDb().prepare(`
      UPDATE levels
      SET xp = MAX(0, xp - ?),
          updatedAt = unixepoch()
      WHERE guildId = ?
      AND userId = ?
    `).run(xp, guildId, userId);
  },

  getLeaderboard(guildId, limit = 10) {
    getDb();
    return _stmts.getLeaderboard.all(guildId, limit);
  },

  getLevelRoles(guildId) {
    return getDb().prepare('SELECT * FROM level_roles WHERE guildId = ? ORDER BY level ASC').all(guildId);
  },

  getXpIgnoredChannels(guildId) {
    return getDb().prepare('SELECT channelId FROM xp_ignored_channels WHERE guildId = ?').all(guildId).map(r => r.channelId);
  },
  addXpIgnoredChannel(guildId, channelId) {
    getDb().prepare('INSERT OR IGNORE INTO xp_ignored_channels (guildId, channelId) VALUES (?, ?)').run(guildId, channelId);
  },
  removeXpIgnoredChannel(guildId, channelId) {
    getDb().prepare('DELETE FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?').run(guildId, channelId);
  },
  isXpIgnoredChannel(guildId, channelId) {
    return !!getDb().prepare('SELECT 1 FROM xp_ignored_channels WHERE guildId = ? AND channelId = ?').get(guildId, channelId);
  },

  getXpRoleMultipliers(guildId) {
    return getDb().prepare('SELECT roleId, multiplier FROM xp_role_multipliers WHERE guildId = ?').all(guildId);
  },
  setXpRoleMultiplier(guildId, roleId, multiplier) {
    getDb().prepare('INSERT OR REPLACE INTO xp_role_multipliers (guildId, roleId, multiplier) VALUES (?, ?, ?)').run(guildId, roleId, multiplier);
  },
  removeXpRoleMultiplier(guildId, roleId) {
    getDb().prepare('DELETE FROM xp_role_multipliers WHERE guildId = ? AND roleId = ?').run(guildId, roleId);
  },

  getXpChannelCooldown(guildId, channelId) {
    const row = getDb().prepare('SELECT cooldown FROM xp_channel_cooldowns WHERE guildId = ? AND channelId = ?').get(guildId, channelId);
    return row ? row.cooldown : null;
  },
  setXpChannelCooldown(guildId, channelId, cooldown) {
    getDb().prepare('INSERT OR REPLACE INTO xp_channel_cooldowns (guildId, channelId, cooldown) VALUES (?, ?, ?)').run(guildId, channelId, cooldown);
  },
  removeXpChannelCooldown(guildId, channelId) {
    getDb().prepare('DELETE FROM xp_channel_cooldowns WHERE guildId = ? AND channelId = ?').run(guildId, channelId);
  },
  getAllXpChannelCooldowns(guildId) {
    return getDb().prepare('SELECT channelId, cooldown FROM xp_channel_cooldowns WHERE guildId = ?').all(guildId);
  },

  setTicketRating(ticketId, rating, comment) {
    getDb().prepare('UPDATE tickets SET rating = ?, ratingComment = ? WHERE id = ?').run(rating, comment ?? null, ticketId);
  },
  getTicketStats(guildId) {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guildId = ? AND status IN ('closed','deleted')").get(guildId)?.c ?? 0;
    const rated = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guildId = ? AND status IN ('closed','deleted') AND rating IS NOT NULL").get(guildId)?.c ?? 0;
    const avgRating = db.prepare("SELECT AVG(rating) as avg FROM tickets WHERE guildId = ? AND status IN ('closed','deleted') AND rating IS NOT NULL").get(guildId)?.avg ?? null;
    const avgClose = db.prepare(`
      SELECT AVG(COALESCE(closedAt, updatedAt) - createdAt) as avg
      FROM tickets WHERE guildId = ? AND status IN ('closed','deleted')
      AND COALESCE(closedAt, updatedAt) IS NOT NULL
    `).get(guildId)?.avg ?? null;
    return { total, rated, avgRating, avgClose };
  },

  addLevelRole(guildId, level, roleId) {
    getDb().prepare('INSERT OR REPLACE INTO level_roles (guildId, level, roleId) VALUES (?, ?, ?)').run(guildId, level, roleId);
  },

  removeLevelRole(guildId, level, roleId) {
    getDb().prepare('DELETE FROM level_roles WHERE guildId = ? AND level = ? AND roleId = ?').run(guildId, level, roleId);
  },


  createTicket(guildId, channelId, userId, subject = null, panelId = null, optionId = null) {
    getDb();
    return _stmts.insertTicket.run(
      guildId,
      channelId,
      userId,
      subject,
      panelId,
      optionId
    ).lastInsertRowid;
  },

  getTicket(channelId) {
    getDb();
    return _stmts.getTicket.get(channelId);
  },

  getTicketById(id) {
    return getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  },

  getOpenTickets(guildId, userId) {
    getDb();
    return _stmts.getOpenTickets.all(guildId, userId);
  },

  getTicketsPendingDelete() {
    getDb();
    return _stmts.getTicketsPendingDelete.all();
  },

  updateTicket(channelId, data = {}) {
    getDb();
    _stmts.updateTicketCore.run(
      data.status ?? null,
      data.claimedBy ?? null,
      data.claimedAt ?? null,
      data.closedBy ?? null,
      data.closedAt ?? null,
      data.closeReason ?? null,
      data.deleteAt ?? null,
      data.renamedBy ?? null,
      data.lastMessageId ?? null,
      data.transcriptUrl ?? null,
      data.subject ?? null,
      channelId
    );
  },

  claimTicket(channelId, modId) {
    this.updateTicket(channelId, {
      claimedBy: modId,
      claimedAt: Math.floor(Date.now() / 1000),
    });
  },

  unclaimTicket(channelId) {
    getDb();
    _stmts.clearTicketClaim.run(channelId);
  },

  clearTicketDeleteAt(channelId) {
    getDb();
    _stmts.clearTicketDeleteAt.run(channelId);
  },

  reopenTicket(channelId) {
    getDb();
    _stmts.reopenTicket.run(channelId);
  },

  updateTicketActivity(channelId, timestamp) {
    getDb();
    _stmts.updateTicketActivity.run(timestamp, channelId);
  },

  getInactiveTickets(now) {
    getDb();
    return _stmts.getInactiveTickets.all(now);
  },

  closeTicket(channelId, closedBy = null, reason = null, deleteAt = null) {
    getDb();
    const now = Math.floor(Date.now() / 1000);
    _stmts.closeTicketCore.run(closedBy, now, reason, deleteAt, now, channelId);
  },

  renameTicket(channelId, newSubject, renamedBy) {
    this.updateTicket(channelId, {
      subject   : newSubject,
      renamedBy : renamedBy,
    });
  },

  setTicketLastMessageId(channelId, messageId) {
    this.updateTicket(channelId, {
      lastMessageId: messageId,
    });
  },

  setTicketTranscriptUrl(channelId, url) {
    this.updateTicket(channelId, {
      transcriptUrl: url,
    });
  },

  createTicketPanel(guildId, channelId, panelType = 'button') {
    getDb();
    return _stmts.insertTicketPanel.run(guildId, channelId, panelType).lastInsertRowid;
  },

  getTicketPanels(guildId) {
    getDb();
    return _stmts.getTicketPanels.all(guildId);
  },

  getTicketPanel(panelId) {
    getDb();
    return _stmts.getTicketPanelById.get(panelId);
  },

  getTicketPanelByGuild(panelId, guildId) {
    getDb();
    return getDb().prepare('SELECT * FROM ticket_panels WHERE id = ? AND guildId = ?').get(panelId, guildId) ?? null;
  },

  deleteTicketPanel(panelId) {
    getDb();
    _stmts.deleteTicketPanel.run(panelId);
  },

    resetTicketPanelSequence() {
    getDb();
    _stmts.resetTicketPanelSequence.run();
  },

  resetTicketOptionSequence() {
    getDb();
    _stmts.resetTicketOptionSequence.run();
  },

  setTicketPanelMessageId(panelId, messageId) {
    this.updateTicketPanel(panelId, { messageId });
  },

  updateTicketPanel(panelId, data = {}) {
    const db = getDb();
    const ALLOWED = new Set([
      'channelId','messageId','panelType','placeholder','embedJson',
      'requiredRoles','blockedRoles','bypassRoles','claimMode',
      'showClaimButton','showCloseButton','maxOpenPerUser',
      'autoCloseSeconds','autoDeleteSeconds','transcriptDm',
      'closeOnLeave','logChannelId','inactiveCloseDelay',
    ]);
    const entries = Object.entries(data).filter(([k, v]) => ALLOWED.has(k) && v !== undefined);
    if (!entries.length) return;
    const sets   = entries.map(([k]) => `${k} = ?`);
    const values = entries.map(([, v]) => v);
    sets.push('updatedAt = unixepoch()');
    values.push(panelId);
    db.prepare(`UPDATE ticket_panels SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  updateTicketPanelEmbed(panelId, embedJson) {
    this.updateTicketPanel(panelId, { embedJson });
  },

  resetTicketPanelEmbed(panelId) {
    getDb();
    _stmts.resetTicketPanelEmbed.run(panelId);
  },

  clearTicketPanelMessage(panelId) {
    getDb();
    _stmts.clearTicketPanelMessage.run(panelId);
  },

  clearTicketPanelChannel(panelId) {
    getDb();
    _stmts.clearTicketPanelChannel.run(panelId);
  },

  updateTicketPanelSettings(panelId, data) {
    this.updateTicketPanel(panelId, data);
  },

  getTicketPanelMessageId(panelId) {
    getDb();
    return _stmts.getTicketPanelMessageId.get(panelId)?.messageId ?? null;
  },

  getTicketPanelByMessageId(messageId) {
    getDb();
    return _stmts.getTicketPanelByMessageId.get(messageId) ?? null;
  },

  createTicketOption(panelId, data) {
    getDb();
    return _stmts.insertTicketOption.run(
      panelId,
      data.label ?? null,
      data.emoji ?? null,
      data.description ?? null,
      data.categoryId ?? null,
      data.mentionRoles ?? null,
      data.staffRoles ?? null,
      data.logChannelId ?? null,
      data.openMessage ?? null,
      data.openEmbedJson ?? null,
      data.nameTemplate ?? null,
      data.buttonStyle ?? null,
    ).lastInsertRowid;
  },

  getTicketOptions(panelId) {
    getDb();
    return _stmts.getTicketOptionsByPanel.all(panelId);
  },

  getTicketOption(optionId) {
    getDb();
    return _stmts.getTicketOptionById.get(optionId);
  },

  deleteTicketOption(optionId) {
    getDb();
    _stmts.deleteTicketOption.run(optionId);
  },

  updateTicketOption(optionId, data = {}) {
    const db = getDb();
    const ALLOWED = new Set([
      'label','emoji','description','categoryId','mentionRoles',
      'staffRoles','logChannelId','openMessage','openEmbedJson','nameTemplate','buttonStyle',
    ]);
    const entries = Object.entries(data).filter(([k, v]) => ALLOWED.has(k) && v !== undefined);
    if (!entries.length) return;
    const sets   = entries.map(([k]) => `${k} = ?`);
    const values = entries.map(([, v]) => v);
    values.push(optionId);
    db.prepare(`UPDATE ticket_options SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },


  getAntiraidConfig(guildId) {
    const database = getDb();
    database.prepare('INSERT OR IGNORE INTO antiraid_config (guildId) VALUES (?)').run(guildId);
    return database.prepare('SELECT * FROM antiraid_config WHERE guildId = ?').get(guildId);
  },

  setAntiraidConfig(guildId, key, value) {
    getDb();
    assertAllowedColumn(ANTIRAID_CONFIG_KEYS, key, 'antiraid_config');
    getDb().prepare(`UPDATE antiraid_config SET ${key} = ?, updatedAt = unixepoch() WHERE guildId = ?`).run(value, guildId);
  },

  getAntiraidWhitelist(guildId) {
    getDb();
    return _stmts.getAntiraidWhitelist.all(guildId);
  },

  addAntiraidWhitelist(guildId, targetId, targetType) {
    getDb();
    _stmts.insertAntiraidWhitelist.run(guildId, targetId, targetType);
  },

  removeAntiraidWhitelist(guildId, targetId) {
    getDb();
    _stmts.deleteAntiraidWhitelist.run(guildId, targetId);
  },


  createGiveaway(guildId, channelId, hostId, prize, winnerCount, endsAt, emoji = '🎉', entryMode = 'button') {
    getDb();
    return _stmts.insertGiveaway.run(guildId, channelId, hostId, prize, winnerCount, endsAt, emoji, entryMode).lastInsertRowid;
  },

  setGiveawayMessageId(id, messageId) {
    getDb();
    _stmts.setGiveawayMsgId.run(messageId, id);
  },

  getGiveaway(messageId) {
    getDb();
    return _stmts.getGiveaway.get(messageId);
  },

  getActiveGiveaways() {
    getDb();
    return _stmts.getActiveGiveaways.all();
  },

  endGiveaway(id, winners) {
    getDb();
    _stmts.endGiveaway.run(JSON.stringify(winners), id);
  },

  addGiveawayEntry(giveawayId, userId) {
    getDb();
    return _stmts.insertEntry.run(giveawayId, userId).changes > 0;
  },

  removeGiveawayEntry(giveawayId, userId) {
    getDb();
    _stmts.deleteEntry.run(giveawayId, userId);
  },

  getGiveawayEntries(giveawayId) {
    getDb();
    return _stmts.getEntries.all(giveawayId).map(r => r.userId);
  },

  hasEnteredGiveaway(giveawayId, userId) {
    getDb();
    return !!_stmts.hasEntry.get(giveawayId, userId);
  },

  getGiveawayById(id) {
    getDb();
    return _stmts.getGiveawayById.get(id) ?? null;
  },


  tryClaimGiveawayEnd(id) {
    getDb();
    return _stmts.tryClaimGiveawayEnd.run(id);
  },


  setGiveawayWinners(id, winnersJson) {
    getDb();
    _stmts.setGiveawayWinners.run(winnersJson, id);
  },

  updateGiveawayConditions(id, conditions = {}) {
    getDb();
    const forced  = Array.isArray(conditions.forcedWinners) && conditions.forcedWinners.length
      ? JSON.stringify(conditions.forcedWinners) : null;
    const guilds  = Array.isArray(conditions.requiredGuildIds) && conditions.requiredGuildIds.length
      ? JSON.stringify(conditions.requiredGuildIds) : null;
    _stmts.updateGiveawayConditions.run(
      conditions.requiredRoleId ?? null,
      conditions.deniedRoleId ?? null,
      conditions.soutienRequired ? 1 : 0,
      conditions.statusRequired ? 1 : 0,
      conditions.tagRequired ? 1 : 0,
      conditions.requireBeforeStart ? 1 : 0,
      conditions.minLevel ?? null,
      conditions.voiceRequired ? 1 : 0,
      conditions.minVoiceSeconds ?? null,
      forced,
      guilds,
      id
    );
  },

  getActiveGiveawayByMessageId(messageId) {
    getDb();
    return _stmts.getActiveGiveawayByMsg.get(messageId) ?? null;
  },

  getActiveGiveawaysByChannelId(channelId) {
    getDb();
    return _stmts.getActiveGiveawaysByChannel.all(channelId);
  },


  getGiveawayConfigPreset(guildId, prizeKey) {
    getDb();
    return _stmts.getGwPreset.get(guildId, prizeKey) ?? null;
  },

  setGiveawayConfigPreset(guildId, prizeKey, prizeLabel, configJson) {
    getDb();
    _stmts.setGwPreset.run(guildId, prizeKey, prizeLabel, configJson);
  },

  deleteGiveawayConfigPreset(guildId, prizeKey) {
    getDb();
    _stmts.deleteGwPreset.run(guildId, prizeKey);
  },


  getRoleReactions(guildId, messageId) {
    getDb();
    return _stmts.getRoleReactions.all(guildId, messageId);
  },

  getAllRoleReactions(guildId) {
    getDb();
    return _stmts.getAllRoleReactions.all(guildId);
  },

  addRoleReaction(guildId, messageId, emoji, roleId) {
    getDb();
    _stmts.insertRoleReaction.run(guildId, messageId, emoji, roleId);
  },

  removeRoleReaction(guildId, messageId, emoji) {
    getDb();
    _stmts.deleteRoleReaction.run(guildId, messageId, emoji);
  },


  saveEmbed(guildId, name, data, createdBy) {
    getDb().prepare('INSERT OR REPLACE INTO saved_embeds (guildId, name, data, createdBy, updatedAt) VALUES (?, ?, ?, ?, unixepoch())').run(guildId, name, JSON.stringify(data), createdBy);
  },

  getEmbed(guildId, name) {
    const row = getDb().prepare('SELECT * FROM saved_embeds WHERE guildId = ? AND name = ?').get(guildId, name);
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  },

  listEmbeds(guildId) {
    return getDb().prepare('SELECT id, name, createdBy, createdAt, data FROM saved_embeds WHERE guildId = ?').all(guildId).map(r => {
      try { r.data = JSON.parse(r.data); } catch { r.data = {}; }
      return r;
    });
  },

  deleteEmbed(guildId, name) {
    getDb().prepare('DELETE FROM saved_embeds WHERE guildId = ? AND name = ?').run(guildId, name);
  },


  getCustomCommand(guildId, name) {
    return getDb().prepare('SELECT * FROM custom_commands WHERE guildId = ? AND name = ?').get(guildId, name);
  },

  getAllCustomCommands(guildId) {
    return getDb().prepare('SELECT * FROM custom_commands WHERE guildId = ?').all(guildId);
  },

  setCustomCommand(guildId, name, response, deleteMsg, deleteDelay, embedData, createdBy) {
    const d = getDb();
    d.prepare(
      'INSERT OR IGNORE INTO custom_commands (guildId, name, response, createdBy, updatedAt) VALUES (?, ?, ?, ?, unixepoch())'
    ).run(guildId, name, response, createdBy);
    d.prepare(
      'UPDATE custom_commands SET response = ?, deleteMsg = ?, deleteDelay = ?, embedData = ?, updatedAt = unixepoch() WHERE guildId = ? AND name = ?'
    ).run(response, deleteMsg ? 1 : 0, deleteDelay ?? null, embedData ? JSON.stringify(embedData) : null, guildId, name);
  },

  deleteCustomCommand(guildId, name) {
    getDb().prepare('DELETE FROM custom_commands WHERE guildId = ? AND name = ?').run(guildId, name);
  },


  renameCustomCommand(guildId, oldName, newName) {
    if (!oldName || !newName) return { ok: false, reason: 'missing' };
    if (oldName === newName) return { ok: false, reason: 'same' };

    const d = getDb();
    const src = d.prepare('SELECT 1 FROM custom_commands WHERE guildId = ? AND name = ?').get(guildId, oldName);
    if (!src) return { ok: false, reason: 'missing' };

    const dup = d.prepare('SELECT 1 FROM custom_commands WHERE guildId = ? AND name = ?').get(guildId, newName);
    if (dup) return { ok: false, reason: 'exists' };

    d.prepare(
      'UPDATE custom_commands SET name = ?, updatedAt = unixepoch() WHERE guildId = ? AND name = ?'
    ).run(newName, guildId, oldName);

    const hasNewCd = d.prepare(
      'SELECT 1 FROM command_cooldowns WHERE guildId = ? AND commandName = ?'
    ).get(guildId, newName);

    if (hasNewCd) {
      d.prepare(
        'DELETE FROM command_cooldowns WHERE guildId = ? AND commandName = ?'
      ).run(guildId, oldName);
    } else {
      d.prepare(
        'UPDATE command_cooldowns SET commandName = ? WHERE guildId = ? AND commandName = ?'
      ).run(newName, guildId, oldName);
    }

    return { ok: true };
  },

  createCustomCommand(guildId, name, createdBy) {
    getDb().prepare(
      'INSERT OR IGNORE INTO custom_commands (guildId, name, response, createdBy, updatedAt) VALUES (?, ?, ?, ?, unixepoch())'
    ).run(guildId, name, '', createdBy);
  },

  updateCustomCommandField(guildId, name, key, value) {
    getDb();
    assertAllowedColumn(CUSTOM_COMMAND_KEYS, key, 'custom_commands');
    getDb().prepare(
      `UPDATE custom_commands SET ${key} = ?, updatedAt = unixepoch() WHERE guildId = ? AND name = ?`
    ).run(value, guildId, name);
  },

  countCustomCommands(guildId) {
    return getDb().prepare('SELECT COUNT(*) as count FROM custom_commands WHERE guildId = ?').get(guildId)?.count ?? 0;
  },

  clearCustomCommands(guildId) {
    getDb().prepare('DELETE FROM custom_commands WHERE guildId = ?').run(guildId);
  },


  getComponentDraft(guildId, ownerId) {
    return getDb().prepare(
      'SELECT * FROM custom_component_drafts WHERE guildId = ? AND ownerId = ?'
    ).get(guildId, ownerId);
  },

  setComponentDraft(guildId, ownerId, json) {
    getDb().prepare(`
      INSERT INTO custom_component_drafts (guildId, ownerId, json, updatedAt)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(guildId, ownerId) DO UPDATE SET
        json      = excluded.json,
        updatedAt = unixepoch()
    `).run(guildId, ownerId, json);
  },

  deleteComponentDraft(guildId, ownerId) {
    getDb().prepare(
      'DELETE FROM custom_component_drafts WHERE guildId = ? AND ownerId = ?'
    ).run(guildId, ownerId);
  },


  addReminder(guildId, userId, channelId, message, remindAt) {
    getDb();
    return _stmts.insertReminder.run(guildId, userId, channelId, message, remindAt).lastInsertRowid;
  },

  getDueReminders() {
    getDb();
    return _stmts.getDueReminders.all(Math.floor(Date.now() / 1000));
  },

  markReminderDone(id) {
    getDb();
    _stmts.markReminderDone.run(id);
  },

  getReminder(id) {
    getDb();
    return _stmts.getReminderById.get(id) ?? null;
  },

  getRemindersByGuild(guildId) {
    getDb();
    return _stmts.getRemindersByGuild.all(guildId);
  },

  getRemindersByChannelId(guildId, channelId) {
    getDb();
    return _stmts.getRemindersByChannel.all(guildId, channelId);
  },

  deleteReminder(id) {
    getDb();
    _stmts.deleteReminder.run(id);
  },

  updateReminder(id, data = {}) {
    getDb();
    const current = _stmts.getReminderById.get(id);
    if (!current) return false;

    const final = {
      channelId         : data.channelId !== undefined         ? data.channelId         : current.channelId,
      message           : data.message !== undefined           ? data.message           : current.message,
      remindAt          : data.remindAt !== undefined          ? data.remindAt          : current.remindAt,
      customCommandName : data.customCommandName !== undefined ? data.customCommandName : (current.customCommandName ?? null),
      repeatEvery       : data.repeatEvery !== undefined       ? data.repeatEvery       : (current.repeatEvery ?? null),
    };

    _stmts.updateReminderCore.run(
      final.channelId,
      final.message,
      final.remindAt,
      final.customCommandName,
      final.repeatEvery,
      id
    );
    return true;
  },

  rescheduleReminder(id, nextRemindAt) {
    getDb();
    _stmts.rescheduleReminder.run(nextRemindAt, id);
  },

  getReminderById(id) {
    getDb();
    return _stmts.getReminderById.get(id) ?? null;
  },

  getRemindersByGuildRaw(guildId) {
    getDb();
    return getDb().prepare('SELECT * FROM reminders WHERE guildId = ?').all(guildId);
  },

  countReminders() {
    getDb();
    return Number(getDb().prepare('SELECT COUNT(*) AS count FROM reminders').get()?.count ?? 0);
  },

  resetReminderSequence() {
    getDb();
    getDb().prepare("DELETE FROM sqlite_sequence WHERE name = 'reminders'").run();
  },


  getBlacklist() {
    return getDb().prepare('SELECT * FROM blacklist WHERE deletedAt IS NULL ORDER BY addedAt DESC').all();
  },

  getBlacklistEntry(userId) {
    return getDb().prepare('SELECT * FROM blacklist WHERE userId = ? AND deletedAt IS NULL').get(userId);
  },

  addBlacklist(userId, reason, addedBy) {
    getDb().prepare('INSERT OR REPLACE INTO blacklist (userId, reason, addedBy, addedAt, deletedAt) VALUES (?, ?, ?, unixepoch(), NULL)').run(userId, reason, addedBy);
  },

  removeBlacklist(userId) {
    getDb().prepare('UPDATE blacklist SET deletedAt = unixepoch() WHERE userId = ?').run(userId);
  },

  clearBlacklist() {
    getDb().prepare('UPDATE blacklist SET deletedAt = unixepoch() WHERE deletedAt IS NULL').run();
  },

  isBlacklisted(userId) {
    return !!getDb().prepare('SELECT 1 FROM blacklist WHERE userId = ? AND deletedAt IS NULL').get(userId);
  },


  createSuggestion(guildId, userId, channelId, content) {
    getDb();
    return _stmts.insertSuggestion.run(guildId, userId, channelId, content).lastInsertRowid;
  },

  setSuggestionMessageId(id, messageId) {
    getDb();
    _stmts.setSuggestionMsgId.run(messageId, id);
  },

  setSuggestionThread(id, threadId) {
    getDb();
    _stmts.setSuggestionThread.run(threadId, id);
  },

  getSuggestion(id) {
    getDb();
    return _stmts.getSuggestion.get(id);
  },

  getSuggestionByMessageId(messageId) {
    getDb();
    return _stmts.getSuggestionByMsg.get(messageId, messageId);
  },

  setSuggestionValidatedMessageId(id, validatedMessageId) {
    getDb();
    _stmts.setSuggestionValidatedMsgId.run(validatedMessageId, id);
  },

  updateSuggestionStatus(id, status, response, respondedBy) {
    getDb();
    _stmts.updateSuggestionStatus.run(status, response ?? null, respondedBy ?? null, id);
  },

  voteSuggestion(suggestionId, userId, vote) {

    getDb();
    if (vote === 0) {
      _stmts.deleteSuggestionVote.run(suggestionId, userId);
    } else {
      _stmts.upsertSuggestionVote.run(suggestionId, userId, vote);
    }
    const totals = _stmts.getSuggestionVotes.get(suggestionId);
    _stmts.updateSuggestionVotes.run(totals.up ?? 0, totals.down ?? 0, suggestionId);
    return totals;
  },

  getUserSuggestionVote(suggestionId, userId) {
    getDb();
    return _stmts.getSuggestionVote.get(suggestionId, userId)?.vote ?? 0;
  },

  getTopSuggestions(guildId, limit = 10, status = 'pending') {
    getDb();
    return _stmts.getTopSuggestions.all(guildId, status, limit);
  },

  getAllSuggestions(guildId) {
    getDb();
    return _stmts.getAllSuggestions.all(guildId);
  },


  addTempRole(guildId, userId, roleId, durationSecs) {
    getDb();
    const expiresAt = Math.floor(Date.now() / 1000) + durationSecs;
    _stmts.insertTempRole.run(guildId, userId, roleId, expiresAt);
    return expiresAt;
  },

  removeTempRole(guildId, userId, roleId) {
    getDb();
    _stmts.deleteTempRole.run(guildId, userId, roleId);
  },

  getTempRoles(guildId, userId) {
    getDb();
    return _stmts.getTempRoles.all(guildId, userId);
  },

  getAllTempRoles(guildId) {
    getDb();
    return _stmts.getAllTempRoles.all(guildId);
  },

  getTempRolesByGuild(guildId) {
    getDb();
    return _stmts.getAllTempRoles.all(guildId);
  },

  deleteTempRole(guildId, userId, roleId) {
    getDb();
    _stmts.deleteTempRole.run(guildId, userId, roleId);
  },

  getExpiredTempRoles() {
    getDb();
    return _stmts.getExpiredTempRoles.all(Math.floor(Date.now() / 1000));
  },

  removeTempRolesByRoleId(guildId, roleId) {
    getDb().prepare('DELETE FROM temp_roles WHERE guildId = ? AND roleId = ?').run(guildId, roleId);
  },


  addPiconlyChannel(guildId, channelId) {
    getDb();
    _stmts.insertPiconlyChannel.run(guildId, channelId);
  },

  removePiconlyChannel(guildId, channelId) {
    getDb();
    _stmts.deletePiconlyChannel.run(guildId, channelId);
  },

  getPiconlyChannels(guildId) {
    getDb();
    return _stmts.getPiconlyChannels.all(guildId).map(r => r.channelId);
  },

  isPiconlyChannel(guildId, channelId) {
    getDb();
    return !!_stmts.isPiconlyChannel.get(guildId, channelId);
  },

  addPiconlyExemptRole(guildId, channelId, roleId) {
    getDb();
    _stmts.insertPiconlyExemptRole.run(guildId, channelId, roleId);
  },

  removePiconlyExemptRole(guildId, channelId, roleId) {
    getDb();
    _stmts.deletePiconlyExemptRole.run(guildId, channelId, roleId);
  },

  getPiconlyExemptRoles(guildId, channelId) {
    getDb();
    return _stmts.getPiconlyExemptRoles.all(guildId, channelId);
  },

  clearPiconlyExemptRoles(guildId, channelId) {
    getDb();
    _stmts.deleteAllPiconlyExemptRoles.run(guildId, channelId);
  },


  createReport(guildId, reporterId, targetId, targetMessageId, targetChannelId, reason) {
    getDb();
    const info = _stmts.insertReport.run(
      guildId,
      reporterId,
      targetId,
      targetMessageId ?? null,
      targetChannelId ?? null,
      reason
    );
    return Number(info.lastInsertRowid);
  },

  getReport(id) {
    getDb();
    return _stmts.getReportById.get(id) ?? null;
  },

  getReports(guildId, options = {}) {
    const database = getDb();
    const conditions = ['guildId = ?'];
    const params     = [guildId];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.targetId) {
      conditions.push('targetId = ?');
      params.push(options.targetId);
    }
    if (options.reporterId) {
      conditions.push('reporterId = ?');
      params.push(options.reporterId);
    }

    const limit  = Math.max(1, Math.min(Number(options.limit)  || 100, 1000));
    const offset = Math.max(0, Number(options.offset) || 0);

    const sql =
      `SELECT * FROM reports WHERE ${conditions.join(' AND ')} ` +
      `ORDER BY createdAt DESC LIMIT ? OFFSET ?`;

    return database.prepare(sql).all(...params, limit, offset);
  },

  setReportStatus(id, status, handledBy) {
    getDb();
    _stmts.updateReportStatus.run(status, handledBy ?? null, id);
  },

  countReportsAgainst(guildId, targetId) {
    getDb();
    const row = _stmts.countReportsAgainst.get(guildId, targetId);
    return Number(row?.n ?? 0);
  },


  addNoderankRole(guildId, roleId) {
    getDb();
    _stmts.insertNoderankRole.run(guildId, roleId);
  },

  removeNoderankRole(guildId, roleId) {
    getDb();
    _stmts.deleteNoderankRole.run(guildId, roleId);
  },

  getNoderankRoles(guildId) {
    getDb();
    return _stmts.getNoderankRoles.all(guildId).map(r => r.roleId);
  },


  addAutoreact(guildId, channelId, emoji) {
    getDb();
    _stmts.insertAutoreact.run(guildId, channelId, emoji);
  },

  removeAutoreact(guildId, channelId, emoji) {
    getDb();
    return _stmts.deleteAutoreact.run(guildId, channelId, emoji).changes;
  },

  getAutoreacts(guildId) {
    getDb();
    return _stmts.getAutoreacts.all(guildId);
  },

  getChannelAutoreacts(guildId, channelId) {
    getDb();
    return _stmts.getChannelAutoreacts.all(guildId, channelId).map(r => r.emoji);
  },

  listAutoreactsByGuild(guildId) {
    getDb();
    return getDb().prepare('SELECT * FROM autoreact WHERE guildId = ? ORDER BY channelId ASC, createdAt ASC').all(guildId);
  },


  setPublicOverride(guildId, channelId, state) {
    getDb();
    if (state === 'reset') {
      _stmts.deletePublicOverride.run(guildId, channelId);
    } else {
      _stmts.setPublicOverride.run(guildId, channelId, state);
    }
  },

  getPublicOverride(guildId, channelId) {
    getDb();
    return _stmts.getPublicOverride.get(guildId, channelId)?.state ?? null;
  },

  setAntispamOverride(guildId, channelId, state) {
    getDb();
    if (state === 'reset') {
      _stmts.deleteAntispamOverride.run(guildId, channelId);
    } else {
      _stmts.setAntispamOverride.run(guildId, channelId, state);
    }
  },

  getAntispamOverride(guildId, channelId) {
    getDb();
    return _stmts.getAntispamOverride.get(guildId, channelId)?.state ?? null;
  },

  setAntilinkOverride(guildId, channelId, state) {
    getDb();
    if (state === 'reset') {
      _stmts.deleteAntilinkOverride.run(guildId, channelId);
    } else {
      _stmts.setAntilinkOverride.run(guildId, channelId, state);
    }
  },

  getAntilinkOverride(guildId, channelId) {
    getDb();
    return _stmts.getAntilinkOverride.get(guildId, channelId)?.state ?? null;
  },

  deletePublicOverride(guildId, channelId) {
    getDb();
    _stmts.deletePublicOverride.run(guildId, channelId);
  },

  deleteAntispamOverride(guildId, channelId) {
    getDb();
    _stmts.deleteAntispamOverride.run(guildId, channelId);
  },

  deleteAntilinkOverride(guildId, channelId) {
    getDb();
    _stmts.deleteAntilinkOverride.run(guildId, channelId);
  },

  listAntilinkOverrides(guildId) {
    getDb();
    return _stmts.listAntilinkOverrides.all(guildId);
  },

  listAntispamOverrides(guildId) {
    getDb();
    return _stmts.listAntispamOverrides.all(guildId);
  },


  addWarnThreshold(guildId, threshold, sanction, duration = null) {
    getDb();
    _stmts.insertWarnThreshold.run(guildId, threshold, sanction, duration);
  },

  removeWarnThreshold(guildId, threshold) {
    getDb();
    _stmts.deleteWarnThreshold.run(guildId, threshold);
  },

  getWarnThresholds(guildId) {
    getDb();
    return _stmts.getWarnThresholds.all(guildId);
  },

  clearWarnThresholds(guildId) {
    getDb();
    _stmts.clearWarnThresholds.run(guildId);
  },

  setupDefaultWarnThresholds(guildId) {
    getDb();
    this.clearWarnThresholds(guildId);
    const defaults = [
      { threshold: 3,  sanction: 'mute',    duration: 600  },
      { threshold: 5,  sanction: 'kick',    duration: null },
      { threshold: 7,  sanction: 'tempban', duration: 86400 },
      { threshold: 10, sanction: 'ban',     duration: null },
    ];
    for (const d of defaults) {
      _stmts.insertWarnThreshold.run(guildId, d.threshold, d.sanction, d.duration);
    }
  },


  addPunishStep(guildId, strikes, window, sanction, duration = null) {
    getDb();
    _stmts.insertPunishStep.run(guildId, strikes, window, sanction, duration);
  },

  removePunishStep(guildId, strikes) {
    getDb();
    _stmts.deletePunishStep.run(guildId, strikes);
  },

  getPunishSteps(guildId) {
    getDb();
    return _stmts.getPunishSteps.all(guildId);
  },

  clearPunishSteps(guildId) {
    getDb();
    _stmts.clearPunishSteps.run(guildId);
  },

  setupDefaultPunishSteps(guildId) {
    getDb();
    this.clearPunishSteps(guildId);
    const defaults = [
      { strikes: 3, window: 3600,  sanction: 'warn' },
      { strikes: 5, window: 3600,  sanction: 'mute' },
      { strikes: 7, window: 86400, sanction: 'kick' },
      { strikes: 10,window: 86400, sanction: 'ban'  },
    ];
    for (const d of defaults) {
      _stmts.insertPunishStep.run(guildId, d.strikes, d.window, d.sanction, null);
    }
  },


  setStrikeTrigger(guildId, trigger, strikes, ancienStr = 1) {
    getDb();
    _stmts.setStrikeTrigger.run(guildId, trigger, strikes, ancienStr);
  },

  getStrikeTriggers(guildId) {
    getDb();
    return _stmts.getStrikeTriggers.all(guildId);
  },

  getStrikeTrigger(guildId, trigger) {
    getDb();
    return _stmts.getStrikeTrigger.get(guildId, trigger);
  },


  setSnipe(channelId, guildId, content, authorId, authorTag, attachments = null) {
    getDb();
    _stmts.setSnipe.run(channelId, guildId, content, authorId, authorTag, attachments ? JSON.stringify(attachments) : null);
  },

  getSnipe(channelId) {
    getDb();
    const row = _stmts.getSnipe.get(channelId);
    if (!row) return null;
    return {
      ...row,
      attachments: row.attachments ? JSON.parse(row.attachments) : [],
    };
  },

  clearSnipe(channelId) {
    getDb();
    _stmts.deleteSnipe.run(channelId);
  },


  addBlacklistRank(guildId, roleId) {
    getDb();
    _stmts.insertBlacklistRank.run(guildId, roleId);
  },

  removeBlacklistRank(guildId, roleId) {
    getDb();
    _stmts.deleteBlacklistRank.run(guildId, roleId);
  },

  clearBlacklistRank(guildId) {
    getDb();
    _stmts.clearBlacklistRank.run(guildId);
  },


  createModmail(guildId, userId, channelId) {
    getDb();
    return _stmts.insertModmail.run(guildId, userId, channelId).lastInsertRowid;
  },

  getModmail(channelId) {
    getDb();
    return _stmts.getModmail.get(channelId);
  },

  getOpenModmailByUser(guildId, userId) {
    getDb();
    return _stmts.getModmailByUser.get(guildId, userId);
  },

  closeModmail(channelId) {
    getDb();
    _stmts.closeModmail.run(channelId);
  },

  claimModmail(channelId, claimedBy) {
    getDb();
    _stmts.claimModmail.run(claimedBy, channelId);
  },

  getOpenModmails(guildId) {
    getDb();
    return _stmts.getAllOpenModmails.all(guildId);
  },


  addTwitchAlert(guildId, twitchLogin, channelId, roleId = null, message = null) {
    getDb();
    _stmts.insertTwitchAlert.run(guildId, twitchLogin.toLowerCase(), channelId, roleId, message);
  },

  removeTwitchAlert(guildId, twitchLogin) {
    getDb();
    _stmts.deleteTwitchAlert.run(guildId, twitchLogin.toLowerCase());
  },

  getTwitchAlerts(guildId) {
    getDb();
    return _stmts.getTwitchAlerts.all(guildId);
  },

  getAllTwitchAlerts() {
    getDb();
    return _stmts.getAllTwitchAlerts.all();
  },

  updateTwitchLastLiveId(guildId, twitchLogin, liveId) {
    getDb();
    _stmts.updateTwitchLastId.run(liveId, guildId, twitchLogin.toLowerCase());
  },


  setFormulaire(guildId, name, { buttonLabel = 'Répondre', buttonEmoji = null, logChannel = null, questions = [] }, createdBy) {
    getDb();
    _stmts.insertFormulaire.run(guildId, name, buttonLabel, buttonEmoji, logChannel, JSON.stringify(questions), createdBy);
  },

  getFormulaire(guildId, name) {
    getDb();
    const row = _stmts.getFormulaire.get(guildId, name);
    if (!row) return null;
    return { ...row, questions: JSON.parse(row.questions) };
  },

  getFormulaireById(id) {
    getDb();
    const row = _stmts.getFormulaireById.get(id);
    if (!row) return null;
    return { ...row, questions: JSON.parse(row.questions) };
  },

  getFormulaires(guildId) {
    getDb();
    return _stmts.getFormulaires.all(guildId).map(r => ({ ...r, questions: JSON.parse(r.questions) }));
  },

  deleteFormulaire(guildId, name) {
    getDb();
    _stmts.deleteFormulaire.run(guildId, name);
  },

  setFormulaireMessage(id, channelId, messageId) {
    getDb();
    _stmts.setFormulaireMsg.run(messageId, channelId, id);
  },

  addFormulaireResponse(formulaireId, userId, answers) {
    getDb();
    _stmts.insertFormulaireResponse.run(formulaireId, userId, JSON.stringify(answers));
  },


  getTempvocConfig(guildId) {
    getDb();
    _stmts.insertTempvocConfig.run(guildId);
    return _stmts.getTempvocConfig.get(guildId);
  },

  setTempvocConfig(guildId, key, value) {
    getDb();
    assertAllowedColumn(TEMPVOC_CONFIG_KEYS, key, 'tempvoc_config');
    _stmts.insertTempvocConfig.run(guildId);
    getDb()
      .prepare(`UPDATE tempvoc_config SET ${key} = ?, updatedAt = unixepoch() WHERE guildId = ?`)
      .run(value, guildId);
  },

  addTempvocChannel(guildId, channelId, ownerId) {
    getDb();
    _stmts.insertTempvocChannel.run(guildId, channelId, ownerId);
  },

  getTempvocChannel(channelId) {
    getDb();
    return _stmts.getTempvocChannel.get(channelId) ?? null;
  },

  getTempvocChannels(guildId) {
    getDb();
    return _stmts.getTempvocChannels.all(guildId);
  },

  removeTempvocChannel(channelId) {
    getDb();
    _stmts.deleteTempvocChannel.run(channelId);
  },

  setTempvocOwner(channelId, ownerId) {
    getDb();
    _stmts.updateTempvocOwner.run(ownerId, channelId);
  },

  addTempvocBan(guildId, channelId, userId) {
    getDb();
    _stmts.insertTempvocBan.run(guildId, channelId, userId);
  },

  removeTempvocBan(channelId, userId) {
    getDb();
    _stmts.deleteTempvocBan.run(channelId, userId);
  },

  getTempvocBans(channelId) {
    getDb();
    return _stmts.getTempvocBans.all(channelId);
  },

  isTempvocBanned(channelId, userId) {
    getDb();
    return !!_stmts.isTempvocBanned.get(channelId, userId);
  },

  clearTempvocBans(channelId) {
    getDb();
    _stmts.deleteTempvocBansByChannel.run(channelId);
  },


  createRoleMenu(guildId, channelId, createdBy, data = {}) {
    getDb();
    return _stmts.insertRoleMenu.run(
      guildId,
      channelId ?? null,
      data.title ?? 'Menu de rôles',
      data.description ?? 'Sélectionnez les rôles que vous souhaitez obtenir.',
      data.placeholder ?? 'Choisir un rôle',
      data.mode ?? 'toggle',
      data.minValues ?? 0,
      data.maxValues ?? 1,
      createdBy
    ).lastInsertRowid;
  },

  getRoleMenu(menuId) {
    getDb();
    return _stmts.getRoleMenu.get(menuId) ?? null;
  },

  getRoleMenuByMessageId(messageId) {
    getDb();
    return _stmts.getRoleMenuByMessageId.get(messageId) ?? null;
  },

  getRoleMenus(guildId) {
    getDb();
    return _stmts.getRoleMenus.all(guildId);
  },

  updateRoleMenu(menuId, data = {}) {
    getDb();

    _stmts.updateRoleMenuCore.run(
      data.channelId     ?? null,
      data.messageId     ?? null,
      data.title         ?? null,
      data.description   ?? null,
      data.placeholder   ?? null,
      data.mode          ?? null,
      data.minValues     ?? null,
      data.maxValues     ?? null,
      data.componentType ?? null,
      data.buttonStyle   ?? null,
      data.roleSpacing   ?? null,
      data.roleSeparator ?? null,
      data.roleFormat    ?? null,
      data.feedbackMode  ?? null,
      menuId
    );
  },

  deleteRoleMenu(menuId) {
    getDb();
    _stmts.deleteRoleMenu.run(menuId);
  },

  addRoleMenuOption(menuId, roleId, data = {}) {
    getDb();
    _stmts.insertRoleMenuOption.run(
      menuId,
      roleId,
      data.label ?? 'Rôle',
      data.description ?? null,
      data.emoji ?? null
    );
  },

  getRoleMenuOptions(menuId) {
    getDb();
    return _stmts.getRoleMenuOptions.all(menuId);
  },

  getRoleMenuOption(menuId, roleId) {
    getDb();
    return _stmts.getRoleMenuOptionByRole.get(menuId, roleId) ?? null;
  },

  removeRoleMenuOption(menuId, roleId) {
    getDb();
    _stmts.deleteRoleMenuOption.run(menuId, roleId);
  },

  clearRoleMenuOptions(menuId) {
    getDb();
    _stmts.clearRoleMenuOptions.run(menuId);
  },

  updateRoleMenuRestrictions(menuId, requiredRoleIds, forbiddenRoleIds) {
    getDb();
    _stmts.updateRoleMenuRestrictions.run(
      requiredRoleIds ? JSON.stringify(requiredRoleIds) : null,
      forbiddenRoleIds ? JSON.stringify(forbiddenRoleIds) : null,
      menuId
    );
  },

  clearRoleMenuMessage(menuId) {
    getDb();
    _stmts.clearRoleMenuMessage.run(menuId);
  },

  getRoleMenusByChannel(guildId, channelId) {
    getDb();
    return _stmts.getRoleMenusByChannel.all(guildId, channelId);
  },


  addAutorole(guildId, roleId) {
    getDb();
    _stmts.insertAutorole.run(guildId, roleId);
  },

  removeAutorole(guildId, roleId) {
    getDb();
    _stmts.deleteAutorole.run(guildId, roleId);
  },

  getAutoroles(guildId) {
    getDb();
    return _stmts.getAutoroles.all(guildId).map(r => r.roleId);
  },

  clearAutoroles(guildId) {
    getDb();
    _stmts.clearAutoroles.run(guildId);
  },


  removeLevelRolesByRoleId(guildId, roleId) {
    getDb().prepare(
      'DELETE FROM level_roles WHERE guildId = ? AND roleId = ?'
    ).run(guildId, roleId);
  },

  removeRoleMenuOptionsByRoleId(guildId, roleId) {

    getDb().prepare(
      'DELETE FROM role_menu_options WHERE roleId = ? AND menuId IN (SELECT id FROM role_menus WHERE guildId = ?)'
    ).run(roleId, guildId);
  },

  clearGiveawayRoleConditions(guildId, roleId) {


    const database = getDb();
    database.prepare(
      'UPDATE giveaways SET requiredRoleId = NULL WHERE guildId = ? AND requiredRoleId = ?'
    ).run(guildId, roleId);
    database.prepare(
      'UPDATE giveaways SET deniedRoleId = NULL WHERE guildId = ? AND deniedRoleId = ?'
    ).run(guildId, roleId);
  },

  removeRoleFromTicketArrays(guildId, roleId) {


    const database = getDb();

    const PANEL_FIELDS  = ['requiredRoles', 'blockedRoles', 'bypassRoles'];
    const OPTION_FIELDS = ['staffRoles', 'mentionRoles'];

    const stripRoleFromJsonArray = (raw) => {
      if (!raw) return { changed: false, value: raw };
      let arr;
      try { arr = JSON.parse(raw); } catch { return { changed: false, value: raw }; }
      if (!Array.isArray(arr) || !arr.includes(roleId)) {
        return { changed: false, value: raw };
      }
      const filtered = arr.filter(id => id !== roleId);
      return {
        changed: true,
        value  : filtered.length ? JSON.stringify(filtered) : null,
      };
    };

    const panels = database.prepare(
      `SELECT id, requiredRoles, blockedRoles, bypassRoles
       FROM ticket_panels
       WHERE guildId = ?`
    ).all(guildId);

    for (const panel of panels) {
      for (const field of PANEL_FIELDS) {
        const { changed, value } = stripRoleFromJsonArray(panel[field]);
        if (!changed) continue;
        database.prepare(
          `UPDATE ticket_panels SET ${field} = ? WHERE id = ?`
        ).run(value, panel.id);
      }
    }

    const options = database.prepare(
      `SELECT o.id, o.staffRoles, o.mentionRoles
       FROM ticket_options o
       JOIN ticket_panels p ON p.id = o.panelId
       WHERE p.guildId = ?`
    ).all(guildId);

    for (const option of options) {
      for (const field of OPTION_FIELDS) {
        const { changed, value } = stripRoleFromJsonArray(option[field]);
        if (!changed) continue;
        database.prepare(
          `UPDATE ticket_options SET ${field} = ? WHERE id = ?`
        ).run(value, option.id);
      }
    }
  },

  removeRoleFromReportMentionRoles(guildId, roleId) {


    const database = getDb();
    const row = database.prepare(
      'SELECT reportMentionRoles FROM guild_config WHERE guildId = ?'
    ).get(guildId);

    if (!row?.reportMentionRoles) return;

    let arr;
    try { arr = JSON.parse(row.reportMentionRoles); } catch { return; }
    if (!Array.isArray(arr) || !arr.includes(roleId)) return;

    const filtered = arr.filter(id => id !== roleId);
    const newVal   = filtered.length ? JSON.stringify(filtered) : null;

    this.setGuildConfig(guildId, 'reportMentionRoles', newVal);
  },

  removeRoleFromTempvocConfig(guildId, roleId) {


    const database = getDb();
    const row = database.prepare(
      'SELECT requiredRoles, blockedRoles FROM tempvoc_config WHERE guildId = ?'
    ).get(guildId);

    if (!row) return;

    for (const field of ['requiredRoles', 'blockedRoles']) {
      const raw = row[field];
      if (!raw) continue;

      let arr;
      try { arr = JSON.parse(raw); } catch { continue; }
      if (!Array.isArray(arr) || !arr.includes(roleId)) continue;

      const filtered = arr.filter(id => id !== roleId);
      const newVal   = filtered.length ? JSON.stringify(filtered) : '[]';

      this.setTempvocConfig(guildId, field, newVal);
    }
  },

  removeRoleFromCustomCommandsRoles(guildId, roleId) {


    const database = getDb();

    database.prepare(
      'UPDATE custom_commands SET requiredRoleId = NULL WHERE guildId = ? AND requiredRoleId = ?'
    ).run(guildId, roleId);
    database.prepare(
      'UPDATE custom_commands SET deniedRoleId = NULL WHERE guildId = ? AND deniedRoleId = ?'
    ).run(guildId, roleId);

    const customs = database.prepare(
      'SELECT name, rolesJson FROM custom_commands WHERE guildId = ? AND rolesJson IS NOT NULL'
    ).all(guildId);

    for (const c of customs) {
      let arr;
      try { arr = JSON.parse(c.rolesJson); } catch { continue; }
      if (!Array.isArray(arr)) continue;

      const filtered = arr.filter(e => e?.roleId !== roleId);
      if (filtered.length === arr.length) continue;


      const newVal = filtered.length ? JSON.stringify(filtered) : null;
      database.prepare(
        'UPDATE custom_commands SET rolesJson = ?, updatedAt = unixepoch() WHERE guildId = ? AND name = ?'
      ).run(newVal, guildId, c.name);
    }
  },


  cleanupGuildRoleReferences(guildId, roleId) {
    if (!guildId || !roleId) return;

    try {
      const config = this.getGuildConfig(guildId);

      if (config?.muteRoleId === roleId) {
        this.setGuildConfig(guildId, 'muteRoleId', null);
      }
      if (config?.verifyRoleId === roleId) {
        this.setGuildConfig(guildId, 'verifyRoleId', null);


        this.setGuildConfig(guildId, 'verifyEnabled', 0);
      }
      if (config?.soutienRoleId === roleId) {
        this.setGuildConfig(guildId, 'soutienRoleId', null);
      }
    } catch {}

    try { this.removeTempRolesByRoleId(guildId, roleId); } catch {}
    try { this.removeAutorole(guildId, roleId);          } catch {}
    try { this.removeLevelRolesByRoleId(guildId, roleId);} catch {}
    try { this.removeRoleMenuOptionsByRoleId(guildId, roleId); } catch {}

    try { this.clearGiveawayRoleConditions(guildId, roleId); } catch {}

    try { this.removeRoleFromTicketArrays(guildId, roleId); } catch {}

    try { this.removeRoleFromReportMentionRoles(guildId, roleId); } catch {}

    try { this.removeRoleFromTempvocConfig(guildId, roleId); } catch {}


    try { this.removeRoleFromCustomCommandsRoles(guildId, roleId); } catch {}
  },


  removeChannelFromGuildConfig(guildId, channelId) {


    const config = this.getGuildConfig(guildId);
    if (!config) return;

    const LOG_CHANNEL_KEYS = [
      'modLogChannel', 'joinLogChannel', 'leaveLogChannel',
      'messageLogChannel', 'voiceLogChannel', 'boostLogChannel',
      'roleLogChannel', 'raidLogChannel', 'errorLogChannel',
      'embedLogChannel', 'verifyLogChannel',
    ];

    for (const key of LOG_CHANNEL_KEYS) {
      if (config[key] === channelId) {
        try { this.setGuildConfig(guildId, key, null); } catch {}
      }
    }

    const SIMPLE_CHANNEL_KEYS = [
      'welcomeChannel', 'leaveChannel',
      'levelUpChannel',
      'showPicsChannel',
      'boostEmbedChannelId',
      'suggestionLogChannel',
      'suggestionPendingChannel', 'suggestionValidatedChannel',
      'ticketLogChannel',
      'modmailChannel', 'modmailLogChannel',
      'ticketCategory',
    ];

    for (const key of SIMPLE_CHANNEL_KEYS) {
      if (config[key] === channelId) {
        try { this.setGuildConfig(guildId, key, null); } catch {}
      }
    }


    if (config.verifyChannel === channelId) {


      try { this.setGuildConfig(guildId, 'verifyChannel', null);   } catch {}
      try { this.setGuildConfig(guildId, 'verifyMessageId', null); } catch {}
      try { this.setGuildConfig(guildId, 'verifyEnabled', 0);      } catch {}
    }

    if (config.reportChannel === channelId) {
      try { this.setGuildConfig(guildId, 'reportChannel', null); } catch {}
      try { this.setGuildConfig(guildId, 'reportEnabled', 0);    } catch {}
    }

    if (config.suggestionChannel === channelId) {
      try { this.setGuildConfig(guildId, 'suggestionChannel', null); } catch {}
      try { this.setGuildConfig(guildId, 'suggestionEnabled', 0);    } catch {}
    }

    if (config.modmailCategory === channelId) {


      try { this.setGuildConfig(guildId, 'modmailCategory', null); } catch {}
      try { this.setGuildConfig(guildId, 'modmailEnabled', 0);     } catch {}
    }
  },

  removeChannelFromTempvocConfig(guildId, channelId) {


    const database = getDb();
    const row = database.prepare(
      'SELECT enabled, joinChannelId, categoryId FROM tempvoc_config WHERE guildId = ?'
    ).get(guildId);
    if (!row) return;

    if (row.joinChannelId === channelId) {
      try { this.setTempvocConfig(guildId, 'joinChannelId', null); } catch {}
      try { this.setTempvocConfig(guildId, 'enabled', 0);          } catch {}
    }

    if (row.categoryId === channelId) {
      try { this.setTempvocConfig(guildId, 'categoryId', null); } catch {}
      try { this.setTempvocConfig(guildId, 'enabled', 0);       } catch {}
    }
  },

  removeChannelFromCustomCommands(guildId, channelId) {


    const database = getDb();

    database.prepare(
      'UPDATE custom_commands SET responseChannelId = NULL, updatedAt = unixepoch() WHERE guildId = ? AND responseChannelId = ?'
    ).run(guildId, channelId);
    database.prepare(
      'UPDATE custom_commands SET logChannelId = NULL, updatedAt = unixepoch() WHERE guildId = ? AND logChannelId = ?'
    ).run(guildId, channelId);

    const customs = database.prepare(
      `SELECT name, allowedChannelIds, blockedChannelIds
       FROM custom_commands
       WHERE guildId = ?
         AND (allowedChannelIds IS NOT NULL OR blockedChannelIds IS NOT NULL)`
    ).all(guildId);

    for (const c of customs) {
      for (const field of ['allowedChannelIds', 'blockedChannelIds']) {
        const raw = c[field];
        if (!raw) continue;

        let arr;
        try { arr = JSON.parse(raw); } catch { continue; }
        if (!Array.isArray(arr) || !arr.includes(channelId)) continue;

        const filtered = arr.filter(id => id !== channelId);
        const newVal   = filtered.length ? JSON.stringify(filtered) : null;
        database.prepare(
          `UPDATE custom_commands SET ${field} = ?, updatedAt = unixepoch() WHERE guildId = ? AND name = ?`
        ).run(newVal, guildId, c.name);
      }
    }
  },

  removeChannelFromTicketOptions(guildId, channelId) {


    const database = getDb();
    database.prepare(
      `UPDATE ticket_options SET categoryId = NULL
       WHERE categoryId = ?
         AND panelId IN (SELECT id FROM ticket_panels WHERE guildId = ?)`
    ).run(channelId, guildId);
    database.prepare(
      `UPDATE ticket_options SET logChannelId = NULL
       WHERE logChannelId = ?
         AND panelId IN (SELECT id FROM ticket_panels WHERE guildId = ?)`
    ).run(channelId, guildId);
  },


  cleanupGuildChannelReferences(guildId, channelId) {
    if (!guildId || !channelId) return;

    try { this.removeChannelFromGuildConfig(guildId, channelId);    } catch {}
    try { this.removeChannelFromTempvocConfig(guildId, channelId);  } catch {}
    try { this.removeChannelFromCustomCommands(guildId, channelId); } catch {}
    try { this.removeChannelFromTicketOptions(guildId, channelId);  } catch {}
  },


  resetGuild(guildId) {
    const database = getDb();


    const _del = (table) => {
      try { database.prepare(`DELETE FROM ${table} WHERE guildId = ?`).run(guildId); } catch {}
    };
    const _orphan = (sql) => {
      try { database.prepare(sql).run(); } catch {}
    };

    database.transaction(() => {
      _del('guild_config');
      _del('perm_levels');
      _del('cmd_perms');
      _del('public_channels');
      _del('nolog_channels');
      _del('antiraid_config');
      _del('antiraid_whitelist');
      _del('automod_strikes');
      _del('piconly_channels');
      _del('piconly_exempt_roles');
      _del('reports');
      _del('noderank_roles');
      _del('public_channel_overrides');
      _del('antispam_channel_overrides');
      _del('antilink_channel_overrides');
      _del('punish_steps');
      _del('strike_triggers');
      _del('warn_thresholds');
      _del('blacklist_rank');
      _del('autoreact');
      _del('twitch_alerts');
      _del('formulaires');
      _orphan('DELETE FROM formulaire_responses WHERE formulaireId NOT IN (SELECT id FROM formulaires)');
      _del('saved_embeds');
      _del('custom_commands');
      _del('role_reactions');
      _del('reminders');
      _del('role_menus');
      _orphan('DELETE FROM role_menu_options WHERE menuId NOT IN (SELECT id FROM role_menus)');
      _del('autoroles');
      _del('sanctions');
      _del('levels');
      _del('level_roles');
      _del('tickets');
      _del('ticket_panels');
      _orphan('DELETE FROM ticket_options WHERE panelId NOT IN (SELECT id FROM ticket_panels)');
      _del('giveaways');
      _orphan('DELETE FROM giveaway_entries WHERE giveawayId NOT IN (SELECT id FROM giveaways)');
      _del('suggestions');
      _orphan('DELETE FROM suggestion_votes WHERE suggestionId NOT IN (SELECT id FROM suggestions)');
      _del('modmails');
      _del('temp_roles');
      _del('snipe_cache');
      _del('command_cooldowns');
      _del('soutien_tracking');
      _del('soutien_manual_ignored');
      _del('voice_stats');
      _del('level_channel_rates');
      _del('giveaway_config_presets');
      _del('mute_role_backup');
      _del('tempvoc_config');
      _del('tempvoc_channels');
      _del('pending_verifications');
      _del('custom_component_drafts');
    })();
  },


  markGuildPendingPurge(guildId, reason = null) {
    if (!guildId) return;
    getDb();
    _stmts.markGuildPendingPurge.run(guildId, reason);
  },

  unmarkGuildPendingPurge(guildId) {
    if (!guildId) return;
    getDb();
    _stmts.unmarkGuildPendingPurge.run(guildId);
  },

  getGuildPendingPurge(guildId) {
    if (!guildId) return null;
    getDb();
    return _stmts.getGuildPendingPurge.get(guildId) ?? null;
  },


  getDuePendingPurges(cutoffTs) {
    getDb();
    return _stmts.getDuePendingPurges.all(cutoffTs);
  },


  purgeGuildData(guildId) {
    if (!guildId) return;
    const database = getDb();
    database.transaction(() => {

      this.resetGuild(guildId);


      const tables = [
        'tempvoc_config',
        'tempvoc_channels',
        'mute_role_backup',
        'pending_verifications',
        'custom_component_drafts',
        'formulaires',
        'autoreact',
        'twitch_alerts',
        'reports',
        'reminders',
      ];
      for (const table of tables) {
        try {
          database.prepare(`DELETE FROM ${table} WHERE guildId = ?`).run(guildId);
        } catch {

        }
      }


      try { database.prepare('DELETE FROM formulaire_responses WHERE formulaireId NOT IN (SELECT id FROM formulaires)').run(); } catch {}
      try { database.prepare('DELETE FROM role_menu_options WHERE menuId NOT IN (SELECT id FROM role_menus)').run(); } catch {}
      try { database.prepare('DELETE FROM ticket_options WHERE panelId NOT IN (SELECT id FROM ticket_panels)').run(); } catch {}

      _stmts.unmarkGuildPendingPurge.run(guildId);
    })();
  },


  saveMuteRoles(guildId, userId, roleIds, restoreAt, source = 'automod') {
    getDb();

    _stmts.clearMuteRoleBackup.run(guildId, userId);
    _stmts.insertMuteRoleBackup.run(guildId, userId, JSON.stringify(roleIds), restoreAt, source);
  },

  getMuteRoles(guildId, userId) {
    getDb();
    const row = _stmts.getMuteRoleBackup.get(guildId, userId);
    if (!row) return null;
    return { ...row, roleIds: JSON.parse(row.roleIds) };
  },

  clearMuteRoles(guildId, userId) {
    getDb();
    _stmts.clearMuteRoleBackup.run(guildId, userId);
  },

  getExpiredMuteRoles(nowTs) {
    getDb();
    return _stmts.getExpiredMuteBackups.all(nowTs).map(row => ({
      ...row,
      roleIds: JSON.parse(row.roleIds),
    }));
  },


  getCommandCooldown,
  setCommandCooldown,
  deleteCommandCooldown,
  getCommandCooldowns,
  clearCommandCooldowns,


  getBotSetting(key) {
    getDb();
    return _stmts.getBotSetting.get(key)?.value ?? null;
  },

  setBotSetting(key, value) {
    getDb();
    _stmts.setBotSetting.run(key, String(value));
  },


  getSoutienTracking(guildId, userId) {
    getDb();
    return _stmts.getSoutienTracking.get(guildId, userId) ?? null;
  },

  grantSoutienTracking(guildId, userId) {
    getDb();
    _stmts.upsertSoutienTracking.run(guildId, userId);
  },

  revokeSoutienTracking(guildId, userId) {
    getDb();
    _stmts.deleteSoutienTracking.run(guildId, userId);
  },

  grantSoutienRoleTracking(guildId, userId, lazy = false) {
    getDb();
    if (lazy) _stmts.grantSoutienRoleLazy.run(guildId, userId);
    else      _stmts.grantSoutienRoleReal.run(guildId, userId);
  },

  revokeSoutienRoleTracking(guildId, userId) {
    getDb();
    _stmts.revokeSoutienRole.run(guildId, userId);
  },

  markSoutienStatusValid(guildId, userId, lazy = false) {
    getDb();
    if (lazy) _stmts.markSoutienStatusValidLazy.run(guildId, userId);
    else      _stmts.markSoutienStatusValidReal.run(guildId, userId);
  },

  clearSoutienStatusValid(guildId, userId) {
    getDb();
    _stmts.clearSoutienStatusValid.run(guildId, userId);
  },

  markSoutienTagValid(guildId, userId, lazy = false) {
    getDb();
    if (lazy) _stmts.markSoutienTagValidLazy.run(guildId, userId);
    else      _stmts.markSoutienTagValidReal.run(guildId, userId);
  },

  clearSoutienTagValid(guildId, userId) {
    getDb();
    _stmts.clearSoutienTagValid.run(guildId, userId);
  },

  getSoutienLeaderboard(guildId, limit = 10, offset = 0) {
    getDb();
    const safeLimit  = Math.max(1, Math.min(100, Number(limit)  || 10));
    const safeOffset = Math.max(0, Number(offset) || 0);
    return _stmts.getSoutienLeaderboard.all(guildId, safeLimit, safeOffset);
  },

  countSoutienLeaderboard(guildId) {
    getDb();
    return _stmts.countSoutienLeaderboard.get(guildId)?.total ?? 0;
  },


  listSoutienTagOnly(guildId) {
    getDb();
    return _stmts.listSoutienTagOnly.all(guildId);
  },


  addSoutienManualIgnore(guildId, userId, roleId, ignoredBy = null) {
    getDb();
    _stmts.addSoutienManualIgnore.run(guildId, userId, roleId, ignoredBy);
  },

  removeSoutienManualIgnore(guildId, userId, roleId) {
    getDb();
    _stmts.removeSoutienManualIgnore.run(guildId, userId, roleId);
  },

  isSoutienManualIgnored(guildId, userId, roleId) {
    getDb();
    return !!_stmts.getSoutienManualIgnore.get(guildId, userId, roleId);
  },


  getVoiceStats(guildId, userId) {
    getDb();
    return _stmts.getVoiceStats.get(guildId, userId) ?? null;
  },

  voiceJoin(guildId, userId, channelId) {
    getDb();
    _stmts.upsertVoiceJoin.run(guildId, userId, channelId);
  },

  voiceLeave(guildId, userId) {
    getDb();
    _stmts.voiceLeave.run(guildId, userId);
  },

  voiceMove(guildId, userId, channelId) {
    getDb();
    _stmts.voiceMove.run(channelId, guildId, userId);
  },

  getActiveVoiceSessions(guildId) {
    getDb();
    return _stmts.getActiveVoiceSessions.all(guildId);
  },

  clearVoiceSession(guildId, userId, { stale = false } = {}) {
    getDb();
    if (stale) {
      _stmts.clearVoiceSessionStale.run(guildId, userId);
    } else {
      _stmts.clearVoiceSession.run(guildId, userId);
    }
  },


  setPendingVerification(guildId, userId, expiresAt) {
    getDb();
    if (!guildId || !userId) return false;
    const exp = Math.floor(Number(expiresAt));
    if (!Number.isFinite(exp) || exp <= 0) return false;
    _stmts.setPendingVerification.run(String(guildId), String(userId), exp);
    return true;
  },

  deletePendingVerification(guildId, userId) {
    getDb();
    if (!guildId || !userId) return false;
    const info = _stmts.deletePendingVerification.run(String(guildId), String(userId));
    return info.changes > 0;
  },

  getPendingVerification(guildId, userId) {
    getDb();
    if (!guildId || !userId) return null;
    return _stmts.getPendingVerification.get(String(guildId), String(userId)) || null;
  },

  getPendingVerifications() {
    getDb();
    return _stmts.getPendingVerifications.all();
  },

  clearGuildPendingVerifications(guildId) {
    getDb();
    if (!guildId) return 0;
    const info = _stmts.clearGuildPendingVerifications.run(String(guildId));
    return info.changes || 0;
  },


  /**
   * @param {string} userId
   * @param {string|null} guildId  
   * @param {'username'|'globalname'|'nickname'} type
   * @param {string} name         
   */
  addPrevName(userId, guildId, type, name) {
    if (!userId || !type || !name) return;
    getDb();

    const last = type === 'nickname'
      ? _stmts.getLastPrevNameNick.get(userId, guildId)
      : _stmts.getLastPrevName.get(userId, type);

    if (last?.name === name) return; 

    _stmts.insertPrevName.run(userId, guildId ?? null, type, name);

    if (type === 'nickname') {
      _stmts.prunePrevNamesNick.run(userId, guildId, userId, guildId);
    } else {
      _stmts.prunePrevNames.run(userId, type, userId, type);
    }
  },

  /**
   * @param {string} userId
   * @param {string|null} guildId 
   * @param {number} limit
   * @returns {Array}
   */
  getPrevNames(userId, guildId = null, limit = 0) {
    if (!userId) return [];
    getDb();
    const cap = limit > 0 ? Math.min(limit, 10000) : 10000;
    if (guildId) {
      return _stmts.getPrevNamesAll.all(userId, guildId, cap);
    }
    return _stmts.getPrevNamesGlobal.all(userId, cap);
  },

  getPrevNicknames(userId, guildId, limit = 30) {
    if (!userId || !guildId) return [];
    getDb();
    return _stmts.getPrevNamesNick.all(userId, guildId, Math.min(limit, 100));
  },

  clearPrevNames(userId, guildId = null) {
    if (!userId) return;
    getDb();
    if (guildId) {
      _stmts.clearPrevNamesGuild.run(userId, guildId);
    } else {
      _stmts.clearPrevNamesAll.run(userId);
    }
  },

  updateSeen(userId, guildId, channelId, lastMessage) {
    if (!userId || !guildId) return;
    getDb();
    _stmts.upsertSeen.run(userId, guildId, channelId ?? null, lastMessage ?? null);
  },

  getSeen(userId, guildId) {
    if (!userId || !guildId) return null;
    getDb();
    return _stmts.getSeen.get(userId, guildId) || null;
  },

  addRolelog(userId, guildId, roleId, action) {
    if (!userId || !guildId || !roleId || !action) return;
    getDb();
    _stmts.insertRolelog.run(userId, guildId, roleId, action);
    _stmts.pruneRolelog.run(userId, guildId, userId, guildId);
  },

  getRolelog(userId, guildId, limit = 0) {
    if (!userId || !guildId) return [];
    getDb();
    const cap = limit > 0 ? Math.min(limit, 500) : 500;
    return _stmts.getRolelog.all(userId, guildId, cap);
  },

  addKeyword(ownerId, guildId, keyword, targetUserId = null) {
    if (!ownerId || !guildId || !keyword) return false;
    getDb();
    const target = targetUserId ?? ownerId;
    const kw = keyword.toLowerCase().trim();
    const info = _stmts.insertKeyword.run(ownerId, guildId, kw, target);
    return info.changes > 0;
  },

  removeKeyword(ownerId, guildId, keyword) {
    if (!ownerId || !guildId || !keyword) return false;
    getDb();
    const info = _stmts.deleteKeyword.run(ownerId, guildId, keyword.toLowerCase().trim());
    return info.changes > 0;
  },

  setKeywordTargets(ownerId, guildId, keyword, targetUserIds = []) {
    if (!ownerId || !guildId || !keyword) return;
    getDb();
    const kw = keyword.toLowerCase().trim();
    const targets = targetUserIds.length ? targetUserIds : [ownerId];
    getDb().transaction(() => {
      _stmts.setKeywordTargets.run(ownerId, guildId, kw);
      for (const t of targets) {
        _stmts.insertKeywordTarget.run(ownerId, guildId, kw, t);
      }
    })();
  },

  getKeywords(ownerId, guildId) {
    if (!ownerId || !guildId) return [];
    getDb();
    return _stmts.getKeywords.all(ownerId, guildId).map(r => ({
      keyword : r.keyword,
      targets : r.targets ? r.targets.split(',') : [ownerId],
    }));
  },

  getGuildKeywords(guildId) {
    if (!guildId) return [];
    getDb();
    return _stmts.getGuildKeywords.all(guildId);
  },

  clearKeywords(ownerId, guildId) {
    if (!ownerId || !guildId) return;
    getDb();
    _stmts.clearKeywords.run(ownerId, guildId);
  },

  getConfessionConfig(guildId) {
    if (!guildId) return null;
    getDb();
    _stmts.upsertConfessionConfig.run(guildId);
    return _stmts.getConfessionConfig.get(guildId);
  },

  saveConfessionConfig(guildId, fields) {
    if (!guildId) return;
    getDb();
    _stmts.upsertConfessionConfig.run(guildId);
    const cfg = _stmts.getConfessionConfig.get(guildId);
    const merged = { ...cfg, ...fields };
    _stmts.setConfessionField.run(
      merged.enabled ? 1 : 0,
      merged.channelId ?? null,
      merged.reviewChannelId ?? null,
      merged.reviewEnabled ? 1 : 0,
      merged.revealAllowed ? 1 : 0,
      merged.reactionsEnabled ? 1 : 0,
      merged.replyEnabled ? 1 : 0,
      merged.cooldownSeconds ?? 300,
      merged.blacklist ?? '',
      merged.buttonMsgId ?? null,
      merged.allowAnonymousReply ? 1 : 0,
      guildId,
    );
  },

  createConfession(guildId, authorId, content) {
    if (!guildId || !authorId || !content) return null;
    getDb();
    const info = _stmts.insertConfession.run(guildId, authorId, content, guildId);
    return info.lastInsertRowid;
  },

  getConfession(id) {
    if (!id) return null;
    getDb();
    return _stmts.getConfession.get(id);
  },

  getConfessionByMsgId(messageId) {
    if (!messageId) return null;
    getDb();
    return _stmts.getConfessionByMsgId.get(messageId, messageId);
  },

  updateConfessionStatus(id, status, messageId = null, reviewMsgId = null) {
    if (!id) return;
    getDb();
    const cur = _stmts.getConfession.get(id);
    _stmts.updateConfessionStatus.run(
      status,
      messageId ?? cur?.messageId ?? null,
      reviewMsgId ?? cur?.reviewMsgId ?? null,
      id,
    );
  },

  getLastApprovedConfession(guildId) {
    if (!guildId) return null;
    getDb();
    return _stmts.getLastApprovedConfession.get(guildId);
  },

  getLastConfessionTime(guildId, authorId) {
    if (!guildId || !authorId) return 0;
    getDb();
    return _stmts.getLastConfessionTime.get(guildId, authorId)?.last ?? 0;
  },

  countApprovedConfessions(guildId) {
    if (!guildId) return 0;
    getDb();
    return _stmts.countConfessions.get(guildId)?.c ?? 0;
  },

  incrementMsgcount(userId, guildId) {
    if (!userId || !guildId) return;
    getDb();
    const day = new Date().toISOString().slice(0, 10);
    _stmts.upsertMsgcount.run(userId, guildId, day);
  },

  getTopMsgs(guildId, days = 7, limit = 10) {
    if (!guildId) return [];
    getDb();
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return _stmts.getTopMsgs.all(guildId, since, Math.min(limit, 25));
  },

  transaction(fn) {
    return getDb().transaction(fn)();
  },

  getSchemaVersion() {
    return getDb().prepare('SELECT MAX(version) as v FROM schema_version').get()?.v ?? 0;
  },

  raw() {
    return getDb();
  },


  getBotActivity() {
    getDb();
    return _stmts.getBotActivity.get() || null;
  },

  setBotActivity(type, messages, url, status) {
    getDb();
    _stmts.setBotActivity.run(type, messages, url || null, status || 'online');
  },

  clearBotActivity() {
    getDb();
    _stmts.clearBotActivity.run();
  },

  updateStreak(userId, guildId) {
    if (!userId || !guildId) return null;
    getDb();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const row = _stmts.getStreak.get(guildId, userId);
    if (row?.lastDate === today) {
      return row;
    }

    const streak = row?.lastDate === yesterday ? (row.streak || 0) + 1 : 1;
    _stmts.insertStreak.run(guildId, userId, streak, today);
    return _stmts.getStreak.get(guildId, userId);
  },

  getStreak(userId, guildId) {
    if (!userId || !guildId) return null;
    getDb();
    return _stmts.getStreak.get(guildId, userId) || null;
  },

  getBirthday(guildId, userId) {
    if (!guildId || !userId) return null;
    getDb();
    return _stmts.getBirthdayByUser.get(guildId, userId) || null;
  },

  getBirthdays(guildId) {
    if (!guildId) return [];
    getDb();
    return _stmts.getBirthdaysByGuild.all(guildId) || [];
  },

  getBirthdaysForDate(guildId, month, day) {
    if (!guildId || !month || !day) return [];
    getDb();
    return _stmts.getBirthdaysByDate.all(guildId, month, day) || [];
  },

  setBirthday(guildId, userId, month, day, timezone = null) {
    if (!guildId || !userId || !month || !day) return null;
    getDb();
    _stmts.insertBirthday.run(guildId, userId, month, day, timezone);
    return _stmts.getBirthdayByUser.get(guildId, userId) || null;
  },

  deleteBirthday(guildId, userId) {
    if (!guildId || !userId) return;
    getDb();
    _stmts.deleteBirthday.run(guildId, userId);
  },

  getRainbowRole(guildId, roleId) {
    if (!guildId || !roleId) return null;
    getDb();
    return _stmts.getRainbowRole.get(guildId, roleId) || null;
  },

  getRainbowRoles(guildId) {
    if (!guildId) return [];
    getDb();
    return _stmts.getRainbowRolesByGuild.all(guildId) || [];
  },

  getActiveRainbowRoles(guildId) {
    if (!guildId) return [];
    getDb();
    return _stmts.getActiveRainbowRoles.all(guildId) || [];
  },

  setRainbowRole(guildId, roleId, options = {}) {
    if (!guildId || !roleId) return null;
    getDb();
    const existing = _stmts.getRainbowRole.get(guildId, roleId);
    const mode = options.mode || 'rainbow';
    const paletteSize = Number(options.paletteSize) || 7;
    const active = (options.active === false || options.active === 0) ? 0 : 1;
    const interval = Number(options.interval) || 60;
    const nextRun = options.nextRun || new Date(Date.now() + interval * 1000).toISOString();
    const color = options.color !== undefined ? options.color : existing?.color ?? null;
    _stmts.insertRainbowRole.run(guildId, roleId, mode, paletteSize, active, interval, nextRun, color);
    return _stmts.getRainbowRole.get(guildId, roleId) || null;
  },

  updateRainbowRole(guildId, roleId, options = {}) {
    if (!guildId || !roleId) return null;
    getDb();
    _stmts.updateRainbowRole.run(
      options.mode ?? null,
      options.paletteSize ?? null,
      options.active !== undefined && options.active !== null ? Number(options.active) : null,
      options.interval ?? null,
      options.nextRun ?? null,
      options.color ?? null,
      guildId,
      roleId
    );
    return _stmts.getRainbowRole.get(guildId, roleId) || null;
  },

  removeRainbowRole(guildId, roleId) {
    if (!guildId || !roleId) return;
    getDb();
    _stmts.deleteRainbowRole.run(guildId, roleId);
  },

  getInviteStats(guildId, userId) {
    const d = getDb();
    const regular = d.prepare(
      `SELECT COUNT(*) as count FROM invite_tracking WHERE guildId = ? AND inviterId = ? AND leftAt IS NULL`
    ).get(guildId, userId)?.count ?? 0;
    const left = d.prepare(
      `SELECT COUNT(*) as count FROM invite_tracking WHERE guildId = ? AND inviterId = ? AND leftAt IS NOT NULL`
    ).get(guildId, userId)?.count ?? 0;
    const bonus = d.prepare(
      `SELECT bonus FROM invite_bonus WHERE guildId = ? AND userId = ?`
    ).get(guildId, userId)?.bonus ?? 0;
    return { regular, left, bonus, total: regular + bonus };
  },

  getInviteLeaderboard(guildId, limit = 10) {
    const d = getDb();
    return d.prepare(`
      SELECT
        inviterId AS userId,
        SUM(CASE WHEN leftAt IS NULL THEN 1 ELSE 0 END) AS regular,
        SUM(CASE WHEN leftAt IS NOT NULL THEN 1 ELSE 0 END) AS left_count,
        COALESCE((SELECT bonus FROM invite_bonus WHERE guildId = it.guildId AND userId = it.inviterId), 0) AS bonus
      FROM invite_tracking it
      WHERE guildId = ? AND inviterId IS NOT NULL
      GROUP BY inviterId
      ORDER BY (regular + bonus) DESC
      LIMIT ?
    `).all(guildId, limit);
  },

  setInviteBonus(guildId, userId, bonus) {
    getDb().prepare(
      `INSERT INTO invite_bonus (guildId, userId, bonus) VALUES (?, ?, ?)
       ON CONFLICT(guildId, userId) DO UPDATE SET bonus = excluded.bonus`
    ).run(guildId, userId, bonus);
  },

  addInviteBonus(guildId, userId, amount) {
    const d = getDb();
    d.prepare(
      `INSERT INTO invite_bonus (guildId, userId, bonus) VALUES (?, ?, ?)
       ON CONFLICT(guildId, userId) DO UPDATE SET bonus = bonus + excluded.bonus`
    ).run(guildId, userId, amount);
    return d.prepare(`SELECT bonus FROM invite_bonus WHERE guildId = ? AND userId = ?`).get(guildId, userId)?.bonus ?? amount;
  },

  clearInvites(guildId, userId) {
    const d = getDb();
    d.prepare(`UPDATE invite_tracking SET inviterId = NULL WHERE guildId = ? AND inviterId = ?`).run(guildId, userId);
    d.prepare(`DELETE FROM invite_bonus WHERE guildId = ? AND userId = ?`).run(guildId, userId);
  },

  clearAllInvites(guildId) {
    const d = getDb();
    d.prepare(`UPDATE invite_tracking SET inviterId = NULL WHERE guildId = ?`).run(guildId);
    d.prepare(`DELETE FROM invite_bonus WHERE guildId = ?`).run(guildId);
  },

  trackInvite(guildId, userId, inviterId) {
    getDb().prepare(
      `INSERT INTO invite_tracking (guildId, userId, inviterId) VALUES (?, ?, ?)
       ON CONFLICT(guildId, userId) DO UPDATE SET inviterId = excluded.inviterId, joinedAt = unixepoch(), leftAt = NULL`
    ).run(guildId, userId, inviterId ?? null);
  },

  markInviteLeft(guildId, userId) {
    getDb().prepare(
      `UPDATE invite_tracking SET leftAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(guildId, userId);
  },

  getInviterOf(guildId, userId) {
    return getDb().prepare(
      `SELECT inviterId FROM invite_tracking WHERE guildId = ? AND userId = ?`
    ).get(guildId, userId)?.inviterId ?? null;
  },

  getInviteRewards(guildId) {
    return getDb().prepare(
      `SELECT threshold, roleId FROM invite_rewards WHERE guildId = ? ORDER BY threshold ASC`
    ).all(guildId);
  },

  setInviteReward(guildId, threshold, roleId) {
    getDb().prepare(
      `INSERT INTO invite_rewards (guildId, threshold, roleId) VALUES (?, ?, ?)
       ON CONFLICT(guildId, threshold) DO UPDATE SET roleId = excluded.roleId`
    ).run(guildId, threshold, roleId);
  },

  deleteInviteReward(guildId, threshold) {
    getDb().prepare(
      `DELETE FROM invite_rewards WHERE guildId = ? AND threshold = ?`
    ).run(guildId, threshold);
  },

  getCmdAliases(guildId) {
    return getDb().prepare(
      `SELECT alias, commandName FROM cmd_aliases WHERE guildId = ? ORDER BY commandName, alias`
    ).all(guildId);
  },

  getCmdAliasesByCommand(guildId, commandName) {
    return getDb().prepare(
      `SELECT alias FROM cmd_aliases WHERE guildId = ? AND commandName = ? ORDER BY alias`
    ).all(guildId, commandName).map(r => r.alias);
  },

  getCmdAlias(guildId, alias) {
    return getDb().prepare(
      `SELECT commandName FROM cmd_aliases WHERE guildId = ? AND alias = ?`
    ).get(guildId, alias) ?? null;
  },

  addCmdAlias(guildId, alias, commandName) {
    getDb().prepare(
      `INSERT INTO cmd_aliases (guildId, alias, commandName) VALUES (?, ?, ?)
       ON CONFLICT(guildId, alias) DO UPDATE SET commandName = excluded.commandName`
    ).run(guildId, alias.toLowerCase().trim(), commandName.toLowerCase().trim());
  },

  removeCmdAlias(guildId, alias) {
    getDb().prepare(
      `DELETE FROM cmd_aliases WHERE guildId = ? AND alias = ?`
    ).run(guildId, alias.toLowerCase().trim());
  },

  clearCmdAliases(guildId, commandName) {
    getDb().prepare(
      `DELETE FROM cmd_aliases WHERE guildId = ? AND commandName = ?`
    ).run(guildId, commandName);
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // CASINO SYSTEM - COMPLETE
  // ═══════════════════════════════════════════════════════════════════════════

  getCasinoConfig(guildId) {
    getDb();
    const row = getDb().prepare('SELECT * FROM casino_config WHERE guildId = ?').get(guildId);
    if (!row) {
      getDb().prepare('INSERT OR IGNORE INTO casino_config (guildId) VALUES (?)').run(guildId);
      return getDb().prepare('SELECT * FROM casino_config WHERE guildId = ?').get(guildId);
    }
    return row;
  },

  setCasinoConfig(guildId, data) {
    const d = getDb();
    const cols = Object.keys(data).filter(k => k !== 'guildId');
    if (!cols.length) return;
    const sets = cols.map(c => `${c} = ?`).join(', ');
    d.prepare(`UPDATE casino_config SET ${sets}, updatedAt = unixepoch() WHERE guildId = ?`)
      .run(...cols.map(c => data[c]), guildId);
  },

  enableCasino(guildId, enabled = true) {
    this.getCasinoConfig(guildId);
    getDb().prepare('UPDATE casino_config SET enabled = ?, updatedAt = unixepoch() WHERE guildId = ?')
      .run(enabled ? 1 : 0, guildId);
  },

  isCasinoEnabled(guildId) {
    const row = getDb().prepare('SELECT enabled FROM casino_config WHERE guildId = ?').get(guildId);
    return row?.enabled === 1;
  },

  // ─── Managers ────────────────────────────────────────────────────────────
  addCasinoManager(guildId, userId, addedBy) {
    getDb().prepare('INSERT OR REPLACE INTO casino_managers (guildId, userId, addedBy) VALUES (?, ?, ?)').run(guildId, userId, addedBy);
  },

  removeCasinoManager(guildId, userId) {
    getDb().prepare('DELETE FROM casino_managers WHERE guildId = ? AND userId = ?').run(guildId, userId);
  },

  isCasinoManager(guildId, userId) {
    const row = getDb().prepare('SELECT 1 FROM casino_managers WHERE guildId = ? AND userId = ?').get(guildId, userId);
    return !!row;
  },

  getCasinoManagers(guildId) {
    return getDb().prepare('SELECT * FROM casino_managers WHERE guildId = ?').all(guildId);
  },

  // ─── Blacklist ───────────────────────────────────────────────────────────
  addCasinoBlacklist(guildId, userId, reason, addedBy) {
    getDb().prepare('INSERT OR REPLACE INTO casino_blacklist (guildId, userId, reason, addedBy) VALUES (?, ?, ?, ?)')
      .run(guildId, userId, reason, addedBy);
  },

  removeCasinoBlacklist(guildId, userId) {
    getDb().prepare('DELETE FROM casino_blacklist WHERE guildId = ? AND userId = ?').run(guildId, userId);
  },

  isCasinoBlacklisted(guildId, userId) {
    const row = getDb().prepare('SELECT 1 FROM casino_blacklist WHERE guildId = ? AND userId = ?').get(guildId, userId);
    return !!row;
  },

  getCasinoBlacklist(guildId) {
    return getDb().prepare('SELECT * FROM casino_blacklist WHERE guildId = ?').all(guildId);
  },

  // ─── Level Roles ─────────────────────────────────────────────────────────
  addCasinoLevelRole(guildId, level, roleId) {
    getDb().prepare('INSERT OR REPLACE INTO casino_level_roles (guildId, level, roleId) VALUES (?, ?, ?)').run(guildId, level, roleId);
  },

  getCasinoLevelRoles(guildId) {
    return getDb().prepare('SELECT * FROM casino_level_roles WHERE guildId = ? ORDER BY level ASC').all(guildId);
  },

  deleteCasinoLevelRole(guildId, level) {
    getDb().prepare('DELETE FROM casino_level_roles WHERE guildId = ? AND level = ?').run(guildId, level);
  },


  getCasinoUser(guildId, userId) {
    getDb();
    let row = getDb().prepare('SELECT * FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!row) {
      getDb().prepare('INSERT OR IGNORE INTO casino_users (guildId, userId) VALUES (?, ?)').run(guildId, userId);
      const cfg = getDb().prepare('SELECT creationBonus FROM casino_config WHERE guildId = ?').get(guildId);
      const bonus = cfg?.creationBonus ?? 0;
      if (bonus > 0) {
        getDb().prepare('UPDATE casino_users SET coins = coins + ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(bonus, guildId, userId);
      }
      row = getDb().prepare('SELECT * FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
      row.__isNewProfile = true;
      row.__creationBonusGiven = bonus;
    }
    return row;
  },

  getCasinoTop(guildId, limit = 10) {
    getDb();
    return getDb().prepare(
      'SELECT userId, coins, totalWon, level FROM casino_users WHERE guildId = ? ORDER BY coins DESC LIMIT ?'
    ).all(guildId, limit);
  },

  addCasinoCoins(guildId, userId, amount, type = 'add') {
    if (!amount) return;
    getDb().prepare(
      `INSERT INTO casino_users (guildId, userId, coins, totalWon, updatedAt) VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT(guildId, userId) DO UPDATE SET
       coins = coins + ?, totalWon = totalWon + ?, updatedAt = unixepoch()`
    ).run(guildId, userId, amount, type === 'win' ? amount : 0, amount, type === 'win' ? amount : 0);
  },

  removeCasinoCoins(guildId, userId, amount, type = 'remove') {
    if (!amount) return;
    getDb().prepare(
      `UPDATE casino_users SET coins = MAX(0, coins - ?), totalSpent = totalSpent + ?, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(amount, type === 'spend' ? amount : 0, guildId, userId);
  },

  refundCasinoBet(guildId, userId, amount) {
    if (!amount) return;
    getDb().prepare(
      `UPDATE casino_users SET coins = coins + ?, totalSpent = MAX(0, totalSpent - ?), updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(amount, amount, guildId, userId);
  },

  addCasinoDraws(guildId, userId, amount) {
    getDb().prepare(
      `UPDATE casino_users SET draws = draws + ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(amount, guildId, userId);
  },

  removeCasinoDraws(guildId, userId, amount) {
    getDb().prepare(
      `UPDATE casino_users SET draws = MAX(0, draws - ?), updatedAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(amount, guildId, userId);
  },

  addShields(guildId, userId, amount) {
    getDb().prepare(
      `UPDATE casino_users SET shields = MIN(shields + ?, 10), updatedAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(amount, guildId, userId);
  },

  getShields(guildId, userId) {
    const row = getDb().prepare('SELECT shields FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    return row?.shields ?? 0;
  },

  consumeShield(guildId, userId) {
    const d = getDb();
    const row = d.prepare('SELECT shields FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!row || row.shields < 1) return false;
    d.prepare('UPDATE casino_users SET shields = shields - 1, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(guildId, userId);
    return true;
  },

  getJackpot(guildId) {
    const row = getDb().prepare('SELECT jackpotAmount, jackpotNumber FROM casino_config WHERE guildId = ?').get(guildId);
    let amount = row?.jackpotAmount ?? 0;
    let number = row?.jackpotNumber ?? 0;
    if (!number) {
      number = Math.floor(Math.random() * 1000) + 1;
      getDb().prepare('UPDATE casino_config SET jackpotNumber = ? WHERE guildId = ?').run(number, guildId);
    }
    return { amount, number };
  },

  addToJackpot(guildId, amount) {
    getDb().prepare('UPDATE casino_config SET jackpotAmount = jackpotAmount + ? WHERE guildId = ?').run(amount, guildId);
  },

  resetJackpot(guildId) {
    const newNumber = Math.floor(Math.random() * 1000) + 1;
    getDb().prepare('UPDATE casino_config SET jackpotAmount = 0, jackpotNumber = ? WHERE guildId = ?').run(newNumber, guildId);
  },

  useCasinoDraw(guildId, userId) {
    const d = getDb();
    const user = d.prepare('SELECT draws FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!user || user.draws < 1) return false;
    d.prepare(
      `UPDATE casino_users SET draws = draws - 1, totalDraws = totalDraws + 1, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(guildId, userId);
    return true;
  },

  addVocMinutes(guildId, userId, minutes) {
    getDb().prepare(
      `UPDATE casino_users SET vocMinutes = vocMinutes + ?, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(minutes, guildId, userId);
  },

  resetVocMinutes(guildId, userId) {
    getDb().prepare(
      `UPDATE casino_users SET vocMinutes = 0, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(guildId, userId);
  },

  addMsgCount(guildId, userId, count = 1) {
    getDb().prepare(
      `UPDATE casino_users SET msgCount = msgCount + ?, updatedAt = unixepoch()
       WHERE guildId = ? AND userId = ?`
    ).run(count, guildId, userId);
  },

  getLastDaily(guildId, userId) {
    const row = getDb().prepare('SELECT lastDaily FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    return row?.lastDaily ?? 0;
  },

  setLastDaily(guildId, userId, timestamp) {
    getDb().prepare(
      `UPDATE casino_users SET lastDaily = ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(timestamp, guildId, userId);
  },

  getLastCollect(guildId, userId) {
    const row = getDb().prepare('SELECT lastCollect FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    return row?.lastCollect ?? 0;
  },

  setLastCollect(guildId, userId, timestamp) {
    getDb().prepare(
      `UPDATE casino_users SET lastCollect = ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?`
    ).run(timestamp, guildId, userId);
  },

  getTopCasino(guildId, limit = 10) {
    return getDb().prepare(
      `SELECT userId, coins, draws, totalWon, vipTier FROM casino_users
       WHERE guildId = ? ORDER BY coins DESC LIMIT ?`
    ).all(guildId, limit);
  },

  // ─── Equipment (new schema) ──────────────────────────────────────────────
  getEquippedItems(guildId, userId) {
    const d = getDb();
    const user = d.prepare('SELECT equippedColorId, equippedBadgeId, equippedDecorId, equippedSuccessId FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!user) return {};
    return {
      color: user.equippedColorId,
      badge: user.equippedBadgeId,
      decor: user.equippedDecorId,
      success: user.equippedSuccessId,
    };
  },

  equipItem(guildId, userId, itemId) {
    const d = getDb();
    const item = d.prepare('SELECT type FROM casino_shop WHERE id = ?').get(itemId);
    if (!item) return false;

    const slotMap = { color: 'equippedColorId', badge: 'equippedBadgeId', decor: 'equippedDecorId', success: 'equippedSuccessId' };
    const slot = slotMap[item.type];
    if (!slot) return false;

    d.prepare('UPDATE casino_users SET ' + slot + ' = ?, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(itemId, guildId, userId);
    d.prepare('UPDATE casino_inventory SET equipped = 1, equippedAt = unixepoch() WHERE guildId = ? AND userId = ? AND itemId = ?').run(guildId, userId, itemId);
    return true;
  },

  unequipItem(guildId, userId, type) {
    const d = getDb();
    const slotMap = { color: 'equippedColorId', badge: 'equippedBadgeId', decor: 'equippedDecorId', success: 'equippedSuccessId' };
    const slot = slotMap[type];
    if (!slot) return false;

    d.prepare('UPDATE casino_users SET ' + slot + ' = NULL, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('UPDATE casino_inventory SET equipped = 0 WHERE guildId = ? AND userId = ? AND itemId IN (SELECT id FROM casino_shop WHERE type = ?)').run(guildId, userId, type);
    return true;
  },

  getEquippedItemDetails(guildId, userId) {
    const d = getDb();
    const user = d.prepare('SELECT equippedColorId, equippedBadgeId, equippedDecorId, equippedSuccessId FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!user) return {};

    const result = {};
    const slots = [
      { key: 'color', id: user.equippedColorId },
      { key: 'badge', id: user.equippedBadgeId },
      { key: 'decor', id: user.equippedDecorId },
      { key: 'success', id: user.equippedSuccessId },
    ];

    for (const slot of slots) {
      if (slot.id) {
        const item = d.prepare('SELECT * FROM casino_shop WHERE id = ?').get(slot.id);
        if (item) result[slot.key] = item;
      }
    }
    return result;
  },


  addShopItem(guildId, name, description, price, type, roleId = null, colorHex = null, stock = -1, limited = 0) {
    const d = getDb();
    d.prepare('DELETE FROM casino_shop WHERE guildId = ? AND name = ? AND active = 0').run(guildId, name);
    return d.prepare(
      `INSERT INTO casino_shop (guildId, name, description, price, type, roleId, colorHex, stock, limited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(guildId, name, description, price, type, roleId, colorHex, stock, limited);
  },

  getShopItems(guildId) {
    return getDb().prepare('SELECT * FROM casino_shop WHERE guildId = ? AND active = 1 ORDER BY price ASC').all(guildId);
  },

  getShopItem(guildId, itemId) {
    return getDb().prepare('SELECT * FROM casino_shop WHERE guildId = ? AND id = ?').get(guildId, itemId);
  },

  deleteShopItem(guildId, itemId) {
    getDb().prepare('UPDATE casino_shop SET active = 0 WHERE guildId = ? AND id = ?').run(guildId, itemId);
  },

  buyShopItem(guildId, userId, itemId) {
    const d = getDb();
    const item = d.prepare('SELECT * FROM casino_shop WHERE guildId = ? AND id = ?').get(guildId, itemId);
    if (!item) return { ok: false, reason: 'notfound' };

    const UNIQUE_TYPES = ['color', 'role', 'badge', 'decor', 'nitro'];
    if (UNIQUE_TYPES.includes(item.type)) {
      const existing = d.prepare('SELECT 1 FROM casino_inventory WHERE guildId = ? AND userId = ? AND itemId = ?').get(guildId, userId, itemId);
      if (existing) return { ok: false, reason: 'alreadyowned' };
    }

    const user = d.prepare('SELECT coins FROM casino_users WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (!user || user.coins < item.price) return { ok: false, reason: 'nomoney' };

    if (item.stock > 0) {
      d.prepare('UPDATE casino_shop SET stock = stock - 1 WHERE id = ?').run(itemId);
    } else if (item.stock === 0) {
      return { ok: false, reason: 'outofstock' };
    }

    d.prepare('UPDATE casino_users SET coins = coins - ?, totalSpent = totalSpent + ? WHERE guildId = ? AND userId = ?')
      .run(item.price, item.price, guildId, userId);

    d.prepare(
      `INSERT INTO casino_inventory (guildId, userId, itemId) VALUES (?, ?, ?)
       ON CONFLICT(guildId, userId, itemId) DO UPDATE SET quantity = quantity + 1`
    ).run(guildId, userId, itemId);

    return { ok: true, item };
  },


  getInventory(guildId, userId) {
    return getDb().prepare(
      `SELECT i.*, s.name, s.type, s.roleId, s.colorHex FROM casino_inventory i
       JOIN casino_shop s ON i.itemId = s.id
       WHERE i.guildId = ? AND i.userId = ?`
    ).all(guildId, userId);
  },

  clearInventory(guildId, userId) {
    const d = getDb();
    const invItems = d.prepare('SELECT itemId, quantity FROM casino_inventory WHERE guildId = ? AND userId = ?').all(guildId, userId);
    for (const inv of invItems) {
      const shopItem = d.prepare('SELECT stock FROM casino_shop WHERE guildId = ? AND id = ?').get(guildId, inv.itemId);
      if (shopItem && shopItem.stock >= 0) {
        d.prepare('UPDATE casino_shop SET stock = stock + ? WHERE guildId = ? AND id = ?').run(inv.quantity, guildId, inv.itemId);
      }
    }
    d.prepare('DELETE FROM casino_inventory WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('DELETE FROM casino_gacha_owned WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('UPDATE casino_users SET equippedColorId = NULL, equippedBadgeId = NULL, equippedDecorId = NULL, equippedSuccessId = NULL, updatedAt = unixepoch() WHERE guildId = ? AND userId = ?').run(guildId, userId);
  },



  addGachaItem(guildId, name, type, value, roleId, weight) {
    getDb().prepare(
      `INSERT INTO casino_gacha_pool (guildId, name, type, value, roleId, weight) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(guildId, name, type, value, roleId, weight);
  },

  getGachaPool(guildId) {
    return getDb().prepare('SELECT * FROM casino_gacha_pool WHERE guildId = ? AND active = 1').all(guildId);
  },

  setGachaCoinConfig(guildId, min, max) {
    const d = getDb();
    const existing = d.prepare("SELECT id FROM casino_gacha_pool WHERE guildId = ? AND type = 'coins'").get(guildId);
    if (existing) {
      d.prepare('UPDATE casino_gacha_pool SET value = ?, valueMax = ?, active = 1 WHERE id = ?').run(min, max, existing.id);
    } else {
      d.prepare("INSERT INTO casino_gacha_pool (guildId, name, type, value, valueMax, chance, weight) VALUES (?, 'Mysoul Coins', 'coins', ?, ?, 100, 1)").run(guildId, min, max);
    }
  },

  addGachaPoolItem(guildId, name, type, chance, roleId, value) {
    getDb().prepare('INSERT INTO casino_gacha_pool (guildId, name, type, chance, value, roleId, weight) VALUES (?, ?, ?, ?, ?, ?, 1)').run(guildId, name, type, chance, value || null, roleId || null);
  },

  removeGachaPoolItem(guildId, itemId) {
    getDb().prepare('UPDATE casino_gacha_pool SET active = 0 WHERE guildId = ? AND id = ?').run(guildId, itemId);
  },

  hasGachaOwned(guildId, userId, itemId) {
    return !!getDb().prepare('SELECT 1 FROM casino_gacha_owned WHERE guildId = ? AND userId = ? AND itemId = ?').get(guildId, userId, itemId);
  },

  addGachaOwned(guildId, userId, itemId) {
    try { getDb().prepare('INSERT OR IGNORE INTO casino_gacha_owned (guildId, userId, itemId) VALUES (?, ?, ?)').run(guildId, userId, itemId); } catch {}
  },

  drawGacha(guildId, userId) {
    const pool = this.getGachaPool(guildId);
    if (!pool.length) return null;

    const UNIQUE = new Set(['color', 'role', 'badge', 'decor', 'nitro']);

    // 1. Coins ・ always rewarded
    const coinsConfig = pool.find(i => i.type === 'coins');
    let coinsEarned = 0;
    if (coinsConfig) {
      const min = coinsConfig.value ?? 100;
      const max = coinsConfig.valueMax ?? coinsConfig.value ?? 100;
      coinsEarned = Math.floor(Math.random() * (max - min + 1)) + min;
      if (coinsEarned > 0) this.addCasinoCoins(guildId, userId, coinsEarned, 'win');
    }

    // 2. Bonus item ・ cumulative chance, rarest first, skip already-owned unique items
    const itemPool = pool
      .filter(i => i.type !== 'coins' && (i.chance ?? 100) > 0)
      .filter(i => !UNIQUE.has(i.type) || !this.hasGachaOwned(guildId, userId, i.id))
      .sort((a, b) => (a.chance ?? 100) - (b.chance ?? 100));

    let wonItem = null;
    let cumulative = 0;
    const roll = Math.random() * 100;
    for (const item of itemPool) {
      cumulative += (item.chance ?? 100);
      if (roll < cumulative) {
        wonItem = item;
        if (UNIQUE.has(item.type)) this.addGachaOwned(guildId, userId, item.id);
        this._applyGachaReward(guildId, userId, { ...item, value: item.value ?? 0 });
        break;
      }
    }

    return { coins: coinsEarned, item: wonItem };
  },

  _applyGachaReward(guildId, userId, item) {
    const d = getDb();
    switch (item.type) {
      case 'coins':
        this.addCasinoCoins(guildId, userId, item.value, 'win');
        break;
      case 'draws':
        this.addCasinoDraws(guildId, userId, item.value);
        break;
      case 'xp':
        this.addCasinoXP(guildId, userId, item.value);
        break;
      case 'pillages':
      case 'sabotage':
        d.prepare(
          `INSERT INTO casino_inventory (guildId, userId, itemId, quantity) VALUES (?, ?, ?, ?)
           ON CONFLICT(guildId, userId, itemId) DO UPDATE SET quantity = quantity + excluded.quantity`
        ).run(guildId, userId, item.id, item.value || 1);
        break;
      case 'role':
      case 'color':
      case 'badge':
      case 'decor':
      case 'nitro':
        d.prepare(
          `INSERT INTO casino_inventory (guildId, userId, itemId, quantity) VALUES (?, ?, ?, 1)
           ON CONFLICT(guildId, userId, itemId) DO UPDATE SET quantity = quantity + 1`
        ).run(guildId, userId, item.id);
        break;
    }
  },


  getUnlockedAchievementKeys(guildId, userId) {
    return new Set(
      getDb().prepare('SELECT achievementKey FROM casino_user_achievements WHERE guildId = ? AND userId = ?')
        .all(guildId, userId)
        .map(r => r.achievementKey)
    );
  },

  unlockAchievementByKey(guildId, userId, key) {
    try {
      getDb().prepare('INSERT OR IGNORE INTO casino_user_achievements (guildId, userId, achievementKey) VALUES (?, ?, ?)')
        .run(guildId, userId, key);
    } catch {}
  },


  addCasinoHistory(guildId, userId, type, amount, result, details) {
    getDb().prepare(
      `INSERT INTO casino_history (guildId, userId, type, amount, result, details) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(guildId, userId, type, amount, result, details);
  },

  getCasinoHistory(guildId, userId, limit = 50) {
    return getDb().prepare(
      `SELECT * FROM casino_history WHERE guildId = ? AND userId = ? ORDER BY createdAt DESC LIMIT ?`
    ).all(guildId, userId, limit);
  },


  createDuel(guildId, challengerId, opponentId, bet, game) {
    return getDb().prepare(
      `INSERT INTO casino_duels (guildId, challengerId, opponentId, bet, game) VALUES (?, ?, ?, ?, ?)`
    ).run(guildId, challengerId, opponentId, bet, game).lastInsertRowid;
  },

  getDuel(duelId) {
    return getDb().prepare('SELECT * FROM casino_duels WHERE id = ?').get(duelId);
  },

  getPendingDuel(guildId, userId) {
    return getDb().prepare(
      `SELECT * FROM casino_duels WHERE guildId = ? AND status = 'pending'
       AND (challengerId = ? OR opponentId = ?) LIMIT 1`
    ).get(guildId, userId, userId);
  },

  acceptDuel(duelId, winnerId) {
    getDb().prepare(
      `UPDATE casino_duels SET status = 'accepted', winnerId = ? WHERE id = ?`
    ).run(winnerId, duelId);
  },

  endDuel(duelId, winnerId) {
    getDb().prepare(
      `UPDATE casino_duels SET status = 'ended', winnerId = ?, endedAt = unixepoch() WHERE id = ?`
    ).run(winnerId, duelId);
  },

  deleteDuel(duelId) {
    getDb().prepare('DELETE FROM casino_duels WHERE id = ?').run(duelId);
  },


  resetCasinoUser(guildId, userId) {
    const d = getDb();
    d.prepare('DELETE FROM casino_users WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('DELETE FROM casino_inventory WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('DELETE FROM casino_user_achievements WHERE guildId = ? AND userId = ?').run(guildId, userId);
    d.prepare('DELETE FROM casino_history WHERE guildId = ? AND userId = ?').run(guildId, userId);
  },

  resetCasinoGuild(guildId) {
    const d = getDb();
    d.prepare('DELETE FROM casino_config WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_users WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_level_roles WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_managers WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_blacklist WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_shop WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_inventory WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_gacha_pool WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_history WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM casino_duels WHERE guildId = ?').run(guildId);
    d.prepare('DELETE FROM giveaway_coins WHERE guildId = ?').run(guildId);
  },

  recordPendingBet(guildId, userId, amount, game) {
    getDb().prepare(
      'INSERT INTO casino_pending_bets (guildId, userId, amount, game) VALUES (?, ?, ?, ?)'
    ).run(guildId, userId, amount, game);
  },

  clearPendingBet(guildId, userId, game) {
    getDb().prepare(
      'DELETE FROM casino_pending_bets WHERE guildId = ? AND userId = ? AND game = ? ORDER BY id DESC LIMIT 1'
    ).run(guildId, userId, game);
  },

  refundAllPendingBets() {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM casino_pending_bets').all();
    for (const row of rows) {
      d.prepare(
        'UPDATE casino_users SET coins = coins + ?, totalSpent = MAX(0, totalSpent - ?), updatedAt = unixepoch() WHERE guildId = ? AND userId = ?'
      ).run(row.amount, row.amount, row.guildId, row.userId);
    }
    d.prepare('DELETE FROM casino_pending_bets').run();
    return rows.length;
  },

  // ─── Giveaway Coins ──────────────────────────────────────────────────────
  createGiveawayCoins(guildId, channelId, hostId, amount, winnersCount, durationMs) {
    const endsAt = Math.floor(Date.now() / 1000) + Math.floor(durationMs / 1000);
    return getDb().prepare(
      `INSERT INTO giveaway_coins (guildId, channelId, hostId, amount, winnersCount, durationMs, endsAt, entrants, winners)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(guildId, channelId, hostId, amount, winnersCount, durationMs, endsAt, '[]', '[]').lastInsertRowid;
  },

  getGiveawayCoins(id) {
    return getDb().prepare('SELECT * FROM giveaway_coins WHERE id = ?').get(id);
  },

  getActiveGiveawaysCoins(guildId) {
    return getDb().prepare(
      `SELECT * FROM giveaway_coins WHERE guildId = ? AND status = 'active' AND endsAt > ? ORDER BY endsAt ASC`
    ).all(guildId, Math.floor(Date.now() / 1000));
  },

  endGiveawayCoins(id, winners) {
    getDb().prepare(
      `UPDATE giveaway_coins SET status = 'ended', winners = ?, messageId = ? WHERE id = ?`
    ).run(JSON.stringify(winners), null, id);
  },

  addGiveawayEntrant(id, userId) {
    const d = getDb();
    const gw = d.prepare('SELECT entrants FROM giveaway_coins WHERE id = ?').get(id);
    if (!gw) return false;
    const entrants = JSON.parse(gw.entrants || '[]');
    if (entrants.includes(userId)) return false;
    entrants.push(userId);
    d.prepare('UPDATE giveaway_coins SET entrants = ? WHERE id = ?').run(JSON.stringify(entrants), id);
    return true;
  },

  getGiveawayEntrants(id) {
    const gw = getDb().prepare('SELECT entrants FROM giveaway_coins WHERE id = ?').get(id);
    return gw ? JSON.parse(gw.entrants || '[]') : [];
  },

  deleteGiveawayCoins(id) {
    getDb().prepare('DELETE FROM giveaway_coins WHERE id = ?').run(id);
  },

  rerollGiveawayCoins(id, newWinners) {
    getDb().prepare('UPDATE giveaway_coins SET winners = ? WHERE id = ?').run(JSON.stringify(newWinners), id);
  },

};

module.exports = db;
