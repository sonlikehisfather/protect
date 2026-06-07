'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MentionableSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? null;
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const MAX_V2_COMPONENTS    = 40;
const MAX_BUTTONS_PER_ROW  = 5;

const db           = require('../core/database');
const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const permissions  = require('../utils/permissions');
const { replaceVariables } = require('../utils/variables');

const MAX_BUTTONS   = 5;
const MAX_REACTIONS = 10;
const MAX_ROLES     = 5;
const MAX_SELECTS   = 1;
const MAX_OPTIONS   = 25;

const VALID_MODES = new Set(['replace', 'follow', 'ephemeral']);

const BUTTON_STYLE_MAP = {
  primary  : ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success  : ButtonStyle.Success,
  danger   : ButtonStyle.Danger,
};

const CHANNEL_TYPE_MAP = {
  text         : ChannelType.GuildText,
  announcement : ChannelType.GuildAnnouncement,
  voice        : ChannelType.GuildVoice,
  stage        : ChannelType.GuildStageVoice,
  category     : ChannelType.GuildCategory,
  forum        : ChannelType.GuildForum,
};

function _resolveChannelTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  }
  const resolved = types
    .map(t => CHANNEL_TYPE_MAP[String(t).trim().toLowerCase()])
    .filter(v => v !== undefined);
  return resolved.length > 0 ? resolved : [ChannelType.GuildText, ChannelType.GuildAnnouncement];
}

const VALID_CUSTOM_PERMS = new Set([
  'everyone', 'public', 'owner', 'buyer',
  'perm1', 'perm2', 'perm3', 'perm4', 'perm5',
  'perm6', 'perm7', 'perm8', 'perm9',
]);

const cooldownMap       = new Map();
const cooldownNoticeMap = new Map();


const selectedRoleCache = new Map();
const ROLE_CACHE_TTL_MS = 30 * 60 * 1000;


const recentClicksMap = new Map();
const DOUBLE_CLICK_TTL_MS = 1500;
function _pruneRecentClicks() {
  if (recentClicksMap.size < 500) return;
  const now = Date.now();
  for (const [k, expiresAt] of recentClicksMap) {
    if (expiresAt <= now) recentClicksMap.delete(k);
  }
}

function _roleCacheKey(guildId, messageId, customName, componentId, userId) {
  return `${guildId}:${messageId || ''}:${customName}:${componentId}:${userId}`;
}
function _setRoleCache(key, roleIds) {
  _pruneRoleCache();
  const arr = Array.isArray(roleIds) ? roleIds : [roleIds];
  selectedRoleCache.set(key, { roleIds: arr, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
}
function _getRoleCache(key) {
  const entry = selectedRoleCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { selectedRoleCache.delete(key); return null; }
  return entry.roleIds;
}
function _delRoleCache(key) {
  selectedRoleCache.delete(key);
}
function _pruneRoleCache() {
  if (selectedRoleCache.size < 200) return;
  const now = Date.now();
  for (const [k, v] of selectedRoleCache) {
    if (now > v.expiresAt) selectedRoleCache.delete(k);
  }
}


function _canUseCustom(guild, member, userId, custom, channelId) {
  if (!custom.enabled) return { ok: false, reason: 'disabled', silent: true };


  const _hasBypass = permissions.isBuyer(userId) || permissions.isOwner(guildId,userId);
  if (_hasBypass) return { ok: true };

  const perm = (custom.customPerm || 'everyone').toLowerCase();
  if (perm !== 'everyone') {
    if (perm === 'buyer') {
      return { ok: false, reason: 'Permission insuffisante.' };
    } else if (perm === 'owner') {
      return { ok: false, reason: 'Permission insuffisante.' };
    } else if (perm === 'public') {
      const publicChannels = db.getPublicChannels(guild.id);
      const inPublic = Array.isArray(publicChannels) && publicChannels.some(c =>
        typeof c === 'string' ? c === channelId : c.channelId === channelId
      );
      if (!inPublic) return { ok: false, reason: 'Permission insuffisante.' };
    } else {
      const m = perm.match(/^perm([1-9])$/);
      if (m) {
        const level = parseInt(m[1], 10);
        if (!permissions.hasLevel(member, guild.id, level)) {
          return { ok: false, reason: 'Permission insuffisante.' };
        }
      }
    }
  }

  if (custom.requiredRoleId) {
    if (!member?.roles?.cache?.has(custom.requiredRoleId)) {
      return { ok: false, reason: 'Vous n\'avez pas le rôle requis.' };
    }
  }
  if (custom.deniedRoleId) {
    if (member?.roles?.cache?.has(custom.deniedRoleId)) {
      return { ok: false, reason: 'Votre rôle bloque cette action.' };
    }
  }


  if (channelId) {
    if (custom.allowedChannelIds) {
      try {
        const _allowed = JSON.parse(custom.allowedChannelIds);
        if (Array.isArray(_allowed) && _allowed.length > 0 && !_allowed.includes(channelId)) {
          return { ok: false, reason: 'Cette action n\'est pas disponible dans ce salon.' };
        }
      } catch {}
    }
    if (custom.blockedChannelIds) {
      try {
        const _blocked = JSON.parse(custom.blockedChannelIds);
        if (Array.isArray(_blocked) && _blocked.includes(channelId)) {
          return { ok: false, reason: 'Cette action est bloquee dans ce salon.' };
        }
      } catch {}
    }
  }

  return { ok: true };
}


async function execute(client, message, commandName) {
  const guildId = message.guild.id;

  let custom;

  try {
    custom = db.getCustomCommand(guildId, commandName);
  } catch {
    return false;
  }

  if (!custom) return false;


  if (custom.triggerByMessage === 0) return true;

  const check = _canUseCustom(message.guild, message.member, message.author.id, custom, message.channel.id);
  if (!check.ok) {
    if (!check.silent && check.reason) {
      const _permCfg   = db.getGuildConfig(guildId);
      const _permDelay = _permCfg?.autoDeleteDelay ?? 8;
      message.channel.send({
        embeds: [embed.build(guildId, check.reason, { color: '#ED4245', timestamp: false })],
        allowedMentions: { parse: [] },
      }).then(m => {
        if (m) embed.scheduleDelete(m, _permDelay);
      }).catch(() => {});
    }
    return true;
  }


  const _bypassCd = permissions.isBuyer(message.author.id) || permissions.isOwner(guildId,message.author.id)
    || (message.member && permissions.hasLevel(message.member, guildId, 9));
  const cdSeconds = Number(custom.cooldown ?? 0);

  if (cdSeconds > 0 && !_bypassCd) {
    const cdKey = `${guildId}:${message.author.id}:cc:${commandName}`;
    const now   = Date.now();
    const until = cooldownMap.get(cdKey) || 0;

    if (until > now) {
      const noticeKey   = `${guildId}:${message.author.id}:${commandName}`;
      const noticeUntil = cooldownNoticeMap.get(noticeKey) || 0;

      if (now >= noticeUntil) {
        const remainingMs = until - now;
        const seconds = Math.ceil(remainingMs / 1000);
        const _ccCfg   = db.getGuildConfig(guildId);
        const _ccDelay = _ccCfg?.autoDeleteDelay ?? 5;
        message.channel.send({
          embeds: [embed.build(guildId, `Vous êtes en cooldown. Réessayez dans **${seconds}s**.`, { color: '#ED4245', timestamp: false })],
          allowedMentions: { parse: [] },
        }).then(m => {
          if (m) embed.scheduleDelete(m, _ccDelay);
        }).catch(() => {});
        cooldownNoticeMap.set(noticeKey, now + 3000);
        setTimeout(() => cooldownNoticeMap.delete(noticeKey), 3000).unref?.();
      }

      return true;
    }

    cooldownMap.set(cdKey, now + cdSeconds * 1000);

    setTimeout(() => {
      const current = cooldownMap.get(cdKey);
      if (current && current <= Date.now()) cooldownMap.delete(cdKey);
    }, cdSeconds * 1000 + 1000).unref?.();
  }


  const targetMember = custom.targetMemberEnabled
    ? (_parseTargetMember(message, custom.name) || message.member)
    : message.member;


  try {
    if (custom.deleteMsg) {
      await message.delete().catch(() => {});
    }

    const payload = _buildPayload(custom, message, guildId, { target: targetMember });
    let sent = null;


    if (payload) {
      sent = await _sendToDestination(client, message, custom, payload);
    }


    if (sent && custom.deleteDelay && Number(custom.deleteDelay) > 0) {
      const delay = Math.min(300, Number(custom.deleteDelay)) * 1000;
      setTimeout(() => { sent.delete().catch(() => {}); }, delay).unref?.();
    }


    if (sent && custom.reactionsJson) {
      await _applyReactions(sent, custom.reactionsJson);
    }


    if (custom.rolesJson) {
      await _applyRoles(message, custom.rolesJson);
    }


    if (custom.logEnabled) {
      const logEmbed = embed.log(
        guildId,
        'Custom command',
        [
          { name: 'Commande', value: `\`${custom.name}\``,          inline: true },
          { name: 'Membre',   value: `<@${message.author.id}>`,     inline: true },
          { name: 'Salon',    value: `<#${message.channel.id}>`,    inline: true },
        ]
      );

      await _dispatchLog(client, guildId, custom, logEmbed);
    }
  } catch (err) {
    errorHandler.handle(err, {
      source : 'customCommands',
      guildId,
      userId : message.author.id,
    });
  }

  return true;
}


function _buildPayload(custom, message, guildId, opts = {}) {
  const target = opts.target || message.member || null;


  if (custom.componentsJson && V2_AVAILABLE) {
    const v2 = _buildComponentsV2Payload(custom, message, guildId, target);
    if (v2) return v2;

  }

  const payload = {
    allowedMentions: { parse: [] },
  };


  const content = _replacePlaceholders(custom.response, message, target);

  if (content) {
    payload.content = content;
  }


  if (custom.embedData) {
    try {
      const data = JSON.parse(custom.embedData);
      _walkReplaceMessagePlaceholders(data, message, target);
      const e = new EmbedBuilder(data);

      payload.embeds = [e];
    } catch {}
  }


  const components = [];

  if (custom.buttonsJson) {
    try {
      const buttons = JSON.parse(custom.buttonsJson);

      if (Array.isArray(buttons) && buttons.length > 0) {
        const row = new ActionRowBuilder();

        buttons.slice(0, MAX_BUTTONS).forEach((btn, idx) => {
          if (!btn || typeof btn !== 'object') return;
          if (!btn.label) return;

          const type = btn.type || (btn.url ? 'link' : null);

          try {
            if (type === 'link' && btn.url) {
              row.addComponents(
                new ButtonBuilder()
                  .setLabel(String(btn.label).slice(0, 80))
                  .setURL(String(btn.url))
                  .setStyle(ButtonStyle.Link)
              );
            } else if (type === 'custom' && btn.target && VALID_MODES.has(btn.mode)) {
              const style = BUTTON_STYLE_MAP[String(btn.style || '').toLowerCase()] || ButtonStyle.Primary;

              const builder = new ButtonBuilder()
                .setCustomId(`ccbtn:${guildId}:${custom.name}:${idx}`.slice(0, 100))
                .setLabel(String(btn.label).slice(0, 80))
                .setStyle(style);

              if (btn.emoji) {
                try { builder.setEmoji(String(btn.emoji)); } catch {}
              }

              row.addComponents(builder);
            }
          } catch {}
        });

        if (row.components.length > 0) {
          components.push(row);
        }
      }
    } catch {}
  }


  if (custom.selectsJson) {
    try {
      const selects = JSON.parse(custom.selectsJson);

      if (Array.isArray(selects) && selects.length > 0) {
        selects.slice(0, MAX_SELECTS).forEach((sel, selIdx) => {
          if (!sel || !Array.isArray(sel.options) || sel.options.length === 0) return;

          const validOptions = [];

          sel.options.forEach((opt, optIdx) => {
            if (optIdx >= MAX_OPTIONS) return;
            if (!opt || !opt.label || !opt.target || !VALID_MODES.has(opt.mode)) return;

            const built = {
              label: String(opt.label).slice(0, 100),
              value: String(optIdx),
            };

            if (opt.description) {
              built.description = String(opt.description).slice(0, 100);
            }

            if (opt.emoji) {
              try {
                const raw = String(opt.emoji);
                const customMatch = raw.match(/^<a?:([\w-]+):(\d{17,20})>$/);
                if (customMatch) {
                  built.emoji = { id: customMatch[2], animated: raw.startsWith('<a:') };
                } else {
                  built.emoji = { name: raw };
                }
              } catch {}
            }

            validOptions.push(built);
          });

          if (validOptions.length === 0) return;

          try {
            const builder = new StringSelectMenuBuilder()
              .setCustomId(`ccsel:${guildId}:${custom.name}:${selIdx}`.slice(0, 100))
              .setPlaceholder(String(sel.placeholder || 'Choisir une action').slice(0, 150))
              .setMinValues(1)
              .setMaxValues(1);


            let added = 0;
            for (const opt of validOptions) {
              try {
                builder.addOptions(opt);
                added++;
              } catch {
                if (opt.emoji) {
                  const stripped = { ...opt };
                  delete stripped.emoji;
                  try {
                    builder.addOptions(stripped);
                    added++;
                  } catch {}
                }
              }
            }

            if (added > 0) {
              components.push(new ActionRowBuilder().addComponents(builder));
            }
          } catch {}
        });
      }
    } catch {}
  }

  if (components.length > 0) {
    payload.components = components.slice(0, 5);
  }


  if (!payload.content && !payload.embeds?.length && !payload.components?.length) {
    return null;
  }

  return payload;
}


const V2_BUTTON_STYLE_MAP = {
  primary   : ButtonStyle.Primary,
  secondary : ButtonStyle.Secondary,
  success   : ButtonStyle.Success,
  danger    : ButtonStyle.Danger,
  link      : ButtonStyle.Link,
};

function _buildComponentsV2Payload(custom, message, guildId, target) {
  let items;
  try {
    items = JSON.parse(custom.componentsJson);
  } catch (err) {
    console.error('[customCommands] componentsJson parse failed:', custom.name, err?.message || err);
    return null;
  }
  if (!Array.isArray(items) || items.length === 0) return null;

  const accent = _v2Accent(guildId);
  const container = new ContainerBuilder();
  if (accent != null) {
    try { container.setAccentColor(accent); } catch {}
  }

  let totalCount = 1;
  let pendingButtons = [];
  const customName = custom.name;

  const flushButtons = () => {
    while (pendingButtons.length > 0 && totalCount < MAX_V2_COMPONENTS) {
      const chunk = pendingButtons.splice(0, MAX_BUTTONS_PER_ROW);
      if (totalCount + 1 + chunk.length > MAX_V2_COMPONENTS) {
        pendingButtons.unshift(...chunk);
        return;
      }
      try {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(chunk));
        totalCount += 1 + chunk.length;
      } catch {
        return;
      }
    }
  };

  for (const it of items) {
    if (!it || typeof it !== 'object' || totalCount >= MAX_V2_COMPONENTS) break;

    if (it.type === 'button') {
      const btn = _v2BuildButton(it, message, target, customName);
      if (btn) {
        pendingButtons.push(btn);
        if (pendingButtons.length >= MAX_BUTTONS_PER_ROW) flushButtons();
      }
      continue;
    }

    if (_v2IsSelect(it.type)) {
      flushButtons();
      if (totalCount + 2 > MAX_V2_COMPONENTS) break;
      const sel = _v2BuildSelect(it, customName, message?.guild ?? null);
      if (sel) {
        try {
          container.addActionRowComponents(new ActionRowBuilder().addComponents(sel));
          totalCount += 2;
        } catch {}
      }
      continue;
    }

    flushButtons();
    if (totalCount >= MAX_V2_COMPONENTS) break;

    try {
      switch (it.type) {
        case 'textDisplay': {
          const c = _replacePlaceholders(it.content || '', message, target);
          if (c.trim()) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c));
            totalCount += 1;
          }
          break;
        }
        case 'separator':
          container.addSeparatorComponents(new SeparatorBuilder());
          totalCount += 1;
          break;
        case 'mediaGallery':
          if (it.url) {
            const gallery = new MediaGalleryBuilder()
              .addItems(new MediaGalleryItemBuilder().setURL(String(it.url)));
            container.addMediaGalleryComponents(gallery);
            totalCount += 1;
          }
          break;
      }
    } catch {}
  }

  flushButtons();

  if (totalCount <= 1) return null;

  return {
    flags           : COMPONENTS_V2_FLAG,
    embeds          : [],
    components      : [container],
    allowedMentions : { parse: [] },
  };
}

function _v2HasAction(it) {


  if (Array.isArray(it?.actions) && it.actions.some(a => a && typeof a?.type === 'string' && a.type.length > 0)) {
    return true;
  }
  const t = it?.action?.type;
  return typeof t === 'string' && t.length > 0;
}

function _v2RuntimeCustomId(customName, componentId) {

  return `cccomp:${customName}:${componentId}`.slice(0, 100);
}

function _v2BuildButton(it, message, target, customName) {
  const style = V2_BUTTON_STYLE_MAP[String(it.style || '').toLowerCase()];
  if (!style) return null;
  const label = _replacePlaceholders(it.label || '', message, target).slice(0, 80) || 'Action';

  try {
    const btn = new ButtonBuilder().setLabel(label).setStyle(style);
    if (it.emoji) {
      try { btn.setEmoji(it.emoji); } catch {}
    }
    if (style === ButtonStyle.Link) {
      if (!it.url || !/^https?:\/\//i.test(it.url)) return null;
      btn.setURL(String(it.url));
    } else {
      const componentId = it.componentId;
      const hasAction = _v2HasAction(it);
      if (componentId && hasAction) {
        btn.setCustomId(_v2RuntimeCustomId(customName, componentId));
      } else {
        const cid = `cccompinert:${componentId || Math.random().toString(36).slice(2, 10)}`.slice(0, 100);
        btn.setCustomId(cid).setDisabled(true);
      }
    }
    return btn;
  } catch {
    return null;
  }
}

function _v2IsSelect(type) {
  return ['stringSelect', 'userSelect', 'roleSelect', 'channelSelect', 'mentionableSelect'].includes(type);
}


function _isRoleMapStringSelect(it) {
  if (!it || it.type !== 'stringSelect') return false;
  const ROLE_TYPES = ['role_add', 'role_remove', 'role_toggle', 'role_sync'];
  const isRoleMapAction = (a) =>
    a && typeof a.type === 'string'
    && ROLE_TYPES.includes(a.type)
    && !(a.roleId && String(a.roleId).trim());
  if (Array.isArray(it.actions) && it.actions.some(isRoleMapAction)) return true;
  if (it.action && isRoleMapAction(it.action)) return true;
  return false;
}

function _v2BuildSelect(it, customName, guild = null) {
  const placeholder = it.placeholder ? String(it.placeholder).slice(0, 150) : null;
  const componentId = it.componentId;
  const hasAction   = _v2HasAction(it);
  const activeId    = (componentId && hasAction)
    ? _v2RuntimeCustomId(customName, componentId)
    : null;
  const baseId = activeId || `cccompinert:${it.type}:${componentId || Math.random().toString(36).slice(2, 10)}`.slice(0, 100);
  const disabled = !activeId;

  const _applyMinMax = (s, defaultMin) => {
    try {
      const min = it.minValues !== undefined ? Number(it.minValues) : defaultMin;
      const max = it.maxValues !== undefined ? Number(it.maxValues) : 1;
      if (!isNaN(min) && min >= 0) s.setMinValues(min);
      if (!isNaN(max) && max >= 1) s.setMaxValues(max);
    } catch {}
  };

  try {
    if (it.type === 'stringSelect') {
      if (!Array.isArray(it.options) || it.options.length === 0) return null;
      let opts = it.options.slice(0, 25).map(o => ({
        label : String(o.label || '').slice(0, 100),
        value : String(o.value || '').slice(0, 100),
      })).filter(o => o.label && o.value);


      if (guild && _isRoleMapStringSelect(it)) {
        opts = opts.filter(o => {
          if (!/^\d{17,20}$/.test(o.value)) return true;
          return guild.roles?.cache?.has(o.value);
        });
      }

      if (opts.length === 0) return null;
      if (opts.length < 2) return null;
      const s = new StringSelectMenuBuilder()
        .setCustomId(baseId)
        .setDisabled(disabled)
        .addOptions(opts);
      if (placeholder) s.setPlaceholder(placeholder);
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'userSelect') {
      const s = new UserSelectMenuBuilder().setCustomId(baseId).setDisabled(disabled);
      if (placeholder) s.setPlaceholder(placeholder);
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'roleSelect') {
      const s = new RoleSelectMenuBuilder().setCustomId(baseId).setDisabled(disabled);
      if (placeholder) s.setPlaceholder(placeholder);
      _applyMinMax(s, 0);
      return s;
    }
    if (it.type === 'channelSelect') {
      const s = new ChannelSelectMenuBuilder()
        .setCustomId(baseId)
        .setDisabled(disabled)
        .addChannelTypes(..._resolveChannelTypes(it.channelTypes));
      if (placeholder) s.setPlaceholder(placeholder);
      _applyMinMax(s, 1);
      return s;
    }
    if (it.type === 'mentionableSelect') {
      const s = new MentionableSelectMenuBuilder().setCustomId(baseId).setDisabled(disabled);
      if (placeholder) s.setPlaceholder(placeholder);
      _applyMinMax(s, 0);
      return s;
    }
  } catch {}
  return null;
}

function _v2Accent(guildId) {
  try {
    const hex = embed.getGuildColor(guildId);
    if (typeof hex !== 'string') return null;
    const m = hex.replace(/^#/, '').match(/^[0-9a-fA-F]{6}$/);
    return m ? parseInt(m[0], 16) : null;
  } catch {
    return null;
  }
}

function _replacePlaceholders(text, message, target = null) {
  if (!text) return '';

  const member = message.member;
  const user   = message.author;


  const tMember = target || member;
  const tUser   = tMember?.user || user;
  const tId     = tMember?.id ?? tUser.id;
  const tName   = tUser.username;
  const tDisp   = tMember?.displayName || tUser.globalName || tUser.username;
  const tAvatar = tUser.displayAvatarURL ? tUser.displayAvatarURL({ size: 1024 }) : '';

  return replaceVariables(String(text), {
    user,
    member,
    guild  : message.guild,
    client : message.client,
    extras : {
      channel           : `<#${message.channel.id}>`,
      TargetMention     : `<@${tId}>`,
      TargetName        : tName,
      TargetDisplayName : tDisp,
      TargetID          : tId,
      TargetPic         : tAvatar,
    },
  });
}


function _walkReplaceMessagePlaceholders(obj, message, target = null) {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (typeof val === 'string') {
      obj[key] = _replacePlaceholders(val, message, target);
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (typeof val[i] === 'string') {
          val[i] = _replacePlaceholders(val[i], message, target);
        } else if (val[i] && typeof val[i] === 'object') {
          _walkReplaceMessagePlaceholders(val[i], message, target);
        }
      }
    } else if (val && typeof val === 'object') {
      _walkReplaceMessagePlaceholders(val, message, target);
    }
  }
}


function _parseTargetMember(message, commandName) {

  const mentioned = message.mentions?.members?.first?.();
  if (mentioned && mentioned.id !== message.author.id) return mentioned;


  const content = String(message.content || '');

  const stripped = content.replace(new RegExp(`^[^\\s]+\\s*${commandName}\\s*`, 'i'), '');
  const idMatch = stripped.match(/(\d{17,20})/);
  if (!idMatch) return null;

  const id = idMatch[1];
  if (id === message.author.id) return null;

  return message.guild?.members?.cache?.get(id) || null;
}


function _resolveResponseMode(custom) {
  const explicit = String(custom.responseMode || '').toLowerCase();
  if (explicit === 'local' || explicit === 'dm' || explicit === 'fixed' || explicit === 'remote') {
    return explicit;
  }
  return custom.dmResponse ? 'dm' : 'local';
}


async function _sendToDestination(client, message, custom, payload) {
  const mode = _resolveResponseMode(custom);

  if (mode === 'dm') {
    const sent = await message.author.send(payload).catch(() => null);
    if (!sent) {
      await message.channel.send({
        content         : `<@${message.author.id}>, impossible de vous envoyer un MP.`,
        allowedMentions : { users: [message.author.id] },
      }).catch(() => {});
    }
    return sent;
  }

  if ((mode === 'fixed' || mode === 'remote') && custom.responseChannelId) {
    let target = null;
    try {
      target = message.guild?.channels?.cache?.get(custom.responseChannelId)
        || await client.channels.fetch(custom.responseChannelId).catch(() => null);
    } catch {}

    if (target && typeof target.send === 'function') {
      const sent = await target.send(payload).catch(() => null);
      if (sent) return sent;
    }


    if (mode === 'fixed') {
      await message.channel.send({
        content        : `<@${message.author.id}>, le salon de réponse configuré est inaccessible.`,
        allowedMentions: { users: [message.author.id] },
      }).catch(() => {});
      return null;
    }

  }

  return message.channel.send(payload).catch(() => null);
}


async function _dispatchLog(client, guildId, custom, logEmbed) {
  if (custom.logChannelId) {
    try {
      const ch = client.channels.cache.get(custom.logChannelId)
        || await client.channels.fetch(custom.logChannelId).catch(() => null);
      if (ch && typeof ch.send === 'function') {
        const ok = await ch.send({ embeds: [logEmbed], allowedMentions: { parse: [] } }).catch(() => null);
        if (ok) return;
      }
    } catch {}
  }
  await logger.send(client, guildId, 'modlog', logEmbed);
}

async function _applyReactions(msg, reactionsJson) {
  try {
    const reactions = JSON.parse(reactionsJson);

    if (!Array.isArray(reactions)) return;

    for (const emoji of reactions.slice(0, MAX_REACTIONS)) {
      if (!emoji) continue;
      await msg.react(emoji).catch(() => {});
    }
  } catch {}
}

async function _applyRoles(message, rolesJson) {
  try {
    const roles = JSON.parse(rolesJson);

    if (!Array.isArray(roles)) return;

    const guild  = message.guild;
    const member = message.member;

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return;

    for (const entry of roles.slice(0, MAX_ROLES)) {
      if (!entry?.roleId || !entry?.action) continue;

      const role = guild.roles.cache.get(entry.roleId);

      if (!role) continue;
      if (role.managed) continue;
      if (role.id === guild.id) continue;
      if (role.position >= me.roles.highest.position) continue;

      if (entry.action === 'add') {
        await member.roles.add(role, 'Custom command').catch(() => {});
      } else if (entry.action === 'remove') {
        await member.roles.remove(role, 'Custom command').catch(() => {});
      } else if (entry.action === 'toggle') {
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role, 'Custom command').catch(() => {});
        } else {
          await member.roles.add(role, 'Custom command').catch(() => {});
        }
      }
    }
  } catch {}
}

function buildReminderPayload(custom, context = {}) {
  const payload = {
    allowedMentions: { parse: [] },
  };

  if (custom.response) {
    payload.content = _applyReminderPlaceholders(custom.response, context);
  }

  if (custom.embedData) {
    try {
      const data = JSON.parse(custom.embedData);
      _walkReplacePlaceholders(data, context);
      payload.embeds = [new EmbedBuilder(data)];
    } catch {}
  }

  if (custom.buttonsJson) {
    try {
      const buttons = JSON.parse(custom.buttonsJson);

      if (Array.isArray(buttons) && buttons.length > 0) {
        const row = new ActionRowBuilder();

        for (const btn of buttons.slice(0, MAX_BUTTONS)) {
          if (!btn.label || !btn.url) continue;

          try {
            row.addComponents(
              new ButtonBuilder()
                .setLabel(String(btn.label).slice(0, 80))
                .setURL(String(btn.url))
                .setStyle(ButtonStyle.Link)
            );
          } catch {}
        }

        if (row.components.length > 0) {
          payload.components = [row];
        }
      }
    } catch {}
  }

  if (!payload.content && !payload.embeds?.length) {
    payload.content = '\u200b';
  }

  return payload;
}

function _applyReminderPlaceholders(text, ctx) {
  if (!text || typeof text !== 'string') return text;

  return replaceVariables(text, {
    extras: {
      server   : ctx.guildName  || '',
      guild    : ctx.guildName  || '',
      channel  : ctx.channelName || '',
      user     : ctx.userMention || '',
      username : ctx.username    || '',
    },
  });
}

function _walkReplacePlaceholders(obj, ctx) {
  if (!obj || typeof obj !== 'object') return;

  const keys = Object.keys(obj);

  for (const key of keys) {
    const val = obj[key];

    if (typeof val === 'string') {
      obj[key] = _applyReminderPlaceholders(val, ctx);
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (typeof val[i] === 'string') {
          val[i] = _applyReminderPlaceholders(val[i], ctx);
        } else if (val[i] && typeof val[i] === 'object') {
          _walkReplacePlaceholders(val[i], ctx);
        }
      }
    } else if (val && typeof val === 'object') {
      _walkReplacePlaceholders(val, ctx);
    }
  }
}

async function applyReminderReactions(sent, custom) {
  if (!sent || !custom?.reactionsJson) return;
  await _applyReactions(sent, custom.reactionsJson);
}


async function executeFromInteraction(client, interaction, targetKeyword, mode) {
  if (!VALID_MODES.has(mode)) mode = 'follow';

  const guild = interaction.guild;
  if (!guild) return _ephemeral(interaction, 'Action indisponible.');

  const guildId = guild.id;

  let custom;
  try {
    custom = db.getCustomCommand(guildId, targetKeyword);
  } catch {
    return _ephemeral(interaction, 'Action introuvable.');
  }

  if (!custom) {
    return _ephemeral(interaction, 'Action introuvable.');
  }

  const check2 = _canUseCustom(guild, interaction.member, interaction.user.id, custom, interaction.channelId);
  if (!check2.ok) {
    return _ephemeral(interaction, check2.reason || 'Action indisponible.');
  }

  const _bypassCd2 = permissions.isBuyer(interaction.user.id) || permissions.isOwner(guildId,interaction.user.id)
    || (interaction.member && permissions.hasLevel(interaction.member, guildId, 9));
  const cdSeconds = Number(custom.cooldown ?? 0);

  if (cdSeconds > 0 && !_bypassCd2) {
    const cdKey = `${guildId}:${interaction.user.id}:cc:${custom.name}`;
    const now   = Date.now();
    const until = cooldownMap.get(cdKey) || 0;

    if (until > now) {
      const remaining = Math.ceil((until - now) / 1000);
      return _ephemeral(interaction, `Patientez ${remaining}s avant de réutiliser cette action.`);
    }

    cooldownMap.set(cdKey, now + cdSeconds * 1000);

    setTimeout(() => {
      const current = cooldownMap.get(cdKey);
      if (current && current <= Date.now()) cooldownMap.delete(cdKey);
    }, cdSeconds * 1000 + 1000).unref?.();
  }


  const fakeMessage = {
    author : interaction.user,
    member : interaction.member,
    guild  : interaction.guild,
    channel: interaction.channel,
  };

  const payload = _buildPayload(custom, fakeMessage, guildId);

  if (custom.rolesJson) {
    await _applyRoles(fakeMessage, custom.rolesJson);
  }

  if (custom.logEnabled) {
    try {
      const logEmbed = embed.log(
        guildId,
        'Custom command (interaction)',
        [
          { name: 'Commande', value: `\`${custom.name}\``,            inline: true },
          { name: 'Membre',   value: `<@${interaction.user.id}>`,     inline: true },
          { name: 'Salon',    value: `<#${interaction.channel.id}>`,  inline: true },
        ]
      );

      await _dispatchLog(client, guildId, custom, logEmbed);
    } catch {}
  }


  if (!payload) {
    if (mode === 'replace') {
      return interaction.deferUpdate().catch(() => {});
    }
    return _ephemeral(interaction, 'Action exécutée.');
  }


  payload.allowedMentions = { parse: [] };


  if (mode === 'replace' && COMPONENTS_V2_FLAG && payload.flags === COMPONENTS_V2_FLAG) {
    mode = 'follow';
  }

  try {
    if (mode === 'replace') {
      return await interaction.update(payload);
    }

    if (mode === 'ephemeral') {
      return await interaction.reply({ ...payload, flags: 64 });
    }

    return await interaction.reply(payload);
  } catch (err) {
    errorHandler.handle(err, {
      source : 'customCommands.executeFromInteraction',
      guildId,
      userId : interaction.user.id,
    });

    return _ephemeral(interaction, 'Impossible d\'exécuter cette action.');
  }
}

async function _ephemeral(interaction, content) {
  const guildId = interaction.guild?.id;
  try {
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({
        embeds : [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
        flags  : 64,
      }).catch(() => {});
    }
    return interaction.reply({
      embeds : [embed.build(guildId, content, { color: '#ED4245', timestamp: false })],
      flags  : 64,
    }).catch(() => {});
  } catch {}
}


function buildPreviewPayload(custom, contextLike, guildId) {
  return _buildPayload(custom, contextLike, guildId);
}


async function executeComponentAction(client, interaction) {
  const guild = interaction.guild;
  const guildId = guild?.id;
  if (!guildId) return _ephemeral(interaction, 'Action indisponible.');

  const cid = interaction.customId || '';
  const parts = cid.split(':');
  if (parts.length < 3 || parts[0] !== 'cccomp') {
    return _ephemeral(interaction, 'Composant invalide.');
  }
  const customName  = parts[1];
  const componentId = parts.slice(2).join(':');


  const _dblKey = `${interaction.user.id}:${interaction.message?.id || ''}:${componentId}`;
  const _dblNow = Date.now();
  const _dblExpires = recentClicksMap.get(_dblKey);
  if (_dblExpires && _dblExpires > _dblNow) {
    return _ephemeral(interaction, 'Action déjà en cours, réessayez dans un instant.');
  }
  _pruneRecentClicks();
  recentClicksMap.set(_dblKey, _dblNow + DOUBLE_CLICK_TTL_MS);
  setTimeout(() => {
    const cur = recentClicksMap.get(_dblKey);
    if (cur && cur <= Date.now()) recentClicksMap.delete(_dblKey);
  }, DOUBLE_CLICK_TTL_MS + 50).unref?.();

  let custom;
  try {
    custom = db.getCustomCommand(guildId, customName);
  } catch {
    return _ephemeral(interaction, 'Custom introuvable.');
  }
  if (!custom) return _ephemeral(interaction, 'Custom introuvable.');
  if (!custom.componentsJson) return _ephemeral(interaction, 'Aucun component lie a cette custom.');

  const check3 = _canUseCustom(guild, interaction.member, interaction.user.id, custom, interaction.channelId);
  if (!check3.ok) {
    return _ephemeral(interaction, check3.reason || 'Action indisponible.');
  }

  let items;
  try { items = JSON.parse(custom.componentsJson); } catch {
    return _ephemeral(interaction, 'Configuration invalide.');
  }
  if (!Array.isArray(items)) return _ephemeral(interaction, 'Configuration invalide.');

  let item = items.find(it => it && it.componentId === componentId);
  if (!item && custom.componentsPagesJson) {
    try {
      const _pages = JSON.parse(custom.componentsPagesJson);
      if (_pages && typeof _pages === 'object') {
        for (const pItems of Object.values(_pages)) {
          if (!Array.isArray(pItems)) continue;
          const found = pItems.find(it => it && it.componentId === componentId);
          if (found) { item = found; break; }
        }
      }
    } catch {}
  }
  if (!item) return _ephemeral(interaction, 'Component introuvable.');


  const multiActions = Array.isArray(item.actions)
    ? item.actions.filter(a => a && typeof a.type === 'string')
    : [];
  const action = item.action;
  if (multiActions.length === 0 && (!action || !action.type)) {
    return _ephemeral(interaction, 'Aucune action configuree.');
  }


  const _bypassCd3 = permissions.isBuyer(interaction.user.id) || permissions.isOwner(guildId,interaction.user.id)
    || (interaction.member && permissions.hasLevel(interaction.member, guildId, 9));
  const cdSeconds = Number(custom.cooldown ?? 0);
  if (cdSeconds > 0 && !_bypassCd3) {
    const cdKey = `${guildId}:${interaction.user.id}:cc:${custom.name}`;
    const now   = Date.now();
    const until = cooldownMap.get(cdKey) || 0;
    if (until > now) {
      const remaining = Math.ceil((until - now) / 1000);
      return _ephemeral(interaction, `Patientez ${remaining}s.`);
    }
    cooldownMap.set(cdKey, now + cdSeconds * 1000);
    setTimeout(() => {
      const current = cooldownMap.get(cdKey);
      if (current && current <= Date.now()) cooldownMap.delete(cdKey);
    }, cdSeconds * 1000 + 1000).unref?.();
  }

  const selected = _resolveSelected(interaction, item);


  {
    const _isRoleSel = interaction.isRoleSelectMenu?.() || interaction.isMentionableSelectMenu?.();
    if (_isRoleSel) {
      const _rKey = _roleCacheKey(
        guildId, interaction.message?.id, customName, componentId, interaction.user.id,
      );
      const _clearedRoles = (interaction.roles?.size ?? 0) === 0;
      const _clearedUsers = interaction.isMentionableSelectMenu?.()
        ? (interaction.users?.size ?? 0) === 0
        : true;
      if (_clearedRoles && _clearedUsers) {
        selected.cleared = true;
        const _cachedArr = _getRoleCache(_rKey);
        if (_cachedArr && _cachedArr.length > 0) {
          selected._cachedRoleIds = _cachedArr;
          selected.SelectedID      = _cachedArr[0];
          selected.SelectedValue   = _cachedArr[0];
          selected.SelectedMention = `<@&${_cachedArr[0]}>`;
          _delRoleCache(_rKey);
        }
      } else {

        const _selRoleIds = interaction.roles ? [...interaction.roles.keys()] : [];
        if (_selRoleIds.length > 0) _setRoleCache(_rKey, _selRoleIds);
      }
    }
  }


  if (multiActions.length > 0) {
    try {
      await _executeMultiActions(interaction, multiActions, selected, custom, item);
    } catch (err) {
      errorHandler.handle(err, {
        source : 'customCommands.executeComponentAction.multi',
        guildId,
        userId : interaction.user.id,
      });
      await _multiWarn(interaction, 'Erreur lors de l\'exécution multi-actions.');
    }

    if (custom.logEnabled) {
      try {
        const logEmbed = embed.log(
          guildId,
          'Custom command (component multi)',
          [
            { name: 'Commande',  value: `\`${custom.name}\``, inline: true },
            { name: 'Component', value: `\`${componentId}\``, inline: true },
            { name: 'Actions',   value: multiActions.map(a => `\`${a.type}\``).join(', ').slice(0, 1024), inline: false },
            { name: 'Membre',    value: `<@${interaction.user.id}>`, inline: true },
          ]
        );
        await _dispatchLog(client, guildId, custom, logEmbed);
      } catch {}
    }
    return;
  }

  try {
    switch (action.type) {
      case 'none':
        await interaction.deferUpdate().catch(() => {});
        break;
      case 'reply':
        await _execActionReply(interaction, action, selected);
        break;
      case 'dm':

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }).catch(() => {});
        }
        await _execActionDm(interaction, action, selected);
        break;
      case 'role_toggle':
      case 'role_add':
      case 'role_remove':

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }).catch(() => {});
        }
        await _execActionRole(interaction, action, action.type, selected);
        break;
      case 'role_sync':
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }).catch(() => {});
        }
        await _execActionRoleSync(interaction, action, item, selected);
        break;
      case 'channel_send':

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }).catch(() => {});
        }
        await _execActionChannelSend(interaction, action, selected);
        break;
      case 'edit_page':
        await _execActionEditPage(interaction, action, custom);
        break;
      case 'delete_message':
        await _execActionDeleteMessage(interaction);
        break;
      default:
        return _ephemeral(interaction, 'Type d\'action inconnu.');
    }
  } catch (err) {
    errorHandler.handle(err, {
      source : 'customCommands.executeComponentAction',
      guildId,
      userId : interaction.user.id,
    });
    return _ephemeral(interaction, 'Erreur lors de l\'exécution.');
  }

  if (custom.logEnabled) {
    try {
      const logEmbed = embed.log(
        guildId,
        'Custom command (component)',
        [
          { name: 'Commande',    value: `\`${custom.name}\``, inline: true },
          { name: 'Component',   value: `\`${componentId}\``, inline: true },
          { name: 'Action',      value: `\`${action.type}\``, inline: true },
          { name: 'Membre',      value: `<@${interaction.user.id}>`, inline: true },
        ]
      );
      await _dispatchLog(client, guildId, custom, logEmbed);
    } catch {}
  }
}

function _resolveSelected(interaction, item) {
  const out = {
    SelectedValue    : '',
    SelectedLabel    : '',
    SelectedID       : '',
    SelectedMention  : '',
    SelectedName     : '',
    SelectedValues   : '',
    SelectedLabels   : '',
    SelectedIDs      : '',
    SelectedMentions : '',
    SelectedNames    : '',
  };
  try {
    if (interaction.isStringSelectMenu?.()) {
      const vals = interaction.values || [];
      const v = vals[0] || '';
      out.SelectedValue = v;
      out.SelectedID    = v;
      const opt = (item.options || []).find(o => String(o.value) === v);
      out.SelectedLabel = opt?.label || v;
      out.SelectedName  = opt?.label || v;
      out.SelectedValues   = vals.join(', ');
      out.SelectedIDs      = vals.join(', ');
      out.SelectedMentions = vals.join(', ');
      out.SelectedLabels   = vals.map(vv => {
        const o2 = (item.options || []).find(oo => String(oo.value) === vv);
        return o2?.label || vv;
      }).join(', ');
      out.SelectedNames    = vals.map(vv => {
        const o = (item.options || []).find(oo => String(oo.value) === vv);
        return o?.label || vv;
      }).join(', ');
      return out;
    }
    if (interaction.isUserSelectMenu?.()) {
      const users = interaction.users ? [...interaction.users.values()] : [];
      const u = users[0];
      if (u) {
        out.SelectedID      = u.id;
        out.SelectedMention = `<@${u.id}>`;
        out.SelectedName    = u.username;
        out.SelectedLabel   = u.username;
        out.SelectedValue   = u.id;
      }
      out.SelectedValues   = users.map(x => x.id).join(', ');
      out.SelectedIDs      = users.map(x => x.id).join(', ');
      out.SelectedLabels   = users.map(x => x.username).join(', ');
      out.SelectedMentions = users.map(x => `<@${x.id}>`).join(', ');
      out.SelectedNames    = users.map(x => x.username).join(', ');
      return out;
    }
    if (interaction.isRoleSelectMenu?.()) {
      const roles = interaction.roles ? [...interaction.roles.values()] : [];
      const r = roles[0];
      if (r) {
        out.SelectedID      = r.id;
        out.SelectedMention = `<@&${r.id}>`;
        out.SelectedName    = r.name;
        out.SelectedLabel   = r.name;
        out.SelectedValue   = r.id;
      }
      out.SelectedValues   = roles.map(x => x.id).join(', ');
      out.SelectedIDs      = roles.map(x => x.id).join(', ');
      out.SelectedLabels   = roles.map(x => x.name).join(', ');
      out.SelectedMentions = roles.map(x => `<@&${x.id}>`).join(', ');
      out.SelectedNames    = roles.map(x => x.name).join(', ');
      return out;
    }
    if (interaction.isChannelSelectMenu?.()) {
      const channels = interaction.channels ? [...interaction.channels.values()] : [];
      const c = channels[0];
      if (c) {
        out.SelectedID      = c.id;
        out.SelectedMention = `<#${c.id}>`;
        out.SelectedName    = c.name || c.id;
        out.SelectedLabel   = c.name || c.id;
        out.SelectedValue   = c.id;
      }
      out.SelectedValues   = channels.map(x => x.id).join(', ');
      out.SelectedIDs      = channels.map(x => x.id).join(', ');
      out.SelectedLabels   = channels.map(x => x.name || x.id).join(', ');
      out.SelectedMentions = channels.map(x => `<#${x.id}>`).join(', ');
      out.SelectedNames    = channels.map(x => x.name || x.id).join(', ');
      return out;
    }
    if (interaction.isMentionableSelectMenu?.()) {
      const users = interaction.users ? [...interaction.users.values()] : [];
      const roles = interaction.roles ? [...interaction.roles.values()] : [];
      const u = users[0];
      const r = roles[0];
      if (u) {
        out.SelectedID      = u.id;
        out.SelectedMention = `<@${u.id}>`;
        out.SelectedName    = u.username;
        out.SelectedLabel   = u.username;
        out.SelectedValue   = u.id;
      } else if (r) {
        out.SelectedID      = r.id;
        out.SelectedMention = `<@&${r.id}>`;
        out.SelectedName    = r.name;
        out.SelectedLabel   = r.name;
        out.SelectedValue   = r.id;
      }
      const allMentions = [
        ...users.map(x => `<@${x.id}>`),
        ...roles.map(x => `<@&${x.id}>`),
      ];
      const allNames = [
        ...users.map(x => x.username),
        ...roles.map(x => x.name),
      ];
      const allValues = [
        ...users.map(x => x.id),
        ...roles.map(x => x.id),
      ];
      out.SelectedValues   = allValues.join(', ');
      out.SelectedIDs      = allValues.join(', ');
      out.SelectedLabels   = allNames.join(', ');
      out.SelectedMentions = allMentions.join(', ');
      out.SelectedNames    = allNames.join(', ');
      return out;
    }
  } catch {}
  return out;
}

function _replaceActionVars(text, interaction, selected) {
  if (!text) return '';
  const u = interaction.user;
  const m = interaction.member;
  const g = interaction.guild;
  const map = {
    UserMention      : `<@${u.id}>`,
    UserName         : u.username,
    UserDisplayName  : m?.displayName || u.globalName || u.username,
    UserID           : u.id,
    ServerName       : g?.name || '',
    SelectedValue    : selected.SelectedValue,
    SelectedLabel    : selected.SelectedLabel,
    SelectedID       : selected.SelectedID,
    SelectedMention  : selected.SelectedMention,
    SelectedName     : selected.SelectedName,
    SelectedValues   : selected.SelectedValues   || selected.SelectedValue,
    SelectedLabels   : selected.SelectedLabels   || selected.SelectedLabel,
    SelectedIDs      : selected.SelectedIDs      || selected.SelectedID,
    SelectedMentions : selected.SelectedMentions || selected.SelectedMention,
    SelectedNames    : selected.SelectedNames    || selected.SelectedName,
  };
  return String(text).replace(/\{(\w+)\}/g, (full, key) => (key in map ? map[key] : full));
}

async function _execActionReply(interaction, action, selected) {
  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return _ephemeral(interaction, 'Réponse vide.');
  const ephemeral = (action.mode || 'ephemeral') !== 'public';
  return interaction.reply({
    content,
    flags : ephemeral ? 64 : undefined,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _execActionDm(interaction, action, selected) {
  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return _ephemeral(interaction, 'Réponse vide.');
  try {
    await interaction.user.send({ content, allowedMentions: { parse: [] } });
    return _ackOrFollow(interaction, {
      embeds : [embed.build(interaction.guild?.id, 'Message envoyé en MP.', { timestamp: false })],
      flags  : 64,
    });
  } catch {
    return _ephemeral(interaction, 'Impossible d\'envoyer le MP (DM fermés ?).');
  }
}

async function _execActionChannelSend(interaction, action, selected) {
  const guild = interaction.guild;
  if (!guild) return _ephemeral(interaction, 'Action indisponible.');

  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return _ephemeral(interaction, 'Reponse vide.');

  const fixedId = (action.channelId || '').trim();
  const channelIds = [];

  if (fixedId) {
    channelIds.push(fixedId);
  } else if (interaction.isChannelSelectMenu?.()) {
    const channels = interaction.channels ? [...interaction.channels.values()] : [];
    for (const c of channels) channelIds.push(c.id);
  }

  if (!channelIds.length) return _ephemeral(interaction, 'Salon ID requis.');

  const me = guild.members.me;
  const sent = [];
  for (const cid of channelIds) {
    if (!/^\d{17,20}$/.test(cid)) continue;
    const ch = guild.channels.cache.get(cid)
      || await guild.channels.fetch(cid).catch(() => null);
    if (!ch || typeof ch.send !== 'function') continue;
    if (me && ch.permissionsFor && !ch.permissionsFor(me).has('SendMessages')) continue;
    try {
      await ch.send({ content, allowedMentions: { parse: [] } });
      sent.push(`<#${cid}>`);
    } catch {}
  }

  if (!sent.length) return _ephemeral(interaction, 'Aucun salon valide ou permission manquante.');

  return _ackOrFollow(interaction, {
    embeds : [embed.build(guild.id, `Message envoye dans ${sent.join(', ')}.`, { timestamp: false })],
    flags  : 64,
  });
}

async function _execActionDeleteMessage(interaction) {


  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {});
  }
  try {
    if (interaction.message?.deletable) {
      await interaction.message.delete().catch(() => {});
      return;
    }
  } catch {}
  return _ephemeral(interaction, 'Impossible de supprimer ce message.');
}

async function _execActionEditPage(interaction, action, custom) {
  const pageName = (action.response || '').trim().toLowerCase();
  if (!pageName) return _ephemeral(interaction, 'Page introuvable.');

  let items;
  if (pageName === 'main') {
    if (!custom.componentsJson) return _ephemeral(interaction, 'Page introuvable.');
    try { items = JSON.parse(custom.componentsJson); } catch {
      return _ephemeral(interaction, 'Page invalide.');
    }
  } else {
    if (!custom.componentsPagesJson) return _ephemeral(interaction, 'Page introuvable.');
    try {
      const _pages = JSON.parse(custom.componentsPagesJson);
      items = _pages[pageName];
    } catch {
      return _ephemeral(interaction, 'Page invalide.');
    }
  }

  if (!Array.isArray(items) || items.length === 0) return _ephemeral(interaction, 'Page introuvable.');

  const _gId = interaction.guild.id;
  const _fakeMsg = {
    guild  : interaction.guild,
    member : interaction.member,
    author : interaction.user,
    channel: interaction.channel,
  };
  const _fakeCustom = { ...custom, componentsJson: JSON.stringify(items) };
  const _payload = _buildComponentsV2Payload(_fakeCustom, _fakeMsg, _gId, null);
  if (!_payload) return _ephemeral(interaction, 'Page invalide.');

  if (!interaction.deferred && !interaction.replied) {
    await interaction.update(_payload).catch(async () => {
      await _ephemeral(interaction, 'Impossible de changer la page.');
    });
  } else {


    const _editPayload = { components: _payload.components };
    if (_payload.allowedMentions) _editPayload.allowedMentions = _payload.allowedMentions;
    await interaction.message?.edit(_editPayload).catch(() => {});
  }
}


async function _executeMultiActions(interaction, actions, selected, custom = null, item = null) {


  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 64 }).catch(() => {});
  }

  let _stopSeq = false;
  for (const action of actions) {
    if (_stopSeq) break;
    try {
      switch (action.type) {
        case 'none':
          break;
        case 'reply':
          await _execMultiReply(interaction, action, selected);
          break;
        case 'dm':
          await _execMultiDm(interaction, action, selected);
          break;
        case 'channel_send':
          await _execMultiChannelSend(interaction, action, selected);
          break;
        case 'role_add':
        case 'role_remove':
        case 'role_toggle':
          await _execMultiRole(interaction, action, action.type, selected);
          break;
        case 'role_sync':
          await _execMultiRoleSync(interaction, action, item, selected);
          break;
        case 'edit_page':
          if (custom) await _execActionEditPage(interaction, action, custom);
          _stopSeq = true;
          break;
        case 'delete_message':
          await _execMultiDelete(interaction);
          break;
        default:
          await _multiWarn(interaction, `Action inconnue : \`${action.type}\`.`);
          break;
      }
    } catch (err) {
      errorHandler.handle(err, {
        source : 'customCommands.executeMultiActions.step',
        type   : action?.type,
      });
      await _multiWarn(interaction, `Échec de l'étape \`${action?.type || '?'}\`.`);
    }
  }


  await interaction.editReply({ content: '\u200b', flags: 64 }).catch(() => {});
}

async function _execMultiReply(interaction, action, selected) {
  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return;
  const ephemeral = (action.mode || 'ephemeral') !== 'public';
  await interaction.followUp({
    content,
    flags : ephemeral ? 64 : undefined,
    allowedMentions : { parse: [] },
  }).catch(() => {});
}

async function _execMultiDm(interaction, action, selected) {
  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return;
  try {
    await interaction.user.send({ content, allowedMentions: { parse: [] } });
  } catch {
    await _multiWarn(interaction, 'MP impossible (DM fermés ?).');
  }
}

async function _execMultiChannelSend(interaction, action, selected) {
  const guild = interaction.guild;
  if (!guild) return;
  const content = _replaceActionVars(action.response || '', interaction, selected).slice(0, 2000);
  if (!content) return;

  const fixedId = (action.channelId || '').trim();
  const channelIds = [];
  if (fixedId) {
    channelIds.push(fixedId);
  } else if (interaction.isChannelSelectMenu?.()) {
    const channels = interaction.channels ? [...interaction.channels.values()] : [];
    for (const c of channels) channelIds.push(c.id);
  }
  if (!channelIds.length) {
    return _multiWarn(interaction, 'channel_send : Salon ID requis.');
  }

  const me = guild.members.me;
  let ok = false;
  for (const cid of channelIds) {
    if (!/^\d{17,20}$/.test(cid)) continue;
    const channel = guild.channels.cache.get(cid)
      || await guild.channels.fetch(cid).catch(() => null);
    if (!channel || typeof channel.send !== 'function') continue;
    if (me && channel.permissionsFor && !channel.permissionsFor(me).has('SendMessages')) continue;
    try {
      await channel.send({ content, allowedMentions: { parse: [] } });
      ok = true;
    } catch {}
  }
  if (!ok) return _multiWarn(interaction, 'channel_send : aucun salon valide.');
}

async function _execMultiRole(interaction, action, type, selected = {}) {
  if (selected.cleared === true) {
    const cachedIds = selected._cachedRoleIds || (selected.SelectedID ? [selected.SelectedID] : []);
    if (!cachedIds.length) {
      return _multiWarn(interaction, 'role_* : aucun role a retirer.');
    }
    type = 'role_remove';
  }

  const guild   = interaction.guild;
  const clicker = interaction.member;
  if (!guild || !clicker) return _multiWarn(interaction, 'role_* : membre indisponible.');

  const me = guild.members.me;
  if (!me?.permissions?.has?.('ManageRoles')) {
    return _multiWarn(interaction, 'role_* : ManageRoles manquant.');
  }

  const pairs = [];
  const fixedRoleId = (action.roleId || '').trim();

  if (selected.cleared === true) {
    const cachedIds = selected._cachedRoleIds || (selected.SelectedID ? [selected.SelectedID] : []);
    for (const rid of cachedIds) pairs.push({ member: clicker, roleId: rid });
  } else if (interaction.isChannelSelectMenu?.()) {
    return _multiWarn(interaction, 'role_* : composant incompatible.');
  } else if (interaction.isRoleSelectMenu?.()) {
    if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      const roles = interaction.roles ? [...interaction.roles.values()] : [];
      if (!roles.length) return _multiWarn(interaction, 'role_* : selectionnez un role.');
      for (const r of roles) pairs.push({ member: clicker, roleId: r.id });
    }
  } else if (interaction.isUserSelectMenu?.()) {
    if (!fixedRoleId) return _multiWarn(interaction, 'role_* : Role ID requis.');
    const users = interaction.users ? [...interaction.users.values()] : [];
    if (!users.length) return _multiWarn(interaction, 'role_* : selectionnez un utilisateur.');
    for (const u of users) {
      const m2 = await guild.members.fetch(u.id).catch(() => null);
      if (m2) pairs.push({ member: m2, roleId: fixedRoleId });
    }
    if (!pairs.length) return _multiWarn(interaction, 'role_* : membre introuvable.');
  } else if (interaction.isMentionableSelectMenu?.()) {
    const selRoles = interaction.roles ? [...interaction.roles.values()] : [];
    const selUsers = interaction.users ? [...interaction.users.values()] : [];
    if (fixedRoleId && selUsers.length) {
      for (const u of selUsers) {
        const m2 = await guild.members.fetch(u.id).catch(() => null);
        if (m2) pairs.push({ member: m2, roleId: fixedRoleId });
      }
      if (!pairs.length) return _multiWarn(interaction, 'role_* : membre introuvable.');
    } else if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      if (!selRoles.length) return _multiWarn(interaction, 'role_* : selectionnez un role.');
      for (const r of selRoles) pairs.push({ member: clicker, roleId: r.id });
    }
  } else if (interaction.isStringSelectMenu?.()) {
    if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      const vals = interaction.values || [];
      for (const v of vals) {
        if (/^\d{17,20}$/.test(v)) pairs.push({ member: clicker, roleId: v });
      }
    }
  } else {
    if (fixedRoleId) pairs.push({ member: clicker, roleId: fixedRoleId });
  }

  if (!pairs.length) return _multiWarn(interaction, 'role_* : Role ID requis.');

  for (const { member: tgt, roleId } of pairs) {
    if (!/^\d{17,20}$/.test(roleId)) continue;
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === guild.id || role.managed) continue;
    if (role.position >= me.roles.highest.position) continue;
    const has = tgt.roles.cache.has(role.id);
    try {
      if (type === 'role_add' || (type === 'role_toggle' && !has)) {
        await tgt.roles.add(role);
      } else if (type === 'role_remove' || (type === 'role_toggle' && has)) {
        await tgt.roles.remove(role);
      }
    } catch {}
  }
}

async function _execMultiDelete(interaction) {

  try {
    if (interaction.message?.deletable) {
      await interaction.message.delete().catch(() => {});
    }
  } catch {}
}

async function _multiWarn(interaction, content) {
  await interaction.followUp({
    embeds : [embed.build(interaction.guild?.id, content, { color: '#FAA61A', timestamp: false })],
    flags  : 64,
  }).catch(() => {});
}


async function _ackOrFollow(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply(payload);
    }
    if (interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch {
    return null;
  }
}

async function _execActionRole(interaction, action, type, selected = {}) {

  if (selected.cleared === true) {
    const cachedIds = selected._cachedRoleIds || (selected.SelectedID ? [selected.SelectedID] : []);
    if (!cachedIds.length) {
      return _ephemeral(interaction, 'Aucun rôle à retirer (resélectionnez d\'abord un rôle).');
    }
    type = 'role_remove';
  }

  const guild   = interaction.guild;
  const clicker = interaction.member;
  if (!guild || !clicker) return _ephemeral(interaction, 'Membre indisponible.');

  const me = guild.members.me;
  if (!me?.permissions?.has?.('ManageRoles')) {
    return _ephemeral(interaction, 'Permission ManageRoles manquante.');
  }


  const pairs = [];
  const fixedRoleId = (action.roleId || '').trim();

  if (selected.cleared === true) {
    const cachedIds = selected._cachedRoleIds || (selected.SelectedID ? [selected.SelectedID] : []);
    for (const rid of cachedIds) pairs.push({ member: clicker, roleId: rid });
  } else if (interaction.isChannelSelectMenu?.()) {
    return _ephemeral(interaction, 'Cette action necessite un role ou un utilisateur.');
  } else if (interaction.isRoleSelectMenu?.()) {

    if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      const roles = interaction.roles ? [...interaction.roles.values()] : [];
      if (!roles.length) return _ephemeral(interaction, 'Selectionnez un role.');
      for (const r of roles) pairs.push({ member: clicker, roleId: r.id });
    }
  } else if (interaction.isUserSelectMenu?.()) {

    if (!fixedRoleId) return _ephemeral(interaction, 'Rôle ID requis pour une sélection utilisateur.');
    const users = interaction.users ? [...interaction.users.values()] : [];
    if (!users.length) return _ephemeral(interaction, 'Selectionnez un utilisateur.');
    for (const u of users) {
      const m2 = await guild.members.fetch(u.id).catch(() => null);
      if (m2) pairs.push({ member: m2, roleId: fixedRoleId });
    }
    if (!pairs.length) return _ephemeral(interaction, 'Membre introuvable.');
  } else if (interaction.isMentionableSelectMenu?.()) {
    const selRoles = interaction.roles ? [...interaction.roles.values()] : [];
    const selUsers = interaction.users ? [...interaction.users.values()] : [];
    if (fixedRoleId && selUsers.length) {
      for (const u of selUsers) {
        const m2 = await guild.members.fetch(u.id).catch(() => null);
        if (m2) pairs.push({ member: m2, roleId: fixedRoleId });
      }
      if (!pairs.length) return _ephemeral(interaction, 'Membre introuvable.');
    } else if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      if (!selRoles.length) return _ephemeral(interaction, 'Selectionnez un role.');
      for (const r of selRoles) pairs.push({ member: clicker, roleId: r.id });
    }
  } else if (interaction.isStringSelectMenu?.()) {

    if (fixedRoleId) {
      pairs.push({ member: clicker, roleId: fixedRoleId });
    } else {
      const vals = interaction.values || [];
      if (!vals.length) return _ephemeral(interaction, 'Selectionnez une option.');
      for (const v of vals) {
        if (!/^\d{17,20}$/.test(v)) return _ephemeral(interaction, `Option invalide pour un role : \`${String(v).slice(0, 30)}\`.`);
        pairs.push({ member: clicker, roleId: v });
      }
    }
  } else {

    if (fixedRoleId) pairs.push({ member: clicker, roleId: fixedRoleId });
  }

  if (!pairs.length) return _ephemeral(interaction, 'Rôle ID requis.');

  const results = [];
  for (const { member: tgt, roleId } of pairs) {
    if (!/^\d{17,20}$/.test(roleId)) { results.push('ID invalide'); continue; }
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role)        { results.push('Rôle introuvable'); continue; }
    if (role.id === guild.id) { results.push('@everyone refuse'); continue; }
    if (role.managed) { results.push(`${role.name} : gere par integration`); continue; }
    if (role.position >= me.roles.highest.position) { results.push(`${role.name} : hierarchie`); continue; }

    const has = tgt.roles.cache.has(role.id);
    try {
      if (type === 'role_add' || (type === 'role_toggle' && !has)) {
        await tgt.roles.add(role);
        results.push(`${role.name} ajoute` + (tgt.id !== clicker.id ? ` a ${tgt.user.username}` : ''));
      } else if (type === 'role_remove' || (type === 'role_toggle' && has)) {
        await tgt.roles.remove(role);
        results.push(`${role.name} retire` + (tgt.id !== clicker.id ? ` de ${tgt.user.username}` : ''));
      } else {
        results.push(`${role.name} : aucun changement`);
      }
    } catch {
      results.push(`${role.name} : impossible`);
    }
  }

  const summary = results.join('\n') || 'Action effectuee.';
  return _ackOrFollow(interaction, {
    embeds : [embed.build(guild.id, summary.slice(0, 2000), { timestamp: false })],
    flags  : 64,
  });
}

async function _execActionRoleSync(interaction, action, item, selected = {}) {
  const guild   = interaction.guild;
  const clicker = interaction.member;
  if (!guild || !clicker) return _ephemeral(interaction, 'Membre indisponible.');

  const me = guild.members.me;
  if (!me?.permissions?.has?.('ManageRoles')) {
    return _ephemeral(interaction, 'Permission ManageRoles manquante.');
  }

  if (!interaction.isStringSelectMenu?.()) {
    return _ephemeral(interaction, 'role_sync necessite un StringSelect.');
  }

  const allPossibleIds = (item?.options || [])
    .map(o => String(o.value || '').trim())
    .filter(v => /^\d{17,20}$/.test(v));
  if (!allPossibleIds.length) {
    return _ephemeral(interaction, 'Aucun rôle valide dans les options.');
  }

  const selectedIds = new Set(
    (interaction.values || []).filter(v => /^\d{17,20}$/.test(v)),
  );

  const results = [];
  for (const roleId of allPossibleIds) {
    const role = guild.roles.cache.get(roleId)
      || await guild.roles.fetch(roleId).catch(() => null);
    if (!role)              { results.push('Rôle introuvable'); continue; }
    if (role.id === guild.id) { results.push('@everyone refuse'); continue; }
    if (role.managed)       { results.push(`${role.name} : gere par integration`); continue; }
    if (role.position >= me.roles.highest.position) { results.push(`${role.name} : hierarchie`); continue; }

    const has = clicker.roles.cache.has(role.id);
    try {
      if (selectedIds.has(roleId) && !has) {
        await clicker.roles.add(role);
        results.push(`${role.name} ajoute`);
      } else if (!selectedIds.has(roleId) && has) {
        await clicker.roles.remove(role);
        results.push(`${role.name} retire`);
      }
    } catch {
      results.push(`${role.name} : impossible`);
    }
  }

  const summary = results.join('\n') || 'Rôles mis à jour.';
  return _ackOrFollow(interaction, {
    embeds : [embed.build(guild.id, summary.slice(0, 2000), { timestamp: false })],
    flags  : 64,
  });
}

async function _execMultiRoleSync(interaction, action, item, selected = {}) {
  const guild   = interaction.guild;
  const clicker = interaction.member;
  if (!guild || !clicker) return _multiWarn(interaction, 'role_sync : membre indisponible.');

  const me = guild.members.me;
  if (!me?.permissions?.has?.('ManageRoles')) {
    return _multiWarn(interaction, 'role_sync : ManageRoles manquant.');
  }

  if (!interaction.isStringSelectMenu?.()) {
    return _multiWarn(interaction, 'role_sync : necessite un StringSelect.');
  }

  const allPossibleIds = (item?.options || [])
    .map(o => String(o.value || '').trim())
    .filter(v => /^\d{17,20}$/.test(v));
  if (!allPossibleIds.length) return;

  const selectedIds = new Set(
    (interaction.values || []).filter(v => /^\d{17,20}$/.test(v)),
  );

  for (const roleId of allPossibleIds) {
    const role = guild.roles.cache.get(roleId)
      || await guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === guild.id || role.managed) continue;
    if (role.position >= me.roles.highest.position) continue;
    const has = clicker.roles.cache.has(role.id);
    try {
      if (selectedIds.has(roleId) && !has) {
        await clicker.roles.add(role);
      } else if (!selectedIds.has(roleId) && has) {
        await clicker.roles.remove(role);
      }
    } catch {}
  }
}

module.exports = {
  execute,
  executeFromInteraction,
  executeComponentAction,
  buildReminderPayload,
  applyReminderReactions,
  buildPreviewPayload,
  canUseCustom: _canUseCustom,
  VALID_CUSTOM_PERMS,
};
