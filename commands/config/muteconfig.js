'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { applyMuteOverwriteToChannel } = require('../../utils/applyMuteOverwrites');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'muteconfig',
    description : 'Configure le mode de mute (timeout natif ou rôle).',
    usage       : 'muteconfig | muteconfig setup | muteconfig timeout on|off | muteconfig role <@role>|reset',
    aliases     : ['muteset', 'configmute'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'muteconfig')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    const sub = args[0]?.toLowerCase();
    const me  = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!sub) {
      if (deleteCmd) {
        await message.delete().catch(() => {});
      }


      const useTimeout = Boolean(config?.useTimeout);
      const muteRoleId = config?.muteRoleId ?? null;
      const muteRole   = muteRoleId ? guild.roles.cache.get(muteRoleId) : null;

      let modeLabel;

      if (useTimeout) {
        modeLabel = '**Timeout natif Discord**\n*Les mutes appliqués via le bot sont limités à 28 jours.*';
      } else if (!muteRoleId) {
        modeLabel = '**Rôle mute**\n⚠️ Aucun rôle configuré. Les commandes `mute` / `tempmute` échoueront.\nUtilisez `+muteconfig setup` ou `+muteconfig role <@role>`.';
      } else if (!muteRole) {
        modeLabel = `**Rôle mute**\n⚠️ Le rôle configuré (\`${muteRoleId}\`) est introuvable.`;
      } else {
        modeLabel = `**Rôle mute** : <@&${muteRole.id}>\n*Vérifiez les permissions du rôle sur tous les salons avec \`+muteconfig setup\` si besoin.*`;
      }

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            null,
            {
              title  : 'Configuration du mute',
              fields : [
                {
                  name   : 'Mode actuel',
                  value  : modeLabel,
                  inline : false,
                },
                {
                  name   : 'Commandes',
                  value  : [
                    '`muteconfig setup` - crée et configure automatiquement un rôle mute',
                    '`muteconfig timeout on|off` - active ou désactive le timeout natif',
                    '`muteconfig role <@role>` - définit un rôle mute',
                    '`muteconfig role reset` - supprime le rôle mute configuré',
                  ].join('\n'),
                  inline : false,
                },
              ],
              timestamp: false,
            }
          ),
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'setup') {
      if (deleteCmd) {
        await message.delete().catch(() => {});
      }


      if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const sent = await embed.replyError(
          message,
          'Je n\'ai pas la permission de gérer les rôles.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        const sent = await embed.replyError(
          message,
          'Je n\'ai pas la permission de gérer les salons (nécessaire pour appliquer les overwrites du rôle mute).',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }


      const existingRoleId = config?.muteRoleId ?? null;
      let muteRole         = existingRoleId
        ? (guild.roles.cache.get(existingRoleId) ?? null)
        : null;
      const reuseExisting  = Boolean(muteRole);


      if (reuseExisting && me.roles.highest.comparePositionTo(muteRole) <= 0) {
        const sent = await embed.replyError(
          message,
          `Le rôle mute existant <@&${muteRole.id}> est au-dessus de mon rôle le plus haut. Déplacez mon rôle au-dessus avant le setup.`,
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const confirmed = await _confirmMuteSetup(message, guildId, {
        reuseExisting,
        roleMention: reuseExisting ? `<@&${muteRole.id}>` : null,
      });
      if (!confirmed) return;

      if (!muteRole) {
        muteRole = await guild.roles.create({
          name        : 'Mute',
          colors      : { primary: 0x818386 },
          hoist       : false,
          mentionable : false,
          permissions : [],
          reason      : `Rôle mute créé automatiquement par ${message.author.username}`,
        }).catch(() => null);

        if (!muteRole) {
          const sent = await embed.replyError(
            message,
            'La création du rôle mute a échoué.',
            { timestamp: false }
          ).catch(() => null);

          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }
      }

      const channels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildCategory ||
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildForum ||
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice
      );


      const failedChannels = [];

      for (const channel of channels.values()) {

        const result = await applyMuteOverwriteToChannel(channel, muteRole, me, {
          reason: `Setup rôle mute par ${message.author.username}`,
        });

        if (!result.ok && !result.skipped) {
          failedChannels.push(channel);
        }

        await _wait(300);
      }


      if (!reuseExisting) {
        db.setGuildConfig(guildId, 'muteRoleId', muteRole.id);
      }
      db.setGuildConfig(guildId, 'useTimeout', 0);

      const totalChannels = channels.size;
      const failCount     = failedChannels.length;
      const okChannels    = totalChannels - failCount;

      const fields = [
        {
          name  : 'Rôle utilisé',
          value : reuseExisting
            ? `<@&${muteRole.id}> (rôle existant réutilisé)`
            : `<@&${muteRole.id}> (nouveau rôle créé)`,
          inline: false,
        },
        {
          name  : 'Résultat',
          value : `${okChannels}/${totalChannels} salon(s) / catégorie(s) configuré(s)`,
          inline: false,
        },
      ];

      if (failCount > 0) {
        const listed = failedChannels.slice(0, 10)
          .map(c => `<#${c.id}>`)
          .join('\n');
        const more = failCount > 10 ? `\n+ ${failCount - 10} autre(s)` : '';

        fields.push({
          name  : 'Salons non configurés',
          value : `${listed}${more}`,
          inline: false,
        });

        fields.push({
          name  : 'À vérifier',
          value :
            'Je dois avoir **Voir les salons** et **Gérer les salons** dans ces salons.\n' +
            'Le rôle mute doit rester sous mon rôle le plus haut.\n\n' +
            'Si tout est OK, relancez `+muteconfig setup`.',
          inline: false,
        });
      }

      const description = failCount > 0
        ? 'Setup rôle mute partiel.\nLe rôle mute a été conservé, mais certains salons n\'ont pas pu être configurés.'
        : 'Setup terminé. Le rôle mute est correctement appliqué sur tous les salons.';

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            description,
            { fields, timestamp: false }
          ),
        ],
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'timeout') {
      const toggle = args[1]?.toLowerCase();

      if (!['on', 'off'].includes(toggle)) {
        const sent = await embed.replyError(
          message,
          'Utilisation : `muteconfig timeout on|off`',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      const desiredTimeout = toggle === 'on' ? 1 : 0;

      const currentTimeout = Number(config?.useTimeout) ? 1 : 0;

      if (currentTimeout === desiredTimeout) {
        const sent = await embed.replyError(
          message,
          desiredTimeout === 1
            ? 'Le mode timeout natif Discord est déjà activé.'
            : 'Le mode rôle mute est déjà activé.',
          { timestamp: false }
        ).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      db.setGuildConfig(guildId, 'useTimeout', desiredTimeout);

      const sent = await embed.reply(
        message,
        toggle === 'on'
          ? 'Mode timeout natif Discord activé.'
          : 'Mode rôle mute activé. Configurez un rôle avec `muteconfig role <@role>` si nécessaire.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (sub === 'role') {
      const arg = args[1]?.toLowerCase();

      if (arg === 'reset') {
        const currentRoleId = config?.muteRoleId ?? null;

        if (!currentRoleId) {
          const sent = await embed.replyError(
            message,
            'Aucun rôle mute n’est configuré.',
            { timestamp: false }
          ).catch(() => null);
          if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
          return;
        }

        if (deleteCmd) {
          await message.delete().catch(() => {});
        }

        const muteRole = guild.roles.cache.get(currentRoleId) ?? null;

        db.setGuildConfig(guildId, 'muteRoleId', null);

        let deletedRole = false;

        if (
          muteRole &&
          me?.permissions.has(PermissionsBitField.Flags.ManageRoles) &&
          me.roles.highest.position > muteRole.position
        ) {
          const deleted = await muteRole.delete(
            `Rôle mute supprimé par ${message.author.username}`
          ).catch(() => null);

          if (deleted) {
            deletedRole = true;
          }
        }

        const sent = await embed.reply(
          message,
          deletedRole
            ? 'Rôle mute supprimé de la configuration et supprimé du serveur.'
            : 'Rôle mute supprimé de la configuration.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      const role = message.mentions.roles.first()
        ?? guild.roles.cache.get(args[1]?.replace(/[<@&>]/g, '').trim());

      if (!role) {
        const sent = await embed.replyError(
          message,
          'Rôle introuvable. Utilisation : `muteconfig role <@role>`',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (role.managed || role.id === guild.id) {
        const sent = await embed.replyError(
          message,
          'Ce rôle ne peut pas être utilisé comme rôle mute.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        const sent = await embed.replyError(
          message,
          'Je n\'ai pas la permission de gérer les rôles.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (role.position >= me.roles.highest.position) {
        const sent = await embed.replyError(
          message,
          'Je ne peux pas utiliser ce rôle car il est supérieur ou égal à mon rôle le plus haut.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (
        message.member.id !== guild.ownerId &&
        role.position >= message.member.roles.highest.position
      ) {
        const sent = await embed.replyError(
          message,
          'Vous ne pouvez pas définir un rôle supérieur ou égal à votre rôle le plus haut.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (config?.muteRoleId === role.id) {
        const sent = await embed.replyError(
          message,
          `Le rôle <@&${role.id}> est déjà configuré comme rôle mute.`,
          { timestamp: false }
        ).catch(() => null);
        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      db.setGuildConfig(guildId, 'muteRoleId', role.id);


      const TEXT_MUTE_DENY_BITS = [
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.AddReactions,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
        PermissionsBitField.Flags.SendMessagesInThreads,
      ];

      const textChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildForum
      );

      const problematicChannels = [];

      for (const channel of textChannels.values()) {
        const overwrite = channel.permissionOverwrites?.cache?.get(role.id);
        const denyBits  = overwrite?.deny ?? new PermissionsBitField();
        const blocksAll = TEXT_MUTE_DENY_BITS.every(bit => denyBits.has(bit));

        if (!blocksAll) {
          problematicChannels.push(channel);
        }
      }

      const baseDescription =
        `Rôle mute défini : <@&${role.id}>.\nActivez le mode rôle avec \`muteconfig timeout off\` si ce n'est pas déjà fait.`;

      const replyOptions = {
        timestamp      : false,
        allowedMentions: { parse: [], repliedUser: false },
      };

      if (problematicChannels.length > 0) {
        const issueCount = problematicChannels.length;
        const totalText  = textChannels.size;

        const listed = problematicChannels.slice(0, 10)
          .map(c => `<#${c.id}>`)
          .join('\n');

        const more = issueCount > 10 ? `\n*(+ ${issueCount - 10} autre(s))*` : '';

        replyOptions.fields = [
          {
            name : `Salons non protégés (${issueCount}/${totalText})`,
            value: `${listed}${more}\n\nLe rôle mute est défini, mais il ne bloque pas encore l'écriture dans ces salons.\nUtilisez \`+muteconfig setup\` pour reconfigurer automatiquement ou modifiez manuellement les permissions du rôle dans ces salons.`,
            inline: false,
          },
        ];
      }

      const sent = await embed.reply(
        message,
        baseDescription,
        replyOptions
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const sent = await embed.replyError(
      message,
      'Utilisation : `muteconfig` | `muteconfig setup` | `muteconfig timeout on|off` | `muteconfig role <@role>|reset`',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

function _buildMuteSetupConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:muteconfig:confirm')
      .setLabel(' Confirmer')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:muteconfig:cancel')
      .setLabel(' Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

async function _confirmMuteSetup(message, guildId, opts = {}) {
  const { reuseExisting = false, roleMention = null } = opts;

  const firstBullet = reuseExisting && roleMention
    ? `• Réutiliser le rôle mute existant : ${roleMention}`
    : '• Créer un nouveau rôle `Mute`';

  const description =
    `Cette action va :\n${firstBullet}\n` +
    '• (Re)configurer les permissions sur **tous** les salons (textuels et vocaux)\n' +
    '• Désactiver le mode timeout natif\n\n' +
    'Cette action peut prendre quelques secondes et modifie de nombreux salons.';

  const confirmMessage = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        description,
        {
          title    : 'Confirmer muteconfig setup',
          timestamp: false,
        }
      ),
    ],
    components      : [_buildMuteSetupConfirmRow(false)],
    allowedMentions : { parse: [] },
  }).catch(() => null);

  if (!confirmMessage) return false;

  embed.registerPrivateInteraction(confirmMessage, message.author.id, 120_000);

  let result = false;

  const collector = confirmMessage.createMessageComponentCollector({
    filter : interaction =>
      interaction.user.id === message.author.id &&
      interaction.message.id === confirmMessage.id,
    idle   : 60_000,
    time   : 120_000,
  });

  await new Promise(resolveEnd => {
    collector.on('collect', async interaction => {
      if (interaction.customId === 'local:muteconfig:cancel') {
        result = false;
        await interaction.update({
          embeds: [
            embed.build(message.guild.id, 'Action annulée. Aucun rôle n\'a été créé.', {
              title    : 'Setup annulé',
              timestamp: false,
            }),
          ],
          components: [_buildMuteSetupConfirmRow(true)],
        }).catch(() => {});
        collector.stop('cancelled');
        return;
      }

      if (interaction.customId === 'local:muteconfig:confirm') {
        result = true;
        await interaction.deferUpdate().catch(() => {});
        await confirmMessage.edit({
          components: [_buildMuteSetupConfirmRow(true)],
        }).catch(() => {});
        collector.stop('confirmed');
        return;
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(confirmMessage);
      if (reason !== 'confirmed' && reason !== 'cancelled') {
        confirmMessage.edit({
          components: [_buildMuteSetupConfirmRow(true)],
        }).catch(() => {});
      }
      resolveEnd();
    });
  });

  return result;
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
