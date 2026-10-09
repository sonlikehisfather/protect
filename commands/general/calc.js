'use strict';


const { evaluate } = require('mathjs');

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'calc',
    description : 'Effectue un calcul mathématique.',
    usage       : 'calc <expression>',
    aliases     : ['calculate', 'math'],
    defaultPermission: 'everyone',
  },

  async run(client, message, args) {

    const guild = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const expression = args.join(' ').trim();

    if (!expression) {
      return embed.replyError(
        message,
        'Donnez une expression.\nExemple : `calc 5+5`'
      );
    }


    if (expression.length > 100) {
      return embed.replyError(
        message,
        'Expression trop longue.'
      );
    }

    let result;
    try {
      result = evaluate(expression);
    } catch {
      return embed.replyError(
        message,
        'Expression invalide.'
      );
    }

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return embed.replyError(
        message,
        'Expression invalide.'
      );
    }

    const text = `## Calcul\n\nExpression › \`${expression}\`\nRésultat › \`${formatResult(result)}\``;

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title : 'Calcul',
            fields: [
              { name: 'Expression', value: `\`${expression}\``, inline: false },
              { name: 'Résultat', value: `\`${formatResult(result)}\``, inline: false },
            ],
            timestamp : false,
          }),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

  },
};

function formatResult(value) {

  if (Number.isInteger(value)) {
    return value.toString();
  }

  return Number(value.toFixed(6)).toString();

}
