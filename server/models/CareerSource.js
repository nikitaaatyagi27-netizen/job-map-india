const mongoose = require("mongoose");

const CareerSourceSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true
  },

  companyName: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },

  provider: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },

  boardUrl: {
    type: String,
    required: true,
    trim: true
  },

  careersUrl: {
    type: String,
    default: null
  },

  discoveryMethod: {
    type: String,
    default: "unknown"
  },

  parserType: {
    type: String,
    default: "unknown"
  },

  status: {
    type: String,
    default: "active"
  },

  jobsFound: {
    type: Number,
    default: 0
  },

  lastCheckedAt: {
    type: Date,
    default: null
  },

  lastSuccessAt: {
    type: Date,
    default: null
  },

  lastError: {
    type: String,
    default: null
  },

  failureCount: {
    type: Number,
    default: 0
  },

  lastFailureAt: {
    type: Date,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

CareerSourceSchema.index(
  {
    company: 1,
    provider: 1,
    boardUrl: 1
  },
  {
    unique: true
  }
);

module.exports = mongoose.model("CareerSource", CareerSourceSchema);
