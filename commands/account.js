const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Profile = require('../models/Profile');

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
  );

module.exports.execute = async (interaction) => {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
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


