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
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'blcasino',
  description: 'Gérer la blacklist du casino.',
  use        : 'blcasino [@membre/ID] [raison]',
  usage      : 'blcasino [@membre/ID] [raison]',
  aliases    : ['blcasinos', 'blc'],
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {

  const authorId = message.author.id;
  const guildId  = message.guild.id;

  if (
    !perms.isBuyer(authorId) &&
    !perms.isOwner(guildId, authorId) &&
    !db.isCasinoManager(guildId, authorId)
  ) {
    return embed.replyError(message, 'Permission refusée.');
  }

  if (!args[0]) {
    return _showList(message, guildId);
  }

  const target =
    message.mentions.users.first()
    ?? message.guild.members.cache.get(args[0])?.user
    ?? await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  const reason =
    args.slice(1).join(' ')
    || 'Aucune raison fournie';

  const existing = db.isCasinoBlacklisted(guildId, target.id);

  if (existing) {
    db.removeCasinoBlacklist(guildId, target.id);
    return embed.reply(message, `<@${target.id}> retiré de la blacklist casino.`);
  }

  const _v2Panel = (text, disabled = false) => {
    if (V2_AVAILABLE) {
      try {
        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(_buildConfirmRow(disabled));
        return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
      } catch {}
    }
    return {
      embeds: [embed.build(message.guild.id, text.replace(/^##[^\n]*\n/, ''), { title: '⊘ Blacklist Casino', timestamp: false })],
      components: [_buildConfirmRow(disabled)],
      allowedMentions: { parse: [] },
    };
  };

  const confirmText =
    `## ⊘ Blacklist Casino\n\n` +
    `**Cible** › <@${target.id}> \`${target.id}\`\n` +
    `**Raison** › ${reason}\n\n` +
    `-# Ce membre ne pourra plus utiliser les commandes casino.`;

  const panel = await message.channel.send(_v2Panel(confirmText, false)).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible de demander la confirmation.');
  }

  embed.registerPrivateInteraction(panel, message.author.id, 120_000);

  const collector = panel.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id && i.message.id === panel.id,
    idle  : 60_000,
    time  : 120_000,
  });

  let confirmed = false;

  collector.on('collect', async interaction => {
    if (interaction.customId === 'local:blcasino:cancel') {
      collector.stop('cancelled');
      const cancelText = `## ⊘ Blacklist annulée\n\n-# Action annulée par <@${message.author.id}>.`;
      await interaction.update(_v2Panel(cancelText, true)).catch(() => {});
      return;
    }
    if (interaction.customId === 'local:blcasino:confirm') {
      confirmed = true;
      collector.stop('confirmed');
      await interaction.deferUpdate().catch(() => {});
    }
  });

  await new Promise(resolve => collector.on('end', resolve));
  embed.clearPrivateInteraction(panel);

  if (!confirmed) {
    await panel.edit(_v2Panel(confirmText, true)).catch(() => {});
    return;
  }

  db.addCasinoBlacklist(guildId, target.id, reason, authorId);

  const doneText =
    `## ⊘ Blacklist appliquée\n\n` +
    `**Membre** › <@${target.id}> \`${target.id}\`\n` +
    `**Raison** › ${reason}\n\n` +
    `-# <t:${Math.floor(Date.now() / 1000)}:f>`;

  if (V2_AVAILABLE) {
    try {
      const container = new ContainerBuilder().setAccentColor(0xED4245);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(doneText));
      await panel.edit({ embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    } catch {}
  }

  return embed.reply(message, `<@${target.id}> ajouté à la blacklist casino.`);

};

async function _showList(message, guildId) {
  const list = db.getCasinoBlacklist(guildId);

  if (!list.length) {
    return embed.reply(message, 'Blacklist casino vide.');
  }

  const PAGE_SIZE  = 10;
  const totalPages = Math.ceil(list.length / PAGE_SIZE);
  let   page       = 0;

  const buildPayload = (disabled = false) => {
    const slice  = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    const lines = slice.map((e, i) =>
      `**${offset + i + 1}.** <@${e.userId}> \`${e.userId}\`\n-# ${e.reason || 'Aucune raison'}`
    );

    const header = `## ☰ Blacklist Casino (${list.length})\n`;
    const body   = header + lines.join('\n\n');
    const footer = `-# Page ${page + 1}/${totalPages}`;

    const prevBtn = new ButtonBuilder()
      .setCustomId('local:blcasino:prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0);

    const nextBtn = new ButtonBuilder()
      .setCustomId('local:blcasino:next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1);

    const navRow = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

    if (V2_AVAILABLE) {
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
        title    : `☰ Blacklist Casino (${list.length})`,
        description: slice.map((e, i) =>
          `**${offset + i + 1}.** <@${e.userId}> \`${e.userId}\`\n${e.reason || 'Aucune raison'}`
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
    if (i.customId === 'local:blcasino:prev') page = Math.max(0, page - 1);
    if (i.customId === 'local:blcasino:next') page = Math.min(totalPages - 1, page + 1);
    await i.deferUpdate().catch(() => {});
    await panel.edit(buildPayload()).catch(() => {});
  });

  collector.on('end', () => {
    embed.clearPrivateInteraction(panel);
    panel.edit(buildPayload(true)).catch(() => {});
  });
}

function _buildConfirmRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:blcasino:confirm')
      .setLabel('Confirmer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:blcasino:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}
