const { SlashCommandBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

module.exports.data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure server settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

module.exports.execute = async (interaction) => {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
  }

  const existing = await GuildConfig.findOne({ guildId: interaction.guildId });
  let maxAccounts = existing?.maxAccountsPerUser ?? 1;
  const currentChannelId = existing?.twitterForumChannelId ?? null;

  const select = new ChannelSelectMenuBuilder()
    .setCustomId('config:set-twitter-forum')
    .setPlaceholder('Select the forum channel for Twitter posts')
    .addChannelTypes(ChannelType.GuildForum);

  const selectRow = new ActionRowBuilder().addComponents(select);

  const buildButtonsRow = (count, disabled = false) => {
    const up = new ButtonBuilder()
      .setCustomId('config:max-accounts:up')
      .setEmoji('⬆️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || count >= 10);
    const display = new ButtonBuilder()
      .setCustomId('config:max-accounts:display')
      .setLabel(`Max accounts: ${count}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
    const down = new ButtonBuilder()
      .setCustomId('config:max-accounts:down')
      .setEmoji('⬇️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || count <= 1);
    return new ActionRowBuilder().addComponents(up, display, down);
  };

  const embedColor = '#202023';
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Configuration')
    .setDescription('Manage your server settings below.')
    .addFields(
      { name: 'Twitter Forum Channel', value: currentChannelId ? `<#${currentChannelId}>` : 'Not set' },
      { name: 'Max Accounts Per User', value: String(maxAccounts), inline: true },
    );

  const message = await interaction.reply({ embeds: [embed], components: [selectRow, buildButtonsRow(maxAccounts)], ephemeral: true, fetchReply: true });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('config:max-accounts:'),
  });

  collector.on('collect', async (i) => {
    if (i.customId.endsWith(':up') && maxAccounts < 10) {
      maxAccounts += 1;
    } else if (i.customId.endsWith(':down') && maxAccounts > 1) {
      maxAccounts -= 1;
    }

    const updated = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { maxAccountsPerUser: maxAccounts } },
      { upsert: true, new: true }
    );

    const refreshed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('Configuration')
      .setDescription('Manage your server settings below.')
      .addFields(
        { name: 'Twitter Forum Channel', value: updated.twitterForumChannelId ? `<#${updated.twitterForumChannelId}>` : 'Not set' },
        { name: 'Max Accounts Per User', value: String(updated.maxAccountsPerUser), inline: true },
      );

    await i.update({ embeds: [refreshed], components: [selectRow, buildButtonsRow(maxAccounts)] });
  });

  collector.on('end', async () => {
    try {
      await message.edit({ components: [selectRow, buildButtonsRow(maxAccounts, true)] });
    } catch {}
  });
};


