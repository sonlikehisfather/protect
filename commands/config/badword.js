'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'badword',
  description : 'Gérer la liste des mots interdits.',
  usage       : 'badword <add|del|list> [mot]',
};

exports.run = async (client, message, args) => {
  if (!perms.check(message, exports.help.name)) return;

  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();
  const word    = args.slice(1).join(' ').trim().toLowerCase();
  const config  = db.getGuildConfig(guildId);

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const antiraidConfig = db.getAntiraidConfig(guildId);
  const list           = _readBadwords(antiraidConfig?.badwordList);

  if (sub === 'add') {
    if (!word) {
      const sent = await embed.replyError(
        message,
        'Précisez un mot à ajouter.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (word.length > 50) {
      const sent = await embed.replyError(
        message,
        'Le mot interdit ne peut pas dépasser **50** caractères.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    if (list.includes(word)) {
      const sent = await embed.replyError(
        message,
        `\`${word}\` est déjà dans la liste des mots interdits.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    list.push(word);
    db.setAntiraidConfig(guildId, 'badwordList', JSON.stringify(list));

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `\`${word}\` a été ajouté à la liste des mots interdits. (${list.length} mot(s))`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'del') {
    if (!word) {
      const sent = await embed.replyError(
        message,
        'Précisez un mot à retirer.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    const idx = list.indexOf(word);
    if (idx === -1) {
      const sent = await embed.replyError(
        message,
        `\`${word}\` n’est pas présent dans la liste des mots interdits.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
      return;
    }

    list.splice(idx, 1);
    db.setAntiraidConfig(guildId, 'badwordList', JSON.stringify(list));

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `\`${word}\` a été retiré de la liste des mots interdits.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  if (sub === 'list') {
    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title : 'Mots interdits',
            fields: [
              {
                name   : `${list.length} mot(s)`,
                value  : list.length
                  ? list.map(w => `\`${w}\``).join(', ').slice(0, 1024)
                  : 'Aucun mot interdit configuré.',
                inline : false,
              },
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const sent = await embed.replyError(
    message,
    'Utilisez `badword add <mot>`, `badword del <mot>` ou `badword list`.',
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

function _readBadwords(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
