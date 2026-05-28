const mongoose = require("mongoose");

// Anonymous user session — no email, no password.
// The sessionId is a UUID generated client-side and stored in localStorage.
// Sessions expire after 30 days of inactivity (rolling — lastActiveAt is updated on every request).
const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  savedJobs: [
    {
      jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
      title: String,
      company: String,
      companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
      applyLink: String,
      location: String,
      source: String,
      savedAt: { type: Date, default: Date.now }
    }
  ],

  appliedJobs: [
    {
      jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
      title: String,
      company: String,
      applyLink: String,
      appliedAt: { type: Date, default: Date.now }
    }
  ],

  // Last search that produced results — used to auto-reload on return visit
  lastSearch: {
    domain: String,
    primarySkills: [String],
    secondarySkills: [String],
    roles: [String],
    searchedAt: Date
  },

  searchHistory: {
    type: [
      {
        domain: String,
        primarySkills: [String],
        roles: [String],
        resultCount: Number,
        searchedAt: Date
      }
    ],
    default: []
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  lastActiveAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30   // 30-day inactivity TTL
  }
});

module.exports = mongoose.model("Session", sessionSchema);
