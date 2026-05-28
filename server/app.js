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

app.set("trust proxy", 1);

const ALLOWED_ORIGINS = [
  process.env.APP_URL || "http://localhost:3000",
  "http://localhost:3000",
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    // Allow any vercel.app subdomain (covers preview deployments)
    if (origin.endsWith(".vercel.app") || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
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
