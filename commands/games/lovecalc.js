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

function _hashScore(id1, id2) {
  const key = [id1, id2].sort().join(':');
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 101;
}

function _bar(percent) {
  const filled = Math.round(percent / 10);
  const empty  = 10 - filled;
  return '❤️'.repeat(filled) + '🖤'.repeat(empty);
}

function _comment(percent) {
  if (percent >= 95) return 'C\'est le grand amour, une âme sœur ! 💍';
  if (percent >= 85) return 'Vous êtes faits l\'un pour l\'autre ! 😍';
  if (percent >= 75) return 'Une belle complicité, ça sent fort ! 💕';
  if (percent >= 65) return 'Il y a du potentiel, continuez comme ça ! 😊';
  if (percent >= 50) return 'Pas mal, mais il reste du chemin à faire… 💭';
  if (percent >= 35) return 'C\'est tiède, à travailler ensemble ! 😅';
  if (percent >= 20) return 'L\'étincelle est là mais très faible… 🕯️';
  if (percent >= 10) return 'Plutôt amis que amoureux ! 👫';
  return 'Aucune compatibilité détectée… 💔';
}

async function _resolveMember(guild, query) {
  if (!query) return null;

  if (query.toLowerCase() === 'random') {
    const members = guild.members.cache.filter(m => !m.user.bot);
    if (!members.size) return null;
    const arr = [...members.values()];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const clean = query.replace(/[<@!>]/g, '');
  if (/^\d{17,20}$/.test(clean)) {
    return guild.members.cache.get(clean)
      ?? await guild.members.fetch(clean).catch(() => null);
  }

  const lower = query.toLowerCase();
  return guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lower ||
    m.displayName.toLowerCase()   === lower,
  ) ?? null;
}

module.exports = {
  help: {
    name        : 'lovecalc',
    description : 'Calcule le pourcentage d\'amour entre deux membres.',
    usage       : 'lovecalc [@membre1/nom/random/id] [@membre2/nom/random/id]',
    aliases     : ['love', 'ship'],
    category    : 'games',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);
    const prefix      = config?.prefix || '+';

    if (deleteCmd) await message.delete().catch(() => {});

    const query1 = args[0];
    const query2 = args[1];

    if (!query1 || !query2) {
      const s = await embed.replyError(
        message,
        `Utilisation : \`${prefix}lovecalc [@membre1/nom/random/id] [@membre2/nom/random/id]\``,
        { timestamp: false },
      ).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const [m1, m2] = await Promise.all([
      _resolveMember(message.guild, query1),
      _resolveMember(message.guild, query2),
    ]);

    if (!m1) {
      const s = await embed.replyError(message, `Membre introuvable : \`${query1}\`.`, { timestamp: false }).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }
    if (!m2) {
      const s = await embed.replyError(message, `Membre introuvable : \`${query2}\`.`, { timestamp: false }).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const percent = _hashScore(m1.id, m2.id);
    const bar     = _bar(percent);
    const comment = _comment(percent);
    const name1   = m1.displayName;
    const name2   = m2.displayName;

    if (!V2_AVAILABLE) {
      const s = await embed.reply(message, null, {
        title     : '💘 Love Calculator',
        timestamp : false,
        fields    : [
          { name: 'Couple',      value: `**${name1}** ❤️ **${name2}**`,  inline: false },
          { name: 'Compatibilité', value: `${bar}\n**${percent}%**`,     inline: false },
          { name: 'Verdict',     value: comment,                          inline: false },
        ],
      }).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const body = [
      `## 💘 Love Calculator`,
      ``,
      `**${name1}** ❤️ **${name2}**`,
      ``,
      `${bar}`,
      ``,
      `### ${percent}%`,
      ``,
      `> ${comment}`,
    ].join('\n');

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const panel = await message.channel.send({
      components      : [container],
      flags           : COMPONENTS_V2_FLAG,
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!panel) return;
    if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
  },
};
