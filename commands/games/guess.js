'use strict';


const embed = require('../../utils/embed');
const db = require('../../core/database');

exports.help = {
  name        : 'guess',
  description : 'Jeu du Plus ou Moins — Écris un nombre, le bot dit + ou -.',
  use         : 'guess [max]',
  usage       : 'guess 100',
  aliases     : ['devine', 'nombre', 'plusmoins'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  const guildConfig = require('../../core/database').getGuildConfig(guildId);
  const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
  const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
  const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  const maxNumber = Math.min(Math.max(parseInt(args[0], 10) || 100, 10), 1000);
  const target = Math.floor(Math.random() * (maxNumber + 1));
  let attempts = 0;
  const maxAttempts = Math.ceil(Math.log2(maxNumber)) + 3;

  const sent = await message.reply({
    embeds: [
      embed.build(guildId, null, {
        title  : '🎯 Plus ou Moins',
        description: `**J'ai choisi un nombre entre 0 et ${maxNumber}...**`,
        fields : [
          { name: '✏️ Comment jouer', value: `Écris un nombre entre **0** et **${maxNumber}** dans le chat.\nJe te dirai si c'est **⬆️ PLUS** ou **⬇️ MOINS** !`, inline: false },
          { name: '⏳ Essais max', value: `${maxAttempts}`, inline: true },
          { name: '� Ta proposition', value: 'En attente...', inline: true },
        ],
        color  : '#3498DB',
        timestamp: false,
      }),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!sent) return;

  const filter = m => {
    const num = parseInt(m.content, 10);
    return (
      m.author.id === message.author.id &&
      !isNaN(num) &&
      num >= 0 &&
      num <= maxNumber
    );
  };

  const collector = message.channel.createMessageCollector({
    filter,
    time: 120_000,
  });

  collector.on('collect', async m => {
    const guess = parseInt(m.content, 10);
    attempts++;

    if (guess === target) {
      collector.stop('won');
      return;
    }

    if (attempts >= maxAttempts) {
      collector.stop('lost');
      return;
    }

    const hint = guess < target ? '⬆️ C\'est PLUS !' : '⬇️ C\'est MOINS !';
    const remaining = maxAttempts - attempts;
    const bar = '█'.repeat(remaining) + '░'.repeat(maxAttempts - remaining);

    await sent.edit({
      embeds: [
        embed.build(guildId, null, {
          title  : hint,
          description: `**Essai ${attempts}/${maxAttempts}** — Tu as proposé **${guess}**`,
          fields : [
            { name: '📊 Dernier essai', value: `**${guess}**`, inline: true },
            { name: '⏳ Essais restants', value: `${bar} (${remaining})`, inline: true },
          ],
          color  : guess < target ? '#E74C3C' : '#3498DB',
          timestamp: false,
        }),
      ],
    }).catch(() => {});

    m.delete().catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    let xpGain = 0;

    if (reason === 'won') {
      // XP basé sur les essais restants : +15 XP par essai restant
      const remaining = maxAttempts - attempts;
      xpGain = Math.max(remaining * 15, 10); // Minimum 10 XP

      db.addXp(guildId, message.author.id, xpGain);

      await sent.edit({
        embeds: [
          embed.build(guildId, null, {
            title  : '🎉 BRAVO ! TROUVÉ !',
            description: `✅ Le nombre était bien **${target}** !\n📊 Trouvé en **${attempts}** essai${attempts > 1 ? 's' : ''} !\n\n✨ **+${xpGain} XP** gagnés !`,
            color  : '#57F287',
            timestamp: false,
          }),
        ],
      }).catch(() => {});
    } else if (reason === 'lost') {
      // 5 XP pour participation
      db.addXp(guildId, message.author.id, 5);

      await sent.edit({
        embeds: [
          embed.build(guildId, null, {
            title  : '💥 GAME OVER',
            description: `❌ Plus d'essais !\n🔢 Le nombre mystère était **${target}**.\n\n✨ **+5 XP** pour la participation !`,
            color  : '#ED4245',
            timestamp: false,
          }),
        ],
      }).catch(() => {});
    } else {
      await sent.edit({
        embeds: [
          embed.build(guildId, null, {
            title  : '⏰ Temps écoulé !',
            description: `⏱️ Partie abandonnée.\n🔢 Le nombre était **${target}**.`,
            color  : '#95A5A6',
            timestamp: false,
          }),
        ],
      }).catch(() => {});
    }
  });

  if (deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};

