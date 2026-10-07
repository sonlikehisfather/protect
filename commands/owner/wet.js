'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'wet',
    description : 'Afficher la wetlist ou wet un utilisateur.',
    usage       : 'wet [@membre/ID] [raison] | unwet <@membre/ID>',
    aliases     : ['unwet'],
    category    : 'owner',
    selfManaged : true,
  },

  async run(client, message, args) {
    if (!_canUse(message)) {
      return embed.replyError(message, 'Permission refusée.');
    }

    const isUnwet = message.content
      .slice((message.prefix || '+').length)
      .trim()
      .split(/\s+/, 1)[0]
      .toLowerCase() === 'unwet';

    if (!args[0] && !isUnwet) {
      return _showList(message);
    }

    const targetId = message.mentions.users.first()?.id
      ?? args[0]?.replace(/[<@!>]/g, '');
    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}${isUnwet ? 'unwet' : 'wet'} <@membre/ID>${isUnwet ? '' : ' [raison]'}\``
      );
    }

    const target = await client.users.fetch(targetId).catch(() => null);
    if (!target) return embed.replyError(message, 'Utilisateur introuvable.');

    if (isUnwet) {
      return _unwet(client, message, target);
    }

    if (target.id === client.user.id) {
      return embed.replyError(message, 'Impossible de wet le bot.');
    }
    if (db.isWet(target.id)) {
      return _reply(message, `<@${target.id}> Deja wet`);
    }

    const reason = args.slice(1).join(' ').trim() || 'Aucune raison fournie';

    try {
      db.addWet(target.id, reason, message.author.id);
    } catch (error) {
      return embed.replyError(message, `Impossible d’enregistrer la wetlist : ${error.message}`);
    }

    const deleted = await message.delete().then(() => true).catch(() => false);
    const failures = [];
    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.members.ban(target.id, { reason: `Wet - ${reason}` });
      } catch (error) {
        failures.push(`${guild.name} (${_errorCode(error)})`);
      }
    }

    const result = failures.length
      ? `<@${target.id}> Wet & Ban\nÉchec du ban sur : ${failures.join(', ')}`
      : `<@${target.id}> Wet & Ban`;
    return _reply(message, _withDeleteWarning(result, deleted));
  },
};

async function _showList(message) {
  const list = db.getWetlist();
  if (!list.length) return _reply(message, 'La wetlist est vide.');

  const pageSize = 10;
  const totalPages = Math.ceil(list.length / pageSize);
  let page = 0;

  const buildPayload = (disabled = false) => {
    const entries = list.slice(page * pageSize, (page + 1) * pageSize);
    const body = [
      `## ☰ Wetlist (${list.length})`,
      '',
      ...entries.map((entry, index) =>
        `**${page * pageSize + index + 1}.** <@${entry.userId}> \`${entry.userId}\`\n-# ${(entry.reason || 'Aucune raison fournie').slice(0, 160)}`
      ),
      '',
      `-# Page ${page + 1}/${totalPages}`,
    ].join('\n');

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:wet:prev')
        .setLabel('←')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0),
      new ButtonBuilder()
        .setCustomId('local:wet:next')
        .setLabel('→')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page >= totalPages - 1),
    );

    if (embed.shouldUseV2(message.guild.id, module.exports.help.name)) {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      if (totalPages > 1) container.addActionRowComponents(navRow);
      return {
        embeds: [],
        components: [container],
        flags: COMPONENTS_V2_FLAG,
        allowedMentions: { parse: [] },
      };
    }

    return {
      embeds: [embed.build(message.guild.id, null, {
        title: `☰ Wetlist (${list.length})`,
        description: entries.map((entry, index) =>
          `**${page * pageSize + index + 1}.** <@${entry.userId}> \`${entry.userId}\`\n${(entry.reason || 'Aucune raison fournie').slice(0, 160)}`
        ).join('\n\n'),
        footer: { text: `Page ${page + 1}/${totalPages}` },
        timestamp: false,
      })],
      components: totalPages > 1 ? [navRow] : [],
      allowedMentions: { parse: [] },
    };
  };

  const panel = await message.channel.send(buildPayload()).catch(() => null);
  if (!panel || totalPages <= 1) return;

  embed.registerPrivateInteraction(panel, message.author.id, 120_000);
  const collector = panel.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id && interaction.message.id === panel.id,
    idle: 60_000,
    time: 120_000,
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:wet:prev') page = Math.max(0, page - 1);
    if (interaction.customId === 'local:wet:next') page = Math.min(totalPages - 1, page + 1);
    await interaction.deferUpdate().catch(() => {});
    await panel.edit(buildPayload()).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(buildPayload(true)).catch(() => {});
  });
}

function _canUse(message) {
  const { author, guild, member } = message;
  if (perms.isBuyer(author.id)) return true;

  const roleIds = member.roles.cache.map(role => role.id);
  return db.getCmdTargets(guild.id, module.exports.help.name).some(target =>
    (target.targetType === 'user' && target.targetId === author.id) ||
    (target.targetType === 'role' && roleIds.includes(target.targetId))
  );
}

async function _unwet(client, message, target) {
  if (!db.isWet(target.id)) {
    return _reply(message, `<@${target.id}> n'est pas wet`);
  }

  let removed;
  try {
    removed = db.removeWet(target.id);
  } catch (error) {
    return embed.replyError(message, `Impossible de retirer l’utilisateur de la wetlist : ${error.message}`);
  }
  if (!removed) {
    return embed.replyError(message, 'La wetlist a changé avant le retrait. Aucun unban n’a été lancé.');
  }

  const deleted = await message.delete().then(() => true).catch(() => false);
  const failures = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.bans.remove(target.id, 'Unwet');
    } catch (error) {
      if (_errorCode(error) !== 10026) {
        failures.push(`${guild.name} (${_errorCode(error)})`);
      }
    }
  }

  const result = `<@${target.id}> Unwet & Unban`;
  const details = failures.length ? `${result}\nÉchec du unban sur : ${failures.join(', ')}` : result;
  return _reply(message, _withDeleteWarning(details, deleted));
}

function _withDeleteWarning(content, deleted) {
  return deleted ? content : `${content}\nLa commande n’a pas pu être supprimée.`;
}

async function _reply(message, content) {
  const guildId = message.guild.id;
  let payload;

  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    payload = {
      embeds          : [],
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    };
  } else {
    payload = {
      embeds: [new EmbedBuilder().setDescription(content)],
      allowedMentions: { parse: [] },
    };
  }

  return message.channel.send(payload);
}

function _errorCode(error) {
  return Number(error?.code ?? error?.rawError?.code) || 'erreur';
}
