'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const PANEL_IDLE_MS = 900_000;
const PANEL_TIME_MS = 900_000;

module.exports = {
  help: {
    name        : 'variables',
    description : 'Affiche les variables disponibles pour les embeds configurables.',
    use         : 'variables',
    usage       : 'variables',
    aliases     : ['vars', 'var'],
  },

  async run(client, message) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId) || {};

    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);
    const deleteReply = Boolean(config?.autoDeleteModReplies);


    const deleteCmd = Boolean(config?.autoDeleteModCmds);
    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const panel = await message.channel.send({
      embeds          : [_buildVariablesEmbed(message.guild, guildId)],
      components      : [_buildCloseRow(false)],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, PANEL_TIME_MS);

    const collector = panel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter       : interaction =>
        interaction.user.id === message.author.id &&
        interaction.message.id === panel.id,
      idle         : PANEL_IDLE_MS,
      time         : PANEL_TIME_MS,
    });

    collector.on('collect', async interaction => {
      if (interaction.customId === 'local:variables:close') {
        await interaction.deferUpdate().catch(() => {});

        collector.stop('closed');
        embed.clearPrivateInteraction(panel);

        await panel.delete().catch(() => {});


        if (!deleteCmd) {
          await message.delete().catch(() => {});
        }

        return;
      }

      await interaction.deferUpdate().catch(() => {});
    });

    collector.on('end', async (_, reason) => {
      embed.clearPrivateInteraction(panel);

      if (reason === 'closed') return;


      await panel.edit({
        components      : [],
        allowedMentions : { parse: [] },
      }).catch(() => {});

      if (deleteReply) {
        embed.scheduleDelete(panel, deleteDelay);
      }
    });
  },
};

function _buildVariablesEmbed(guild, guildId) {
  return new EmbedBuilder()
    .setColor(embed.getGuildColor(guildId))
    .setTitle('Variables disponibles')
    .setDescription(
      'Variables utilisables dans les embeds configurables du bot.\n' +
      'Elles sont remplacées automatiquement au moment de l\'affichage.'
    )
    .addFields(
      {
        name  : 'Statistiques serveur (VC stats)',
        value : [
          '`{guild}` - nom du serveur',
          '`{members}` - nombre de membres',
          '`{online}` - membres en ligne',
          '`{voice}` - membres en vocal',
          '`{vocal}` - alias de `{voice}`',
          '`{stream}` - membres en stream',
          '`{boost}` - boosts du serveur',
          '`{boosts}` - alias de `{boost}`',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Informations serveur (VC stats)',
        value : [
          '`{owner}` - propriétaire du serveur',
          '`{channels}` - nombre de salons',
          '`{roles}` - nombre de rôles',
          '`{date}` - date actuelle',
          '`{time}` - heure actuelle',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Variables messages (join, leave, custom, boost)',
        value : [
          '`{user}` - mention du membre',
          '`{username}` - nom d\'utilisateur',
          '`{tag}` - tag complet',
          '`{id}` - identifiant du membre',
          '`{server}` - nom du serveur',
          '`{membercount}` - nombre de membres',
          '`{count}` - alias de `{membercount}` (join/leave)',
          '`{createdat}` - date de création du compte',
          '`{channel}` - salon (custom commands)',
          '`{boostcount}` - boosts (boostembed)',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Variables messages avancées',
        value : [
          '`{MemberMention}` - mention du membre',
          '`{MemberName}` - nom d\'utilisateur',
          '`{MemberFullName}` - nom complet',
          '`{MemberDisplayName}` - pseudo affiché',
          '`{MemberJoinedAt}` - date d\'arrivée sur le serveur',
          '`{MemberCreatedAt}` - date de création du compte',
          '`{MemberID}` - identifiant du membre',
          '`{MemberProfile}` - lien profil Discord du membre',
          '`{MemberPic}` - URL de l\'avatar du membre',
          '`{ServerIcon}` - URL de l\'icône du serveur (welcome/leave)',
          '`{ClientPic}` - URL de l\'avatar du bot (welcome/leave)',
          '`{ServerBoostsCount}` - nombre de boosts',
          '`{ServerLevel}` - niveau de boost (0 à 3)',
          '`{ServerMembersCount}` - nombre de membres',
          '`{VocalMembersCount}` - membres en vocal',
          '`{OnlineMembersCount}` - membres en ligne',
          '`{OfflineMembersCount}` - membres hors ligne',
          '`{ServerRolesCount}` - nombre de rôles',
          '`{ServerChannelsCount}` - nombre de salons',
          '`{BotCommandsCount}` - nombre total de commandes du bot',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Médias',
        value : [
          '`guild` ou `{icon}` - icône du serveur',
          '`bot` ou `{boticon}` - avatar du bot',
          '`none` - aucun média',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Variables soutien',
        value : [
          '`{tagSoutien}` - membres soutenant via le tag du serveur',
          '`{statusSoutien}` - membres soutenant via le statut',
          '`{allSoutien}` - total des soutiens actifs',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Variables spécifiques (help)',
        value : [
          '`{prefix}` - préfixe du serveur (help uniquement)',
          '`{BotPic}` - alias legacy de `{ClientPic}` (help uniquement)',
        ].join('\n'),
        inline: false,
      },
      {
        name  : 'Exemple VC',
        value : [
          '`{guild} - Statistiques`',
          '`Membre : **{members}**\\nEn ligne : **{online}**\\nEn vocal : **{voice}**\\nBoost : **{boost}**`',
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({
      text: `Serveur : ${guild.name}`,
    });
}

function _buildCloseRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:variables:close')
      .setLabel('\u2716')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}
