'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'givetirage',
  description: 'Donner des tirages a un utilisateur.',
  use        : 'givetirage <@user/ID> <nombre>',
  usage      : 'givetirage @user 5',
  category   : 'casino',
  selfManaged: true,
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const authorId = message.author.id;

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
    const current = targetUser.draws ?? 0;
    if (cfg.limitMaxDraws > 0) {
      amount = cfg.limitMaxDraws - current;
      if (amount <= 0) {
        return embed.replyError(message, `<@${target.id}> a déjà atteint le plafond de **${cfg.limitMaxDraws}** tirages.`);
      }
    } else {
      amount = 1000000;
    }
  } else {
    amount = parseInt(rawAmount);
  }
  if (!amount || amount < 1) {
    return embed.replyError(message, 'Nombre invalide.');
  }

  // Check max draws cap
  if (cfg.limitMaxDraws > 0) {
    const targetUser = db.getCasinoUser(guildId, target.id);
    const current = targetUser.draws ?? 0;
    if (current >= cfg.limitMaxDraws) {
      return embed.replyError(message, `<@${target.id}> a déjà atteint le plafond de **${cfg.limitMaxDraws}** tirages (solde actuel : **${current}**). Impossible d'en ajouter.`);
    }
    const maxAddable = cfg.limitMaxDraws - current;
    if (amount > maxAddable) {
      return embed.replyError(message, `Ce montant dépasserait le plafond de **${cfg.limitMaxDraws}** tirages.\n<@${target.id}> a actuellement **${current}** tirages ・ maximum ajoutables : **${maxAddable}**.`);
    }
  }

  // Add draws
  db.addCasinoDraws(guildId, target.id, amount);

  // Log if channel configured (V2)
  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '✸',
    title : 'Give Tirages',

    lines : [
      `◆ **+${amount}** tirage${amount !== 1 ? 's' : ''} → <@${target.id}>`,
      `> par <@${authorId}>`,
    ],
  });

  if (V2_AVAILABLE) {
    const after = db.getCasinoUser(guildId, target.id);
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ✸ Give Tirages\n\n◆ **+${amount}** tirage${amount !== 1 ? 's' : ''} → <@${target.id}>\n▱ Nouveau solde : **${after.draws}** tirage${after.draws !== 1 ? 's' : ''}`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `+${amount} tirage(s) ajoutés à <@${target.id}>.`,
    { title: '✸ Give Tirages' }
  );
};
