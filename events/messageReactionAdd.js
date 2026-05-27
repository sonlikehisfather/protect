'use strict';


const { PermissionsBitField } = require('discord.js');

const db           = require('../core/database');
const giveaways    = require('../modules/giveaways');
const errorHandler = require('../utils/errorHandler');
const perms        = require('../utils/permissions');

module.exports = {
  name : 'messageReactionAdd',
  once : false,

  async execute(client, reaction, user) {
    if (user?.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch().catch(() => null);
      }

      if (reaction.message?.partial) {
        await reaction.message.fetch().catch(() => null);
      }

      if (!reaction.message?.guild) return;


      if (giveaways?.handleReactionAdd) {
        const handledGiveaway = await giveaways.handleReactionAdd(client, reaction, user);
        if (handledGiveaway) return;
      }


      const emojiName = reaction.emoji.name;
      if (emojiName === '\u2705' || emojiName === '\u274c') {
        const handled = await _handleSuggestionVote(reaction, user, emojiName);
        if (handled) return;
      }


      const guildId   = reaction.message.guild.id;
      const messageId = reaction.message.id;
      const emojiKey  = _emojiKey(reaction.emoji);

      const entry = _findReactionEntry(guildId, messageId, emojiKey);
      if (!entry) return;

      const guild = reaction.message.guild;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      const role = guild.roles.cache.get(entry.roleId)
        ?? await guild.roles.fetch(entry.roleId).catch(() => null);

      if (!role) return;

      const canManage = await _canManageRole(guild, role);
      if (!canManage) return;

      const menu = _getRoleMenuByMessageId(messageId);

            if (menu) {
        const componentType = menu.componentType || menu.panelType || 'reaction';
        if (componentType !== 'reaction') return;

        if (!perms.isBuyer(user.id) && !perms.isGlobalOwner(user.id)) {
          if (!_passesRolemenuRestrictions(member, menu, guild)) {
            await _removeUserReactionByEmoji(reaction.message, emojiKey, user.id);
            return;
          }
        }

        const mode = String(menu.mode || 'toggle').toLowerCase();
        const hasRole = member.roles.cache.has(role.id);

        if (mode === 'remove') {
          if (hasRole) {
            await member.roles.remove(role, 'Rolemenu reaction remove').catch(() => {});
          }

          return;
        }

        if ((mode === 'add' || mode === 'toggle') && !hasRole) {
          const limitResult = await _enforceReactionLimit({
            guild,
            member,
            menu,
            currentRoleId : role.id,
            message       : reaction.message,
            userId        : user.id,
          });

          if (limitResult === 'blocked') {
            await _removeUserReactionByEmoji(reaction.message, emojiKey, user.id);
            return;
          }
        }

        if (!hasRole) {
          await member.roles.add(role, 'Rolemenu reaction add').catch(() => {});
        }

        return;
      }


      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role, 'Role reaction add').catch(() => {});
      }

    } catch (err) {
      errorHandler.handle(err, { source: 'messageReactionAdd' });
    }
  },
};

function _findReactionEntry(guildId, messageId, emojiKey) {
  const reactions = db.getRoleReactions(guildId, messageId);
  return reactions.find(r => r.emoji === emojiKey) ?? null;
}

function _getRoleMenuByMessageId(messageId) {
  try {
    if (typeof db.getRoleMenuByMessageId === 'function') {
      return db.getRoleMenuByMessageId(messageId);
    }

    return db.raw()
      .prepare('SELECT * FROM role_menus WHERE messageId = ?')
      .get(messageId) ?? null;
  } catch {
    return null;
  }
}

async function _canManageRole(guild, role) {
  if (!role || role.id === guild.id) return false;
  if (role.managed) return false;

  const me = guild.members.me
    ?? await guild.members.fetchMe().catch(() => null);

  if (!me) return false;

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return false;
  }

  if (role.position >= me.roles.highest.position) {
    return false;
  }

  return true;
}

async function _enforceReactionLimit({ guild, member, menu, currentRoleId, message, userId }) {
  const limit = Math.min(
    Math.max(Number(menu.maxValues) || 0, 0),
    25
  );

  if (limit <= 0) {
    return 'ok';
  }

  const options = db.getRoleMenuOptions(menu.id);
  const menuRoleIds = options.map(option => option.roleId);

  const ownedRoleIds = menuRoleIds
    .filter(roleId => roleId !== currentRoleId)
    .filter(roleId => member.roles.cache.has(roleId));

  if (limit === 1) {
    for (const oldRoleId of ownedRoleIds) {
      const oldRole = guild.roles.cache.get(oldRoleId)
        ?? await guild.roles.fetch(oldRoleId).catch(() => null);

      if (!oldRole) continue;

      const canManage = await _canManageRole(guild, oldRole);
      if (!canManage) continue;

      await member.roles.remove(oldRole, 'Rolemenu reaction maxValues replacement').catch(() => {});

      const oldOption = options.find(option => option.roleId === oldRoleId);

      if (oldOption?.emoji) {
        await _removeUserReactionByEmoji(message, oldOption.emoji, userId);
      }
    }

    return 'ok';
  }

  if (ownedRoleIds.length >= limit) {
    return 'blocked';
  }

  return 'ok';
}

async function _removeUserReactionByEmoji(message, emojiKey, userId) {
  try {
    const targetReaction = message.reactions.cache.find(r =>
      _emojiKey(r.emoji) === emojiKey
    );

    if (!targetReaction) return;

    await targetReaction.users.remove(userId).catch(() => {});
  } catch {}
}

function _passesRolemenuRestrictions(member, menu, guild) {
  if (!member?.roles?.cache) return true;

  const forbidden = _parseJsonArray(menu.forbiddenRoleIds);
  if (forbidden.length) {
    const validForbidden = guild
      ? forbidden.filter(id => guild.roles.cache.has(id))
      : forbidden;
    if (validForbidden.length && validForbidden.some(id => member.roles.cache.has(id))) {
      return false;
    }
  }

  const required = _parseJsonArray(menu.requiredRoleIds);
  if (required.length) {
    const validRequired = guild
      ? required.filter(id => guild.roles.cache.has(id))
      : required;
    if (!validRequired.length) return false;
    if (!validRequired.some(id => member.roles.cache.has(id))) return false;
  }

  return true;
}

function _parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function _emojiKey(emoji) {
  if (emoji?.id) {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }

  return emoji?.name;
}


async function _handleSuggestionVote(reaction, user, emojiName) {
  const message = reaction.message;
  const suggestion = db.getSuggestionByMessageId(message.id);
  if (!suggestion) return false;
  if (suggestion.status !== 'approved') return false;


  const opposite = emojiName === '\u2705' ? '\u274c' : '\u2705';
  const oppositeReaction = message.reactions.cache.find(r => r.emoji.name === opposite);
  if (oppositeReaction) {
    await oppositeReaction.users.remove(user.id).catch(() => {});
  }

  return true;
}
