const mongoose = require("mongoose");

const IngestionRunTaskSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    priority: { type: Number, default: 0 },
    error: { type: String, default: null },
    skippedReason: { type: String, default: null },
    backoffUntil: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    newCompanies: { type: Number, default: 0 },
    newJobs: { type: Number, default: 0 },
    refreshedJobs: { type: Number, default: 0 }
  },
  { _id: false }
);

const IngestionRunSchema = new mongoose.Schema({
  trigger: { type: String, required: true, index: true },
  totalTasks: { type: Number, default: 0 },
  executedTasks: { type: Number, default: 0 },
  skippedTasks: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
  tasks: { type: [IngestionRunTaskSchema], default: [] },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

IngestionRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model("IngestionRun", IngestionRunSchema);
