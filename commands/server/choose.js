'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'choose',
    description : 'Lance un tirage au sort instantané parmi plusieurs choix.',
    usage       : 'choose <choix 1>, <choix 2>, <choix 3>',
    aliases     : ['choice', 'random'],
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

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const raw = args.join(' ').trim();

    if (!raw) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}choose <choix 1>, <choix 2>, <choix 3>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const choices = _parseChoices(raw);

    if (choices.length < 2) {
      const sent = await embed.replyError(
        message,
        'Vous devez indiquer au moins deux choix séparés par une virgule.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (choices.length > 50) {
      const sent = await embed.replyError(
        message,
        'Vous ne pouvez pas indiquer plus de 50 choix.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const invalid = choices.find(choice => choice.length > 256);

    if (invalid) {
      const sent = await embed.replyError(
        message,
        'Chaque choix doit faire 256 caractères maximum.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const selected = choices[Math.floor(Math.random() * choices.length)];

    const displayedChoices = choices.slice(0, 15);
let list = displayedChoices
  .map((choice, index) => `\`${index + 1}.\` ${_truncate(choice, 80)}`)
  .join('\n');

const extra = choices.length > 15
  ? `\nEt \`${choices.length - 15}\` autre(s) choix.`
  : '';

list = _truncate(`${list}${extra}`, 1024);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `Choix sélectionné : **${selected}**`,
          {
            title: 'Tirage au sort',
            fields: [
              {
                name  : 'Choix proposés',
                value : list,
                inline: false,
              },
            ],
            timestamp: false,
          }
        ),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

function _parseChoices(raw) {
  return raw
    .split(',')
    .map(choice => choice.trim())
    .filter(Boolean)
    .filter((choice, index, array) =>
      array.findIndex(other => other.toLowerCase() === choice.toLowerCase()) === index
    );
}

function _truncate(value, max) {
  const text = String(value || '');
  const cut  = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
  return embed.breakLongTokens(cut);
}
