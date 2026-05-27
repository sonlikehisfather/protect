'use strict';


const {
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'restrict',
    description : 'Rend un emoji custom accessible seulement à certains rôles.',
    use         : 'restrict <emoji/nom/id> <rôle>',
    usage       : 'restrict <emoji/nom/id> <rôle>',
    aliases     : [],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (args.length < 2) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}restrict <emoji/nom/id> <rôle>\`\n` +
        `Exemple : \`${message.prefix || '+'}restrict <:emoji:123456789012345678> @VIP\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me) {
      const sent = await embed.replyError(
        message,
        'Impossible de vérifier mes permissions.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!_hasManageExpressions(me)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les emojis du serveur.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const targetEmoji = await _resolveGuildEmoji(guild, args[0]);

    if (!targetEmoji) {
      const sent = await embed.replyError(
        message,
        'Emoji introuvable. Utilisez un emoji custom de ce serveur, son nom exact ou son ID.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (targetEmoji.guild?.id && targetEmoji.guild.id !== guild.id) {
      const sent = await embed.replyError(
        message,
        'Cet emoji ne vient pas de ce serveur.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const roleInput = args.slice(1).join(' ').trim();
    const roles = _resolveRoles(guild, roleInput);

    if (!roles.length) {
      const sent = await embed.replyError(
        message,
        'Aucun rôle valide trouvé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (roles.some(role => role.id === guild.id)) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas restreindre un emoji au rôle everyone. Utilisez plutôt `unrestrict`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const uniqueRoles = [...new Map(roles.map(role => [role.id, role])).values()];

    const botAccessRole = _getBotAccessRole(guild, me, client);

    if (botAccessRole && !uniqueRoles.some(role => role.id === botAccessRole.id)) {
      uniqueRoles.push(botAccessRole);
    }

    if (uniqueRoles.length > 25) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas définir plus de 25 rôles à la fois.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const ok = await guild.emojis.edit(
      targetEmoji.id,
      { roles: uniqueRoles.map(role => role.id) },
      `Restriction emoji par ${message.author.username}`
    ).then(() => true).catch(() => false);

    if (!ok) {
      const sent = await embed.replyError(
        message,
        'Impossible de modifier les rôles autorisés pour cet emoji.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const visibleRoles = uniqueRoles
      .filter(role => !botAccessRole || role.id !== botAccessRole.id)
      .map(role => `<@&${role.id}>`);

    const botInfo = botAccessRole
      ? `\n\nLe rôle du bot a été ajouté automatiquement pour garder l'accès à l'emoji.`
      : '';

    const sent = await embed.reply(
      message,
      `${targetEmoji} est maintenant restreint à : ${visibleRoles.join(', ') || 'aucun rôle visible'}.${botInfo}`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveGuildEmoji(guild, input) {
  if (!input) return null;

  const raw = String(input).trim();

  const custom = raw.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);
  const id = custom?.[2] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  const fetched = await guild.emojis.fetch().catch(() => null);
  const emojis = fetched
    ? [...fetched.values()]
    : [...guild.emojis.cache.values()];

  if (id) {
    return emojis.find(emoji => emoji.id === id) || null;
  }

  const cleanName = raw
    .replace(/^:/, '')
    .replace(/:$/, '')
    .toLowerCase();

  return emojis.find(emoji =>
    emoji.name?.toLowerCase() === cleanName
  ) || null;
}

function _resolveRoles(guild, input) {
  const chunks = String(input || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  const values = chunks.length ? chunks : [input];
  const roles = [];

  for (const value of values) {
    const role = _resolveRole(guild, value);
    if (role) roles.push(role);
  }

  return roles;
}

function _resolveRole(guild, input) {
  if (!input) return null;

  const raw = String(input).trim();

  const mention = raw.match(/^<@&(\d{17,20})>$/);
  const id = mention?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (id) {
    return guild.roles.cache.get(id) ?? null;
  }

  const normalized = _normalizeName(raw);

  return guild.roles.cache.find(role =>
    _normalizeName(role.name) === normalized
  ) ?? null;
}

function _normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function _hasManageExpressions(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageGuildExpressions) ||
    member.permissions.has(PermissionsBitField.Flags.ManageEmojisAndStickers)
  );
}

function _getBotAccessRole(guild, me, client) {
  if (me?.roles?.botRole) {
    return me.roles.botRole;
  }

  const botId = client?.user?.id;

  if (botId) {
    const botRole = guild.roles.cache.find(role =>
      role.managed &&
      role.tags?.botId === botId
    );

    if (botRole) return botRole;
  }

  return null;
}
