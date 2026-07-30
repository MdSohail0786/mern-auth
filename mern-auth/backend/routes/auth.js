import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  signAccessToken,
  signRefreshToken,
  hashToken,
  refreshCookieOptions,
} from "../utils/tokens.js";

const router = express.Router();

// ---------- SIGNUP ----------
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });

    const accessToken = await issueTokens(res, user);

    return res.status(201).json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error during signup" });
  }
});

// ---------- LOGIN ----------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const accessToken = await issueTokens(res, user);

    return res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error during login" });
  }
});

// ---------- REFRESH ----------
// Reads the httpOnly refresh cookie, validates it against the stored hash,
// rotates it (issues a new refresh token, invalidates the old one), and
// returns a fresh access token.
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    const incomingHash = hashToken(token);
    const stored = user.refreshTokens.find((rt) => rt.tokenHash === incomingHash);

    if (!stored) {
      // Token not recognized (already rotated/used, or forged).
      // Treat as reuse detection: nuke all sessions for this user.
      user.refreshTokens = [];
      await user.save();
      return res.status(401).json({ message: "Refresh token reuse detected. Please log in again." });
    }

    // Remove the used token, then issue + store a new one (rotation)
    user.refreshTokens = user.refreshTokens.filter((rt) => rt.tokenHash !== incomingHash);
    const accessToken = await issueTokens(res, user);

    return res.json({ accessToken, message: "Token refreshed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error during refresh" });
  }
});

// ---------- LOGOUT ----------
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      const incomingHash = hashToken(token);
      // Best-effort: remove this session's refresh token from whichever user owns it
      await User.updateOne(
        { "refreshTokens.tokenHash": incomingHash },
        { $pull: { refreshTokens: { tokenHash: incomingHash } } }
      );
    }
    res.clearCookie("refreshToken", { path: "/api/auth" });
    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error during logout" });
  }
});

// ---------- CURRENT USER (protected, dashboard uses this) ----------
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select("-password -refreshTokens");
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ user });
});

// ---------- helper ----------
async function issueTokens(res, user) {
  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());

  const expiresAt = new Date(
    Date.now() + (Number(process.env.REFRESH_TOKEN_EXPIRES_MS) || 7 * 24 * 60 * 60 * 1000)
  );

  user.refreshTokens.push({ tokenHash: hashToken(refreshToken), expiresAt });
  // Prune any expired tokens while we're at it
  user.refreshTokens = user.refreshTokens.filter((rt) => rt.expiresAt > new Date());
  await user.save();

  res.cookie("refreshToken", refreshToken, refreshCookieOptions());
  return accessToken;
}

export default router;
