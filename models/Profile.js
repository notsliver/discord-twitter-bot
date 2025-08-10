const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    handle: { type: String, required: true },
    username: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
    verificationType: { type: String, enum: ['blue', 'grey', 'gold'], default: null },
    affiliatedIconUrl: { type: String, default: null },
    createdBy: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'guild.profiles',
  }
);

ProfileSchema.index({ guildId: 1, userId: 1, handle: 1 }, { unique: true });
ProfileSchema.index({ guildId: 1, userId: 1 });

module.exports = mongoose.model('Profile', ProfileSchema);


