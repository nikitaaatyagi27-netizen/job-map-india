const mongoose = require("mongoose");

// An anonymous email subscription for job alerts.
// When new jobs matching the stored profile appear, we email the subscriber.
const jobAlertSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },

  // Resume-derived profile
  domain: { type: String, required: true },
  primarySkills:   { type: [String], default: [] },
  secondarySkills: { type: [String], default: [] },
  roles:           { type: [String], default: [] },

  // Preferred cities (empty = all India)
  cities: { type: [String], default: [] },

  isActive: { type: Boolean, default: true },

  // Unsubscribe token — sent in every email footer
  unsubToken: { type: String, required: true, index: true },

  // Track last digest so we only send new jobs
  lastAlertAt: { type: Date, default: null },

  // How often to send (daily / weekly)
  frequency: { type: String, default: "daily" },

  createdAt: { type: Date, default: Date.now }
});

jobAlertSchema.index({ email: 1, domain: 1 }, { unique: true });

module.exports = mongoose.model("JobAlert", jobAlertSchema);
