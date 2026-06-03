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
  name        : 'roll',
  description : 'Lance un dé (6 faces par défaut) ou plusieurs.',
  use         : 'roll [nombre] [faces]',
  usage       : 'roll [nombre] [faces]',
  aliases     : ['dice', 'de', 'des'],
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

  const count = Math.min(Math.max(parseInt(args[0], 10) || 1, 1), 10);
  const faces = Math.min(Math.max(parseInt(args[1], 10) || 6, 2), 100);

  const rolls = [];
  let total = 0;

  for (let i = 0; i < count; i++) {
    const roll = Math.floor(Math.random() * faces) + 1;
    rolls.push(roll);
    total += roll;
  }

  const emojiMap = {
    1: '🎲 **1**', 2: '🎲 **2**', 3: '🎲 **3**', 4: '🎲 **4**', 5: '🎲 **5**', 6: '🎲 **6**',
  };

  const rollDisplay = rolls.map((r, i) => {
    const dieEmoji = faces === 6 ? (emojiMap[r] || `\`${r}\``) : `\`${r}\``;
    return count > 1 ? `**#${i + 1}** : ${dieEmoji}` : dieEmoji;
  }).join('\n');

  const fields = [
    { name: 'Lancer', value: `${count} dé${count > 1 ? 's' : ''} à ${faces} faces`, inline: true },
  ];

  if (count > 1) {
    fields.push({ name: 'Total', value: `\`${total}\``, inline: true });
  }

  fields.push({ name: 'Résultat', value: rollDisplay, inline: false });

  let sent;
  if (V2_AVAILABLE) {
    const lines = [
      `## 🎲 Lancer de dés`,
      ``,
      `**Lancer** : ${count} dé${count > 1 ? 's' : ''} à ${faces} faces`,
    ];
    if (count > 1) lines.push(`**Total** : \`${total}\``);
    lines.push(``, `**Résultat**`, rollDisplay);
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    sent = await message.reply({
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).catch(() => null);
  } else {
    sent = await message.reply({
      embeds: [
        embed.build(guildId, null, {
          title  : '🎲 Lancer de dés',
          fields : fields,
          color  : '#5865F2',
          timestamp: false,
        }),
      ],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  db.addXp(guildId, message.author.id, 5);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
