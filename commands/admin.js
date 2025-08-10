const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Organization = require('../models/Organization');

function parseTargetString(input) {
  if (!input) return { userId: null, handle: null };
  const idMatch = String(input).match(/\d{15,}/);
  if (idMatch) return { userId: idMatch[0], handle: null };
  const handle = String(input).trim().replace(/^@/, '');
  return { userId: null, handle };
}

module.exports.data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Administrative actions')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('Action to take')
      .setRequired(true)
      .addChoices(
        { name: 'delete', value: 'delete' },
        { name: 'verify', value: 'verify' },
        { name: 'info', value: 'info' },
      )
  )
  .addStringOption((opt) =>
    opt
      .setName('target')
      .setDescription('User mention or @handle')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('verify_type')
      .setDescription('Verification type for verify action')
      .addChoices(
        { name: 'Gold (Organization)', value: 'gold' },
        { name: 'Blue (Known)', value: 'blue' },
        { name: 'Grey (Government)', value: 'grey' },
      )
  );

module.exports.execute = async (interaction) => {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Admins only.', ephemeral: true });
  }

  const action = interaction.options.getString('action', true);
  const target = interaction.options.getString('target', true);
  const verifyType = interaction.options.getString('verify_type');
  const { userId, handle } = parseTargetString(target);

  if (action === 'delete') {
    await interaction.deferReply({ ephemeral: true });
    let deletedPosts = 0;
    try {
      let handles = [];
      if (userId) {
        const profiles = await Profile.find({ guildId: interaction.guildId, userId });
        const orgs = await Organization.find({ guildId: interaction.guildId, ownerUserId: userId });
        handles = [
          ...profiles.map((p) => p.handle),
          ...orgs.map((o) => o.handler),
        ];
      } else if (handle) {
        handles = [handle];
      }

      const postQuery = userId
        ? { guildId: interaction.guildId, $or: [{ authorUserId: userId }, { handle: { $in: handles } }] }
        : { guildId: interaction.guildId, handle };
      const posts = await Post.find(postQuery);
      for (const p of posts) {
        if (p.threadId) {
          try {
            const thread = await interaction.guild.channels.fetch(p.threadId);
            if (thread) await thread.delete().catch(() => {});
          } catch {}
        }
      }
      deletedPosts = (await Post.deleteMany(postQuery)).deletedCount || 0;

      let deletedProfiles = 0;
      let deletedOrgs = 0;
      if (userId) {
        deletedProfiles = (await Profile.deleteMany({ guildId: interaction.guildId, userId })).deletedCount || 0;
        deletedOrgs = (await Organization.deleteMany({ guildId: interaction.guildId, ownerUserId: userId })).deletedCount || 0;
      } else if (handle) {
        deletedProfiles = (await Profile.deleteMany({ guildId: interaction.guildId, handle })).deletedCount || 0;
        deletedOrgs = (await Organization.deleteMany({ guildId: interaction.guildId, handler: handle })).deletedCount || 0;
      }

      return interaction.editReply({ content: `Deleted posts: ${deletedPosts}, profiles: ${deletedProfiles}, organizations: ${deletedOrgs}.` });
    } catch (e) {
      return interaction.editReply({ content: 'Delete failed.' });
    }
  }

  if (action === 'verify') {
    if (!verifyType) return interaction.reply({ content: 'Provide verify_type.', ephemeral: true });

    if (userId) {
      const orgRes = await Organization.updateMany(
        { guildId: interaction.guildId, ownerUserId: userId },
        { $set: { verificationType: verifyType } }
      );
      const profRes = await Profile.updateMany(
        { guildId: interaction.guildId, userId },
        { $set: { verificationType: verifyType } }
      );
      const orgMatched = orgRes.matchedCount || 0;
      const orgModified = orgRes.modifiedCount || 0;
      const profMatched = profRes.matchedCount || 0;
      const profModified = profRes.modifiedCount || 0;
      return interaction.reply({ content: `Organizations matched: ${orgMatched}, updated: ${orgModified} | Profiles matched: ${profMatched}, updated: ${profModified}`, ephemeral: true });
    } else if (handle) {
      const orgRes = await Organization.updateOne(
        { guildId: interaction.guildId, handler: handle },
        { $set: { verificationType: verifyType } }
      );
      const profRes = await Profile.updateMany(
        { guildId: interaction.guildId, handle },
        { $set: { verificationType: verifyType } }
      );
      const orgModified = orgRes.modifiedCount || 0;
      const profMatched = profRes.matchedCount || 0;
      const profModified = profRes.modifiedCount || 0;
      return interaction.reply({ content: `Organization updated: ${orgModified} | Profiles matched: ${profMatched}, updated: ${profModified}`, ephemeral: true });
    }
    return interaction.reply({ content: 'Provide a valid target (user mention or @handle).', ephemeral: true });
  }

  if (action === 'info') {
    const isUser = Boolean(userId);
    const profiles = isUser
      ? await Profile.find({ guildId: interaction.guildId, userId }).sort({ createdAt: -1 })
      : await Profile.find({ guildId: interaction.guildId, handle }).sort({ createdAt: -1 });
    const orgs = isUser
      ? await Organization.find({ guildId: interaction.guildId, ownerUserId: userId }).sort({ createdAt: -1 })
      : await Organization.find({ guildId: interaction.guildId, handler: handle }).sort({ createdAt: -1 });
    const handles = [...new Set([...(profiles.map(p => p.handle)), ...(orgs.map(o => o.handler))])];
    const posts = await Post.find({ guildId: interaction.guildId, $or: [{ authorUserId: userId || undefined }, { handle: { $in: handles } }] }).sort({ createdAt: -1 }).limit(10);

    const embed = new EmbedBuilder()
      .setColor('#202023')
      .setTitle('Admin Info')
      .addFields(
        { name: 'Profiles', value: profiles.length ? profiles.map(p => `@${p.handle} (${p.username})`).join('\n') : 'None' },
        { name: 'Organizations', value: orgs.length ? orgs.map(o => `@${o.handler} (${o.username})`).join('\n') : 'None' },
        { name: 'Recent Posts', value: posts.length ? posts.map(p => `@${p.handle} — https://discord.com/channels/${interaction.guildId}/${p.threadId || ''}`).join('\n') : 'None' },
      );

    const rows = [];
    if (orgs.length === 1) {
      const addAdminBtn = new ButtonBuilder().setCustomId(`admin:addadmin:${orgs[0].id}`).setLabel('Add Admin').setStyle(ButtonStyle.Secondary);
      rows.push(new ActionRowBuilder().addComponents(addAdminBtn));
    }
    return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }

  return interaction.reply({ content: 'Unknown action.', ephemeral: true });
};


