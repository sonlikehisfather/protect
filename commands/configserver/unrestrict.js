'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const LIST_BACKEND_LIMIT = 30;
const LIST_PER_PAGE      = 10;
const LIST_IDLE_MS       = 120_000;
const LIST_TIMEOUT_MS    = 300_000;

module.exports = {
  help: {
    name        : 'unrestrict',
    description : 'Rend un émoji custom de nouveau accessible à tout le monde.',
    use         : 'unrestrict <émoji/nom/id> | unrestrict list',
    usage       : 'unrestrict <émoji/nom/id> | unrestrict list',
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

    const input = args.join(' ').trim();

    if (!input) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}unrestrict <émoji/nom/id>\`\n` +
        `Pour voir les emojis du serveur : \`${message.prefix || '+'}unrestrict list\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (input.toLowerCase() === 'list') {
      return _handleList(message, guild, guildId, deleteReply, deleteDelay);
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
        'Je n\'ai pas la permission de gérer les émojis du serveur.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const emojiId = await _resolveEmojiId(guild, input);

    if (!emojiId) {
      const sent = await embed.replyError(
        message,
        `Émoji introuvable.\n\n` +
        `Utilise directement l'ID affiché avec \`${message.prefix || '+'}unrestrict list\`.\n` +
        `Exemple : \`${message.prefix || '+'}unrestrict 1498158730360000662\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const ok = await guild.emojis.edit(
      emojiId,
      { roles: [] },
      `Unrestrict emoji par ${message.author.username}`
    ).then(() => true).catch(() => false);

    if (!ok) {
      const sent = await embed.replyError(
        message,
        'Impossible de retirer la restriction de cet émoji. Vérifie que le bot a bien la permission de gérer les émojis.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await embed.reply(
      message,
      `L'émoji \`${emojiId}\` est maintenant accessible à tout le monde.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _handleList(message, guild, guildId, deleteReply, deleteDelay) {
  const fetched = await guild.emojis.fetch().catch(() => null);

  const emojis = fetched
    ? [...fetched.values()]
    : [...guild.emojis.cache.values()];

  if (!emojis.length) {
    const sent = await embed.replyError(
      message,
      'Aucun émoji custom trouvé sur ce serveur.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const visible    = emojis.slice(0, LIST_BACKEND_LIMIT);
  const totalPages = Math.max(1, Math.ceil(visible.length / LIST_PER_PAGE));
  let page = 0;

  const buildEmbed = () => {
    const start = page * LIST_PER_PAGE;
    const slice = visible.slice(start, start + LIST_PER_PAGE);

    const lines = slice.map((emoji, index) => {
      const display = emoji.animated
        ? `<a:${emoji.name}:${emoji.id}>`
        : `<:${emoji.name}:${emoji.id}>`;

      return `\`${start + index + 1}.\` ${display} \`${emoji.name}\` - \`${emoji.id}\``;
    });

    const extra = emojis.length > LIST_BACKEND_LIMIT
      ? `\n\nEt \`${emojis.length - LIST_BACKEND_LIMIT}\` autre(s) émoji(s) non listé(s).`
      : '';

    const built = embed.build(
      guildId,
      `${lines.join('\n')}${extra}`,
      {
        title    : 'Émojis custom du serveur',
        timestamp: false,
      }
    );

    if (totalPages > 1) {
      built.setFooter({ text: `Page ${page + 1}/${totalPages}` });
    }

    return built;
  };


  if (visible.length <= LIST_PER_PAGE) {
    const sent = await message.channel.send({
      embeds          : [buildEmbed()],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const buildRows = (disabled = false) => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:unrestrict:prev')
        .setLabel('\u25C0')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page <= 0),
      new ButtonBuilder()
        .setCustomId('local:unrestrict:next')
        .setLabel('\u25B6')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('local:unrestrict:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];

  const msg = await message.channel.send({
    embeds          : [buildEmbed()],
    components      : buildRows(false),
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!msg) return;

  embed.registerPrivateInteraction(msg, message.author.id, LIST_TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id && i.message.id === msg.id,
    idle   : LIST_IDLE_MS,
    time   : LIST_TIMEOUT_MS,
  });

  collector.on('collect', async interaction => {
    try {
      if (interaction.customId === 'local:unrestrict:close') {
        collector.stop('closed');
        embed.clearPrivateInteraction(msg);
        await interaction.deferUpdate().catch(() => {});
        return msg.delete().catch(() => {});
      }

      if (interaction.customId === 'local:unrestrict:prev' && page > 0) page--;
      if (interaction.customId === 'local:unrestrict:next' && page < totalPages - 1) page++;

      return interaction.update({
        embeds     : [buildEmbed()],
        components : buildRows(false),
      });
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) {
        console.error('[unrestrict] Erreur collector :', err?.message ?? err);
      }
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit({ components: [] }).catch(() => {});
  });
}

async function _resolveEmojiId(guild, input) {
  if (!input) return null;

  const raw = String(input).trim();

  const custom = raw.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);
  const directId = custom?.[2] ?? (/^\d{17,20}$/.test(raw) ? raw : null);

  if (directId) {
    return directId;
  }

  const cleanName = raw
    .replace(/^:/, '')
    .replace(/:$/, '')
    .toLowerCase();

  const fetched = await guild.emojis.fetch().catch(() => null);

  const emojis = fetched
    ? [...fetched.values()]
    : [...guild.emojis.cache.values()];

  const emoji = emojis.find(e =>
    e.name?.toLowerCase() === cleanName
  );

  return emoji?.id ?? null;
}

function _hasManageExpressions(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageGuildExpressions) ||
    member.permissions.has(PermissionsBitField.Flags.ManageEmojisAndStickers)
  );
}
