'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'delcoins',
  description: 'Retirer des coins a un utilisateur.',
  use        : 'delcoins <@user/ID> <montant>',
  usage      : 'delcoins @user 5000',
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

  const targetUser = db.getCasinoUser(guildId, target.id);
  const current = targetUser.coins ?? 0;

  let amount;
  if (rawAmount.toLowerCase() === 'all') {
    amount = current;
  } else {
    amount = parseInt(rawAmount);
  }
  if (!amount || amount < 1) {
    return embed.replyError(message, 'Montant invalide.');
  }
  if (current <= 0) {
    return embed.replyError(message, `<@${target.id}> n'a aucun coin à retirer.`);
  }
  const effective = Math.min(amount, current);

  // Remove coins
  db.removeCasinoCoins(guildId, target.id, effective, 'admin');

  // Log if channel configured (V2)
  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '↺',
    title : 'Remove Coins',

    lines : [
      `※ **-${embed.fmtCoins(effective)}** coins ← <@${target.id}>`,
      `> par <@${authorId}>${effective < amount ? ` (plafonné ・ solde était ${embed.fmtCoins(current)})` : ''}`,
    ],
  });

  if (V2_AVAILABLE) {
    const after = db.getCasinoUser(guildId, target.id);
    const capNote = effective < amount ? `\n⚑ Demandé : ${embed.fmtCoins(amount)} ・ plafonné au solde` : '';
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ↺ Del Coins\n\n※ **-${embed.fmtCoins(effective)}** coins ← <@${target.id}>${capNote}\n▱ Nouveau solde : **${embed.fmtCoins(after.coins)}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  const note = effective < amount ? `\n*(demandé : ${embed.fmtCoins(amount)} ・ plafonné au solde)*` : '';
  return embed.reply(message,
    `**${embed.fmtCoins(effective)}** coins retirés à <@${target.id}>.${note}`,
    { title: '↺ Remove Coins' }
  );
};
