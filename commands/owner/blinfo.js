'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'blinfo',
  description: "Afficher les infos de blacklist d'un membre.",
  use        : 'blinfo <@membre/ID>',
  usage      : 'blinfo <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const guildId  = message.guild.id;

  if (!_canView(message)) {
    return embed.replyError(message, 'Permission refusée.');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  const entry = db.getBlacklistEntry(guildId, target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  const lines = [
    `## <@${entry.userId}> \`${entry.userId}\``,
    '',
    `**Ajouté par** › <@${entry.addedBy}>`,
    `**Raison** › ${entry.reason ?? 'Aucune raison'}`,
    '',
    `-# <t:${entry.addedAt}:f>`,
  ];

  const body = lines.join('\n');

  let payload;

  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
      payload = {
        embeds          : [],
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  if (!payload) {
    payload = {
      embeds: [embed.build(guildId, null, {
        authorName : target.username,
        authorIcon : target.displayAvatarURL({ size: 64, extension: 'png' }),
        color      : '#ED4245',
        fields     : [
          { name: 'Ajouté par', value: `<@${entry.addedBy}>`,              inline: true  },
          { name: 'Date',       value: `<t:${entry.addedAt}:f>`,            inline: true  },
          { name: 'Raison',     value: entry.reason ?? 'Aucune raison',     inline: false },
        ],
        footer    : { text: entry.userId },
        timestamp : false,
      })],
      allowedMentions: { repliedUser: false },
    };
  }

  return message.channel.send(payload).catch(() => {});
};

function _canView(message) {
  const { author, guild, member } = message;
  if (perms.isBuyer(author.id) || perms.isOwner(guild.id, author.id)) return true;

  const roleIds = member.roles.cache.map(role => role.id);
  return db.getCmdTargets(guild.id, 'bl').some(target =>
    (target.targetType === 'user' && target.targetId === author.id) ||
    (target.targetType === 'role' && roleIds.includes(target.targetId))
  );
}
