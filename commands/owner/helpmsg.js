'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const MAX_LENGTH    = 1500;
const PANEL_IDLE_MS = 120_000;
const PANEL_TIME_MS = 300_000;

module.exports = {
  help: {
    name        : 'helpmsg',
    description : 'Configure un message custom affiche dans le panel +help.',
    use         : 'helpmsg [show | set <message> | reset]',
    usage       : 'helpmsg [show | set <message> | reset]',
    aliases     : ['helpmessage'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'show') {
      return _show(message, config?.helpMessage ?? null, deleteReply, deleteDelay);
    }

    if (sub === 'reset' || sub === 'clear' || sub === 'remove') {
      if (!config?.helpMessage || !String(config.helpMessage).trim()) {
        return _reply(
          message,
          'Aucun message help personnalisé n\'est configuré.',
          deleteReply,
          deleteDelay
        );
      }

      db.setGuildConfig(guildId, 'helpMessage', null);
      return _reply(
        message,
        'Message du help reinitialise.',
        deleteReply,
        deleteDelay
      );
    }

    if (sub === 'set') {
      const raw = args.slice(1).join(' ').trim();

      if (!raw) {
        return _error(
          message,
          `Utilisation : \`${_prefix(message)}helpmsg set <message>\`.`,
          deleteReply,
          deleteDelay
        );
      }

      if (raw.length > MAX_LENGTH) {
        return _error(
          message,
          `Message trop long (${raw.length}/${MAX_LENGTH} caracteres).`,
          deleteReply,
          deleteDelay
        );
      }

      if ((config?.helpMessage ?? '') === raw) {
        return _reply(
          message,
          'Ce message help est déjà configuré.',
          deleteReply,
          deleteDelay
        );
      }

      db.setGuildConfig(guildId, 'helpMessage', raw);

      return _reply(
        message,
        `Message du help defini (${raw.length}/${MAX_LENGTH} caracteres).`,
        deleteReply,
        deleteDelay
      );
    }

    return _error(
      message,
      `Sous-commande inconnue. Utilisation : \`${_prefix(message)}helpmsg [show | set <message> | reset]\`.`,
      deleteReply,
      deleteDelay
    );
  },
};


async function _show(message, helpMessage, deleteReply, deleteDelay) {
  const guildId = message.guild.id;
  const prefix  = _prefix(message);

  const pages = _buildPages(guildId, helpMessage, prefix);

  let current = 0;

  const panel = await message.channel.send({
    embeds          : [pages[current]],
    components      : [_buildRow(current, pages.length, false)],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!panel) return;

  embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

  const collector = panel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter       : i =>
      i.user.id === message.author.id &&
      i.message.id === panel.id,
    idle : PANEL_IDLE_MS,
    time : PANEL_TIME_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'local:helpmsg:close') {
        await i.deferUpdate().catch(() => {});
        collector.stop('closed');
        embed.clearPrivateInteraction(panel);
        await panel.delete().catch(() => {});
        return;
      }

      if (i.customId === 'local:helpmsg:prev' && current > 0) {
        current--;
      } else if (i.customId === 'local:helpmsg:next' && current < pages.length - 1) {
        current++;
      }

      await i.update({
        embeds     : [pages[current]],
        components : [_buildRow(current, pages.length, false)],
      }).catch(() => {});
    } catch {}
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(panel);

    if (reason === 'closed') return;

    await panel.edit({
      components      : [],
      allowedMentions : { parse: [] },
    }).catch(() => {});

    if (deleteReply) {
      embed.scheduleDelete(panel, deleteDelay);
    }
  });
}

function _buildPages(guildId, helpMessage, prefix) {
  const totalPages = 6;
  const stamp = (title, page) => `${title} - Page ${page}/${totalPages}`;

  const messageFields = [];

  if (helpMessage) {
    const truncated = helpMessage.length > 1024;
    const displayed = truncated ? helpMessage.slice(0, 1000) + '...' : helpMessage;

    messageFields.push(
      {
        name  : truncated ? 'Message (tronque pour affichage)' : 'Message',
        value : displayed,
      },
      {
        name  : 'Longueur',
        value : `${helpMessage.length}/${MAX_LENGTH}`,
      },
    );
  } else {
    messageFields.push({
      name  : 'Message',
      value : 'Aucun message custom configure.',
    });
  }

  messageFields.push({
    name  : 'Commandes',
    value : [
      `\`${prefix}help msg set <message>\``,
      `\`${prefix}helpmsg set <message>\``,
      `\`${prefix}help msg reset\``,
      `\`${prefix}helpmsg reset\``,
      `\`${prefix}variables\``,
    ].join('\n'),
  });

  const page1 = embed.build(guildId, null, {
    title     : stamp('Message du help', 1),
    fields    : messageFields,
    timestamp : false,
  });

  const page2 = embed.build(guildId, null, {
    title     : stamp('Variables membre', 2),
    fields    : [
      {
        name  : 'Identite',
        value : [
          '`{user}` mention du membre',
          '`{username}` nom d\'utilisateur',
          '`{tag}` tag complet',
          '`{id}` identifiant du membre',
          '`{MemberMention}` mention',
          '`{MemberName}` nom',
          '`{MemberFullName}` nom complet',
          '`{MemberDisplayName}` pseudo affiche',
          '`{MemberID}` identifiant',
        ].join('\n'),
      },
      {
        name  : 'Dates',
        value : [
          '`{createdat}` date de creation du compte',
          '`{MemberCreatedAt}` date de creation du compte',
          '`{MemberJoinedAt}` date d\'arrivee sur le serveur',
        ].join('\n'),
      },
    ],
    timestamp : false,
  });

  const page3 = embed.build(guildId, null, {
    title     : stamp('Variables serveur', 3),
    fields    : [
      {
        name  : 'Serveur',
        value : [
          '`{server}` nom du serveur',
          '`{prefix}` prefixe du bot',
          '`{bot}` nom du bot',
          '`{membercount}` nombre de membres',
          '`{count}` alias de `{membercount}`',
          '`{ServerMembersCount}` nombre de membres',
          '`{ServerRolesCount}` nombre de roles',
          '`{ServerChannelsCount}` nombre de salons',
          '`{BotCommandsCount}` nombre total de commandes du bot',
        ].join('\n'),
      },
      {
        name  : 'Boost',
        value : [
          '`{ServerBoostsCount}` nombre de boosts',
          '`{ServerLevel}` niveau de boost (0 a 3)',
        ].join('\n'),
      },
    ],
    timestamp : false,
  });

  const page4 = embed.build(guildId, null, {
    title     : stamp('Variables stats vocales et online', 4),
    fields    : [
      {
        name  : 'Stats',
        value : [
          '`{VocalMembersCount}` membres en vocal',
          '`{OnlineMembersCount}` membres en ligne',
          '`{OfflineMembersCount}` membres hors ligne',
        ].join('\n'),
      },
      {
        name  : 'Note',
        value : 'Les stats online et vocal dependent du cache members. ' +
                'Ces valeurs peuvent etre 0 si l\'intent presence n\'est pas active ou si le cache n\'est pas chauffe.',
      },
    ],
    timestamp : false,
  });

  const page5 = embed.build(guildId, null, {
    title     : stamp('Variables images', 5),
    fields    : [
      {
        name  : 'Images',
        value : [
          '`{MemberPic}` avatar du membre',
          '`{ServerIcon}` icone du serveur',
          '`{ClientPic}` avatar du bot',
        ].join('\n'),
      },
      {
        name  : 'Usage',
        value : 'Ces variables sont remplacees par une URL. Utilisez-les dans les champs `image` ou `thumbnail` d\'un embed JSON, pas dans une description simple.',
      },
    ],
    timestamp : false,
  });

  const page6 = embed.build(guildId, null, {
    title     : stamp('Variables compatibles', 6),
    fields    : [
      {
        name  : 'Anciennes variables',
        value : [
          '`{BotPic}` alias de `{ClientPic}`',
        ].join('\n'),
      },
      {
        name  : 'Liens',
        value : [
          `\`${prefix}variables\` panel complet des variables`,
          `\`${prefix}help msg set <message>\` definir le message custom`,
          `\`${prefix}help msg reset\` reinitialiser`,
        ].join('\n'),
      },
    ],
    timestamp : false,
  });

  return [page1, page2, page3, page4, page5, page6];
}

function _buildRow(current, total, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:helpmsg:prev')
      .setLabel('\u25C0')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || current === 0),

    new ButtonBuilder()
      .setCustomId('local:helpmsg:page')
      .setLabel(`${current + 1}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),

    new ButtonBuilder()
      .setCustomId('local:helpmsg:next')
      .setLabel('\u25B6')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || current === total - 1),

    new ButtonBuilder()
      .setCustomId('local:helpmsg:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function _prefix(message) {
  try {
    return db.getGuildConfig(message.guild.id)?.prefix ?? '+';
  } catch {
    return '+';
  }
}

async function _reply(message, content, deleteReply, deleteDelay) {
  const sent = await embed.reply(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

async function _error(message, content, deleteReply, deleteDelay) {
  const sent = await embed.replyError(
    message,
    content,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}
