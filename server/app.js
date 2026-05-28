const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const jobsRouter      = require("./routes/jobs");
const sessionRouter   = require("./routes/session");
const alertsRouter    = require("./routes/alerts");
const adminRouter     = require("./routes/admin");
const ingestionRouter = require("./routes/ingestion");
const resumeRouter    = require("./routes/resume");
const authRouter      = require("./routes/auth");

const app = express();

app.use(cors({
  origin: process.env.APP_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth",      authRouter);
app.use("/api/jobs",      jobsRouter);
app.use("/api/session",   sessionRouter);
app.use("/api/alerts",    alertsRouter);
app.use("/api/admin",     adminRouter);
app.use("/api/ingestion", ingestionRouter);
app.use("/api/resume",    resumeRouter);

module.exports = app;
