'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SeparatorBuilder   === 'function'
);

const VALID_DAYS  = [1, 7, 14, 30];
const TOP_LIMIT   = 15;
const IDLE_MS     = 120_000;
const TIMEOUT_MS  = 300_000;

module.exports = {
  help: {
    name        : 'topmsgs',
    description : 'Classement des membres les plus actifs (en messages).',
    usage       : 'topmsgs [1|7|14|30]',
    aliases     : ['topmessages', 'activite', 'msgtop'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    let days = Number(args[0]) || 7;
    if (!VALID_DAYS.includes(days)) days = 7;

    const sent = V2_AVAILABLE
      ? await _sendV2(client, message, guildId, days, deleteCmd ? null : message)
      : await _sendEmbed(client, message, guildId, days);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

const DAY_LABELS = { 1: "Aujourd'hui", 7: '7 derniers jours', 14: '14 derniers jours', 30: '30 derniers jours' };

function _buildNavRow(days, disabled = false) {
  return new ActionRowBuilder().addComponents(
    ...VALID_DAYS.map(d =>
      new ButtonBuilder()
        .setCustomId(`tm:${d}`)
        .setLabel(d === 1 ? '24h' : `${d}j`)
        .setStyle(d === days ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
    new ButtonBuilder()
      .setCustomId('tm:close')
      .setLabel('✖')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function _fetchRows(client, guildId, days) {
  const rows = db.getTopMsgs(guildId, days, TOP_LIMIT);
  const result = [];
  for (const [i, row] of rows.entries()) {
    const user = await client.users.fetch(row.userId).catch(() => null);
    const name = user ? (user.globalName ?? user.username) : `\`${row.userId}\``;
    result.push({ rank: i + 1, name, total: row.total, userId: row.userId });
  }
  return result;
}

function _formatRows(rows) {
  if (!rows.length) return 'Aucune activité enregistrée sur cette période.';
  return rows.map(r => {
    return `**${r.rank}.** **${r.name}** ・ \`${r.total}\` msg${r.total > 1 ? 's' : ''}`;
  }).join('\n');
}

async function _sendV2(client, message, guildId, initialDays, invokeMsg = null) {
  let days = initialDays;
  let rows = await _fetchRows(client, guildId, days);

  const buildPayload = (disabled = false) => {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Top messages · ${DAY_LABELS[days]}`),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(_formatRows(rows)),
    );
    container.addActionRowComponents(_buildNavRow(days, disabled));
    return { flags: COMPONENTS_V2_FLAG, components: [container], embeds: [], allowedMentions: { parse: [] } };
  };

  const msg = await message.channel.send(buildPayload()).catch(() => null);
  if (!msg) return null;

  embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

  const collector = msg.createMessageComponentCollector({
    filter : i => i.user.id === message.author.id,
    idle   : IDLE_MS,
    time   : TIMEOUT_MS,
  });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'tm:close') {
        await i.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(msg);
        collector.stop('closed');
        if (invokeMsg) invokeMsg.delete().catch(() => {});
        return msg.delete().catch(() => {});
      }

      const newDays = Number(i.customId.split(':')[1]);
      if (VALID_DAYS.includes(newDays)) {
        days = newDays;
        rows = await _fetchRows(client, guildId, days);
      }

      await i.update(buildPayload());
    } catch (err) {
      if (err?.code !== 10062 && err?.code !== 40060) console.error('[topmsgs]', err.message);
    }
  });

  collector.on('end', (_, reason) => {
    embed.clearPrivateInteraction(msg);
    if (reason === 'closed') return;
    msg.edit(buildPayload(true)).catch(() => {});
  });

  return msg;
}

async function _sendEmbed(client, message, guildId, initialDays) {
  let days = initialDays;
  let rows = await _fetchRows(client, guildId, days);

  const buildEmbed = () => embed.build(guildId, _formatRows(rows), {
    title     : `Top messages · ${DAY_LABELS[days]}`,
    timestamp : false,
  });

  const navRow = (disabled = false) => new ActionRowBuilder().addComponents(
    ...VALID_DAYS.map(d =>
      new ButtonBuilder()
        .setCustomId(`tm:${d}`)
        .setLabel(d === 1 ? '24h' : `${d}j`)
        .setStyle(d === days ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
    new ButtonBuilder().setCustomId('tm:close').setLabel('✖').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );

  const msg = await message.channel.send({ embeds: [buildEmbed()], components: [navRow()], allowedMentions: { parse: [] } }).catch(() => null);
  if (!msg) return null;

  const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, idle: IDLE_MS, time: TIMEOUT_MS });

  collector.on('collect', async i => {
    try {
      if (i.customId === 'tm:close') { await i.deferUpdate().catch(() => {}); collector.stop('closed'); return msg.delete().catch(() => {}); }
      const newDays = Number(i.customId.split(':')[1]);
      if (VALID_DAYS.includes(newDays)) { days = newDays; rows = await _fetchRows(client, guildId, days); }
      await i.update({ embeds: [buildEmbed()], components: [navRow()] });
    } catch {}
  });

  collector.on('end', (_, reason) => { if (reason === 'closed') return; msg.edit({ components: [navRow(true)] }).catch(() => {}); });

  return msg;
}
