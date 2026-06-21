'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

const TAX_RATE = 0.10;


exports.help = {
  name       : 'don',
  description: 'Donne des coins a un autre joueur (taxe 10%).',
  use        : 'don @user <montant>',
  usage      : 'don @user 1000',
  category   : 'casino',
  aliases    : [],
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const userId  = message.author.id;

  if (!db.isCasinoEnabled(guildId)) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  const mention = message.mentions.users.first();
  let target = null;
  let amountArg = null;

  if (mention) {
    target = mention;
    const idx = args.findIndex(a => a === `<@${mention.id}>` || a === `<@!${mention.id}>`);
    const other = args.filter((_, i) => i !== idx).find(a => a && !a.match(/^<@!?\d+>$/));
    amountArg = other ?? args.find(a => a && a.toLowerCase() === 'all');
  } else {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a && a.toLowerCase() === 'all') {
        amountArg = 'all';
        const other = args.find((_, j) => j !== i);
        if (other) target = message.guild.members.cache.get(other)?.user || await client.users.fetch(other).catch(() => null);
      } else if (a && !a.match(/^<@!?\d+>$/) && !parseInt(a)) {
        target = message.guild.members.cache.get(a)?.user || await client.users.fetch(a).catch(() => null);
      }
    }
  }

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable. Mention ou ID requis.');
  }

  if (target.id === userId) {
    return embed.replyError(message, 'Vous ne pouvez pas vous donner a vous-meme.');
  }

  const user = db.getCasinoUser(guildId, userId);

  let amount;
  if (amountArg && amountArg.toLowerCase() === 'all') {
    amount = user.coins;
  } else {
    amount = parseInt(amountArg, 10);
  }
  if (!amount || amount < 100) {
    return embed.replyError(message, 'Minimum **100** coins.');
  }

  if (user.coins < amount) {
    return embed.replyError(message, `Solde insuffisant. Tu as **${embed.fmtCoins(user.coins)}** coins`);
  }

  const tax    = Math.floor(amount * TAX_RATE);
  const net    = amount - tax;

  db.removeCasinoCoins(guildId, userId, amount, 'spend');
  db.addCasinoCoins(guildId, target.id, net, 'win');

  const sender   = db.getCasinoUser(guildId, userId);
  const receiver = db.getCasinoUser(guildId, target.id);

  const cfg = db.getCasinoConfig(guildId);
  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGames', {
    icon  : '➺',
    title : 'Don',
    color : 0x57F287,
    user  : userId,
    lines : [
      `De : <@${userId}> → <@${target.id}>`,
      `Montant : **${embed.fmtCoins(amount)}** coins ・ Taxe : **-${embed.fmtCoins(tax)}** ・ Reçu : **${embed.fmtCoins(net)}**`,
      `Solde ${message.author.username} : **${embed.fmtCoins(sender.coins)}** coins`,
      `Solde ${target.username} : **${embed.fmtCoins(receiver.coins)}** coins`,
    ],
  });

  if (V2_AVAILABLE) {
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ➺ Don

` +
      `※ **${embed.fmtCoins(amount)}** envoyés → taxe 10% → <@${target.id}> reçoit **${embed.fmtCoins(net)}** coins

` +
      `▱ Votre solde : **${embed.fmtCoins(sender.coins)}**
` +
      `▱ Solde de ${target.username} : **${embed.fmtCoins(receiver.coins)}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `Envoyé : ${embed.fmtCoins(amount)} | Taxe : -${embed.fmtCoins(tax)} | Reçu : ${embed.fmtCoins(net)}\n\nVotre solde : ${embed.fmtCoins(sender.coins)} | Solde ${target.username} : ${embed.fmtCoins(receiver.coins)}`,
    { title: '➺ Don', color: '#57F287' }
  );
};
