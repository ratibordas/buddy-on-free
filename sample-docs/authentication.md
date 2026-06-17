# Authentication and Access

## Resetting your password

If you forgot your password, click **Forgot password** on the login page and
enter your email. We send a reset link valid for 30 minutes. Opening the link
lets you set a new password. For security, reset links can be used only once.

## API tokens

Acme Cloud uses Bearer tokens for API access. Create a token under
**Settings → API Tokens**. Tokens inherit your account permissions and never
expire unless revoked. Pass the token in the `Authorization` header:

```
Authorization: Bearer <your-token>
```

Treat tokens as secrets — anyone with a token can act as you. Revoke a leaked
token immediately from the same settings page.

## Two-factor authentication (2FA)

Enable 2FA under **Settings → Security**. We support TOTP apps such as Google
Authenticator and 1Password. Recovery codes are shown once at setup — store them
safely, as they are the only way back in if you lose your device.
