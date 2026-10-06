'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'angel',
    description : 'Protège un utilisateur des actions de modération ciblées.',
    usage       : 'angel [@membre|ID]',
    aliases     : ['angeluser'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!_canManage(message, guildId)) {
      return embed.replyError(message, 'Permission refusée.');
    }

    if (!args[0]) {
      return _showList(message);
    }

    const targetId = message.mentions.users.first()?.id
      ?? args[0].match(/^<@!?(\d{17,20})>$/)?.[1]
      ?? (/^\d{17,20}$/.test(args[0]) ? args[0] : null);

    if (!targetId) {
      return embed.replyError(message, 'Utilisation : `+angel <@membre|ID>`');
    }

    const target = await client.users.fetch(targetId).catch(() => null);
    if (!target) {
      return embed.replyError(message, 'Utilisateur introuvable.');
    }

    if (db.getAngelUser(guildId, target.id)) {
      db.removeAngelUser(guildId, target.id);
      return embed.reply(message, `<@${target.id}> n’est plus un ange.`);
    }

    db.addAngelUser(guildId, target.id, message.author.id);
    return embed.reply(message, `<@${target.id}> est maintenant un ange.`);
  },
};

function _canManage(message, guildId) {
  const userId = message.author.id;
  if (perms.isBuyer(userId) || perms.isOwner(guildId, userId) || db.isGlobalOwner(userId)) return true;

  const roleIds = message.member.roles.cache.map(role => role.id);
  const assignedTargets = db.getCmdTargets(guildId, module.exports.help.name);
  if (assignedTargets.some(target =>
    (target.targetType === 'user' && target.targetId === userId) ||
    (target.targetType === 'role' && roleIds.includes(target.targetId))
  )) return true;

  return perms.getMemberLevel(message.member, guildId) > 0;
}

async function _showList(message) {
  const guildId = message.guild.id;
  const list = db.getAngelUsers(guildId);

  if (!list.length) {
    return embed.reply(message, 'Aucuns Anges.');
  }

  const pageSize = 10;
  const totalPages = Math.ceil(list.length / pageSize);
  let page = 0;

  const buildPayload = (disabled = false) => {
    const offset = page * pageSize;
    const entries = list.slice(offset, offset + pageSize).map((entry, index) =>
      `**${offset + index + 1}.** <@${entry.userId}> \`${entry.userId}\`\n➜ Ajouté par <@${entry.addedBy}> • <t:${entry.addedAt}:R>`
    );
    const content = `## Anges (${list.length})\n\n${entries.join('\n\n')}\n\n-# Page ${page + 1}/${totalPages}`;

    const navigation = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:angel:prev')
        .setLabel('←')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0),
      new ButtonBuilder()
        .setCustomId('local:angel:next')
        .setLabel('→')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page >= totalPages - 1),
    );

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        if (totalPages > 1) container.addActionRowComponents(navigation);
        return {
          embeds          : [],
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        };
      } catch {}
    }

    return {
      embeds: [embed.build(guildId, null, {
        title       : `Anges (${list.length})`,
        description : entries.join('\n\n'),
        footer      : { text: `Page ${page + 1}/${totalPages}` },
        timestamp   : false,
      })],
      components      : totalPages > 1 ? [navigation] : [],
      allowedMentions : { parse: [] },
    };
  };

  const panel = await message.channel.send(buildPayload()).catch(() => null);
  if (!panel || totalPages <= 1) return;

  embed.registerPrivateInteraction(panel, message.author.id, 120_000);
  const collector = panel.createMessageComponentCollector({
    filter : interaction => interaction.user.id === message.author.id && interaction.message.id === panel.id,
    idle   : 60_000,
    time   : 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:angel:prev') page = Math.max(0, page - 1);
    if (interaction.customId === 'local:angel:next') page = Math.min(totalPages - 1, page + 1);
    await interaction.deferUpdate().catch(() => {});
    await panel.edit(buildPayload()).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(buildPayload(true)).catch(() => {});
  });
}