# OIDC Authentication Implementation Summary

## Overview
This implementation adds optional OpenID Connect (OIDC) authentication support to Faster Chat Enterprise, allowing users to sign in using their organization's identity provider.

## Key Features

### 1. Automatic Configuration Discovery
- Uses the OIDC well-known endpoint (`.well-known/openid-configuration`) for automatic provider discovery
- No manual endpoint configuration required - just provide the issuer URL
- Supports any OIDC-compliant provider (Keycloak, Okta, Auth0, Azure AD, etc.)

### 2. Security Best Practices
- **PKCE (Proof Key for Code Exchange)** with S256 method for enhanced security
- **State validation** to prevent CSRF attacks
- **Nonce validation** to prevent replay attacks
- **HttpOnly cookies** for storing sensitive OIDC state
- **Automatic cookie cleanup** after authentication
- **Mixed authentication** support (OIDC and local users can coexist)

### 3. User Experience
- Optional "Sign in with SSO" button appears only when OIDC is configured
- Seamless redirect flow to identity provider
- Automatic user provisioning on first login
- First OIDC user becomes admin (same as local registration)

## Implementation Details

### Backend Changes

#### New Files
- `server/src/lib/oidc.js` - OIDC client service with autodiscovery

#### Modified Files
- `server/.env.example` - Added OIDC environment variables
- `server/package.json` - Added openid-client dependency
- `server/src/index.js` - Initialize OIDC on startup
- `server/src/lib/db.js` - Database schema updates and OIDC user methods
- `server/src/routes/auth.js` - New OIDC routes and password login security

#### Database Schema Changes
```sql
ALTER TABLE users ADD COLUMN oidc_sub TEXT UNIQUE;
ALTER TABLE users ADD COLUMN oidc_provider TEXT;
CREATE INDEX idx_users_oidc_sub ON users(oidc_sub);
```

- `oidc_sub`: Unique identifier from OIDC provider (from `sub` claim)
- `oidc_provider`: Provider name for tracking (set to "oidc")
- OIDC users have empty `password_hash` to prevent password login

#### New API Endpoints
- `GET /api/auth/oidc/config` - Returns whether OIDC is enabled
- `GET /api/auth/oidc/login` - Initiates OIDC login flow
- `GET /api/auth/oidc/callback` - Handles OIDC provider callback

### Frontend Changes

#### New Files
- `frontend/src/pages/public/OIDCCallback.jsx` - OIDC callback handler page

#### Modified Files
- `frontend/src/lib/authClient.js` - Added OIDC API methods
- `frontend/src/state/useAuthState.js` - Added OIDC state management
- `frontend/src/components/auth/AuthPage.jsx` - Added SSO login button
- `frontend/src/router.jsx` - Added OIDC callback route

### Documentation
- `docs/OIDC_SETUP.md` - Comprehensive setup guide with provider examples
- `README.md` - Updated with OIDC feature mention
- `.gitignore` - Removed `/docs` to include documentation

## Environment Variables

```bash
# Optional - leave empty to disable OIDC
OIDC_ISSUER_URL=          # e.g., https://keycloak.example.com/realms/myrealm
OIDC_CLIENT_ID=           # Client ID from your OIDC provider
OIDC_CLIENT_SECRET=       # Client secret (keep secure!)
OIDC_REDIRECT_URI=        # e.g., http://localhost:3000/auth/oidc/callback
```

## Authentication Flow

1. User clicks "Sign in with SSO" button
2. Frontend calls `/api/auth/oidc/login`
3. Server generates state, nonce, and PKCE code verifier
4. Server stores state/nonce/verifier in httpOnly cookies
5. Server returns authorization URL
6. User is redirected to OIDC provider
7. User authenticates with provider
8. Provider redirects to `/auth/oidc/callback?code=...&state=...`
9. Frontend calls `/api/auth/oidc/callback` with query params
10. Server validates state, exchanges code for tokens
11. Server validates nonce and token signature
12. Server extracts user info from token claims
13. Server creates/updates user record (first user becomes admin)
14. Server creates session and sets session cookie
15. User is redirected to application

## Security Considerations

### What's Protected
✅ CSRF attacks via state validation  
✅ Replay attacks via nonce validation  
✅ Authorization code interception via PKCE  
✅ Session hijacking via httpOnly cookies  
✅ OIDC users attempting password login  

### What's Required
⚠️ HTTPS in production (for secure cookies and token exchange)  
⚠️ Secure storage of OIDC_CLIENT_SECRET  
⚠️ Proper OIDC provider configuration  

## Backward Compatibility

- ✅ Works with existing databases (migration adds new columns)
- ✅ Existing local users unaffected
- ✅ Mixed authentication supported (OIDC + local)
- ✅ Empty password_hash for OIDC users (backward compatible)
- ✅ OIDC can be enabled/disabled without data loss

## Testing Checklist

- [x] Code syntax validation (no errors)
- [x] Security scan with CodeQL (0 vulnerabilities)
- [x] Database migration handles existing schemas
- [x] OIDC users cannot login via password
- [x] Server starts without OIDC configured (feature is optional)
- [ ] Manual testing with real OIDC provider (requires provider setup)
- [ ] Full authentication flow test
- [ ] Error handling for invalid OIDC configuration

## Known Limitations

1. **No OIDC-specific logout**: Users logout locally but IdP session may persist
2. **No token refresh**: Sessions use local expiry, not OIDC token refresh
3. **Username conflicts**: If OIDC username matches existing local user, OIDC login fails
4. **Single OIDC provider**: Only one OIDC provider supported at a time

## Future Enhancements

- Multiple OIDC provider support
- Token refresh implementation
- OIDC logout (backchannel logout)
- Additional claims mapping (roles, groups)
- User attribute sync on each login

## Files Changed

### Backend (6 files)
- `server/.env.example`
- `server/package.json`
- `server/src/index.js`
- `server/src/lib/db.js`
- `server/src/lib/oidc.js` (new)
- `server/src/routes/auth.js`

### Frontend (5 files)
- `frontend/src/components/auth/AuthPage.jsx`
- `frontend/src/lib/authClient.js`
- `frontend/src/pages/public/OIDCCallback.jsx` (new)
- `frontend/src/router.jsx`
- `frontend/src/state/useAuthState.js`

### Documentation (3 files)
- `.gitignore`
- `README.md`
- `docs/OIDC_SETUP.md` (new)

**Total: 14 files changed**

## Deployment Notes

### Docker Deployment
Add OIDC environment variables to `docker-compose.yml`:
```yaml
environment:
  - OIDC_ISSUER_URL=https://your-idp.example.com
  - OIDC_CLIENT_ID=your-client-id
  - OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
  - OIDC_REDIRECT_URI=https://chat.example.com/auth/oidc/callback
```

### Kubernetes Deployment
Use secrets for sensitive values:
```yaml
env:
  - name: OIDC_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: oidc-secret
        key: client-secret
```

### Development
For local testing with OIDC:
1. Use provider's development account (Auth0, Okta free tier)
2. Set `OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback`
3. Ensure provider allows localhost redirect URIs

## Support

For detailed setup instructions, see:
- `docs/OIDC_SETUP.md` - Complete setup guide
- Example configurations for Keycloak, Okta, Auth0, Azure AD

For issues:
- Check server logs for OIDC initialization messages
- Verify OIDC provider configuration
- Test well-known endpoint: `curl {ISSUER_URL}/.well-known/openid-configuration`
