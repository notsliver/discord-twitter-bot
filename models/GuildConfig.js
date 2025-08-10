const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true, unique: true },
    twitterForumChannelId: { type: String, default: null },
    twitterForumWebhookId: { type: String, default: null },
    twitterForumWebhookToken: { type: String, default: null },
    maxAccountsPerUser: {
      type: Number,
      default: 1,
      min: 1,
      max: 10,
    },
  },
  {
    timestamps: true,
    collection: 'guild.configs',
  }
);

module.exports = mongoose.model('GuildConfig', GuildConfigSchema);


