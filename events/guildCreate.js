'use strict';


const db    = require('../core/database');
const perms = require('../utils/permissions');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
  name : 'guildCreate',
  once : false,

  async execute(client, guild) {
    try {


      try { db.unmarkGuildPendingPurge(guild?.id); } catch {}


      await _sendServerJoinNotification(client, guild);


      if (db.getBotSetting('securInvite') !== '1') return;

      const ownerId = guild.ownerId;

      if (ownerId && (perms.isBuyer(ownerId) || perms.isOwner(guildId,ownerId))) {
        console.log(`[SecurInvite] Serveur autorisé : ${guild.name} (${guild.id}) - owner autorisé (${ownerId})`);
        return;
      }


      const globalOwnerIds = db.getGlobalOwners();
      const buyerId        = perms.getBuyerId();

      const trustedIds = new Set(globalOwnerIds);
      if (buyerId) trustedIds.add(buyerId);


      let found = false;

      for (const id of trustedIds) {
        if (guild.members.cache.has(id)) {
          found = true;
          break;
        }
      }


      if (!found && trustedIds.size > 0) {
        for (const id of trustedIds) {
          const member = await guild.members.fetch(id).catch(() => null);
          if (member) {
            found = true;
            break;
          }
        }
      }

      if (found) {
        console.log(`[SecurInvite] Serveur autorisé : ${guild.name} (${guild.id}) - membre autorisé présent`);
        return;
      }

      console.log(`[SecurInvite] Serveur non autorisé : ${guild.name} (${guild.id}) - leave`);


      try {
        const channel = guild.channels.cache.find(ch =>
          ch.isTextBased() &&
          !ch.isThread() &&
          ch.permissionsFor(guild.members.me)?.has('SendMessages')
        );

        if (channel) {
          await channel.send({
            content         : '⚑ Ce serveur n\'est pas autorisé. Le bot quitte automatiquement.',
            allowedMentions : { parse: [] },
          }).catch(() => {});
        }
      } catch {
      }

      await guild.leave().catch(() => {});
    } catch (err) {
      console.error(`[SecurInvite] Erreur sur ${guild?.name ?? '?'} (${guild?.id ?? '?'}) :`, err.message);
    }
  },
};


async function _sendServerJoinNotification(client, guild) {
  const buyerId = perms.getBuyerId();
  if (!buyerId) return;

  try {
    const owner = await client.users.fetch(buyerId).catch(() => null);
    if (!owner) return;

    await guild.members.fetch().catch(() => {});

    const humans = guild.members.cache.filter(m => !m.user.bot).size;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const channels = guild.channels.cache.size;
    const roles = guild.roles.cache.size;

    try {
      const iconUrl = guild.iconURL({ dynamic: true, size: 256 });
      
      const embed = new EmbedBuilder()
        .setTitle('Serveur ajouté')
        .setDescription(`**${guild.name}**`)
        .setColor('#3498DB');
      
      if (iconUrl) embed.setThumbnail(iconUrl);
      
      embed.addFields(
        { name: 'Ajouté par', value: `<@${guild.ownerId}> \`(${guild.ownerId})\``, inline: false },
        { name: 'Membres', value: `Total **${guild.memberCount}**\nHumains **${humans}** • Bots **${bots}**`, inline: true },
        { name: 'Salons', value: `**${channels}**`, inline: true },
        { name: 'Rôles', value: `**${roles}**`, inline: true },
        { name: 'Vérification', value: String(guild.verificationLevel || 'Aucune'), inline: true },
        { name: 'Boost', value: `Niveau • **${guild.premiumTier ?? 0}** • **${guild.premiumSubscriptionCount ?? 0}** boosts`, inline: true },
        { name: 'Locale', value: guild.preferredLocale || 'Non définie', inline: true }
      );
      
      embed.setFooter({ text: `ID • ${guild.id}` });
      embed.setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`server_invite_${guild.id}`)
          .setLabel('Créer une invitation')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`server_leave_${guild.id}`)
          .setLabel('Quitter le serveur')
          .setStyle(ButtonStyle.Danger)
      );

      await owner.send({ embeds: [embed], components: [row] });
    } catch (sendErr) {
      console.error('[Notification] Erreur détaillée:', sendErr);
      throw sendErr;
    }
  } catch (err) {
    if (err.code === 50007) {
      console.error('[Notification] Le buyer a désactivé les DMs');
    } else {
      console.error('[Notification] Erreur envoi au owner:', err.message, err.code ? `(Code: ${err.code})` : '', err.stack?.split('\n')[0] || '');
    }
  }
}
