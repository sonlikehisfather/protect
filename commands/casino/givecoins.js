'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'givecoins',
  description: 'Donner des coins a un utilisateur.',
  use        : 'givecoins <@user/ID> <montant>',
  usage      : 'givecoins @user 5000',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const authorId = message.author.id;

  // Check permissions: owner, buyer, or casino manager
  const permAllowed = perms.isBuyer(authorId) || perms.isOwner(guildId, authorId);
  if (!permAllowed) {
    const isManager = db.isCasinoManager(guildId, authorId);
    if (!isManager) {
      return embed.replyError(message, 'Tu dois être gérant casino, owner ou buyer pour utiliser cette commande.');
    }
  }

  const target = message.mentions.users.first()
    || message.guild.members.cache.get(args[0])?.user
    || await client.users.fetch(args[0]).catch(() => null);
  if (!target) {
    return embed.replyError(message, 'Utilisateur invalide. Mention ou ID requis.');
  }

  const rawAmount = args.slice(1).join('').replace(/[\s.,_]/g, '');
  const cfg = db.getCasinoConfig(guildId);
  if (!cfg.enabled) {
    return embed.replyError(message, 'Le casino n\'est pas active.');
  }

  let amount;
  if (rawAmount.toLowerCase() === 'all') {
    const targetUser = db.getCasinoUser(guildId, target.id);
    const current = targetUser.coins ?? 0;
    if (cfg.limitMaxCoins > 0) {
      amount = cfg.limitMaxCoins - current;
      if (amount <= 0) {
        return embed.replyError(message, `<@${target.id}> a déjà atteint le plafond de **${embed.fmtCoins(cfg.limitMaxCoins)}** coins.`);
      }
    } else {
      amount = 1000000000;
    }
  } else {
    amount = parseInt(rawAmount);
  }
  if (!amount || amount < 1) {
    return embed.replyError(message, 'Montant invalide.');
  }

  // Check max coins cap
  if (cfg.limitMaxCoins > 0) {
    const targetUser = db.getCasinoUser(guildId, target.id);
    const current = targetUser.coins ?? 0;
    if (current >= cfg.limitMaxCoins) {
      return embed.replyError(message, `<@${target.id}> a déjà atteint le plafond de **${embed.fmtCoins(cfg.limitMaxCoins)}** coins (solde actuel : **${embed.fmtCoins(current)}**). Impossible d'ajouter des coins.`);
    }
    const maxAddable = cfg.limitMaxCoins - current;
    if (amount > maxAddable) {
      return embed.replyError(message, `Ce montant dépasserait le plafond de **${embed.fmtCoins(cfg.limitMaxCoins)}** coins.
<@${target.id}> a actuellement **${embed.fmtCoins(current)}** coins ・ maximum ajoutables : **${embed.fmtCoins(maxAddable)}** coins.`);
    }
  }

  // Add coins
  db.addCasinoCoins(guildId, target.id, amount, 'admin');

  // Log if channel configured (V2)
  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '✸',
    title : 'Give Coins',
    color : 0x57F287,
    lines : [
      `※ **+${embed.fmtCoins(amount)}** coins → <@${target.id}>`,
      `> par <@${authorId}>`,
    ],
  });

  if (V2_AVAILABLE) {
    const after = db.getCasinoUser(guildId, target.id);
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ✸ Give Coins\n\n※ **+${embed.fmtCoins(amount)}** coins → <@${target.id}>\n▱ Nouveau solde : **${embed.fmtCoins(after.coins)}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `+${embed.fmtCoins(amount)} coins ajoutés à <@${target.id}>.`,
    { title: '✸ Give Coins', color: '#57F287' }
  );
};
