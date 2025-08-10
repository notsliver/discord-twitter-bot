require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, Collection, InteractionType, ChannelType, ActionRowBuilder, ChannelSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, WebhookClient } = require('discord.js');
const mongoose = require('mongoose');
const path = require('path');
const { loadSlashCommands } = require('./commandLoader');
const GuildConfig = require('./models/GuildConfig');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const pendingReplies = new Map();

async function connectToDatabase(uri) {
  try {
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || 'twitter',
    });
    console.log('[DB] Connected to MongoDB');
  } catch (error) {
    console.error('[DB] MongoDB connection error:', error.message);
    process.exitCode = 1;
  }
}

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}

async function start() {
  await connectToDatabase(MONGODB_URI);

  const client = createDiscordClient();
  const { commands } = loadSlashCommands(path.join(__dirname, 'commands'));
  client.commands = new Collection(commands);

  client.once(Events.ClientReady, (c) => {
    console.log(`[Bot] Logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && (interaction.customId.startsWith('post:like:') || interaction.customId.startsWith('post:reply:'))) {
        const parts = interaction.customId.split(':');
        const [type, action, postId] = parts;
        const Post = require('./models/Post');
        const post = await Post.findById(postId);
        if (!post) return interaction.reply({ content: 'Post not found.', ephemeral: true });

        if (action === 'like') {
          post.likesCount += 1;
          await post.save();
          const likeBtn = new ButtonBuilder().setCustomId(`post:like:${post.id}`).setLabel(`Likes: ${post.likesCount}`).setStyle(ButtonStyle.Secondary);
          const replyBtn = new ButtonBuilder().setCustomId(`post:reply:${post.id}`).setLabel('Reply').setStyle(ButtonStyle.Secondary);
          const row = new ActionRowBuilder().addComponents(likeBtn, replyBtn);
          return interaction.update({ components: [row] });
        }

        if (action === 'reply') {
          const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
          const targetHandle = parts[3] || post.handle;
          const targetMessageId = parts[4] || post.messageId;
          const modal = new ModalBuilder().setCustomId(`post:reply:modal:${post.id}:${targetHandle}:${targetMessageId}`).setTitle('Add Reply');
          const input = new TextInputBuilder().setCustomId('text').setLabel('Your reply').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        }
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('post:reply:modal:')) {
        const parts = interaction.customId.split(':');
        const postId = parts[3];
        const replyToHandle = parts[4] || null;
        const replyToMessageId = parts[5] || null;
        const text = interaction.fields.getTextInputValue('text');
        const key = `${interaction.guildId}:${interaction.user.id}:${postId}`;
        pendingReplies.set(key, { text, replyToHandle, replyToMessageId });

        const { StringSelectMenuBuilder } = require('discord.js');
        const Profile = require('./models/Profile');
        const Organization = require('./models/Organization');
        const profiles = await Profile.find({ guildId: interaction.guildId, userId: interaction.user.id }).limit(25);
        const orgs = await Organization.find({ guildId: interaction.guildId, ownerUserId: interaction.user.id }).limit(25);

        const options = [
          ...profiles.map((p) => ({ label: `Profile: @${p.handle}`, value: `p:${p.id}` })),
          ...orgs.map((o) => ({ label: `Org: @${o.handler}`, value: `o:${o.id}` })),
        ];
        let parentHandle = replyToHandle || 'thread';
        if (!parentHandle) {
          try {
            const ParentPost = require('./models/Post');
            const parent = await ParentPost.findById(postId);
            if (parent?.handle) parentHandle = parent.handle;
          } catch {}
        }
        const menu = new StringSelectMenuBuilder().setCustomId(`post:reply:target:${postId}:${parentHandle}`).setPlaceholder('Reply as...').addOptions(options.slice(0, 25));
        const row = new ActionRowBuilder().addComponents(menu);
        return interaction.reply({ content: 'Choose an identity to reply as:', components: [row], ephemeral: true });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('post:reply:target:')) {
        const parts = interaction.customId.split(':');
        const postId = parts[3];
        const passedReplyHandle = parts[4] || null;
        const selection = interaction.values[0];
        const [kind, id] = selection.split(':');
        const key = `${interaction.guildId}:${interaction.user.id}:${postId}`;
        const draft = pendingReplies.get(key);
        if (!draft) return interaction.reply({ content: 'Reply expired. Try again.', ephemeral: true });

        const Post = require('./models/Post');
        const post = await Post.findById(postId);
        if (!post || !post.threadId) return interaction.reply({ content: 'Cannot find the target thread.', ephemeral: true });

        const thread = await interaction.guild.channels.fetch(post.threadId).catch(() => null);
        if (!thread) return interaction.reply({ content: 'Thread no longer exists.', ephemeral: true });

        let displayName = interaction.user.username;
        let avatar = interaction.user.displayAvatarURL();
        let handleText = '';
        let replyHandle = passedReplyHandle || draft.replyToHandle || post.handle;
        let replyVerificationType = null;
        let replyAffiliatedIconUrl = null;
        if (kind === 'p') {
          const Profile = require('./models/Profile');
          const prof = await Profile.findById(id);
          if (prof) {
            displayName = `${prof.username}`;
            avatar = prof.profileImageUrl || avatar;
            handleText = `${prof.handle}`;
            replyVerificationType = prof.verificationType || null;
            replyAffiliatedIconUrl = prof.affiliatedIconUrl || null;
          }
        } else if (kind === 'o') {
          const Organization = require('./models/Organization');
          const org = await Organization.findById(id);
          if (org) {
            displayName = `${org.username}`;
            avatar = org.profileImageUrl || avatar;
            handleText = `${org.handler}`;
            replyVerificationType = org.verificationType || null;
          }
        }

        try {
          const { generateTwitterReplyImage } = require('./utils/twitterreplying-generator');
          const png = await generateTwitterReplyImage({
            profilePicUrl: avatar,
            username: displayName,
            handle: handleText,
            replyToHandle: replyHandle,
            tweetText: draft.text,
            tweetImageUrl: null,
            verificationType: replyVerificationType,
            affiliatedIconUrl: replyAffiliatedIconUrl,
          });
          const file = new AttachmentBuilder(png, { name: 'reply.png' });
          const header = `**${displayName}**\n-# @${handleText || replyHandle}`;
          const sent = await thread.send({
            files: [file],
            reply: { messageReference: draft.replyToMessageId || post.messageId, failIfNotExists: false },
            allowedMentions: { parse: [] },
          });
          const replyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`post:reply:${post.id}:${handleText || replyHandle}:${sent?.id || draft.replyToMessageId || post.messageId}`).setLabel('Reply').setStyle(ButtonStyle.Secondary)
          );
          try {
            if (sent?.edit) await sent.edit({ components: [replyRow] });
            else await thread.send({ components: [replyRow] });
          } catch {}
          post.commentsCount += 1;
          await post.save();
        } catch {
          return interaction.reply({ content: 'Failed to post comment.', ephemeral: true });
        }

        await interaction.update({ content: 'Reply posted.' });
        pendingReplies.delete(key);
        return;
      }
      if (interaction.isModalSubmit()) {
        const id = interaction.customId;
        if (id.startsWith('org:addposter:')) {
          const orgId = id.split(':')[2];
          const userField = interaction.fields.getTextInputValue('user');
          const userId = (userField.match(/\d{15,}/) || [null])[0] || userField;
          const Organization = require('./models/Organization');
          const org = await Organization.findById(orgId);
          if (!org) return interaction.reply({ content: 'Organization not found.', ephemeral: true });
          if (org.ownerUserId !== interaction.user.id) return interaction.reply({ content: 'Only the owner can modify posters.', ephemeral: true });
          if (!org.posterUserIds.includes(userId)) org.posterUserIds.push(userId);
          await org.save();
          return interaction.reply({ content: `Added <@${userId}> as poster.`, ephemeral: true });
        }
        if (id.startsWith('org:addaff:')) {
          const orgId = id.split(':')[2];
          const handle = interaction.fields.getTextInputValue('handle').replace(/^@/, '');
          const Organization = require('./models/Organization');
          const Profile = require('./models/Profile');
          const org = await Organization.findById(orgId);
          if (!org) return interaction.reply({ content: 'Organization not found.', ephemeral: true });
          if (org.ownerUserId !== interaction.user.id) return interaction.reply({ content: 'Only the owner can add affiliates.', ephemeral: true });

          const ownerProfile = await Profile.findOne({ guildId: interaction.guildId, handle });
          if (!ownerProfile) return interaction.reply({ content: 'No user with that handle exists in this guild.', ephemeral: true });

          try {
            const user = await interaction.client.users.fetch(ownerProfile.userId);
            const dm = await user.createDM();
            const row = new (require('discord.js').ActionRowBuilder)().addComponents(
              new (require('discord.js').ButtonBuilder)().setCustomId(`org:aff:accept:${org.id}:${handle}`).setLabel('Accept').setStyle(require('discord.js').ButtonStyle.Success),
              new (require('discord.js').ButtonBuilder)().setCustomId(`org:aff:deny:${org.id}:${handle}`).setLabel('Deny').setStyle(require('discord.js').ButtonStyle.Danger)
            );
            await dm.send({ content: `Organization @${org.handler} wants to affiliate with your handle @${handle}. Accept?`, components: [row] });
          } catch (e) {
            return interaction.reply({ content: 'Failed to DM the user for consent.', ephemeral: true });
          }

          return interaction.reply({ content: 'Sent an affiliate request via DM.', ephemeral: true });
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('org:aff:')) {
        const [_, __, decision, orgId, handle] = interaction.customId.split(':');
        const Organization = require('./models/Organization');
        const Profile = require('./models/Profile');
        const org = await Organization.findById(orgId);
        if (!org) return interaction.reply({ content: 'Organization not found.', ephemeral: true });
        const ownerProfile = await Profile.findOne({ guildId: org.guildId, userId: interaction.user.id, handle });
        if (!ownerProfile) return interaction.reply({ content: 'You do not own this handle.', ephemeral: true });

        if (decision === 'accept') {
          ownerProfile.affiliatedIconUrl = org.profileImageUrl || null;
          await ownerProfile.save();
          if (!org.affiliatedHandles.includes(handle)) org.affiliatedHandles.push(handle);
          await org.save();
          return interaction.update({ content: `Affiliation accepted. @${handle} is now affiliated with @${org.handler}.`, components: [] });
        } else {
          return interaction.update({ content: 'Affiliation request denied.', components: [] });
        }
      }
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.autocomplete) return;
        await command.autocomplete(interaction);
        return;
      }

      if (interaction.isChannelSelectMenu() && interaction.customId === 'config:set-twitter-forum') {
        if (!interaction.inGuild()) return interaction.reply({ content: 'Server only.', ephemeral: true });
        const selectedChannel = interaction.channels.first();
        if (!selectedChannel || selectedChannel.type !== ChannelType.GuildForum) {
          return interaction.reply({ content: 'Please select a forum channel.', ephemeral: true });
        }
        const updated = await GuildConfig.findOneAndUpdate(
          { guildId: interaction.guildId },
          { $set: { twitterForumChannelId: selectedChannel.id } },
          { upsert: true, new: true }
        );
        const INVISIBLE_EMBED_COLOR = 0x202023;
        const embed = new EmbedBuilder()
          .setColor(INVISIBLE_EMBED_COLOR)
          .setTitle('Configuration Updated')
          .setDescription(`Saved Twitter forum channel: <#${updated.twitterForumChannelId}>`);
        await interaction.update({ embeds: [embed], components: [] });

        try {
          const forum = await interaction.guild.channels.fetch(selectedChannel.id).catch(() => null);
          if (forum && forum.type === ChannelType.GuildForum) {
            const guide = [
              '**Welcome to the Social Media**',
              '',
              '**Quick start**',
              '- Use `/account register` to create your profile.',
              '- Use `/tweet` to create a post.',
              '- Click Like/Comment buttons on posts to interact. Comment opens a modal and lets you choose an identity.',
              '', ].join('\n');

            const thread = await forum.threads.create({
              name: 'Social Media',
              autoArchiveDuration: 1440,
              message: { content: guide },
            }).catch(() => null);
            if (thread) {
              const starter = await thread.fetchStarterMessage().catch(() => null);
              if (starter) {
                await starter.pin().catch(() => {});
              }
            }
          }
        } catch {}
        return;
      }
    } catch (err) {
      console.error('Interaction error:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
      }
    }
  });

  if (!DISCORD_BOT_TOKEN) {
    console.warn('[Bot] DISCORD_BOT_TOKEN not set. Skipping login. Set it in your .env to start the bot.');
    return;
  }

  try {
    await client.login(DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('[Bot] Login failed:', error.message);
    process.exitCode = 1;
  }
}

start();


