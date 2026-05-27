'use strict';

const { AttachmentBuilder } = require('discord.js');

function _escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchAllMessages(channel, limit = 300) {
  const messages = [];
  let before = null;

  while (messages.length < limit) {
    const batch = await channel.messages.fetch({
      limit : Math.min(100, limit - messages.length),
      before: before || undefined,
    }).catch(() => null);

    if (!batch?.size) break;

    messages.push(...batch.values());
    before = batch.last()?.id;

    if (batch.size < 100) break;
  }

  return messages.reverse();
}

function _renderAttachments(message) {
  if (!message.attachments?.size) return '';

  return [...message.attachments.values()].map(att => {
    const url = _escapeHtml(att.url);
    const name = _escapeHtml(att.name || 'Pièce jointe');

    return `
      <div class="attachment">
        <a href="${url}" target="_blank">${name}</a>
      </div>
    `;
  }).join('');
}

function _renderEmbeds(message) {
  if (!message.embeds?.length) return '';

  return message.embeds.map(rawEmbed => {
    const data = rawEmbed.data || rawEmbed;

    const authorName = data.author?.name
      ? `<div class="embed-author">${_escapeHtml(data.author.name)}</div>`
      : '';

    const title = data.title
      ? `<div class="embed-title">${_escapeHtml(data.title)}</div>`
      : '';

    const description = data.description
      ? `<div class="embed-description">${_escapeHtml(data.description).replace(/\n/g, '<br>')}</div>`
      : '';

    const fields = Array.isArray(data.fields) && data.fields.length
      ? `
        <div class="embed-fields">
          ${data.fields.map(field => `
            <div class="embed-field">
              <div class="embed-field-name">${_escapeHtml(field.name)}</div>
              <div class="embed-field-value">${_escapeHtml(field.value).replace(/\n/g, '<br>')}</div>
            </div>
          `).join('')}
        </div>
      `
      : '';

    const footer = data.footer?.text
      ? `<div class="embed-footer">${_escapeHtml(data.footer.text)}</div>`
      : '';

    return `
      <div class="embed-box">
        ${authorName}
        ${title}
        ${description}
        ${fields}
        ${footer}
      </div>
    `;
  }).join('');
}

async function createHtmlTranscript(channel, options = {}) {
  const messages = await fetchAllMessages(channel, options.limit || 300);

  const rows = messages.map(message => {
    const author = message.author;
    const date = new Date(message.createdTimestamp).toLocaleString('fr-FR');

    const content = message.content
      ? _escapeHtml(message.content).replace(/\n/g, '<br>')
      : '';

    const attachments = _renderAttachments(message);
    const embeds = _renderEmbeds(message);

    const displayedContent = content || embeds || attachments
      ? content
      : '<em>Aucun texte</em>';

    return `
      <div class="message">
        <img class="avatar" src="${author.displayAvatarURL({ extension: 'png', size: 64 })}" alt="">
        <div class="body">
          <div class="meta">
            <span class="author">${_escapeHtml(author.username)}</span>
            <span class="id">${author.id}</span>
            <span class="date">${date}</span>
          </div>
          ${displayedContent ? `<div class="content">${displayedContent}</div>` : ''}
          ${embeds}
          ${attachments}
        </div>
      </div>
    `;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Transcript ${_escapeHtml(channel.name)}</title>
<style>
  body {
    margin: 0;
    padding: 24px;
    background: #111318;
    color: #e5e7eb;
    font-family: Arial, sans-serif;
  }

  .header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #2f333b;
  }

  .header h1 {
    margin: 0 0 8px;
    font-size: 22px;
  }

  .header p {
    margin: 4px 0;
    color: #a8adb7;
  }

  .message {
    display: flex;
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px solid #20232a;
  }

  .avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .meta {
    margin-bottom: 6px;
  }

  .author {
    font-weight: 700;
    color: #ffffff;
  }

  .id,
  .date {
    margin-left: 8px;
    color: #8b909b;
    font-size: 12px;
  }

  .content {
    line-height: 1.45;
    margin-bottom: 6px;
    word-break: break-word;
  }

  .embed-box {
    margin-top: 8px;
    padding: 10px 12px;
    border-left: 4px solid #5865f2;
    background: #181b22;
    border-radius: 4px;
  }

  .embed-author {
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 6px;
  }

  .embed-title {
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 6px;
  }

  .embed-description {
    color: #d7dbe3;
    line-height: 1.45;
    word-break: break-word;
  }

  .embed-fields {
    margin-top: 10px;
  }

  .embed-field {
    margin-top: 8px;
  }

  .embed-field-name {
    font-weight: 700;
    color: #ffffff;
  }

  .embed-field-value {
    color: #d7dbe3;
    margin-top: 2px;
  }

  .embed-footer {
    margin-top: 10px;
    color: #8b909b;
    font-size: 12px;
  }

  .attachment {
    margin-top: 6px;
  }

  a {
    color: #60a5fa;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>Transcript modmail</h1>
    <p>Salon : ${_escapeHtml(channel.name)} (${channel.id})</p>
    <p>Messages : ${messages.length}</p>
    <p>Généré le : ${new Date().toLocaleString('fr-FR')}</p>
  </div>
  ${rows || '<p>Aucun message trouvé.</p>'}
</body>
</html>`;

  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `SPOILER_transcript-${channel.id}.html`,
  });

  attachment.setSpoiler(true);

  return attachment;
}

module.exports = {
  createHtmlTranscript,
};
