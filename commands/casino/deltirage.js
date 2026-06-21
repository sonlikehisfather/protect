'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'deltirage',
  description: 'Retirer des tirages a un utilisateur.',
  use        : 'deltirage <@user/ID> <nombre|all>',
  usage      : 'deltirage @user 5',
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
      return embed.replyError(message, 'Tu dois etre gerant casino, owner ou buyer pour utiliser cette commande.');
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
  const current = targetUser.draws ?? 0;

  let amount;
  if (rawAmount.toLowerCase() === 'all') {
    amount = current;
  } else {
    amount = parseInt(rawAmount);
  }
  if (!amount || amount < 1) {
    return embed.replyError(message, 'Nombre invalide.');
  }
  if (current <= 0) {
    return embed.replyError(message, `<@${target.id}> n'a aucun tirage a retirer.`);
  }

  const effective = Math.min(amount, current);
  db.removeCasinoDraws(guildId, target.id, effective);

  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '↺',
    title : 'Remove Tirages',
    color : 0xED4245,
    lines : [
      `◆ **-${effective}** tirage${effective !== 1 ? 's' : ''} ← <@${target.id}>`,
      `> par <@${authorId}>${effective < amount ? ` (plafonne ・ solde etait ${current})` : ''}`,
    ],
  });

  if (V2_AVAILABLE) {
    const after = db.getCasinoUser(guildId, target.id);
    const capNote = effective < amount ? `\n⚑ Demande : ${embed.fmtCoins(amount)} ・ plafonne au solde` : '';
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ↺ Del Tirages\n\n◆ **-${effective}** tirage${effective !== 1 ? 's' : ''} ← <@${target.id}>${capNote}\n▱ Nouveau solde : **${after.draws}** tirage${after.draws !== 1 ? 's' : ''}`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  const note = effective < amount ? `\n*(demande : ${embed.fmtCoins(amount)} ・ plafonne au solde)*` : '';
  return embed.reply(message,
    `**${effective}** tirage(s) retire(s) a <@${target.id}>.${note}`,
    { title: '↺ Remove Tirages', color: '#ED4245' }
  );
};
