import Data from './data.js';

// Safe to commit — this client ID is restricted to specific authorized origins
// in Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client ID).
export const GOOGLE_CLIENT_ID = '433557584068-74a02v1qfktun4mmvcetptnq5tdbc78m.apps.googleusercontent.com';

// Decodes the JWT payload from a GIS credential. Does NOT verify the signature —
// identity is trusted from GIS delivery. All write authorization is enforced
// server-side in Code.gs (_mapEmail, _addMatch check email against players sheet).
export function decodeJwt(credential) {
  const payload = credential.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const { email, name, picture } = JSON.parse(json);
  if (!email) throw new Error('JWT payload missing email');
  return { email, name, picture };
}

export function getAuthState() {
  return Data.loadAuth();
}

export function signOut() {
  Data.clearAuth();
}

// Initialises Google Identity Services and renders the sign-in button into
// the element with id='g-signin-btn'. Retries up to 50 times (5s) until the
// GIS script has loaded; surfaces a message if it never loads.
// onCredential is called with { email, name, picture } on successful sign-in.
export function initGoogleAuth(onCredential) {
  let attempts = 0;
  const tryInit = () => {
    if (typeof google === 'undefined') {
      if (++attempts >= 50) {
        console.error('Google Sign-In unavailable — GIS script failed to load');
        const btn = document.getElementById('g-signin-btn');
        if (btn) btn.textContent = 'Sign-in unavailable';
        return;
      }
      setTimeout(tryInit, 100);
      return;
    }
    try {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => {
          let decoded;
          try {
            decoded = decodeJwt(credential);
          } catch (err) {
            console.error('Failed to decode Google credential', err);
            return;
          }
          onCredential(decoded);
        },
      });
      const btn = document.getElementById('g-signin-btn');
      if (btn) google.accounts.id.renderButton(btn, { theme: 'outline', size: 'medium', text: 'signin_with' });
    } catch (err) {
      console.error('GIS initialization failed', err);
    }
  };
  tryInit();
}
