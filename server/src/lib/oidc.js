import { Issuer, generators } from "openid-client";

// OIDC Configuration
const OIDC_CONFIG = {
  ISSUER_URL: process.env.OIDC_ISSUER_URL,
  CLIENT_ID: process.env.OIDC_CLIENT_ID,
  CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
  REDIRECT_URI: process.env.OIDC_REDIRECT_URI,
};

let oidcClient = null;
let oidcIssuer = null;

/**
 * Check if OIDC is configured and enabled
 */
export function isOIDCEnabled() {
  return !!(
    OIDC_CONFIG.ISSUER_URL &&
    OIDC_CONFIG.CLIENT_ID &&
    OIDC_CONFIG.CLIENT_SECRET &&
    OIDC_CONFIG.REDIRECT_URI
  );
}

/**
 * Initialize OIDC client by discovering configuration via well-known endpoint
 */
export async function initializeOIDCClient() {
  if (!isOIDCEnabled()) {
    console.log("OIDC is not configured. Skipping OIDC initialization.");
    return null;
  }

  try {
    console.log(`Discovering OIDC configuration from: ${OIDC_CONFIG.ISSUER_URL}`);
    
    // Autodiscover OIDC configuration via .well-known/openid-configuration
    oidcIssuer = await Issuer.discover(OIDC_CONFIG.ISSUER_URL);
    
    console.log(`OIDC Issuer discovered: ${oidcIssuer.issuer}`);
    
    // Create OIDC client
    oidcClient = new oidcIssuer.Client({
      client_id: OIDC_CONFIG.CLIENT_ID,
      client_secret: OIDC_CONFIG.CLIENT_SECRET,
      redirect_uris: [OIDC_CONFIG.REDIRECT_URI],
      response_types: ["code"],
    });

    console.log("OIDC client initialized successfully");
    return oidcClient;
  } catch (error) {
    console.error("Failed to initialize OIDC client:", error);
    throw error;
  }
}

/**
 * Get the OIDC client (initialize if needed)
 */
export async function getOIDCClient() {
  if (!oidcClient) {
    await initializeOIDCClient();
  }
  return oidcClient;
}

/**
 * Get the OIDC issuer
 */
export function getOIDCIssuer() {
  return oidcIssuer;
}

/**
 * Generate authorization URL for OIDC login
 */
export async function getAuthorizationUrl(state, nonce) {
  const client = await getOIDCClient();
  if (!client) {
    throw new Error("OIDC client not initialized");
  }

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const authUrl = client.authorizationUrl({
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { authUrl, codeVerifier };
}

/**
 * Handle OIDC callback and exchange code for tokens
 */
export async function handleCallback(params, codeVerifier, nonce) {
  const client = await getOIDCClient();
  if (!client) {
    throw new Error("OIDC client not initialized");
  }

  const tokenSet = await client.callback(OIDC_CONFIG.REDIRECT_URI, params, {
    code_verifier: codeVerifier,
    nonce,
  });

  const claims = tokenSet.claims();
  
  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    preferredUsername: claims.preferred_username,
    tokenSet,
  };
}

/**
 * Get OIDC configuration info (for frontend)
 */
export function getOIDCConfig() {
  return {
    enabled: isOIDCEnabled(),
    issuer: OIDC_CONFIG.ISSUER_URL,
  };
}
