import Data from './data.js';

export const GOOGLE_CLIENT_ID = '433557584068-74a02v1qfktun4mmvcetptnq5tdbc78m.apps.googleusercontent.com';

export function decodeJwt(credential) {
  const payload = credential.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const { email, name, picture } = JSON.parse(json);
  return { email, name, picture };
}

export function getAuthState() {
  return Data.loadAuth();
}

export function signOut() {
  Data.clearAuth();
}

// Initialises Google Identity Services and renders the sign-in button into
// the element with id='g-signin-btn'. Retries until the GIS script has loaded.
// onCredential is called with { email, name, picture } on successful sign-in.
export function initGoogleAuth(onCredential) {
  const tryInit = () => {
    if (typeof google === 'undefined') { setTimeout(tryInit, 100); return; }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: ({ credential }) => onCredential(decodeJwt(credential)),
    });
    const btn = document.getElementById('g-signin-btn');
    if (btn) {
      google.accounts.id.renderButton(btn, { theme: 'outline', size: 'medium', text: 'signin_with' });
    }
  };
  tryInit();
}
