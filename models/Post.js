const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    authorUserId: { type: String, required: true, index: true },
    handle: { type: String, required: true },
    username: { type: String, required: true },
    content: { type: String, required: true },
    imageUrl: { type: String, default: null },
    messageId: { type: String, default: null },
    threadId: { type: String, default: null },
    webhookId: { type: String, default: null },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'guild.posts' }
);

module.exports = mongoose.model('Post', PostSchema);


