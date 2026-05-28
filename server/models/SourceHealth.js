const mongoose = require("mongoose");

const SourceHealthSchema = new mongoose.Schema({
  sourceKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true
  },

  successCount: {
    type: Number,
    default: 0
  },

  failureCount: {
    type: Number,
    default: 0
  },

  consecutiveFailures: {
    type: Number,
    default: 0
  },

  score: {
    type: Number,
    default: 50
  },

  avgDurationMs: {
    type: Number,
    default: 0
  },

  avgNewJobs: {
    type: Number,
    default: 0
  },

  avgRefreshedJobs: {
    type: Number,
    default: 0
  },

  lastRunAt: {
    type: Date,
    default: null
  },

  lastSuccessAt: {
    type: Date,
    default: null
  },

  lastFailureAt: {
    type: Date,
    default: null
  },

  backoffUntil: {
    type: Date,
    default: null
  },

  lastError: {
    type: String,
    default: null
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("SourceHealth", SourceHealthSchema);
