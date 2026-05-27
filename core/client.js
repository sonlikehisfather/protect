'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');


function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildScheduledEvents,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.User,
      Partials.GuildMember,
      Partials.Reaction,
      Partials.ThreadMember,
      Partials.GuildScheduledEvent,
    ],
  });

  client.commands      = new Collection();
  client.slashCommands = new Collection();
  client.cooldowns     = new Collection();

  return client;
}

module.exports = { createClient };
