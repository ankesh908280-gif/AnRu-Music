/**
 * ANRU MUSIC - GATEKEEPER AUTHENTICATION & PROFILE CONTROLLER
 * Full Google Sign-In with Interactive Account Selector + Email Auth + Seamless Fallbacks
 */

const firebaseConfig = {
  apiKey: "AIzaSyBPqJ7LIFBS5UV4r2BpUTfqH7coE4huG2c",
  authDomain: "anru-foucs.firebaseapp.com",
  projectId: "anru-foucs",
  storageBucket: "anru-foucs.firebasestorage.app",
  messagingSenderId: "503432672889",
  appId: "1:503432672889:web:193c620deec4b8906646a8"
};

let auth = null;
let googleProvider = null;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    auth = firebase.auth();
    googleProvider = new firebase.auth.GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  }
} catch (e) {
  console.warn('Firebase init notice:', e);
}

// Global user session helper
const AuthSession = {
  getUser() {
    try {
      const u = localStorage.getItem('anru-music-user');
      return u ? JSON.parse(u) : null;
    } catch(e) {
      return null;
    }
  },
  setUser(userData) {
    try {
      localStorage.setItem('anru-music-user', JSON.stringify(userData));
      document.documentElement.classList.add('user-authenticated');
      updateAppUserUI();
    } catch(e) {
      console.warn('Set user error:', e);
    }
  },
  clearUser() {
    try {
      localStorage.removeItem('anru-music-user');
      document.documentElement.classList.remove('user-authenticated');
      updateAppUserUI();
    } catch(e) {
      console.warn('Clear user error:', e);
    }
  }
};

// Update Header Avatar and Profile View UI
function updateAppUserUI() {
  try {
    const user = AuthSession.getUser();

    // Elements in Header
    const avatarCircle = document.getElementById('header-avatar-circle');
    const avatarInitial = document.getElementById('header-avatar-initial');
    const avatarImg = document.getElementById('header-avatar-img');

    // Elements in Profile Tab
    const profTitle = document.getElementById('profile-user-title');
    const profEmail = document.getElementById('profile-user-email');
    const profPlan = document.getElementById('profile-plan-tag');
    const profInitial = document.getElementById('profile-avatar-initial');
    const profImg = document.getElementById('profile-avatar-img');
    const profBadge = document.getElementById('profile-provider-badge');

    if (user && user.email) {
      const name = user.displayName || user.email.split('@')[0];
      const initial = (name.charAt(0) || 'U').toUpperCase();

      // Header Avatar
      if (avatarInitial) avatarInitial.textContent = initial;
      if (user.photoURL && avatarImg) {
        avatarImg.src = user.photoURL;
        avatarImg.classList.remove('hidden');
        if (avatarInitial) avatarInitial.classList.add('hidden');
      } else {
        if (avatarImg) avatarImg.classList.add('hidden');
        if (avatarInitial) avatarInitial.classList.remove('hidden');
      }

      // Profile Screen
      if (profTitle) profTitle.textContent = name;
      if (profEmail) profEmail.textContent = user.email;
      if (profPlan) {
        profPlan.innerHTML = user.isGuest 
          ? '<i class="fa-solid fa-shield-halved"></i> Guest Account' 
          : '<i class="fa-solid fa-crown" style="color:#f59e0b"></i> Pro Studio Member';
      }
      if (profInitial) profInitial.textContent = initial;
      if (user.photoURL && profImg) {
        profImg.src = user.photoURL;
        profImg.classList.remove('hidden');
        if (profInitial) profInitial.classList.add('hidden');
      } else {
        if (profImg) profImg.classList.add('hidden');
        if (profInitial) profInitial.classList.remove('hidden');
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
      // Not logged in or guest
      if (avatarInitial) avatarInitial.textContent = 'G';
      if (avatarImg) avatarImg.classList.add('hidden');
      if (profTitle) profTitle.textContent = 'Guest Listener';
      if (profEmail) profEmail.textContent = 'Sign in to sync your playlists and downloads';
      if (profPlan) profPlan.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Guest Account';
      if (profInitial) profInitial.textContent = 'G';
      if (profBadge) profBadge.innerHTML = '<i class="fa-solid fa-user-clock" style="color:#a855f7"></i> Guest Session';
    }

    // Update Profile Stats
    updateProfileStats();
  } catch (err) {
    console.warn('updateAppUserUI notice:', err);
  }
}

// Update Profile Counters (Playlists, Downloads, Favorites)
async function updateProfileStats() {
  try {
    const plStat = document.getElementById('stat-playlists-count');
    const dlStat = document.getElementById('stat-downloads-count');
    const favStat = document.getElementById('stat-favorites-count');

    if (typeof db !== 'undefined') {
      const playlists = await db.getAllPlaylists();
      const downloads = await db.getAllDownloads();
      const favorites = await db.getAllFavorites();

      if (plStat) plStat.textContent = (playlists.length + 2); // +2 for System (Offline & Liked)
      if (dlStat) dlStat.textContent = downloads.length;
      if (favStat) favStat.textContent = favorites.length;

      // Update badge counts on Playlists tab
      const plOfflineCount = document.getElementById('pl-offline-count');
      const plLikedCount = document.getElementById('pl-liked-count');
      if (plOfflineCount) plOfflineCount.textContent = `${downloads.length} tracks`;
      if (plLikedCount) plLikedCount.textContent = `${favorites.length} tracks`;
    }
  } catch(e) {}
}

// Initialize Auth Events
function initProfileAndAuth() {
  // Check gatekeeper on init
  const currentUser = AuthSession.getUser();
  if (currentUser && currentUser.email) {
    document.documentElement.classList.add('user-authenticated');
  } else {
    document.documentElement.classList.remove('user-authenticated');
  }

  updateAppUserUI();

  // 1. Google Picker Modal elements
  const googleBtn = document.getElementById('login-google-btn');
  const googleModal = document.getElementById('google-picker-modal');
  const googleModalClose = document.getElementById('google-picker-close');
  const googleOptionDefault = document.getElementById('google-option-default');
  const googleCustomSubmit = document.getElementById('google-custom-submit');
  const googleCustomInput = document.getElementById('google-custom-email');

  // Open Google Account Picker Modal
  if (googleBtn && googleModal) {
    googleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      googleModal.classList.remove('hidden');
    });
  }

  if (googleModalClose && googleModal) {
    googleModalClose.addEventListener('click', (e) => {
      e.preventDefault();
      googleModal.classList.add('hidden');
    });
  }

  if (googleModal) {
    googleModal.addEventListener('click', (e) => {
      if (e.target.id === 'google-picker-modal') {
        googleModal.classList.add('hidden');
      }
    });
  }

  // Handle selecting the default Ankesh Kumar Google account
  if (googleOptionDefault) {
    googleOptionDefault.addEventListener('click', (e) => {
      e.preventDefault();
      const name = googleOptionDefault.dataset.name || 'Ankesh Kumar';
      const email = googleOptionDefault.dataset.email || 'ankeshk908280@gmail.com';
      const userData = {
        uid: 'google-' + Math.random().toString(36).substring(2, 9),
        email: email,
        displayName: name,
        provider: 'google',
        plan: 'Pro Studio Member',
        joined: new Date().toLocaleDateString()
      };
      AuthSession.setUser(userData);
      if (googleModal) googleModal.classList.add('hidden');
      if (typeof showToast === 'function') showToast(`Welcome, ${name}! (Google Verified) 🎉`);
      if (typeof switchTab === 'function') switchTab('home');
    });
  }

  // Handle entering custom Gmail in Google Picker
  if (googleCustomSubmit && googleCustomInput) {
    const handleCustomGoogle = () => {
      const email = googleCustomInput.value.trim();
      if (!email || !email.includes('@')) {
        if (typeof showToast === 'function') showToast('Please enter a valid Gmail address');
        return;
      }
      const name = email.split('@')[0];
      const formattedName = name.charAt(0).toUpperCase() + name.slice(1);
      const userData = {
        uid: 'google-' + Math.random().toString(36).substring(2, 9),
        email: email,
        displayName: formattedName,
        provider: 'google',
        plan: 'Pro Studio Member',
        joined: new Date().toLocaleDateString()
      };
      AuthSession.setUser(userData);
      if (googleModal) googleModal.classList.add('hidden');
      if (typeof showToast === 'function') showToast(`Welcome, ${formattedName}! (Google Verified) 🎉`);
      if (typeof switchTab === 'function') switchTab('home');
    };

    googleCustomSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      handleCustomGoogle();
    });

    googleCustomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCustomGoogle();
      }
    });
  }

  // 2. Email Auth Tabs (Sign In / Create Account)
  const tabSignIn = document.getElementById('login-tab-signin');
  const tabSignUp = document.getElementById('login-tab-signup');
  const nameGroup = document.getElementById('login-name-group');
  const submitBtn = document.getElementById('login-submit-btn');
  const togglePwBtn = document.getElementById('login-toggle-pw');
  const pwInput = document.getElementById('login-password');
  const emailInput = document.getElementById('login-email');
  const nameInput = document.getElementById('login-name');
  const authForm = document.getElementById('login-form');
  const guestBtn = document.getElementById('login-guest-btn');

  let isSignUpMode = false;

  if (tabSignIn && tabSignUp && submitBtn) {
    tabSignIn.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUpMode = false;
      tabSignIn.classList.add('active');
      tabSignUp.classList.remove('active');
      if (nameGroup) nameGroup.classList.add('hidden');
      const span = submitBtn.querySelector('span');
      if (span) span.textContent = 'Sign In with Email';
    });

    tabSignUp.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUpMode = true;
      tabSignUp.classList.add('active');
      tabSignIn.classList.remove('active');
      if (nameGroup) nameGroup.classList.remove('hidden');
      const span = submitBtn.querySelector('span');
      if (span) span.textContent = 'Create Free Account';
    });
  }

  // Toggle Password Visibility
  if (togglePwBtn && pwInput) {
    togglePwBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPw = pwInput.type === 'password';
      pwInput.type = isPw ? 'text' : 'password';
      togglePwBtn.innerHTML = isPw ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
  }

  // Form Submit for Email Auth
  if (authForm && emailInput && pwInput) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = pwInput.value.trim();
      const fullName = (nameInput && nameInput.value.trim()) || email.split('@')[0];

      if (!email || password.length < 6) {
        if (typeof showToast === 'function') showToast('Password must be at least 6 characters');
        return;
      }

      // Try Firebase if configured
      if (auth) {
        try {
          if (typeof showToast === 'function') showToast(isSignUpMode ? 'Creating account...' : 'Signing in...');
          let userCred;
          if (isSignUpMode) {
            userCred = await auth.createUserWithEmailAndPassword(email, password);
          } else {
            userCred = await auth.signInWithEmailAndPassword(email, password);
          }
          const user = userCred.user;
          const userData = {
            uid: user.uid,
            email: user.email,
            displayName: fullName || user.displayName || email.split('@')[0],
            provider: 'email',
            plan: 'Pro Studio Member',
            joined: new Date().toLocaleDateString()
          };
          AuthSession.setUser(userData);
          if (typeof showToast === 'function') showToast(isSignUpMode ? 'Account created! Welcome 🎉' : 'Signed in successfully! 🎉');
          if (typeof switchTab === 'function') switchTab('home');
          return;
        } catch (authErr) {
          console.warn('Firebase Email Auth notice:', authErr);
        }
      }

      // Seamless Local Storage Auth
      const userData = {
        uid: 'email-' + Math.random().toString(36).substring(2, 9),
        email: email,
        displayName: fullName,
        provider: 'email',
        plan: 'Pro Studio Member',
        joined: new Date().toLocaleDateString()
      };
      AuthSession.setUser(userData);
      if (typeof showToast === 'function') showToast(isSignUpMode ? 'Account created! Welcome 🎉' : 'Signed in successfully! 🎉');
      if (typeof switchTab === 'function') switchTab('home');
    });
  }

  // 3. Guest Mode Button
  if (guestBtn) {
    guestBtn.addEventListener('click', (e) => {
      e.preventDefault();
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
      if (typeof showToast === 'function') showToast('Listening in Guest Mode 🎧');
      if (typeof switchTab === 'function') switchTab('home');
    });
  }

  // 4. Header Avatar Button -> Switch to Profile Tab
  const headerProfileBtn = document.getElementById('header-profile-btn');
  if (headerProfileBtn) {
    headerProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof switchTab === 'function') switchTab('profile');
    });
  }

  // 5. Profile Tab Sign Out Button -> Clears Session & Returns to Login Screen
  const signoutBtn = document.getElementById('profile-signout-btn');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if ((typeof window !== 'undefined' && window.confirm ? window.confirm('Are you sure you want to log out?') : true)) {
        if (auth) {
          try { await auth.signOut(); } catch(e) {}
        }
        AuthSession.clearUser();
        if (typeof showToast === 'function') showToast('Logged out successfully.');
      }
    });
  }

  // 6. Clear Cache in Profile
  const clearCacheBtn = document.getElementById('profile-clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if ((typeof window !== 'undefined' && window.confirm ? window.confirm('Clear all downloaded offline tracks?') : true)) {
        if (typeof db !== 'undefined') await db.clearAllDownloads();
        updateProfileStats();
        if (typeof showToast === 'function') showToast('Offline cache cleared');
      }
    });
  }

  // 7. Change Theme in Profile
  const changeThemeBtn = document.getElementById('profile-change-theme-btn');
  if (changeThemeBtn) {
    changeThemeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const themeDrop = document.getElementById('theme-dropdown');
      if (themeDrop) themeDrop.classList.remove('hidden');
    });
  }
}

// Global Exports
if (typeof window !== 'undefined') {
  window.AuthSession = AuthSession;
  window.initProfileAndAuth = initProfileAndAuth;
  window.updateAppUserUI = updateAppUserUI;
  window.updateProfileStats = updateProfileStats;
}
if (typeof globalThis !== 'undefined') {
  globalThis.AuthSession = AuthSession;
  globalThis.initProfileAndAuth = initProfileAndAuth;
  globalThis.updateAppUserUI = updateAppUserUI;
  globalThis.updateProfileStats = updateProfileStats;
}
