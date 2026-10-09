'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'bl',
  description: 'Gérer la blacklist de ce serveur.',
  use        : 'bl [@membre/ID] [raison]',
  usage      : 'bl [@membre/ID] [raison]',
  aliases    : ['blacklist'],
  defaultPermission: 'owner',
  permissionScopes: [
    {
      permission : 'owner',
      usage      : 'bl [@membre/ID] [raison]',
      description: 'Afficher ou modifier la blacklist du serveur. Réservé aux Owners et Buyers.',
    },
    {
      permission : 'buyer',
      usage      : 'bl clear confirm',
      description: 'Vider toute la blacklist du serveur. Réservé aux Buyers.',
    },
  ],
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;

  if (!args[0]) {
    return _showList(message);
  }

  if (args[0].toLowerCase() === 'clear') {
    if (!perms.isBuyer(authorId)) {
      return embed.replyError(message, 'Commande réservée au buyer.');
    }

    if (args[1]?.toLowerCase() !== 'confirm')
      return embed.replyError(message, 'Confirme avec : +bl clear confirm');

    db.clearBlacklist(guildId);
    return embed.reply(message, 'Blacklist de ce serveur vidée.');
  }

  const target =
    message.mentions.users.first()
    ?? await client.users.fetch(args[0]).catch(() => null);

  if (!target) return embed.replyError(message, 'Utilisateur introuvable.');
  if (target.id === client.user.id) {
    return embed.replyError(message, 'Impossible de blacklister le bot.');
  }

  const targetMember = message.guild.members.cache.get(target.id) ?? null;
  if (perms.isProtected(target.id, guildId, targetMember))
    return embed.replyError(message, 'T’as essayé de blacklister un utilisateur protégé ?');

  const reason =
    args.slice(1).join(' ')
    || 'Aucune raison fournie';

  if (db.getBlacklistEntry(guildId, target.id))
    return embed.replyError(message, `${target.globalName ?? target.username} est déjà blacklisté sur ce serveur.`);

  try {
    await message.guild.members.ban(target.id, { reason: `Blacklist - ${reason}` });
  } catch (error) {
    return embed.replyError(message, `Le bannissement sur ce serveur a échoué : ${_banFailureReason(error)}.`);
  }

  try {
    db.addBlacklist(guildId, target.id, reason, authorId);
  } catch {
    return embed.replyError(
      message,
      `${target.globalName ?? target.username} a été banni sur ce serveur, mais l’enregistrement de la blacklist a échoué.`
    );
  }

  return embed.reply(
    message,
    `${target.globalName ?? target.username} a été blacklisté uniquement sur **${message.guild.name}**.\n**Raison :** ${reason}`
  );
};

async function _showList(message) {
  const guildId = message.guild.id;
  const list = db.getBlacklist(guildId);

  if (!list.length) {
    return embed.reply(message, 'Blacklist vide.');
  }

  const PAGE_SIZE  = 10;
  const totalPages = Math.ceil(list.length / PAGE_SIZE);
  let   page       = 0;

  const buildPayload = (disabled = false) => {
    const slice  = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    const lines = slice.map((e, i) =>
      `**${offset + i + 1}.** <@${e.userId}> \`${e.userId}\``
    );

    const header = `## ☰ Liste BL (${list.length})\n`;
    const body   = header + lines.join('\n\n');
    const footer = `-# Page ${page + 1}/${totalPages}`;

    const prevBtn = new ButtonBuilder()
      .setCustomId('local:bl:prev')
      .setLabel('←')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0);

    const nextBtn = new ButtonBuilder()
      .setCustomId('local:bl:next')
      .setLabel('→')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1);

    const navRow = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
        if (totalPages > 1) container.addActionRowComponents(navRow);
        return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }

    return {
      embeds: [embed.build(guildId, null, {
        title    : `☰ Liste BL (${list.length})`,
        description: slice.map((e, i) =>
          `**${offset + i + 1}.** <@${e.userId}> \`${e.userId}\``
        ).join('\n'),
        footer   : { text: `Page ${page + 1}/${totalPages}` },
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
    filter : i => i.user.id === message.author.id && i.message.id === panel.id,
    idle   : 60_000,
    time   : 120_000,
  });

  collector.on('collect', async i => {
    if (i.customId === 'local:bl:prev') page = Math.max(0, page - 1);
    if (i.customId === 'local:bl:next') page = Math.min(totalPages - 1, page + 1);
    await i.deferUpdate().catch(() => {});
    await panel.edit(buildPayload()).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(buildPayload(true)).catch(() => {});
  });
}

function _banFailureReason(error) {
  const code = Number(error?.code ?? error?.rawError?.code);
  if (code === 50013 || error?.status === 403) {
    return 'permissions insuffisantes ou hiérarchie des rôles du bot';
  }
  if (code === 50001) return 'le bot n’a pas accès au serveur';
  if (code) return `erreur Discord (${code})`;
  return 'erreur inattendue lors du bannissement';
}
