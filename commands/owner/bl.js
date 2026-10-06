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
  description: 'Gérer la blacklist globale.',
  use        : 'bl [@membre/ID] [raison]',
  usage      : 'bl [@membre/ID] [raison]',
  aliases    : ['blacklist'],

};

exports.run = async (client, message, args) => {

  const authorId = message.author.id;
  const guildId  = message.guild.id;


  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId)
  ) {

    return embed.replyError(
      message,
      'Permission refusée.'
    );

  }


  if (!args[0]) {

    return _showList(message);

  }


  if (
    args[0].toLowerCase() === 'clear'
  ) {

    if (!perms.isBuyer(authorId)) {

      return embed.replyError(
        message,
        'Commande réservée au buyer.'
      );

    }

    if (args[1]?.toLowerCase() !== 'confirm') {

      return embed.replyError(
        message,
        'Confirme avec : +bl clear confirm'
      );

    }

    db.clearBlacklist();

    return embed.reply(
      message,
      'Blacklist vidée.'
    );

  }

  const target =
    message.mentions.users.first()
    ?? await client.users
      .fetch(args[0])
      .catch(() => null);

  if (!target) {

    return embed.replyError(
      message,
      'Utilisateur introuvable.'
    );

  }

  if (target.id === client.user.id) {
    return embed.replyError(
      message,
      'Impossible de blacklister le bot.'
    );
  }

  if (perms.isProtected(target.id, message.guild.id, null)) {

    return embed.replyError(
      message,
      'T’as essayé de blacklister un utilisateur protégé ?'
    );

  }

  const reason =
    args.slice(1).join(' ')
    || 'Aucune raison fournie';

  const existing =
    db.getBlacklistEntry(target.id);

  if (existing) {

    return embed.replyError(
      message,
      `${target.globalName ?? target.username} est déjà blacklisté.`
    );

  }

  const guilds = [...client.guilds.cache.values()];
  const progressDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n` +
    `**Raison :** ${reason}\n\n` +
    `Blacklist globale en cours sur ${guilds.length} serveur(s)...`;
  const panel = await message.channel.send(
    _statusPayload(guildId, `Blacklist de ${target.username}`, progressDescription)
  ).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible d’afficher le suivi de la blacklist.');
  }

  try {
    db.addBlacklist(target.id, reason, authorId);
  } catch {
    const failure =
      `**Membre :** <@${target.id}> (\`${target.id}\`)\n` +
      `**Raison :** ${reason}\n\n` +
      `Impossible d’enregistrer cette entrée dans la blacklist globale.`;
    await panel.edit(_statusPayload(guildId, 'Blacklist non enregistrée', failure)).catch(() => {});
    return;
  }

  let banned = 0;
  const protectedGuilds = [];
  const failed = [];

  for (const guild of guilds) {
    if (perms.isProtected(target.id, guild.id, null)) {
      protectedGuilds.push(_protectionReason(target.id, guild.id));
    } else {
      try {
        await guild.members.ban(target.id, { reason: `Blacklist - ${reason}` });
        banned++;
      } catch (error) {
        failed.push(_banFailureReason(error));
      }
    }
    await _wait(300);
  }

  const reasonCounts = new Map();
  for (const reason of [...protectedGuilds, ...failed]) {
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const reasonSummary = [...reasonCounts]
    .map(([reason, count]) => `• ${count} serveur(s) : ${reason}`)
    .join('\n') || 'Aucun.';
  const resultDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n` +
    `**Raison :** ${reason}\n` +
    `**Banni avec succès :** ${banned}/${guilds.length} serveur(s)\n` +
    `**Non banni :** ${protectedGuilds.length + failed.length} serveur(s)\n\n` +
    `**Motifs :**\n${reasonSummary}`;

  return panel.edit(_statusPayload(guildId, 'Blacklist globale terminée', resultDescription))
    .catch(() => {});

};

async function _showList(message) {
  const list = db.getBlacklist();
  const guildId = message.guild.id;

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

function _statusPayload(guildId, title, description) {
  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n\n${description}`));
      return {
        embeds          : [],
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  return {
    embeds          : [embed.build(guildId, description, { title, timestamp: false })],
    components      : [],
    allowedMentions : { parse: [] },
  };
}

function _protectionReason(userId, guildId) {
  if (db.isProtectedUser(guildId, userId)) return 'utilisateur protégé sur ce serveur';
  if (perms.isBuyer(userId)) return 'compte buyer protégé';
  if (userId === process.env.CLIENT_ID) return 'il s’agit du bot';
  if (perms.isOwner(guildId, userId)) return 'owner du serveur';
  return 'protégé par une règle de protection du serveur';
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

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
