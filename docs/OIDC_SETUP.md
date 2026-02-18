# OIDC Authentication Setup Guide

This guide explains how to configure OpenID Connect (OIDC) authentication for Faster Chat Enterprise.

## Overview

Faster Chat Enterprise supports OIDC authentication, allowing users to sign in using your organization's identity provider (IdP) such as:
- Keycloak
- Okta
- Auth0
- Azure AD / Entra ID
- Google Workspace
- Any OIDC-compliant provider

The system automatically discovers the OIDC configuration using the provider's well-known endpoint (`/.well-known/openid-configuration`).

## Configuration

OIDC is configured via environment variables. When enabled, users will see a "Sign in with SSO" button on the login page.

### Required Environment Variables

Add these to your `server/.env` file:

```bash
# OIDC Configuration (Optional)
# Set OIDC_ISSUER_URL to enable OIDC authentication
OIDC_ISSUER_URL=https://your-idp.example.com/realms/your-realm
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
```

### Environment Variable Details

| Variable | Description | Example |
|----------|-------------|---------|
| `OIDC_ISSUER_URL` | The issuer URL of your OIDC provider. This is the base URL that will be used for autodiscovery. | `https://keycloak.example.com/realms/myrealm` |
| `OIDC_CLIENT_ID` | The client ID registered with your OIDC provider. | `faster-chat-client` |
| `OIDC_CLIENT_SECRET` | The client secret for your OIDC client. Keep this secure! | `abc123def456...` |
| `OIDC_REDIRECT_URI` | The callback URL where users will be redirected after authentication. Must match what's configured in your IdP. | `https://chat.example.com/auth/oidc/callback` |

## Setup Instructions

### 1. Register Application with Your OIDC Provider

The exact steps vary by provider, but generally you need to:

1. Create a new OIDC/OAuth2 application in your IdP
2. Set the **Redirect URI** to: `https://your-domain.com/auth/oidc/callback`
3. Configure the **Allowed Scopes**: At minimum `openid`, `profile`, `email`
4. Note the **Client ID** and **Client Secret**
5. Note the **Issuer URL** (sometimes called "Authority" or "Discovery URL")

### 2. Example Provider Configurations

#### Keycloak

```bash
OIDC_ISSUER_URL=https://keycloak.example.com/realms/faster-chat
OIDC_CLIENT_ID=faster-chat
OIDC_CLIENT_SECRET=your-secret-here
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
```

In Keycloak:
1. Go to your realm → Clients → Create Client
2. Set Client ID to `faster-chat`
3. Enable "Client authentication"
4. Add redirect URI: `http://localhost:3000/auth/oidc/callback`
5. Copy the client secret from the Credentials tab

#### Okta

```bash
OIDC_ISSUER_URL=https://dev-12345678.okta.com/oauth2/default
OIDC_CLIENT_ID=0oa123456789abcdef
OIDC_CLIENT_SECRET=your-secret-here
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
```

In Okta:
1. Go to Applications → Create App Integration
2. Choose "OIDC - OpenID Connect"
3. Choose "Web Application"
4. Add redirect URI
5. Copy Client ID and Client Secret

#### Auth0

```bash
OIDC_ISSUER_URL=https://your-tenant.auth0.com
OIDC_CLIENT_ID=your-auth0-client-id
OIDC_CLIENT_SECRET=your-secret-here
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
```

In Auth0:
1. Go to Applications → Create Application
2. Choose "Regular Web Application"
3. Add redirect URI in "Allowed Callback URLs"
4. Copy Domain (for issuer URL), Client ID, and Client Secret

#### Azure AD / Entra ID

```bash
OIDC_ISSUER_URL=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_CLIENT_ID=your-application-id
OIDC_CLIENT_SECRET=your-secret-here
OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback
```

In Azure Portal:
1. Go to Azure Active Directory → App registrations → New registration
2. Add redirect URI
3. Create a client secret under "Certificates & secrets"
4. Copy Application (client) ID and Directory (tenant) ID

### 3. Update Server Configuration

Add the environment variables to your `server/.env` file with the values from your IdP.

### 4. Restart the Server

The OIDC client will automatically initialize on server startup:

```bash
npm run dev  # or npm start for production
```

You should see in the logs:
```
Initializing OIDC client...
Discovering OIDC configuration from: https://your-idp.example.com/...
✓ OIDC client initialized
```

## How It Works

### Autodiscovery

The system uses the OIDC Discovery protocol to automatically fetch the provider's configuration:

1. Server requests `{OIDC_ISSUER_URL}/.well-known/openid-configuration`
2. Parses the response to get endpoints for:
   - Authorization endpoint
   - Token endpoint  
   - UserInfo endpoint
   - JWKS (JSON Web Key Set) endpoint
3. Configures the OIDC client with these endpoints

### Authentication Flow

1. User clicks "Sign in with SSO" button
2. Server generates a secure state and nonce for CSRF protection
3. User is redirected to the IdP's authorization page
4. User authenticates with the IdP
5. IdP redirects back to `/auth/oidc/callback` with an authorization code
6. Server exchanges the code for tokens
7. Server validates the tokens and extracts user information
8. Server creates or updates the user account:
   - First OIDC user becomes admin
   - Subsequent users get "member" role
9. Server creates a session and logs the user in

### User Accounts

- **OIDC users** are identified by their `sub` (subject) claim from the IdP
- The `username` is populated from the OIDC claims (in order of preference):
  1. `preferred_username`
  2. `email`
  3. `sub`
- **First user rule**: The first user (OIDC or local) becomes an admin
- OIDC users don't have passwords in the local database

## Security Considerations

1. **HTTPS in Production**: Always use HTTPS in production. Set `OIDC_REDIRECT_URI` to use `https://`
2. **Client Secret**: Keep `OIDC_CLIENT_SECRET` secure. Use environment variables, never commit to git
3. **PKCE**: The implementation uses PKCE (Proof Key for Code Exchange) for additional security
4. **State & Nonce**: CSRF protection via state validation and replay attack prevention via nonce
5. **Token Validation**: All tokens are cryptographically validated using the IdP's public keys

## Troubleshooting

### "OIDC is not configured" error

- Verify all four environment variables are set
- Check that variable names match exactly (case-sensitive)
- Restart the server after changing environment variables

### "Failed to initialize OIDC client" error

- Check that `OIDC_ISSUER_URL` is accessible from the server
- Verify the well-known endpoint exists: `curl {OIDC_ISSUER_URL}/.well-known/openid-configuration`
- Check server logs for detailed error messages

### "Invalid state parameter" error

- This is usually caused by cookies not being set properly
- Verify your browser accepts cookies
- Check that `TRUST_PROXY` is set correctly if behind a reverse proxy

### Redirect URI mismatch

- The `OIDC_REDIRECT_URI` must **exactly** match what's configured in your IdP
- Include the protocol (`http://` or `https://`)
- Check for trailing slashes (some IdPs are sensitive to this)

### No "Sign in with SSO" button

- Verify OIDC is configured (all four variables set)
- Check browser console for errors
- Verify the `/api/auth/oidc/config` endpoint returns `{"enabled": true}`

## Disabling OIDC

To disable OIDC authentication:

1. Remove or comment out the OIDC environment variables
2. Restart the server

The "Sign in with SSO" button will automatically disappear from the login page.

## Docker / Container Deployment

When deploying with Docker, set the environment variables in your `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      - OIDC_ISSUER_URL=https://your-idp.example.com/realms/your-realm
      - OIDC_CLIENT_ID=your-client-id
      - OIDC_CLIENT_SECRET=your-client-secret
      - OIDC_REDIRECT_URI=https://chat.example.com/auth/oidc/callback
```

Or use a `.env` file with Docker Compose.

## Mixed Authentication

OIDC and local username/password authentication work side-by-side:

- Existing local users can continue using username/password
- New users can sign in with either method
- Each method maintains its own user records
- Sessions work the same regardless of authentication method

## Testing OIDC Locally

For local development testing:

1. Use a public OIDC provider's developer account (Auth0, Okta free tier)
2. Set `OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback`
3. Make sure your IdP allows `http://localhost` redirect URIs
4. Some providers require you to explicitly allow localhost in development mode
