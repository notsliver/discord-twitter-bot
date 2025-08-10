const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    handler: { type: String, required: true },
    username: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
    ownerUserId: { type: String, required: true, index: true },
    adminUserIds: { type: [String], default: [] },
    posterUserIds: { type: [String], default: [] },
    affiliatedHandles: { type: [String], default: [] },
    verificationType: { type: String, enum: ['blue', 'grey', 'gold'], default: null },
  },
  { timestamps: true, collection: 'guild.organizations' }
);

OrganizationSchema.index({ guildId: 1, handler: 1 }, { unique: true });

module.exports = mongoose.model('Organization', OrganizationSchema);


