'use strict';

const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../core/database');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const RESPONSES = [
  { text: 'C\'est certain.',           color: '#57F287', emoji: '✔' },
  { text: 'Sans aucun doute.',         color: '#57F287', emoji: '✔' },
  { text: 'Oui, absolument.',          color: '#57F287', emoji: '✔' },
  { text: 'Probablement.',             color: '#57F287', emoji: '✔' },
  { text: 'Oui.',                      color: '#57F287', emoji: '✔' },
  { text: 'Les signes disent oui.',    color: '#57F287', emoji: '✔' },
  { text: 'Redemande plus tard.',      color: '#F1C40F', emoji: '⏳' },
  { text: 'Mieux vaut ne pas te dire.',color: '#F1C40F', emoji: '🤐' },
  { text: 'Impossible à prédire.',     color: '#F1C40F', emoji: '❓' },
  { text: 'Concentre-toi et redemande.',color: '#F1C40F', emoji: '💭' },
  { text: 'N\'y compte pas.',          color: '#ED4245', emoji: '✖' },
  { text: 'Ma réponse est non.',       color: '#ED4245', emoji: '✖' },
  { text: 'Mes sources disent non.',   color: '#ED4245', emoji: '✖' },
  { text: 'Très douteux.',             color: '#ED4245', emoji: '✖' },
  { text: 'Non.',                      color: '#ED4245', emoji: '✖' },
];

exports.help = {
  name        : '8ball',
  description : 'Pose une question à la boule magique.',
  use         : '8ball <question>',
  usage       : '8ball <question>',
  aliases     : ['ask', 'boule'],
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

  const question = args.join(' ').trim();

  if (!question) {
    const sent = await embed.replyError(
      message,
      'Pose une question ! Exemple : `+8ball Suis-je le meilleur ?`',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

  let sent;
  if (V2_AVAILABLE) {
    const body = [
      `## 🎱 8-Ball`,
      ``,
      `**Question**`,
      question.slice(0, 900),
      ``,
      `**Réponse**`,
      `${response.emoji} ${response.text}`,
    ].join('\n');
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    sent = await message.reply({
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).catch(() => null);
  } else {
    sent = await message.reply({
      embeds: [
        embed.build(guildId, null, {
          title  : '🎱 8-Ball',
          fields : [
            { name: 'Question', value: question.slice(0, 1000), inline: false },
            { name: 'Réponse',  value: `${response.emoji} ${response.text}`, inline: false },
          ],
          color  : response.color,
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  // Ajouter XP pour la participation
  db.addXp(guildId, message.author.id, 5);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
