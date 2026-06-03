'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'confession',
    description : 'Soumettre une confession anonyme.',
    usage       : 'confession',
    aliases     : ['conf', 'confess', 'aveu'],
    category    : 'general',
  },

  async run(client, message) {
    const guildId = message.guild.id;
    const cfg = db.getConfessionConfig(guildId);

    if (!cfg?.enabled || !cfg?.channelId) {
      return message.reply({
        content: 'Le systeme de confessions n\'est pas active sur ce serveur.',
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }

    await message.delete().catch(() => {});
    await openConfessionModal(client, message.author, guildId, cfg);
  },
};

async function postSubmitButton(channel) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Confessions anonymes\nClique sur le bouton ci-dessous pour soumettre une confession anonyme. Ton identite ne sera jamais revelee publiquement.`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cf:submit')
        .setLabel('Faire une confession')
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return channel.send({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function openConfessionModal(client, user, guildId, cfg) {
  return null;
}

async function handleSubmitButton(client, interaction) {
  const guildId = interaction.guild?.id;
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  const cfg = db.getConfessionConfig(guildId);
  if (!cfg?.enabled) {
    return interaction.reply({ content: 'Le systeme de confessions est desactive.', flags: 64 }).catch(() => {});
  }

  const cooldown = Number(cfg.cooldownSeconds ?? 0);
  if (cooldown > 0) {
    const last = db.getLastConfessionTime(guildId, interaction.user.id);
    const elapsed = Date.now() / 1000 - last;
    if (elapsed < cooldown) {
      const remaining = Math.ceil(cooldown - elapsed);
      const mins = Math.ceil(remaining / 60);
      return interaction.reply({
        content: `Tu dois attendre encore **${remaining < 60 ? `${remaining}s` : `${mins} min`}** avant de soumettre une nouvelle confession.`,
        flags: 64,
      }).catch(() => {});
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(`cf:modal:submit:${guildId}`)
    .setTitle('Confession anonyme');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Ta confession (anonyme)')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(2000)
        .setRequired(true)
        .setPlaceholder('Ecris ta confession ici...'),
    ),
  );

  return interaction.showModal(modal).catch(() => {});
}

async function handleConfessionModal(client, interaction) {
  const guildId = interaction.guild?.id ?? interaction.customId.split(':')[3];
  if (!guildId) return interaction.deferUpdate().catch(() => {});

  const cfg = db.getConfessionConfig(guildId);
  if (!cfg?.enabled || !cfg?.channelId) {
    return interaction.reply({ content: 'Systeme de confessions non configure.', flags: 64 }).catch(() => {});
  }

  const content = interaction.fields.getTextInputValue('content').trim();

  const blacklist = cfg.blacklist
    ? cfg.blacklist.split(',').map(w => w.trim().toLowerCase()).filter(Boolean)
    : [];

  if (blacklist.some(w => content.toLowerCase().includes(w))) {
    return interaction.reply({
      content: 'Ta confession contient un mot interdit et n\'a pas pu etre envoyee.',
      flags: 64,
    }).catch(() => {});
  }

  await interaction.deferReply({ flags: 64 }).catch(() => {});

  const confId = db.createConfession(guildId, interaction.user.id, content);
  if (!confId) {
    return interaction.editReply({ content: 'Erreur lors de l\'enregistrement.' }).catch(() => {});
  }

  const confession = db.getConfession(confId);
  const number     = confession.number;

  if (cfg.reviewEnabled && cfg.reviewChannelId) {
    const reviewCh = interaction.guild?.channels?.cache?.get(cfg.reviewChannelId);
    if (reviewCh) {
      const reviewMsg = await postReviewMessage(client, reviewCh, confession, cfg).catch(() => null);
      if (reviewMsg) {
        db.updateConfessionStatus(confId, 'pending', null, reviewMsg.id);
      }
    }
    await interaction.editReply({
      content: `Ta confession (#${number}) a ete soumise et est en attente de validation par les moderateurs.`,
    }).catch(() => {});
  } else {
    const confCh = interaction.guild?.channels?.cache?.get(cfg.channelId);
    if (!confCh) {
      return interaction.editReply({ content: 'Salon de confessions introuvable.' }).catch(() => {});
    }
    const confMsg = await postConfessionMessage(client, confCh, confession, cfg).catch(() => null);
    if (confMsg) {
      db.updateConfessionStatus(confId, 'approved', confMsg.id, null);
    }
    await interaction.editReply({
      content: `Ta confession anonyme #${number} a ete publiee.`,
    }).catch(() => {});
  }
}

function buildConfessionContainer(confession, cfg, includeSubmitBtn = true) {
  const num = confession.number;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Confession #${num}\n${confession.content}`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Confession anonyme`),
  );

  const actionBtns = [];
  if (cfg.replyEnabled) {
    actionBtns.push(
      new ButtonBuilder()
        .setCustomId(`cf:reply:${confession.id}`)
        .setLabel('Repondre anonymement')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  actionBtns.push(
    new ButtonBuilder()
      .setCustomId(`cf:report:${confession.id}`)
      .setLabel('Signaler')
      .setStyle(ButtonStyle.Danger),
  );
  if (includeSubmitBtn) {
    actionBtns.push(
      new ButtonBuilder()
        .setCustomId('cf:submit')
        .setLabel('Faire une confession')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if (actionBtns.length) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...actionBtns));
  }

  return container;
}

async function postConfessionMessage(client, channel, confession, cfg) {
  const guildId = channel.guild?.id ?? '';

  const prevConfession = db.getLastApprovedConfession(guildId);
  if (prevConfession?.messageId) {
    const prevMsg = await channel.messages.fetch(prevConfession.messageId).catch(() => null);
    if (prevMsg) {
      const prevContainer = buildConfessionContainer(prevConfession, cfg, false);
      prevMsg.edit({
        flags      : COMPONENTS_V2_FLAG,
        components : [prevContainer],
        embeds     : [],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }

  const container = buildConfessionContainer(confession, cfg, true);

  return channel.send({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function postReviewMessage(client, reviewCh, confession, cfg) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Confession en attente de review\n${confession.content}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ID: ${confession.id} | Soumise <t:${confession.createdAt}:R>`),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cf:approve:${confession.id}`)
        .setLabel('Approuver')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`cf:refuse:${confession.id}`)
        .setLabel('Refuser')
        .setStyle(ButtonStyle.Danger),
      cfg.revealAllowed
        ? new ButtonBuilder()
            .setCustomId(`cf:reveal:${confession.id}`)
            .setLabel('Voir l\'auteur')
            .setStyle(ButtonStyle.Secondary)
        : null,
    ).addComponents(...[].filter(Boolean)),
  );

  return reviewCh.send({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function handleButton(client, interaction) {
  const id     = interaction.customId;
  const parts  = id.split(':');
  const action = parts[1];
  const guildId = interaction.guild?.id;

  if (action === 'submit') {
    return handleSubmitButton(client, interaction);
  }

  if (action === 'approve') {
    const confId = Number(parts[2]);
    return handleApprove(client, interaction, guildId, confId);
  }

  if (action === 'refuse') {
    const confId = Number(parts[2]);
    return handleRefuse(client, interaction, guildId, confId);
  }

  if (action === 'reveal') {
    const confId = Number(parts[2]);
    return handleReveal(client, interaction, guildId, confId);
  }

  if (action === 'report') {
    const confId = Number(parts[2]);
    return handleReport(client, interaction, guildId, confId);
  }

  if (action === 'reply') {
    const confId = Number(parts[2]);
    return handleReplyButton(client, interaction, guildId, confId);
  }

  return interaction.deferUpdate().catch(() => {});
}

async function handleApprove(client, interaction, guildId, confId) {
  const member = interaction.member;
  if (!member?.permissions?.has('ManageMessages')) {
    return interaction.reply({ content: 'Permission `ManageMessages` requise.', flags: 64 }).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});

  const confession = db.getConfession(confId);
  if (!confession || confession.status !== 'pending') {
    return interaction.message?.edit({ content: 'Confession deja traitee.', components: [] }).catch(() => {});
  }

  const cfg   = db.getConfessionConfig(guildId);
  const confCh = interaction.guild?.channels?.cache?.get(cfg?.channelId);
  if (!confCh) return;

  const confMsg = await postConfessionMessage(client, confCh, confession, cfg).catch(() => null);
  if (confMsg) {
    db.updateConfessionStatus(confId, 'approved', confMsg.id, confession.reviewMsgId);
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Confession approuvee\n${confession.content}\n\n-# Approuvee par <@${interaction.user.id}>`,
    ),
  );
  return interaction.message?.edit({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function handleRefuse(client, interaction, guildId, confId) {
  const member = interaction.member;
  if (!member?.permissions?.has('ManageMessages')) {
    return interaction.reply({ content: 'Permission `ManageMessages` requise.', flags: 64 }).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});

  const confession = db.getConfession(confId);
  if (!confession || confession.status !== 'pending') return;

  db.updateConfessionStatus(confId, 'refused', null, confession.reviewMsgId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Confession refusee\n${confession.content}\n\n-# Refusee par <@${interaction.user.id}>`,
    ),
  );
  return interaction.message?.edit({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function handleReveal(client, interaction, guildId, confId) {
  const cfg = db.getConfessionConfig(guildId);
  if (!cfg?.revealAllowed) {
    return interaction.reply({ content: 'La revelation est desactivee sur ce serveur.', flags: 64 }).catch(() => {});
  }

  const member = interaction.member;
  if (interaction.user.id !== interaction.guild?.ownerId && !member?.permissions?.has('Administrator')) {
    return interaction.reply({ content: 'Seul l\'administrateur peut reveler l\'auteur.', flags: 64 }).catch(() => {});
  }

  const confession = db.getConfession(confId);
  if (!confession) return interaction.reply({ content: 'Confession introuvable.', flags: 64 }).catch(() => {});

  return interaction.reply({
    content: `Auteur de la confession #${confession.number} : <@${confession.authorId}> (\`${confession.authorId}\`)`,
    flags: 64,
  }).catch(() => {});
}

async function handleReport(client, interaction, guildId, confId) {
  await interaction.deferReply({ flags: 64 }).catch(() => {});

  const cfg = db.getConfessionConfig(guildId);
  const confession = db.getConfession(confId);
  if (!confession) return interaction.editReply({ content: 'Confession introuvable.' }).catch(() => {});

  const reviewCh = cfg?.reviewChannelId
    ? interaction.guild?.channels?.cache?.get(cfg.reviewChannelId)
    : null;

  if (reviewCh) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Confession signalee\nConfession #${confession.number} signalee par <@${interaction.user.id}>\n\n${confession.content}`,
      ),
    );
    await reviewCh.send({
      flags      : COMPONENTS_V2_FLAG,
      components : [container],
      embeds     : [],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  return interaction.editReply({
    content: 'La confession a ete signalee aux moderateurs.',
  }).catch(() => {});
}

async function handleReplyButton(client, interaction, guildId, confId) {
  const cfg = db.getConfessionConfig(guildId);
  if (!cfg?.replyEnabled) {
    return interaction.reply({ content: 'Les reponses anonymes sont desactivees.', flags: 64 }).catch(() => {});
  }

  const modal = new ModalBuilder()
    .setCustomId(`cf:modal:reply:${guildId}:${confId}`)
    .setTitle(`Repondre a la confession #${db.getConfession(confId)?.number ?? '?'}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Ta reponse anonyme')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(5)
        .setMaxLength(2000)
        .setRequired(true),
    ),
  );

  return interaction.showModal(modal).catch(() => {});
}

async function handleReplyModal(client, interaction) {
  const parts    = interaction.customId.split(':');
  const guildId  = parts[3];
  const confId   = Number(parts[4]);

  const cfg = db.getConfessionConfig(guildId);
  if (!cfg?.channelId) return interaction.deferUpdate().catch(() => {});

  const content   = interaction.fields.getTextInputValue('content').trim();
  const original  = db.getConfession(confId);
  await interaction.deferReply({ flags: 64 }).catch(() => {});

  const confCh = interaction.guild?.channels?.cache?.get(cfg.channelId);
  if (!confCh) return interaction.editReply({ content: 'Salon introuvable.' }).catch(() => {});

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Reponse a la Confession #${original?.number ?? '?'}\n${content}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Reponse anonyme`),
  );
  if (cfg.replyEnabled) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cf:report:${confId}`)
          .setLabel('Signaler')
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  await confCh.send({
    flags      : COMPONENTS_V2_FLAG,
    components : [container],
    embeds     : [],
    allowedMentions: { parse: [] },
  }).catch(() => {});

  return interaction.editReply({ content: 'Ta reponse anonyme a ete publiee.' }).catch(() => {});
}

async function handleModalSubmit(client, interaction) {
  const parts  = interaction.customId.split(':');
  const action = parts[2];

  if (action === 'submit') return handleConfessionModal(client, interaction);
  if (action === 'reply')  return handleReplyModal(client, interaction);
}

module.exports.postSubmitButton  = postSubmitButton;
module.exports.handleButton      = handleButton;
module.exports.handleModalSubmit = handleModalSubmit;
