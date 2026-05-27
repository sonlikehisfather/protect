'use strict';


const { EmbedBuilder } = require('discord.js');
const db = require('../core/database');


let _client  = null;
let _handling = false;
let _lastSent = 0;

const DEBOUNCE_MS   = 2000;
const MAX_STACK_LEN = 900;
const MAX_MSG_LEN   = 3800;


const ROUTINE_DISCORD_CODES = new Set([10003, 10008, 10062, 50001, 50013]);
const DEBUG_ERRORS = process.env.DEBUG_ERRORS === '1';


function init(client) {
  _client = client;

  process.on('unhandledRejection', (error) => {
    handle(error, { source: 'unhandledRejection' });
  });

  process.on('uncaughtException', (error) => {
    handle(error, { source: 'uncaughtException' });
  });

  process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') {
      handle(warning, { source: 'NodeWarning', level: 'warn' });
      return;
    }


    if (warning.name === 'DeprecationWarning' && process.env.NODE_ENV !== 'production') {
      console.warn('[warn:deprecation]', warning.message);
    }
  });
}


async function handle(error, context = {}) {
  if (_handling) {
    console.error('[ErrorHandler] Erreur dans le handler lui-même :', error);
    return;
  }


  const errorCode = typeof error?.code === 'number' ? error.code : null;
  if (errorCode !== null && ROUTINE_DISCORD_CODES.has(errorCode)) {
    if (DEBUG_ERRORS || process.env.NODE_ENV !== 'production') {
      const src = context.source ?? 'unknown';
      console.warn(`[ErrorHandler:routine] ${src} (${errorCode}) ${error.message ?? ''}`);
    }
    return;
  }

  const level   = context.level ?? 'error';
  const source  = context.source ?? 'unknown';
  const isError = error instanceof Error;

  const message = isError ? error.message : String(error);
  const stack   = isError && error.stack
    ? truncate(error.stack, MAX_STACK_LEN)
    : 'Pas de stack trace disponible.';


  if (level === 'error') {
    console.error(`[${source}]`, error);
  } else {
    console.warn(`[${source}]`, error);
  }

  if (!_client?.isReady()) return;


  const now = Date.now();
  if (now - _lastSent < DEBOUNCE_MS) return;

  _handling = true;
  try {
    const channel = await getErrorChannel(context.guildId);
    if (!channel) return;

    const embed = buildErrorEmbed(error, message, stack, source, context, level);
    await channel.send({ embeds: [embed] });
    _lastSent = Date.now();

  } catch (innerError) {

    console.error('[ErrorHandler] Impossible d\'envoyer dans Discord :', innerError?.message);
  } finally {
    _handling = false;
  }
}


async function getErrorChannel(guildId) {
  if (!_client) return null;


  if (guildId) {
    const channel = await tryGetChannel(guildId);
    if (channel) return channel;
  }


  for (const guild of _client.guilds.cache.values()) {
    const channel = await tryGetChannel(guild.id);
    if (channel) return channel;
  }

  return null;
}

async function tryGetChannel(guildId) {
  try {
    const config = db.getGuildConfig(guildId);
    if (!config?.errorLogChannel) return null;
    const channel = await _client.channels.fetch(config.errorLogChannel).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}


function buildErrorEmbed(error, message, stack, source, context, level) {
  const color  = level === 'warn' ? '#FEE75C' : '#ED4245';
  const prefix = level === 'warn' ? 'Avertissement' : 'Erreur';

  const fields = [
    {
      name  : 'Source',
      value : truncate(source, 200),
      inline: true,
    },
    {
      name  : 'Type',
      value : error instanceof Error ? error.constructor.name : typeof error,
      inline: true,
    },
  ];

  if (context.command) fields.push({ name: 'Commande', value: `\`${context.command}\``, inline: true });
  if (context.guildId) fields.push({ name: 'Guild',    value: context.guildId,          inline: true });
  if (context.userId)  fields.push({ name: 'User',     value: `<@${context.userId}>`,   inline: true });


  fields.push({
    name : 'Stack trace',
    value: `\`\`\`\n${stack}\n\`\`\``,
    inline: false,
  });

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${prefix} - ${new Date().toLocaleTimeString('fr-FR')}`)
    .setDescription(truncate(message, MAX_MSG_LEN))
    .addFields(fields)
    .setTimestamp();
}


function truncate(str, max) {
  if (!str) return 'N/A';
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + '\n... (tronqué)';
}


async function run(fn, context = {}, message = null) {
  try {
    await fn();
  } catch (error) {
    await handle(error, context);


    if (message) {
      try {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#ED4245')
              .setDescription('Une erreur est survenue. Elle a été signalée automatiquement.')
              .setTimestamp(),
          ],
          allowedMentions: { repliedUser: false },
        });
      } catch {

      }
    }
  }
}


async function runInteraction(fn, context = {}, interaction = null) {
  try {
    await fn();
  } catch (error) {
    await handle(error, context);

    if (interaction) {
      try {
        const payload = {
          embeds: [
            new EmbedBuilder()
              .setColor('#ED4245')
              .setDescription('Une erreur est survenue. Elle a été signalée automatiquement.')
              .setTimestamp(),
          ],
          flags: 64,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
      }
    }
  }
}


module.exports = { init, handle, run, runInteraction };
