'use strict';

const { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { getCooldowns, checkCasinoChannel } = require('./casino');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

function formatTime(seconds) {
  if (seconds <= 0) return 'Pret';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.ceil(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

exports.help = {
  name       : 'timer',
  description: 'Affiche les cooldowns de toutes les commandes casino.',
  use        : 'timer',
  usage      : 'timer',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas actif.');
  }

  const chErr = checkCasinoChannel(message);
  if (chErr) return embed.replyError(message, chErr);

  const cooldowns = getCooldowns(guildId, userId);

  const readyList = cooldowns.filter(c => c.ready);
  const waitingList = cooldowns.filter(c => !c.ready);

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().setAccentColor(0xFFD700);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## ⏱ Cooldowns Casino\n' +
      `> <@${userId}> voici tes timers restants`
    ));
    container.addSeparatorComponents(new SeparatorBuilder());

    if (waitingList.length) {
      let text = '### En attente\n';
      for (const c of waitingList) {
        text += `> ❃ **${c.name}** ・ ${formatTime(c.remaining)}\n`;
      }
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    }

    if (readyList.length) {
      let text = '### Disponibles\n';
      for (const c of readyList) {
        text += `> ✓ **${c.name}** ・ Pret\n`;
      }
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    }

    if (!waitingList.length && !readyList.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*Aucun cooldown configure.*'));
    }

    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  let text = '**Cooldowns Casino**\n\n';
  for (const c of cooldowns) {
    const icon = c.ready ? '✓' : '❃';
    text += `${icon} **${c.name}** ・ ${formatTime(c.remaining)}\n`;
  }
  return embed.reply(message, text, { title: '⏱ Timer', color: '#FFD700' });
};
