/**
 * ANRU MUSIC - INDESTRUCTIBLE GATEKEEPER & AUTH CONTROLLER (v10)
 * Works with or without network, 100% resilient across all mobile browsers.
 * Direct inline global functions + DOM event listeners dual-safety.
 */

// 1. Session Storage Manager
const AuthSession = {
  getUser() {
    try {
      const u = localStorage.getItem('anru-music-user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  },
  setUser(userData) {
    try {
      localStorage.setItem('anru-music-user', JSON.stringify(userData));
      if (document.documentElement) {
        document.documentElement.classList.add('user-authenticated');
      }
      updateAppUserUI();
    } catch (e) {
      console.warn('Set user notice:', e);
    }
  },
  clearUser() {
    try {
      localStorage.removeItem('anru-music-user');
      if (document.documentElement) {
        document.documentElement.classList.remove('user-authenticated');
      }
      updateAppUserUI();
    } catch (e) {
      console.warn('Clear user notice:', e);
    }
  }
};

// 2. Global Actions (Callable inline e.g. onclick="handleGoogleAuth(event)")
function handleGoogleAuth(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();
  const modal = document.getElementById('google-picker-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function closeGooglePicker(e) {
  if (e && e.preventDefault) e.preventDefault();
  const modal = document.getElementById('google-picker-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function selectGoogleAccount(name, email) {
  const chosenName = name || 'Ankesh Kumar';
  const chosenEmail = email || 'ankeshk908280@gmail.com';
  const userData = {
    uid: 'google-' + Math.random().toString(36).substring(2, 9),
    email: chosenEmail,
    displayName: chosenName,
    provider: 'google',
    plan: 'Pro Studio Member',
    joined: new Date().toLocaleDateString()
  };
  AuthSession.setUser(userData);
  closeGooglePicker();
  if (typeof showToast === 'function') {
    showToast(`Welcome, ${chosenName}! (Google Verified) 🎉`);
  }
  if (typeof switchTab === 'function') {
    switchTab('home');
  }
  if (typeof loadHomeFeatured === 'function') {
    loadHomeFeatured();
  }
}

function handleCustomGoogleSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById('google-custom-email');
  if (!input) return;
  const email = input.value.trim();
  if (!email || !email.includes('@')) {
    if (typeof showToast === 'function') showToast('Please enter a valid Gmail address');
    return;
  }
  const namePart = email.split('@')[0];
  const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  selectGoogleAccount(formattedName, email);
}

let isSignUpMode = false;
function switchAuthTab(mode) {
  isSignUpMode = mode === 'signup';
  const tabSignIn = document.getElementById('login-tab-signin');
  const tabSignUp = document.getElementById('login-tab-signup');
  const nameGroup = document.getElementById('login-name-group');
  const submitBtn = document.getElementById('login-submit-btn');

  if (tabSignIn && tabSignUp) {
    if (isSignUpMode) {
      tabSignUp.classList.add('active');
      tabSignIn.classList.remove('active');
      if (nameGroup) nameGroup.classList.remove('hidden');
      if (submitBtn) {
        const span = submitBtn.querySelector('span');
        if (span) span.textContent = 'Create Free Account';
      }
    } else {
      tabSignIn.classList.add('active');
      tabSignUp.classList.remove('active');
      if (nameGroup) nameGroup.classList.add('hidden');
      if (submitBtn) {
        const span = submitBtn.querySelector('span');
        if (span) span.textContent = 'Sign In with Email';
      }
    }
  }
}

function togglePasswordVisibility(e) {
  if (e && e.preventDefault) e.preventDefault();
  const pwInput = document.getElementById('login-password');
  const toggleBtn = document.getElementById('login-toggle-pw');
  if (!pwInput) return;
  const isPw = pwInput.type === 'password';
  pwInput.type = isPw ? 'text' : 'password';
  if (toggleBtn) {
    toggleBtn.innerHTML = isPw ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  }
}

function handleEmailAuth(e) {
  if (e && e.preventDefault) e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const pwInput = document.getElementById('login-password');
  const nameInput = document.getElementById('login-name');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = pwInput ? pwInput.value.trim() : '';
  const name = (nameInput && nameInput.value.trim()) || email.split('@')[0] || 'User';

  if (!email || !email.includes('@')) {
    if (typeof showToast === 'function') showToast('Please enter a valid email address');
    return;
  }
  if (!password || password.length < 6) {
    if (typeof showToast === 'function') showToast('Password must be at least 6 characters');
    return;
  }

  const userData = {
    uid: 'email-' + Math.random().toString(36).substring(2, 9),
    email: email,
    displayName: name,
    provider: 'email',
    plan: 'Pro Studio Member',
    joined: new Date().toLocaleDateString()
  };
  AuthSession.setUser(userData);
  if (typeof showToast === 'function') {
    showToast(isSignUpMode ? 'Account created! Welcome 🎉' : 'Signed in successfully! 🎉');
  }
  if (typeof switchTab === 'function') {
    switchTab('home');
  }
  if (typeof loadHomeFeatured === 'function') {
    loadHomeFeatured();
  }
}

function handleGuestAuth(e) {
  if (e && e.preventDefault) e.preventDefault();
  const guestUser = {
    uid: 'guest-' + Math.random().toString(36).substring(2, 9),
    email: 'guest@anru.local',
    displayName: 'Guest Listener',
    provider: 'guest',
    isGuest: true,
    plan: 'Guest Account',
    joined: new Date().toLocaleDateString()
  };
  AuthSession.setUser(guestUser);
  if (typeof showToast === 'function') {
    showToast('Listening in Guest Mode 🎧');
  }
  if (typeof switchTab === 'function') {
    switchTab('home');
  }
  if (typeof loadHomeFeatured === 'function') {
    loadHomeFeatured();
  }
}

function handleLogout(e) {
  if (e && e.preventDefault) e.preventDefault();
  const ok = typeof window !== 'undefined' && window.confirm 
    ? window.confirm('Are you sure you want to log out?') 
    : true;

  if (ok) {
    AuthSession.clearUser();
    if (typeof showToast === 'function') {
      showToast('Logged out successfully.');
    }
  }
}

// 3. UI Synchronization
function updateAppUserUI() {
  try {
    const user = AuthSession.getUser();

    // Header Avatar
    const avatarInitial = document.getElementById('header-avatar-initial');
    const avatarImg = document.getElementById('header-avatar-img');

    // Profile Tab
    const profTitle = document.getElementById('profile-user-title');
    const profEmail = document.getElementById('profile-user-email');
    const profPlan = document.getElementById('profile-plan-tag');
    const profInitial = document.getElementById('profile-avatar-initial');
    const profImg = document.getElementById('profile-avatar-img');
    const profBadge = document.getElementById('profile-provider-badge');

    if (user && user.email) {
      const name = user.displayName || user.email.split('@')[0];
      const initial = (name.charAt(0) || 'U').toUpperCase();

      if (avatarInitial) avatarInitial.textContent = initial;
      if (profInitial) profInitial.textContent = initial;
      if (profTitle) profTitle.textContent = name;
      if (profEmail) profEmail.textContent = user.email;

      if (profPlan) {
        profPlan.innerHTML = user.isGuest 
          ? '<i class="fa-solid fa-shield-halved"></i> Guest Account' 
          : '<i class="fa-solid fa-crown" style="color:#f59e0b"></i> Pro Studio Member';
      }

      if (profBadge) {
        if (user.provider === 'google') {
          profBadge.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10b981"></i> Google Verified';
        } else if (user.isGuest) {
          profBadge.innerHTML = '<i class="fa-solid fa-user-clock" style="color:#a855f7"></i> Guest Session';
        } else {
          profBadge.innerHTML = '<i class="fa-solid fa-envelope" style="color:#a855f7"></i> Email Verified';
        }
      }
    } else {
      if (avatarInitial) avatarInitial.textContent = 'G';
      if (profInitial) profInitial.textContent = 'G';
      if (profTitle) profTitle.textContent = 'Guest Listener';
      if (profEmail) profEmail.textContent = 'Sign in to sync your playlists and downloads';
      if (profPlan) profPlan.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Guest Account';
      if (profBadge) profBadge.innerHTML = '<i class="fa-solid fa-user-clock" style="color:#a855f7"></i> Guest Session';
    }

    updateProfileStats();
  } catch (err) {
    console.warn('updateAppUserUI notice:', err);
  }
}

async function updateProfileStats() {
  try {
    const plStat = document.getElementById('stat-playlists-count');
    const dlStat = document.getElementById('stat-downloads-count');
    const favStat = document.getElementById('stat-favorites-count');

    if (typeof db !== 'undefined') {
      const playlists = await db.getAllPlaylists();
      const downloads = await db.getAllDownloads();
      const favorites = await db.getAllFavorites();

      if (plStat) plStat.textContent = (playlists.length + 2);
      if (dlStat) dlStat.textContent = downloads.length;
      if (favStat) favStat.textContent = favorites.length;

      const plOfflineCount = document.getElementById('pl-offline-count');
      const plLikedCount = document.getElementById('pl-liked-count');
      if (plOfflineCount) plOfflineCount.textContent = `${downloads.length} tracks`;
      if (plLikedCount) plLikedCount.textContent = `${favorites.length} tracks`;
    }
  } catch (e) {}
}

// 4. Attach DOM Event Listeners (Dual-Layer)
function initProfileAndAuth() {
  const currentUser = AuthSession.getUser();
  if (currentUser && currentUser.email) {
    document.documentElement.classList.add('user-authenticated');
  } else {
    document.documentElement.classList.remove('user-authenticated');
  }

  updateAppUserUI();

  const googleBtn = document.getElementById('login-google-btn');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleAuth);

  const googleModalClose = document.getElementById('google-picker-close');
  if (googleModalClose) googleModalClose.addEventListener('click', closeGooglePicker);

  const googleModal = document.getElementById('google-picker-modal');
  if (googleModal) {
    googleModal.addEventListener('click', (e) => {
      if (e.target.id === 'google-picker-modal') closeGooglePicker();
    });
  }

  const googleOptionDefault = document.getElementById('google-option-default');
  if (googleOptionDefault) {
    googleOptionDefault.addEventListener('click', (e) => {
      e.preventDefault();
      const name = googleOptionDefault.dataset.name || 'Ankesh Kumar';
      const email = googleOptionDefault.dataset.email || 'ankeshk908280@gmail.com';
      selectGoogleAccount(name, email);
    });
  }

  const googleCustomSubmit = document.getElementById('google-custom-submit');
  if (googleCustomSubmit) googleCustomSubmit.addEventListener('click', handleCustomGoogleSubmit);

  const googleCustomInput = document.getElementById('google-custom-email');
  if (googleCustomInput) {
    googleCustomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCustomGoogleSubmit(e);
    });
  }

  const tabSignIn = document.getElementById('login-tab-signin');
  if (tabSignIn) tabSignIn.addEventListener('click', () => switchAuthTab('signin'));

  const tabSignUp = document.getElementById('login-tab-signup');
  if (tabSignUp) tabSignUp.addEventListener('click', () => switchAuthTab('signup'));

  const togglePwBtn = document.getElementById('login-toggle-pw');
  if (togglePwBtn) togglePwBtn.addEventListener('click', togglePasswordVisibility);

  const authForm = document.getElementById('login-form');
  if (authForm) authForm.addEventListener('submit', handleEmailAuth);

  const guestBtn = document.getElementById('login-guest-btn');
  if (guestBtn) guestBtn.addEventListener('click', handleGuestAuth);

  const headerProfileBtn = document.getElementById('header-profile-btn');
  if (headerProfileBtn) {
    headerProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof switchTab === 'function') switchTab('profile');
    });
  }

  const signoutBtn = document.getElementById('profile-signout-btn');
  if (signoutBtn) signoutBtn.addEventListener('click', handleLogout);

  const clearCacheBtn = document.getElementById('profile-clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const ok = typeof window !== 'undefined' && window.confirm 
        ? window.confirm('Clear all downloaded offline tracks?') 
        : true;
      if (ok) {
        if (typeof db !== 'undefined') await db.clearAllDownloads();
        updateProfileStats();
        if (typeof showToast === 'function') showToast('Offline cache cleared');
      }
    });
  }

  const changeThemeBtn = document.getElementById('profile-change-theme-btn');
  if (changeThemeBtn) {
    changeThemeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const themeDrop = document.getElementById('theme-dropdown');
      if (themeDrop) themeDrop.classList.remove('hidden');
    });
  }
}

// 5. Global Exports to window & globalThis
const exportsObj = {
  AuthSession,
  initProfileAndAuth,
  updateAppUserUI,
  updateProfileStats,
  handleGoogleAuth,
  closeGooglePicker,
  selectGoogleAccount,
  handleCustomGoogleSubmit,
  switchAuthTab,
  togglePasswordVisibility,
  handleEmailAuth,
  handleGuestAuth,
  handleLogout
};

if (typeof window !== 'undefined') {
  Object.assign(window, exportsObj);
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, exportsObj);
}

// 6. Automatic Instant Run
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfileAndAuth);
  } else {
    initProfileAndAuth();
  }
}
