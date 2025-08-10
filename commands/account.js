const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} = require('discord.js');
const Profile = require('../models/Profile');
const Organization = require('../models/Organization');
const Post = require('../models/Post');
const { generateTwitterPostImage } = require('../utils/twitterpost-generator');

module.exports.data = new SlashCommandBuilder()
  .setName('account')
  .setDescription('Account related commands')
  .addSubcommand((sub) =>
    sub
      .setName('register')
      .setDescription('Register a new account profile')
      .addStringOption((opt) =>
        opt
          .setName('handle')
          .setDescription('Your handle (e.g., without @. Do not ping yourself)')
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('username')
          .setDescription('Display name / username')
          .setMinLength(2)
          .setMaxLength(64)
          .setRequired(true)
      )
      .addAttachmentOption((opt) =>
        opt
          .setName('profile')
          .setDescription('Profile image attachment (optional)')
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit username or profile image for your profile or organization')
      .addStringOption((opt) =>
        opt
          .setName('account')
          .setDescription('Select your handle')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

module.exports.execute = async (interaction) => {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'edit') {
    return handleEdit(interaction);
  }
  if (sub !== 'register') return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });

  const handleRaw = interaction.options.getString('handle', true);
  const username = interaction.options.getString('username', true);
  const profileAttachment = interaction.options.getAttachment('profile');

  const invalidSpace = /\s/.test(handleRaw) || /\s/.test(username);
  const beginsWithAt = handleRaw.startsWith('@') || username.startsWith('@');
  const allowedPattern = /^[A-Za-z0-9][A-Za-z0-9._]*$/;
  const hasLetter = /[A-Za-z]/;
  if (invalidSpace) {
    return interaction.reply({ content: 'Handles and usernames cannot contain spaces. Use _ or . instead (e.g., Elon_Musk).', ephemeral: true });
  }
  if (beginsWithAt) {
    return interaction.reply({ content: 'Handles and usernames cannot begin with @. Enter without the @ prefix.', ephemeral: true });
  }
  if (!allowedPattern.test(handleRaw) || !allowedPattern.test(username)) {
    return interaction.reply({ content: 'Only letters, numbers, underscore (_) and dot (.) are allowed. Must start with a letter/number.', ephemeral: true });
  }
  if (!hasLetter.test(handleRaw) || !hasLetter.test(username)) {
    return interaction.reply({ content: 'Handles and usernames must include at least one letter.', ephemeral: true });
  }

  const handle = handleRaw;

  try {
    const config = await require('../models/GuildConfig').findOne({ guildId: interaction.guildId });
    const maxAllowed = config?.maxAccountsPerUser ?? 1;
    const existingCount = await Profile.countDocuments({ guildId: interaction.guildId, userId: interaction.user.id });

    const existingByHandle = await Profile.findOne({ guildId: interaction.guildId, userId: interaction.user.id, handle });
    const wouldExceed = !existingByHandle && existingCount >= maxAllowed;
    if (wouldExceed) {
      return interaction.reply({ content: `You have reached the maximum of ${maxAllowed} account(s) for this server.`, ephemeral: true });
    }

    const update = {
      $setOnInsert: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        createdBy: interaction.user.id,
        handle,
      },
      $set: {
        username,
      },
    };
    if (profileAttachment?.url) {
      update.$set.profileImageUrl = profileAttachment.url;
    }

    const doc = await Profile.findOneAndUpdate(
      { guildId: interaction.guildId, userId: interaction.user.id, handle },
      update,
      { upsert: true, new: true }
    );

    const INVISIBLE_EMBED_COLOR = '202023';
    const embed = new EmbedBuilder()
      .setColor(INVISIBLE_EMBED_COLOR)
      .setTitle('Profile Saved')
      .addFields(
        { name: 'Handle', value: `@${doc.handle}`, inline: true },
        { name: 'Username', value: doc.username, inline: true },
      //  { name: 'Profile Image', value: doc.profileImageUrl ? doc.profileImageUrl : 'None' }
      );
    if (doc.profileImageUrl) {
      embed.setImage(doc.profileImageUrl);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('Profile save error:', err);
    await interaction.reply({ content: 'Failed to save profile.', ephemeral: true });
  }
};


async function handleEdit(interaction) {
  try {
    const selected = interaction.options.getString('account', true); // value like "p:<id>" or "o:<id>"
    const [kind, id] = String(selected).split(':');
    if (!['p', 'o'].includes(kind) || !id) {
      return interaction.reply({ content: 'Invalid selection.', ephemeral: true });
    }

    let doc = null;
    let handle = '';
    let username = '';
    let imageUrl = null;
    let verificationType = null;
    let affiliatedIconUrl = null;

    if (kind === 'p') {
      doc = await Profile.findById(id);
      if (!doc || doc.guildId !== interaction.guildId) return interaction.reply({ content: 'Account not found.', ephemeral: true });
      if (doc.userId !== interaction.user.id) return interaction.reply({ content: 'You do not own this profile.', ephemeral: true });
      handle = doc.handle;
      username = doc.username;
      imageUrl = doc.profileImageUrl || null;
      verificationType = doc.verificationType || null;
      affiliatedIconUrl = doc.affiliatedIconUrl || null;
    } else {
      doc = await Organization.findById(id);
      if (!doc || doc.guildId !== interaction.guildId) return interaction.reply({ content: 'Organization not found.', ephemeral: true });
      const isOwner = doc.ownerUserId === interaction.user.id;
      const isAdmin = doc.adminUserIds.includes(interaction.user.id);
      if (!isOwner && !isAdmin) return interaction.reply({ content: 'You are not allowed to edit this organization.', ephemeral: true });
      handle = doc.handler;
      username = doc.username;
      imageUrl = doc.profileImageUrl || null;
      verificationType = doc.verificationType || null;
    }

    const recent = await Post.find({ guildId: interaction.guildId, handle }).sort({ createdAt: -1 }).limit(5);
    const recentLines = recent.length
      ? recent.map((p, idx) => `- ${idx + 1}. ${p.content.slice(0, 80)}${p.content.length > 80 ? '…' : ''}`).join('\n')
      : 'No recent posts.';

    const png = await generateTwitterPostImage({
      profilePicUrl: imageUrl,
      username,
      handle,
      tweetText: `Example post by @${handle}`,
      verificationType,
      affiliatedIconUrl,
      tweetImageUrl: null,
    });

    const embed = new EmbedBuilder()
      .setColor('#202023')
      .setTitle(`Edit @${handle}`)
      .addFields(
        { name: 'Username', value: username || 'None', inline: true },
        { name: 'Type', value: kind === 'p' ? 'Profile' : 'Organization', inline: true },
        { name: 'Recent posts', value: recentLines }
      )
      .setImage('attachment://example.png');
    if (imageUrl) embed.setThumbnail(imageUrl);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`account:edit:username:${kind}:${id}`).setLabel('Edit Username').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`account:edit:profileimg:${kind}:${id}`).setLabel('Edit Profile Image').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], files: [{ attachment: png, name: 'example.png' }], components: [row], flags: 64 });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not your panel.', ephemeral: true });
      const parts = i.customId.split(':');
      const action = parts[2];
      const selKind = parts[3];
      const selId = parts[4];

      if (action === 'username') {
        const modal = new ModalBuilder()
          .setCustomId(`account:edit:username:${selKind}:${selId}`)
          .setTitle('Edit Username')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('username').setLabel('New username').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(64).setRequired(true)
            )
          );
        return i.showModal(modal);
      }
      if (action === 'profileimg') {
        const modal = new ModalBuilder()
          .setCustomId(`account:edit:profileimg:${selKind}:${selId}`)
          .setTitle('Edit Profile Image')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('image').setLabel('Image URL (leave blank to clear)').setStyle(TextInputStyle.Short).setRequired(false)
            )
          );
        return i.showModal(modal);
      }
    });
    collector.on('end', async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
  } catch (err) {
    console.error('Edit panel error:', err);
    return interaction.reply({ content: 'Failed to open edit panel.', ephemeral: true }).catch(() => {});
  }
}

module.exports.autocomplete = async (interaction) => {
  try {
    if (!interaction.inGuild()) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'account') return interaction.respond([]);

    const query = String(focused.value || '').toLowerCase();

    const profiles = await Profile.find({ guildId: interaction.guildId, userId: interaction.user.id }).sort({ createdAt: 1 }).limit(25);
    const orgs = await Organization.find({ guildId: interaction.guildId, $or: [ { ownerUserId: interaction.user.id }, { adminUserIds: interaction.user.id } ] }).sort({ createdAt: 1 }).limit(25);

    const profileChoices = profiles.map((p) => ({ name: `(Profile) @${p.handle} (${p.username})`, value: `p:${p.id}` }));
    const orgChoices = orgs.map((o) => ({ name: `(Org) @${o.handler} (${o.username})`, value: `o:${o.id}` }));

    const all = [...profileChoices, ...orgChoices].filter((c) => !query || c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query)).slice(0, 25);
    await interaction.respond(all);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
};


