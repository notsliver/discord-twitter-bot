const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, WebhookClient, ChannelType, ChannelFlagsBitField, PermissionsBitField, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const { generateTwitterPostImage } = require('../utils/twitterpost-generator');

module.exports.data = new SlashCommandBuilder()
  .setName('tweet')
  .setDescription('Create a tweet')
  .addStringOption((opt) =>
    opt
      .setName('account')
      .setDescription('Choose which account to post as')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('content')
      .setDescription('Post content')
      .setRequired(true)
      .setMaxLength(280)
  )
  .addAttachmentOption((opt) =>
    opt
      .setName('image')
      .setDescription('PNG image to include')
      .setRequired(false)
  );

module.exports.execute = async (interaction) => {
  try {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const selectedHandle = interaction.options.getString('account', true);
    const content = interaction.options.getString('content', true);
    const imageAttachment = interaction.options.getAttachment('image');

    if (imageAttachment && !String(imageAttachment.contentType || '').toLowerCase().includes('png')) {
      return interaction.reply({ content: 'Image must be a PNG.', ephemeral: true });
    }

    const config = await GuildConfig.findOne({ guildId: interaction.guildId });
    if (!config?.twitterForumChannelId) {
      return interaction.reply({ content: 'Twitter forum channel not set. Use /config panel to set it.', ephemeral: true });
    }

    const profile = await Profile.findOne({ guildId: interaction.guildId, userId: interaction.user.id, handle: selectedHandle });
    if (!profile) {
      return interaction.reply({ content: 'Selected account not found. Register with /account register or pick another account.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const pngBuffer = await generateTwitterPostImage({
      profilePicUrl: profile.profileImageUrl,
      username: profile.username,
      handle: profile.handle,
      tweetText: content,
      tweetImageUrl: imageAttachment?.url ?? null,
      verificationType: profile.verificationType || null,
      affiliatedIconUrl: profile.affiliatedIconUrl || null,
    });

    const forum = await interaction.guild.channels.fetch(config.twitterForumChannelId).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      return interaction.editReply({ content: 'Configured channel is not a forum channel. Please update in /config panel.' });
    }

    const me = interaction.guild.members.me;
    const perms = forum.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ManageWebhooks)) {
      return interaction.editReply({ content: 'Missing Manage Webhooks permission in the configured forum channel.' });
    }

    async function ensureWebhook() {
      if (config.twitterForumWebhookId && config.twitterForumWebhookToken) {
        return new WebhookClient({ id: config.twitterForumWebhookId, token: config.twitterForumWebhookToken });
      }
      try {
        const hooks = await forum.fetchWebhooks();
        const existing = hooks.find((wh) => Boolean(wh.token));
        if (existing) {
          await GuildConfig.findOneAndUpdate(
            { guildId: interaction.guildId },
            { $set: { twitterForumWebhookId: existing.id, twitterForumWebhookToken: existing.token } },
            { upsert: true }
          );
          return new WebhookClient({ id: existing.id, token: existing.token });
        }
      } catch {}
      const created = await forum.createWebhook({ name: 'Twitter Post' });
      await GuildConfig.findOneAndUpdate(
        { guildId: interaction.guildId },
        { $set: { twitterForumWebhookId: created.id, twitterForumWebhookToken: created.token } },
        { upsert: true }
      );
      return new WebhookClient({ id: created.id, token: created.token });
    }

    let webhookClient;
    try {
      webhookClient = await ensureWebhook();
    } catch (e) {
      return interaction.editReply({ content: 'Failed to create webhook.' });
    }

    const postDoc = await Post.create({
      guildId: interaction.guildId,
      authorUserId: interaction.user.id,
      handle: profile.handle,
      username: profile.username,
      content,
      imageUrl: imageAttachment?.url ?? null,
    });

    const file = new AttachmentBuilder(pngBuffer, { name: 'tweet.png' });

    const baseControlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`post:like:${postDoc.id}`).setLabel(`Likes: 0`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post:reply:${postDoc.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
    );
    let message;
    const MAX_TITLE = 100;
    const desiredTitle = `@${profile.handle}: ${content}`;
    const threadName = desiredTitle.length > MAX_TITLE ? desiredTitle.slice(0, MAX_TITLE) : desiredTitle;

    const requiresTag = forum.flags?.has(ChannelFlagsBitField.Flags.RequireTag);
    const firstTagId = Array.isArray(forum.availableTags) && forum.availableTags.length > 0 ? forum.availableTags[0].id : undefined;
    const appliedTags = requiresTag && firstTagId ? [firstTagId] : undefined;

    async function sendWith(webhook) {
      const payload = {
        username: interaction.user.username,
        avatarURL: interaction.user.displayAvatarURL(),
        files: [file],
        threadName,
      };
      if (appliedTags) payload.appliedTags = appliedTags;
      return webhook.send(payload);
    }

    try {
      message = await sendWith(webhookClient);
    } catch (e) {
      try {
        const created = await forum.createWebhook({ name: 'Twitter Post' });
        await GuildConfig.findOneAndUpdate(
          { guildId: interaction.guildId },
          { $set: { twitterForumWebhookId: created.id, twitterForumWebhookToken: created.token } },
          { upsert: true }
        );
        webhookClient = new WebhookClient({ id: created.id, token: created.token });
        message = await sendWith(webhookClient);
      } catch (e2) {
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
        const found = active.threads.find((t) => t.parentId === forum.id && t.name === threadName && Date.now() - t.createdTimestamp < 60_000);
        if (found) resolvedThreadId = found.id;
      } catch {}
    }

    await Post.findByIdAndUpdate(postDoc.id, {
      guildId: interaction.guildId,
      authorUserId: interaction.user.id,
      handle: profile.handle,
      username: profile.username,
      content,
      imageUrl: imageAttachment?.url ?? null,
      messageId: message.id,
      threadId: resolvedThreadId || null,
      webhookId: webhookClient.id,
    }, { new: true });

    const controlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`post:like:${postDoc.id}`).setLabel(`Likes: 0`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post:reply:${postDoc.id}:${profile.handle}:${message.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
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

    await interaction.editReply({ content: `Posted in https://discord.com/channels/${interaction.guildId}/${resolvedThreadId}` });
  } catch (err) {
    console.error('Error in /post:', err);
    const replyPayload = { content: 'An unexpected error occurred while creating your post.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(replyPayload);
      } else {
        await interaction.reply(replyPayload);
      }
    } catch {}
  }
};

module.exports.autocomplete = async (interaction) => {
  try {
    if (!interaction.inGuild()) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'account') return interaction.respond([]);

    const query = String(focused.value || '').toLowerCase();
    const accounts = await Profile.find({ guildId: interaction.guildId, userId: interaction.user.id })
      .sort({ createdAt: 1 })
      .limit(25);

    const choices = accounts
      .map((p) => ({ name: `@${p.handle} (${p.username})`, value: p.handle }))
      .filter((c) => !query || c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query))
      .slice(0, 25);

    await interaction.respond(choices);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
};


