'use strict';


const { PermissionsBitField } = require('discord.js');

const db           = require('../core/database');
const giveaways    = require('../modules/giveaways');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'messageReactionRemove',
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


      if (giveaways?.handleReactionRemove) {
        const handledGiveaway = await giveaways.handleReactionRemove(client, reaction, user);
        if (handledGiveaway) return;
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

        const mode = String(menu.mode || 'toggle').toLowerCase();


        if (mode === 'add') return;


        if (mode === 'remove') return;


        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role, 'Rolemenu reaction toggle remove').catch(() => {});
        }

        return;
      }


      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Role reaction remove').catch(() => {});
      }

    } catch (err) {
      errorHandler.handle(err, { source: 'messageReactionRemove' });
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

function _emojiKey(emoji) {
  if (emoji?.id) {
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }

  return emoji?.name;
}
