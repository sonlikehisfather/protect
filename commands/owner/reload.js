'use strict';

const { execSync } = require('child_process');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const embed  = require('../../utils/embed');
const loader = require('../../core/loader');
const perms  = require('../../utils/permissions');

const CONFIRM_IDLE_MS = 30_000;
const CONFIRM_TIME_MS = 60_000;

exports.help = {
  name       : 'reload',
  description: 'Recharger commandes/tracking sans reboot.',
  use        : 'reload <commande> | reload commands | reload tracking | reload all | reload events',
  usage      : 'reload <commande> | reload commands | reload tracking | reload all | reload events',
};

exports.run = async (client, message, args) => {
  const target  = args[0]?.toLowerCase();
  const target2 = args[1]?.toLowerCase();

  if (!target) {
    return embed.replyError(
      message,
      '**Usage :**\n' +
      '`reload <commande>` - recharger une commande\n' +
      '`reload command <commande>` - idem\n' +
      '`reload commands` - recharger toutes les commandes\n' +
      '`reload tracking` - resync vocal + soutien\n' +
      '`reload all` - commands + tracking\n' +
      '`reload events` - buyer, dangereux\n\n' +
      '`reload modules` / `reload database` non supportes (PM2 restart).'
    );
  }

  if (target === 'modules' || target === 'database') {
    return embed.replyError(
      message,
      'Reload modules/database non supporte. Utilisez `pm2 restart`.'
    );
  }

  if (target === 'commands') {
    loader.loadCommands(client);
    loader.loadSlashCommands(client);
    return embed.reply(message, 'Commandes prefix + slash rechargees.');
  }

  if (target === 'tracking') {
    return _reloadTracking(client, message);
  }

  if (target === 'all') {
    loader.loadCommands(client);
    loader.loadSlashCommands(client);
    await _reloadTracking(client, message, true);
    return embed.reply(
      message,
      'Reload all safe execute : commands + tracking.\n' +
      'Events/modules necessitent un restart PM2.'
    );
  }

  if (target === 'events') {
    if (!perms.isBuyer(message.author.id)) {
      return embed.replyError(message, 'Seul le buyer peut recharger les events.');
    }
    return _reloadEventsWithConfirm(client, message);
  }

  const commandName = target === 'command' ? target2 : target;

  if (!commandName) {
    return embed.replyError(message, 'Precisez le nom de la commande a recharger.');
  }

  return _reloadSingleCommand(client, message, commandName);
};


function _reloadSingleCommand(client, message, commandName) {
  const filePath = loader.getCommandFilePath(client, commandName);

  if (filePath) {
    const checkErr = _nodeCheck(filePath);
    if (checkErr) {
      return embed.replyError(
        message,
        `node --check echoue pour \`${commandName}\` :\n\`\`\`\n${checkErr}\n\`\`\``
      );
    }
  }

  const result = loader.reloadCommand(client, commandName);

  return result.success
    ? embed.reply(message, result.message)
    : embed.replyError(message, result.message);
}


async function _reloadTracking(client, message, silent = false) {
  const readyMod = require('../../events/ready');

  if (typeof readyMod.syncVoiceTracking !== 'function' ||
      typeof readyMod.syncSoutienTracking !== 'function') {
    if (!silent) {
      return embed.replyError(message, 'Fonctions de sync tracking introuvables dans ready.js.');
    }
    return;
  }

  await readyMod.syncVoiceTracking(client);
  await readyMod.syncSoutienTracking(client);

  if (!silent) {
    return embed.reply(message, 'Tracking vocal + soutien resynchronise.');
  }
}


async function _reloadEventsWithConfirm(client, message) {
  const confirmMsg = await message.channel.send({
    embeds: [
      embed.build(
        message.guild?.id,
        null,
        {
          title     : 'Reload events',
          description:
            '**Attention** : reload events peut laisser des timers orphelins ' +
            '(sanctions, tempRoles, reminders, presence, antideco).\n\n' +
            'Preferez `pm2 restart` sauf si vous savez ce que vous faites.',
          timestamp : false,
        }
      ),
    ],
    components: [_buildConfirmRow(false)],
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, CONFIRM_TIME_MS);

  const collector = confirmMsg.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id && i.message.id === confirmMsg.id,
    idle  : CONFIRM_IDLE_MS,
    time  : CONFIRM_TIME_MS,
  });

  collector.on('collect', async (interaction) => {
    if (interaction.customId === 'local:reload-events:cancel') {
      collector.stop('cancelled');
      await interaction.deferUpdate().catch(() => {});
      await confirmMsg.edit({
        embeds: [
          embed.build(message.guild?.id, null, {
            title      : 'Reload events',
            description: 'Annule.',
            timestamp  : false,
          }),
        ],
        components: [_buildConfirmRow(true)],
      }).catch(() => {});
      return;
    }

    if (interaction.customId !== 'local:reload-events:confirm') {
      return interaction.deferUpdate().catch(() => {});
    }

    collector.stop('confirmed');
    await interaction.deferUpdate().catch(() => {});
    await confirmMsg.edit({ components: [_buildConfirmRow(true)] }).catch(() => {});

    const result = loader.reloadEvents(client);
    await embed.reply(message, result.message);
  });

  collector.on('end', async (_, reason) => {
    embed.clearPrivateInteraction(confirmMsg);

    if (reason === 'confirmed' || reason === 'cancelled') return;

    await confirmMsg.edit({
      embeds: [
        embed.build(message.guild?.id, null, {
          title      : 'Reload events',
          description: 'Expiration - reload annule.',
          timestamp  : false,
        }),
      ],
      components: [_buildConfirmRow(true)],
    }).catch(() => {});
  });
}


function _nodeCheck(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { encoding: 'utf8', timeout: 5000 });
    return null;
  } catch (err) {
    return (err.stderr || err.message || 'Erreur inconnue').slice(0, 800);
  }
}

function _buildConfirmRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:reload-events:confirm')
      .setLabel('Confirmer reload events')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('local:reload-events:cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}
