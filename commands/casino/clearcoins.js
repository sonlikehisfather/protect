'use strict';

const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = typeof ContainerBuilder === 'function' && typeof TextDisplayBuilder === 'function';

exports.help = {
  name       : 'clearcoins',
  description: 'Remettre a zero les coins d\'un utilisateur.',
  use        : 'clearcoins <@user/ID>',
  usage      : 'clearcoins @user',
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

  const cfg = db.getCasinoConfig(guildId);
  const targetUser = db.getCasinoUser(guildId, target.id);
  const current = targetUser.coins ?? 0;

  if (current <= 0) {
    return embed.replyError(message, `<@${target.id}> n'a aucun coin.`);
  }

  db.removeCasinoCoins(guildId, target.id, current, 'admin');

  const { sendCasinoLog } = require('./casino');
  sendCasinoLog(message.guild, cfg, 'logChannelGains', {
    icon  : '×',
    title : 'Clear Coins',
    color : 0xED4245,
    user  : target.id,
    lines : [
      `× **-${embed.fmtCoins(current)}** coins (solde remis a zero)`,
      `> par <@${authorId}>`,
    ],
  });

  if (V2_AVAILABLE) {
    const after = db.getCasinoUser(guildId, target.id);
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## × Clear Coins\n\n× **-${embed.fmtCoins(current)}** coins ← <@${target.id}>\n▱ Nouveau solde : **${embed.fmtCoins(after.coins)}**`
    ));
    return message.reply({ components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } });
  }

  return embed.reply(message,
    `**${embed.fmtCoins(current)}** coins retires a <@${target.id}>. Solde : 0.`,
    { title: '× Clear Coins', color: '#ED4245' }
  );
};
