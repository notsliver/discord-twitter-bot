const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  WebhookClient,
  ChannelFlagsBitField,
  PermissionsBitField,
} = require('discord.js');
const Organization = require('../models/Organization');
const Profile = require('../models/Profile');
const GuildConfig = require('../models/GuildConfig');
const Post = require('../models/Post');
const { generateTwitterPostImage } = require('../utils/twitterpost-generator');

module.exports.data = new SlashCommandBuilder()
  .setName('organizations')
  .setDescription('Manage organizations')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a new organization')
      .addStringOption((opt) => opt.setName('handler').setDescription('Organization handle').setRequired(true))
      .addStringOption((opt) => opt.setName('username').setDescription('Organization username').setRequired(true))
      .addUserOption((opt) => opt.setName('owner').setDescription('Owner of the organization').setRequired(true))
      .addAttachmentOption((opt) => opt.setName('image').setDescription('Organization profile image').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('manage')
      .setDescription('Manage your organizations')
      .addStringOption((opt) =>
        opt
          .setName('account')
          .setDescription('Organization (by handle) to manage')
          .setAutocomplete(true)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('post')
      .setDescription('Post as an organization')
      .addStringOption((opt) =>
        opt.setName('account').setDescription('Organization (by handle)').setAutocomplete(true).setRequired(true)
      )
      .addStringOption((opt) => opt.setName('content').setDescription('Post content').setRequired(true))
      .addAttachmentOption((opt) => opt.setName('image').setDescription('PNG image (optional)').setRequired(false))
  );

async function ensureForumWebhook(interaction, forum) {
  const config = await GuildConfig.findOne({ guildId: interaction.guildId });
  if (!config?.twitterForumChannelId || forum.id !== config.twitterForumChannelId) {
    throw new Error('Forum channel not configured.');
  }
  if (config.twitterForumWebhookId && config.twitterForumWebhookToken) {
    return new WebhookClient({ id: config.twitterForumWebhookId, token: config.twitterForumWebhookToken });
  }
  const hooks = await forum.fetchWebhooks();
  const existing = hooks.find((h) => Boolean(h.token));
  if (existing) {
    await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { twitterForumWebhookId: existing.id, twitterForumWebhookToken: existing.token } },
      { upsert: true }
    );
    return new WebhookClient({ id: existing.id, token: existing.token });
  }
  const created = await forum.createWebhook({ name: 'Twitter Post' });
  await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: { twitterForumWebhookId: created.id, twitterForumWebhookToken: created.token } },
    { upsert: true }
  );
  return new WebhookClient({ id: created.id, token: created.token });
}

module.exports.execute = async (interaction) => {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Only administrators can create organizations.', ephemeral: true });
    }

    const handlerRaw = interaction.options.getString('handler', true);
    const username = interaction.options.getString('username', true);
    const image = interaction.options.getAttachment('image');
    const owner = interaction.options.getUser('owner', true);
    const handler = handlerRaw.startsWith('@') ? handlerRaw.slice(1) : handlerRaw;

    const existing = await Organization.findOne({ guildId: interaction.guildId, handler });
    if (existing) {
      return interaction.reply({ content: 'An organization with that handle already exists.', ephemeral: true });
    }

    const org = await Organization.create({
      guildId: interaction.guildId,
      handler,
      username,
      profileImageUrl: image?.url ?? null,
      ownerUserId: owner.id,
      adminUserIds: [interaction.user.id],
      posterUserIds: [],
      affiliatedHandles: [],
    });

    const embed = new EmbedBuilder()
      .setColor('#202023')
      .setTitle('Organization Created')
      .addFields(
        { name: 'Handle', value: `@${org.handler}`, inline: true },
        { name: 'Username', value: org.username, inline: true },
        { name: 'Owner', value: `<@${org.ownerUserId}>`, inline: true }
      );
    if (org.profileImageUrl) embed.setThumbnail(org.profileImageUrl);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'manage') {
    const handle = interaction.options.getString('account', true);
    const org = await Organization.findOne({ guildId: interaction.guildId, handler: handle });
    if (!org) return interaction.reply({ content: 'Organization not found.', ephemeral: true });

    const isOwner = org.ownerUserId === interaction.user.id;
    const isAdmin = org.adminUserIds.includes(interaction.user.id);
    if (!isOwner && !isAdmin) {
      return interaction.reply({ content: 'Only the owner or org admins can view this panel.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#202023')
      .setTitle(`Manage @${org.handler}`)
      .setDescription('Add posters, add affiliates, or remove members.')
      .addFields(
        { name: 'Owner', value: `<@${org.ownerUserId}>`, inline: true },
        { name: 'Admins', value: org.adminUserIds.map((id) => `<@${id}>`).join(', ') || 'None' },
        { name: 'Posters', value: org.posterUserIds.map((id) => `<@${id}>`).join(', ') || 'None' },
        { name: 'Affiliates (handles)', value: org.affiliatedHandles.length ? org.affiliatedHandles.map(h => `@${h}`).join(', ') : 'None' }
      );

    const addPosterBtn = new ButtonBuilder().setCustomId(`org:addposter:${org.id}`).setLabel('Add Poster').setStyle(ButtonStyle.Primary);
    const addAffiliateBtn = new ButtonBuilder().setCustomId(`org:addaff:${org.id}`).setLabel('Add Affiliate').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(addPosterBtn, addAffiliateBtn);

    const msg = await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, fetchReply: true });

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not for you.', ephemeral: true });
      const [_, action, orgId] = i.customId.split(':');
      const fresh = await Organization.findById(orgId);
      if (!fresh) return i.update({});
      const isOwnerFresh = fresh.ownerUserId === interaction.user.id;
      if (!isOwnerFresh) return i.reply({ content: 'Only the owner can perform this action.', ephemeral: true });

      if (action === 'addposter') {
        const modal = new ModalBuilder()
          .setCustomId(`org:addposter:${fresh.id}`)
          .setTitle('Add Poster')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('user')
                .setLabel('User ID or @mention')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            )
          );
        return i.showModal(modal);
      }

      if (action === 'addaff') {
        const modal = new ModalBuilder()
          .setCustomId(`org:addaff:${fresh.id}`)
          .setTitle('Add Affiliate')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('handle')
                .setLabel('Handle (without @)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            )
          );
        return i.showModal(modal);
      }
    });
    collector.on('end', async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
    return;
  }

  if (sub === 'post') {
    const handle = interaction.options.getString('account', true);
    const content = interaction.options.getString('content', true);
    const imageAttachment = interaction.options.getAttachment('image');
    const Post = require('../models/Post');

    if (imageAttachment && !String(imageAttachment.contentType || '').toLowerCase().includes('png')) {
      return interaction.reply({ content: 'Image must be a PNG.', ephemeral: true });
    }

    const org = await Organization.findOne({ guildId: interaction.guildId, handler: handle });
    if (!org) return interaction.reply({ content: 'Organization not found.', ephemeral: true });

    const isOwner = org.ownerUserId === interaction.user.id;
    const isAdmin = org.adminUserIds.includes(interaction.user.id);
    const isPoster = org.posterUserIds.includes(interaction.user.id);
    if (!isOwner && !isAdmin && !isPoster) {
      return interaction.reply({ content: 'You are not authorized to post for this organization.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const pngBuffer = await generateTwitterPostImage({
      profilePicUrl: org.profileImageUrl,
      username: org.username,
      handle: org.handler,
      tweetText: content,
      verificationType: org.verificationType,
      tweetImageUrl: imageAttachment?.url ?? null,
    });

    const config = await GuildConfig.findOne({ guildId: interaction.guildId });
    const forum = await interaction.guild.channels.fetch(config.twitterForumChannelId).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      return interaction.editReply({ content: 'Configured channel is not a forum channel. Please update in /config panel.' });
    }

    const me = interaction.guild.members.me;
    const perms = forum.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ManageWebhooks)) {
      return interaction.editReply({ content: 'Missing Manage Webhooks permission in the configured forum channel.' });
    }

    let webhookClient;
    try {
      webhookClient = await ensureForumWebhook(interaction, forum);
    } catch {
      return interaction.editReply({ content: 'Failed to ensure forum webhook.' });
    }

    const postDoc = await Post.create({
      guildId: interaction.guildId,
      authorUserId: interaction.user.id,
      handle: org.handler,
      username: org.username,
      content,
      imageUrl: imageAttachment?.url ?? null,
    });

    const file = new AttachmentBuilder(pngBuffer, { name: 'tweet.png' });
    const embed = new EmbedBuilder().setColor('#202023').setImage('attachment://tweet.png');

    const baseControlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`post:like:${postDoc.id}`).setLabel(`Likes: 0`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post:reply:${postDoc.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
    );

    const MAX_TITLE = 100;
    const desiredTitle = `@${org.handler}: ${content}`;
    const threadName = desiredTitle.length > MAX_TITLE ? desiredTitle.slice(0, MAX_TITLE) : desiredTitle;

    const requiresTag = forum.flags?.has(ChannelFlagsBitField.Flags.RequireTag);
    const firstTagId = Array.isArray(forum.availableTags) && forum.availableTags.length > 0 ? forum.availableTags[0].id : undefined;
    const appliedTags = requiresTag && firstTagId ? [firstTagId] : undefined;

    async function sendWith(webhook) {
      const payload = {
        username: org.username,
        avatarURL: org.profileImageUrl || interaction.user.displayAvatarURL(),
        files: [file],
        threadName,
      };
      if (appliedTags) payload.appliedTags = appliedTags;
      return webhook.send(payload);
    }

    let message;
    try {
      message = await sendWith(webhookClient);
    } catch {
      try {
        const created = await forum.createWebhook({ name: 'Twitter Post' });
        await GuildConfig.findOneAndUpdate(
          { guildId: interaction.guildId },
          { $set: { twitterForumWebhookId: created.id, twitterForumWebhookToken: created.token } },
          { upsert: true }
        );
        webhookClient = new WebhookClient({ id: created.id, token: created.token });
        message = await sendWith(webhookClient);
      } catch {
        return interaction.editReply({ content: 'Failed to send post via webhook.' });
      }
    }

    let resolvedThreadId = message?.channelId || message?.channel_id || null;
    if (!resolvedThreadId) {
      const client = interaction.client;
      resolvedThreadId = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          client.off('threadCreate', onCreate);
          resolve(null);
        }, 5000);
        function onCreate(thread) {
          try {
            if (thread.parentId === forum.id && thread.name === threadName) {
              clearTimeout(timeout);
              client.off('threadCreate', onCreate);
              resolve(thread.id);
            }
          } catch {}
        }
        client.on('threadCreate', onCreate);
      });
    }
    if (!resolvedThreadId) {
      try {
        const active = await interaction.guild.channels.fetchActiveThreads();
        const found = active.threads.find(
          (t) => t.parentId === forum.id && t.name === threadName && Date.now() - t.createdTimestamp < 60_000
        );
        if (found) resolvedThreadId = found.id;
      } catch {}
    }

    await Post.findByIdAndUpdate(postDoc.id, {
      messageId: message.id,
      threadId: resolvedThreadId || null,
      webhookId: webhookClient.id,
    }, { new: true });

    const controlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`post:like:${postDoc.id}`).setLabel(`Likes: 0`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post:reply:${postDoc.id}:${org.handler}:${message.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
    );
    try {
      await webhookClient.editMessage(message.id, { components: [controlsRow], threadId: resolvedThreadId });
    } catch {
      try {
        const thread = await interaction.guild.channels.fetch(resolvedThreadId).catch(() => null);
        if (thread) {
          await thread.send({ components: [controlsRow] });
        }
      } catch {}
    }

    await interaction.editReply({ content: `Posted thread https://discord.com/channels/${interaction.guildId}/${resolvedThreadId}` });
  }
};

module.exports.autocomplete = async (interaction) => {
  try {
    if (!interaction.inGuild()) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'account') return interaction.respond([]);

    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const query = String(focused.value || '').toLowerCase();
    const filter = isAdmin ? { guildId: interaction.guildId } : { guildId: interaction.guildId, ownerUserId: interaction.user.id };
    const orgs = await Organization.find(filter).sort({ createdAt: 1 }).limit(25);
    const choices = orgs
      .map((o) => ({ name: `@${o.handler} (${o.username})`, value: o.handler }))
      .filter((c) => !query || c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
};