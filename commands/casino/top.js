'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';


exports.help = {
  name       : 'top',
  description: 'Classement des plus riches.',
  use        : 'top',
  usage      : 'top',
  category   : 'casino',
  aliases    : ['topcoins'],
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const top = db.getTopCasino(guildId, 10);

  if (!top.length) {
    return embed.reply(message, 'Aucun joueur classe.');
  }

  let description = '';
  for (let i = 0; i < top.length; i++) {
    const { userId, coins, draws, vipTier } = top[i];
    const member = message.guild.members.cache.get(userId);
    const name   = member ? member.user.username : '?';
    const rank   = i + 1;

    const medals = ['①', '②', '③'];
    const prefix = medals[i] ?? `#${rank}`;

    const vip = vipTier > 0 ? ` ◆ V${vipTier}` : '';
    description += `${prefix} **${name}** ・ ${embed.fmtCoins(coins)} coins${draws > 0 ? ` ◆ ${draws}T` : ''}${vip}\n`;
  }

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ★ Top Coins\n\n${description}`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return message.reply({ embeds: [embed.build(guildId, description, { title: '★ Top Coins', color: '#FFD700' })] });
};
