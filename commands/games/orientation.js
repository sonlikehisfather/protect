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

const ORIENTATIONS = [
  { key: 'Homosexuel',    emoji: '🏳️‍🌈' },
  { key: 'Hétérosexuel',  emoji: '〰️'  },
  { key: 'Bisexuel',      emoji: '💜'  },
  { key: 'Asexuel',       emoji: '🖤'  },
  { key: 'Pansexuel',     emoji: '💛'  },
  { key: 'Curieux',       emoji: '🤔'  },
];

function _generate(userId) {
  const seed  = [...userId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand  = (n) => Math.floor((Math.sin(seed + n) * 43758.5453123) % 1 * 100 + 100) % 100;

  const picks   = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5).slice(0, 2);
  let remaining = 100;
  const results = [];

  for (let i = 0; i < picks.length; i++) {
    const pct = i === picks.length - 1 ? remaining : Math.max(1, Math.floor(Math.random() * (remaining - (picks.length - i - 1))) + 1);
    remaining -= pct;
    results.push({ ...ORIENTATIONS[picks[i]], pct });
  }

  return results.sort((a, b) => b.pct - a.pct);
}

exports.help = {
  name        : 'orientation',
  description : 'Découvre ton orientation sexuelle.',
  use         : 'orientation [@mention | ID | nom]',
  usage       : 'orientation [@mention | ID | nom]',
  aliases     : ['ori', 'sexual', 'sexualite'],
  category    : 'games',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;

  const conf        = db.getGuildConfig(guildId);
  const deleteCmd   = Boolean(conf?.autoDeleteInfoCmds);
  const deleteReply = Boolean(conf?.autoDeleteInfoReplies);
  const deleteDelay = Number(conf?.autoDeleteDelay ?? 5);

  if (deleteCmd) await message.delete().catch(() => {});

  let target = message.mentions.members?.first() ?? null;

  if (!target && args[0]) {
    const query = args[0].replace(/[<@!>]/g, '');
    target = message.guild.members.cache.get(query)
      ?? message.guild.members.cache.find(m =>
        m.user.username.toLowerCase() === args[0].toLowerCase() ||
        m.displayName.toLowerCase()   === args[0].toLowerCase()
      )
      ?? await message.guild.members.fetch(query).catch(() => null);
  }

  if (!target) target = message.member;

  const results = _generate(target.id);
  const avatar  = target.user.displayAvatarURL({ extension: 'png', size: 128 });

  const lines = results.map(r => `${r.emoji} · **${r.pct}%** ${r.key}`).join('\n');

  let sent;
  if (V2_AVAILABLE) {
    const body = [
      `## Calculateur d'orientation`,
      ``,
      `**<@${target.id}> est :**`,
      lines,
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
          title     : "Calculateur d'orientation sexuelle",
          fields    : [
            { name: '\u200b', value: `**<@${target.id}> est :**\n${lines}`, inline: true },
          ],
          thumbnail : avatar,
          timestamp : false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
};
