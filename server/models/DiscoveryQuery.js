const mongoose = require("mongoose");

const DiscoveryQuerySchema = new mongoose.Schema({
  kind: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },

  query: {
    type: String,
    required: true,
    trim: true
  },

  enabled: {
    type: Boolean,
    default: true,
    index: true
  },

  source: {
    type: String,
    default: "bootstrap",
    trim: true
  },

  order: {
    type: Number,
    default: 0
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

DiscoveryQuerySchema.index(
  {
    kind: 1,
    query: 1
  },
  {
    unique: true
  }
);

module.exports = mongoose.model("DiscoveryQuery", DiscoveryQuerySchema);
