import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";

dotenv.config();
connectDB();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true, // required so the browser sends/receives the refresh cookie
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);

// Dummy protected dashboard endpoint the frontend calls after login
app.get("/api/dashboard", requireAuth, (req, res) => {
  res.json({
    message: "This is protected dashboard data.",
    userId: req.userId,
    fetchedAt: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => res.send("MERN Auth API running"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
