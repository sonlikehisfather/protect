'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../core/database');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

exports.help = {
  name        : 'guess',
  description : 'Jeu du Plus ou Moins — Écris un nombre, le bot dit + ou -.',
  use         : 'guess [max]',
  usage       : 'guess 100',
  aliases     : ['devine', 'nombre', 'plusmoins'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId     = message.guild.id;
  const guildConfig = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  const maxNumber   = Math.min(Math.max(parseInt(args[0], 10) || 100, 10), 1000);
  const target      = Math.floor(Math.random() * (maxNumber + 1));
  let attempts      = 0;
  const maxAttempts = Math.ceil(Math.log2(maxNumber)) + 3;

  const _v2 = (text) => {
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    return { components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
  };

  const introText = [
    `## 🎯 Plus ou Moins`,
    ``,
    `J'ai choisi un nombre entre **0** et **${maxNumber}**…`,
    ``,
    `Écris un nombre dans le chat — je te dirai ⬆️ PLUS ou ⬇️ MOINS !`,
    `**Essais max** : ${maxAttempts}`,
  ].join('\n');

  const sent = V2_AVAILABLE
    ? await message.reply(_v2(introText)).catch(() => null)
    : await message.reply({
        embeds: [embed.build(guildId, null, {
          title: '🎯 Plus ou Moins',
          description: `J'ai choisi un nombre entre **0** et **${maxNumber}**…`,
          fields: [{ name: '⏳ Essais max', value: `${maxAttempts}`, inline: true }],
          color: '#3498DB', timestamp: false,
        })],
        allowedMentions: { parse: [] },
      }).catch(() => null);

  if (!sent) return;

  const collector = message.channel.createMessageCollector({
    filter: m => {
      const num = parseInt(m.content, 10);
      return m.author.id === message.author.id && !isNaN(num) && num >= 0 && num <= maxNumber;
    },
    time: 120_000,
  });

  collector.on('collect', async m => {
    const guess     = parseInt(m.content, 10);
    attempts++;
    m.delete().catch(() => {});

    if (guess === target) { collector.stop('won'); return; }
    if (attempts >= maxAttempts) { collector.stop('lost'); return; }

    const hint      = guess < target ? '⬆️ C\'est PLUS !' : '⬇️ C\'est MOINS !';
    const remaining = maxAttempts - attempts;
    const bar       = '█'.repeat(remaining) + '░'.repeat(maxAttempts - remaining);

    if (V2_AVAILABLE) {
      await sent.edit(_v2([
        `## ${hint}`,
        ``,
        `**Essai ${attempts}/${maxAttempts}** — tu as proposé **${guess}**`,
        ``,
        `\`${bar}\` (${remaining} restant${remaining > 1 ? 's' : ''})`,
      ].join('\n'))).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, null, {
          title: hint,
          description: `Essai **${attempts}/${maxAttempts}** — proposé **${guess}**`,
          color: guess < target ? '#E74C3C' : '#3498DB', timestamp: false,
        })],
      }).catch(() => {});
    }
  });

  collector.on('end', async (_, reason) => {
    let text, xpGain;
    if (reason === 'won') {
      xpGain = Math.max((maxAttempts - attempts) * 15, 10);
      db.addXp(guildId, message.author.id, xpGain);
      text = `## 🎉 BRAVO — TROUVÉ !\n\n Le nombre était **${target}** !\nTrouvé en **${attempts}** essai${attempts > 1 ? 's' : ''} !\n\n✨ **+${xpGain} XP** gagnés !`;
    } else if (reason === 'lost') {
      db.addXp(guildId, message.author.id, 5);
      text = `## 💥 GAME OVER\n\n Plus d'essais !\nLe nombre mystère était **${target}**.\n\n✨ **+5 XP** pour la participation !`;
    } else {
      text = `## Temps écoulé !\n\nPartie abandonnée — le nombre était **${target}**.`;
    }

    if (V2_AVAILABLE) {
      await sent.edit(_v2(text)).catch(() => {});
    } else {
      await sent.edit({
        embeds: [embed.build(guildId, text.replace(/## .+\n\n/, ''), { timestamp: false })],
      }).catch(() => {});
    }
  });

  if (deleteReply) embed.scheduleDelete(sent, deleteDelay);
};

