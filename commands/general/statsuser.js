'use strict';

const { AttachmentBuilder } = require('discord.js');
const db = require('../../core/database');
const embed = require('../../utils/embed');
const { resolveMember } = require('../../utils/memberResolver');
const { generateUserStatsImage } = require('../../utils/userStatsImage');

module.exports = {
  help: {
    name: 'statsuser',
    description: "Affiche les statistiques vocales et messages d'un membre, avec ses classements.",
    usage: 'statsuser [@membre|id|nom]',
    aliases: ['su'],
    category: 'general',
  },

  async run(client, message, args) {
    const guild = message.guild;
    if (!guild) return;

    const config = db.getGuildConfig(guild.id);
    const deleteCmd = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    let member = null;
    if (args.length) {
      member = message.mentions.members.first() ?? await resolveMember(message, args);
    } else if (message.reference?.messageId) {
      const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (replied?.author) {
        member = guild.members.cache.get(replied.author.id)
          ?? await guild.members.fetch(replied.author.id).catch(() => null);
      }
    } else {
      member = message.member;
    }

    if (!member || member.guild.id !== guild.id) {
      const sent = await embed.replyError(message, 'Membre introuvable sur ce serveur.', { timestamp: false })
        .catch(err => {
          console.error('[STATSUSER] Failed to report missing member:', err?.message);
          return null;
        });
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (member.user.bot) {
      const sent = await embed.replyError(message, 'Les statistiques de cette commande sont réservées aux membres humains.', { timestamp: false })
        .catch(err => {
          console.error('[STATSUSER] Failed to report bot target:', err?.message);
          return null;
        });
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    try {
      let serverMembers = guild.members.cache;
      if (serverMembers.size < guild.memberCount) {
        try {
          serverMembers = await guild.members.fetch();
        } catch (err) {
          console.error('[STATSUSER] Failed to fetch guild members for ranking:', err?.message);
          const sent = await embed.replyError(
            message,
            'Impossible de récupérer le classement complet du serveur. Réessaie dans un instant.',
            { timestamp: false },
          ).catch(sendErr => {
            console.error('[STATSUSER] Failed to report unavailable ranking:', sendErr?.message);
            return null;
          });
          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }
      }

      const activityRows = db.getGuildActivityStats(guild.id)
        .filter(row => serverMembers.get(row.userId) && !serverMembers.get(row.userId).user.bot);
      const targetStats = activityRows.find(row => row.userId === member.id);
      const stats = {
        totalMessages: Number(targetStats?.totalMessages) || 0,
        recentMessages: Number(targetStats?.recentMessages) || 0,
        recentVoiceSeconds: Number(targetStats?.recentVoiceSeconds) || 0,
        voiceSeconds: Number(targetStats?.voiceSeconds) || 0,
      };
      stats.messageRank = stats.totalMessages > 0
        ? 1 + activityRows.filter(row => row.totalMessages > stats.totalMessages).length
        : null;
      stats.voiceRank = stats.voiceSeconds > 0
        ? 1 + activityRows.filter(row => row.voiceSeconds > stats.voiceSeconds).length
        : null;

      const voiceStats = db.getVoiceStats(guild.id, member.id);

      const voiceSeconds = Math.max(0, Number(stats.voiceSeconds) || 0);
      const voiceSubtitle = voiceStats?.lastStaleClearAt
        ? 'Une session vocale a été interrompue au redémarrage'
        : member.voice.channelId
          ? 'En vocal actuellement'
          : 'Temps total suivi sur le serveur';

      const image = await generateUserStatsImage({
        guildName: guild.name,
        guildIconUrl: guild.iconURL({ extension: 'png', size: 128 }),
        memberName: member.displayName,
        username: member.user.username,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
        joinedAt: member.joinedTimestamp,
        voiceSeconds,
        messageCount: stats.totalMessages,
        recentMessageCount: stats.recentMessages,
        recentVoiceSeconds: stats.recentVoiceSeconds,
        voiceRank: stats.voiceRank,
        messageRank: stats.messageRank,
        isInVoice: Boolean(member.voice.channelId),
        voiceSubtitle,
      });

      const attachment = new AttachmentBuilder(image, { name: 'stats-membre.png' });
      const sent = await message.reply({
        files: [attachment],
        allowedMentions: { repliedUser: false, parse: [] },
      }).catch(err => {
        console.error('[STATSUSER] Failed to send statistics image:', err?.message);
        return null;
      });
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    } catch (err) {
      console.error('[STATSUSER] Failed to generate member statistics:', err);
      const sent = await embed.replyError(message, 'Impossible de récupérer ou générer les statistiques de ce membre.', { timestamp: false })
        .catch(sendErr => {
          console.error('[STATSUSER] Failed to report statistics error:', sendErr?.message);
          return null;
        });
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
