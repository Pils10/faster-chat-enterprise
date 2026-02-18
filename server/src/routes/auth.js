import { Hono } from "hono";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { dbUtils } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { HTTP_STATUS } from "../lib/httpStatus.js";
import { RATE_LIMIT, AUTH } from "../lib/constants.js";

export const authRouter = new Hono();

// Validation schemas
const RegisterSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
});

const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// Simple in-memory rate limiting (per key)
const loginAttempts = new Map();

function checkRateLimit(bucketKey) {
  const now = Date.now();
  const attempts = loginAttempts.get(bucketKey) || [];

  // Clean old attempts
  const recentAttempts = attempts.filter((timestamp) => now - timestamp < RATE_LIMIT.WINDOW_MS);

  if (recentAttempts.length >= RATE_LIMIT.MAX_ATTEMPTS) {
    return false;
  }

  recentAttempts.push(now);
  loginAttempts.set(bucketKey, recentAttempts);
  return true;
}

// Helper to get client IP
function getClientIP(c) {
  if (AUTH.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    const real = c.req.header("x-real-ip");
    if (real) {
      return real;
    }
  }

  const incoming = c.env?.incoming;
  const socket =
    incoming?.socket || incoming?.connection || incoming?.req?.socket || incoming?.req?.connection;

  return socket?.remoteAddress || "local";
}

// Cookie settings
const COOKIE_NAME = "session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  path: "/",
};

/**
 * POST /api/auth/register
 * Register a new user. First user becomes admin.
 */
authRouter.post("/register", async (c) => {
  try {
    const ip = getClientIP(c);
    if (!checkRateLimit(`register:ip:${ip}`)) {
      return c.json(
        { error: "Too many attempts. Please try again later." },
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }

    const body = await c.req.json();
    const { username, password } = RegisterSchema.parse(body);

    if (!checkRateLimit(`register:user:${username.toLowerCase()}`)) {
      return c.json(
        { error: "Too many attempts for this username." },
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }

    const userCount = dbUtils.getUserCount();
    if (userCount > 0) {
      return c.json({ error: AUTH.REGISTRATION_LOCK_MESSAGE }, HTTP_STATUS.FORBIDDEN);
    }

    // Check if username already exists
    const existingUser = dbUtils.getUserByUsername(username);
    if (existingUser) {
      return c.json({ error: "Username already exists" }, HTTP_STATUS.BAD_REQUEST);
    }

    const role = "admin";

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const userId = dbUtils.createUser(username, passwordHash, role);

    // Create session
    const { sessionId, expiresAt } = dbUtils.createSession(userId);

    // Set cookie
    setCookie(c, COOKIE_NAME, sessionId, COOKIE_OPTIONS);

    return c.json(
      {
        user: {
          id: userId,
          username,
          role,
        },
        session: {
          expiresAt,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid input", details: error.errors }, HTTP_STATUS.BAD_REQUEST);
    }
    console.error("Register error:", error);
    return c.json({ error: "Registration failed" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * POST /api/auth/login
 * Login with username and password
 */
authRouter.post("/login", async (c) => {
  try {
    const ip = getClientIP(c);

    const body = await c.req.json();
    const { username, password } = LoginSchema.parse(body);

    if (
      !checkRateLimit(`login:ip:${ip}`) ||
      !checkRateLimit(`login:user:${username.toLowerCase()}`)
    ) {
      return c.json(
        { error: "Too many attempts. Please try again later." },
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }

    // Get user
    const user = dbUtils.getUserByUsername(username);
    if (!user) {
      return c.json({ error: "Invalid credentials" }, HTTP_STATUS.UNAUTHORIZED);
    }

    // Verify password
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      return c.json({ error: "Invalid credentials" }, HTTP_STATUS.UNAUTHORIZED);
    }

    // Create session
    const { sessionId, expiresAt } = dbUtils.createSession(user.id);

    // Set cookie
    setCookie(c, COOKIE_NAME, sessionId, COOKIE_OPTIONS);

    return c.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      session: {
        expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid input", details: error.errors }, HTTP_STATUS.BAD_REQUEST);
    }
    console.error("Login error:", error);
    return c.json({ error: "Login failed" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * POST /api/auth/logout
 * Logout and clear session
 */
authRouter.post("/logout", async (c) => {
  try {
    const sessionId = getCookie(c, COOKIE_NAME);

    if (sessionId) {
      dbUtils.deleteSession(sessionId);
    }

    // Clear cookie
    deleteCookie(c, COOKIE_NAME, {
      httpOnly: COOKIE_OPTIONS.httpOnly,
      secure: COOKIE_OPTIONS.secure,
      sameSite: COOKIE_OPTIONS.sameSite,
      path: COOKIE_OPTIONS.path,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Logout failed" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * GET /api/auth/session
 * Get current session info
 */
authRouter.get("/session", async (c) => {
  try {
    const sessionId = getCookie(c, COOKIE_NAME);

    if (!sessionId) {
      return c.json({ user: null }, HTTP_STATUS.UNAUTHORIZED);
    }

    const session = dbUtils.getSession(sessionId);

    if (!session) {
      // Session expired or invalid
      deleteCookie(c, COOKIE_NAME, {
        httpOnly: COOKIE_OPTIONS.httpOnly,
        secure: COOKIE_OPTIONS.secure,
        sameSite: COOKIE_OPTIONS.sameSite,
        path: COOKIE_OPTIONS.path,
      });
      return c.json({ user: null }, HTTP_STATUS.UNAUTHORIZED);
    }

    return c.json({
      user: {
        id: session.user_id,
        username: session.username,
        role: session.role,
      },
      session: {
        expiresAt: session.expires_at,
      },
    });
  } catch (error) {
    console.error("Session check error:", error);
    return c.json({ error: "Session check failed" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * GET /api/auth/oidc/config
 * Get OIDC configuration (whether OIDC is enabled)
 */
authRouter.get("/oidc/config", async (c) => {
  const { getOIDCConfig } = await import("../lib/oidc.js");
  return c.json(getOIDCConfig());
});

/**
 * GET /api/auth/oidc/login
 * Initiate OIDC login flow
 */
authRouter.get("/oidc/login", async (c) => {
  try {
    const { isOIDCEnabled, getAuthorizationUrl } = await import("../lib/oidc.js");
    const { generators } = await import("openid-client");

    if (!isOIDCEnabled()) {
      return c.json({ error: "OIDC is not configured" }, HTTP_STATUS.BAD_REQUEST);
    }

    // Generate state and nonce for CSRF protection
    const state = generators.state();
    const nonce = generators.nonce();

    const { authUrl, codeVerifier } = await getAuthorizationUrl(state, nonce);

    // Store state, nonce, and code_verifier in cookie for callback verification
    setCookie(c, "oidc_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    setCookie(c, "oidc_nonce", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    setCookie(c, "oidc_code_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    return c.json({ authUrl });
  } catch (error) {
    console.error("OIDC login error:", error);
    return c.json({ error: "Failed to initiate OIDC login" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * GET /api/auth/oidc/callback
 * Handle OIDC callback
 */
authRouter.get("/oidc/callback", async (c) => {
  try {
    const { isOIDCEnabled, handleCallback } = await import("../lib/oidc.js");

    if (!isOIDCEnabled()) {
      return c.json({ error: "OIDC is not configured" }, HTTP_STATUS.BAD_REQUEST);
    }

    const params = c.req.query();
    const storedState = getCookie(c, "oidc_state");
    const storedNonce = getCookie(c, "oidc_nonce");
    const storedCodeVerifier = getCookie(c, "oidc_code_verifier");

    // Verify state to prevent CSRF
    if (!storedState || params.state !== storedState) {
      return c.json({ error: "Invalid state parameter" }, HTTP_STATUS.BAD_REQUEST);
    }

    // Clear OIDC cookies
    deleteCookie(c, "oidc_state", { path: "/" });
    deleteCookie(c, "oidc_nonce", { path: "/" });
    deleteCookie(c, "oidc_code_verifier", { path: "/" });

    // Exchange code for tokens
    const userInfo = await handleCallback(params, storedCodeVerifier, storedNonce);

    // Check if user exists by OIDC sub
    let user = dbUtils.getUserByOIDCSub(userInfo.sub);

    if (!user) {
      // Create new user from OIDC info
      const username = userInfo.preferredUsername || userInfo.email || userInfo.sub;
      const userCount = dbUtils.getUserCount();
      const role = userCount === 0 ? "admin" : "member"; // First user becomes admin

      const userId = dbUtils.createOIDCUser(username, userInfo.sub, "oidc", role);
      user = dbUtils.getUserById(userId);
    }

    // Create session
    const { sessionId, expiresAt } = dbUtils.createSession(user.id);

    // Set session cookie
    setCookie(c, COOKIE_NAME, sessionId, COOKIE_OPTIONS);

    // Return success with user info
    return c.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      session: {
        expiresAt,
      },
    });
  } catch (error) {
    console.error("OIDC callback error:", error);
    return c.json(
      { error: "Authentication failed", details: error.message },
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});
