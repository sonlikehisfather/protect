'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

exports.help = {
  name       : 'bal',
  description: 'Affiche votre solde de coins et tirages.',
  use        : 'bal [@user]',
  usage      : 'bal',
  category   : 'casino',
  aliases    : ['balance', 'solde'],
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const target = message.mentions.users.first()
    || (args[0] ? message.guild.members.cache.get(args[0])?.user : null)
    || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null)
    || message.author;

  const member      = message.guild.members.cache.get(target.id);
  const user        = db.getCasinoUser(guildId, target.id);
  const displayName = member?.displayName ?? target.username;

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ◈ Solde ・ ${displayName}\n\n` +
        `※ **${embed.fmtCoins(user.coins)}** coins\n` +
        `◆ **${user.draws}** tirage${user.draws !== 1 ? 's' : ''}`
      ));
    return message.reply({
      components: [container],
      flags: COMPONENTS_V2_FLAG,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  return embed.reply(message,
    `**${displayName}**\n` +
    `※ **${embed.fmtCoins(user.coins)}** coins\n` +
    `◆ **${user.draws}** tirage${user.draws !== 1 ? 's' : ''}`,
    { }
  );
};
