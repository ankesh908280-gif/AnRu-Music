/**
 * ANRU MUSIC - MAIN APPLICATION COORDINATOR
 * Connects Modules: catalog.js, db.js, api.js, player.js, auth.js
 */

let searchDebounceTimer = null;

function performSearch(query) {
  if (!query || !query.trim()) return;

  switchTab('search');
  const input = document.getElementById('search-input');
  if (input) input.value = query;
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.remove('hidden');

  const titleEl = document.getElementById('search-results-title');
  const countEl = document.getElementById('results-count');
  const loaderEl = document.getElementById('search-loader');
  const listEl = document.getElementById('search-songs-list');

  if (titleEl) titleEl.textContent = `Search: "${query}"`;
  if (loaderEl) loaderEl.classList.remove('hidden');
  if (listEl) listEl.innerHTML = '';

  if (typeof searchMusic === 'function') {
    searchMusic(query).then(songs => {
      if (loaderEl) loaderEl.classList.add('hidden');
      if (countEl) countEl.textContent = `${songs.length} Tracks`;

      if (listEl) {
        if (songs.length === 0) {
          listEl.innerHTML = `
            <div class="empty-state">
              <i class="fa-solid fa-circle-question empty-icon"></i>
              <h4>Koi song nahi mila</h4>
              <p>Dusra naam search karke dekhein (jaise Pawan Singh, Khesari, Arijit, Kesariya).</p>
            </div>
          `;
          return;
        }
        songs.forEach(song => renderSongItem(song, listEl, { queue: songs }));
      }
    }).catch(() => {
      if (loaderEl) loaderEl.classList.add('hidden');
    });
  }
}

function switchTab(tabName) {
  try {
    document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));

    const view = document.getElementById(`view-${tabName}`);
    const nav = document.getElementById(`nav-${tabName}`);

    if (view) view.classList.add('active');
    if (nav) nav.classList.add('active');

    // UI Polishing: Show search & chips only on Home & Search views to prevent cluttering Profile/Offline/Liked
    const searchSection = document.querySelector('.search-section');
    if (searchSection) {
      if (tabName === 'profile' || tabName === 'downloads' || tabName === 'favorites') {
        searchSection.classList.add('hidden');
      } else {
        searchSection.classList.remove('hidden');
      }
    }

    window.scrollTo({ top: 0, behavior: 'instant' });

    if (tabName === 'downloads' && typeof loadDownloadsView === 'function') loadDownloadsView();
    if (tabName === 'favorites' && typeof loadFavoritesView === 'function') loadFavoritesView();
    if (tabName === 'profile') {
      const headerUser = document.getElementById('header-user-name');
      const user = JSON.parse(storage.get('anru-music-user', 'null'));
      if (user?.email && headerUser) headerUser.textContent = user.displayName || user.email.split('@')[0];
    }
  } catch (err) {
    console.warn('switchTab notice:', err);
  }
}

function loadHomeFeatured() {
  try {
    const bhojpuriCards = document.getElementById('home-bhojpuri-cards');
    const bollywoodCards = document.getElementById('home-bollywood-cards');
    const punjabiCards = document.getElementById('home-punjabi-cards');

    if (typeof CURATED_FULL_CATALOG === 'undefined') return;

    if (bhojpuriCards) {
      const bhojpuriSongs = CURATED_FULL_CATALOG.filter(s => s.category === 'bhojpuri');
      bhojpuriCards.innerHTML = '';
      bhojpuriSongs.forEach(song => renderMusicCard(song, bhojpuriCards, bhojpuriSongs));
    }

    if (bollywoodCards) {
      const bollywoodSongs = CURATED_FULL_CATALOG.filter(s => s.category === 'bollywood');
      bollywoodCards.innerHTML = '';
      bollywoodSongs.forEach(song => renderMusicCard(song, bollywoodCards, bollywoodSongs));
    }

    if (punjabiCards) {
      const punjabiSongs = CURATED_FULL_CATALOG.filter(s => s.category === 'punjabi');
      punjabiCards.innerHTML = '';
      punjabiSongs.forEach(song => renderMusicCard(song, punjabiCards, punjabiSongs));
    }
  } catch (err) {
    console.warn('loadHomeFeatured notice:', err);
  }
}

// Theme Engine (Anru Focus System)
function initThemeEngine() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  const dropdown = document.getElementById('theme-dropdown');
  const savedTheme = storage.get('anru-music-theme', 'theme-aurora');

  document.body.className = savedTheme;
  document.querySelectorAll('.theme-opt').forEach(opt => {
    if (opt.dataset.theme === savedTheme) opt.classList.add('active');
    else opt.classList.remove('active');
  });

  if (themeBtn && dropdown) {
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !themeBtn.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  document.querySelectorAll('.theme-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const selected = opt.dataset.theme;
      document.body.className = selected;
      storage.set('anru-music-theme', selected);
      document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      if (dropdown) dropdown.classList.add('hidden');
      const span = opt.querySelector('span:last-child');
      if (span) showToast(`Theme: ${span.textContent}`);
    });
  });
}

// PWA Installation Setup
let deferredPrompt = null;
function initPWAInstallation() {
  const pwaBtn = document.getElementById('pwa-install-btn');
  if (!pwaBtn) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaBtn.classList.remove('hidden');
  });

  pwaBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('App installed on your home screen! 🎉');
        pwaBtn.classList.add('hidden');
      }
      deferredPrompt = null;
    } else {
      showToast('Install option available in Chrome Menu (3 dots) -> Install App');
    }
  });

  window.addEventListener('appinstalled', () => {
    pwaBtn.classList.add('hidden');
    deferredPrompt = null;
    showToast('Anru Music is now installed!');
  });
}

// Core App Initialization (Instant, Non-blocking, Error-Resilient)
function initApp() {
  try {
    // 1. Immediately Bind Bottom Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab(tab.dataset.tab);
      });
    });

    // 2. Brand logo and Hero Explore button
    const brandBtn = document.getElementById('brand-home-btn');
    if (brandBtn) brandBtn.addEventListener('click', () => switchTab('home'));

    const exploreBtn = document.getElementById('hero-explore-btn');
    if (exploreBtn) exploreBtn.addEventListener('click', () => performSearch('trending hindi hits'));

    // 3. Search input & clear button
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (clearBtn) clearBtn.classList.toggle('hidden', !val);

        clearTimeout(searchDebounceTimer);
        if (val.length >= 2) {
          searchDebounceTimer = setTimeout(() => performSearch(val), 400);
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchDebounceTimer);
          performSearch(searchInput.value.trim());
        }
      });
    }

    if (clearBtn && searchInput) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        searchInput.focus();
      });
    }

    // 4. Category Chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        performSearch(chip.dataset.query);
      });
    });

    // 5. Section See All
    document.querySelectorAll('.section-see-all').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.preventDefault();
        performSearch(tag.dataset.tag);
      });
    });

    // 6. Mini Player Controls
    const miniContent = document.getElementById('mini-player-content');
    if (miniContent) {
      miniContent.addEventListener('click', (e) => {
        if (e.target.closest('.mini-action-btn')) return;
        const fsPlayer = document.getElementById('fullscreen-player');
        if (fsPlayer) fsPlayer.classList.remove('hidden');
      });
    }

    const miniPlay = document.getElementById('mini-play-btn');
    if (miniPlay) miniPlay.addEventListener('click', () => player.togglePlay());

    const miniNext = document.getElementById('mini-next-btn');
    if (miniNext) miniNext.addEventListener('click', () => player.next());

    // 7. Queue Drawer
    const queueDrawer = document.getElementById('queue-drawer');
    const openQueue = () => {
      if (typeof renderQueueDrawer === 'function') renderQueueDrawer();
      if (queueDrawer) queueDrawer.classList.remove('hidden');
    };
    const closeQueue = () => {
      if (queueDrawer) queueDrawer.classList.add('hidden');
    };

    const miniQueue = document.getElementById('mini-queue-btn');
    if (miniQueue) miniQueue.addEventListener('click', (e) => { e.stopPropagation(); openQueue(); });

    const fsQueue = document.getElementById('fs-queue-btn');
    if (fsQueue) fsQueue.addEventListener('click', openQueue);

    const closeQueueBtn = document.getElementById('close-queue-btn');
    if (closeQueueBtn) closeQueueBtn.addEventListener('click', closeQueue);

    const clearQueueBtn = document.getElementById('clear-queue-btn');
    if (clearQueueBtn) clearQueueBtn.addEventListener('click', () => player.clearUpcomingQueue());

    // 8. Fullscreen Player Controls
    const fsClose = document.getElementById('fs-close-btn');
    if (fsClose) fsClose.addEventListener('click', () => {
      const fsPlayer = document.getElementById('fullscreen-player');
      if (fsPlayer) fsPlayer.classList.add('hidden');
    });

    const fsPlay = document.getElementById('fs-play-btn');
    if (fsPlay) fsPlay.addEventListener('click', () => player.togglePlay());

    const fsNext = document.getElementById('fs-next-btn');
    if (fsNext) fsNext.addEventListener('click', () => player.next());

    const fsPrev = document.getElementById('fs-prev-btn');
    if (fsPrev) fsPrev.addEventListener('click', () => player.previous());

    const fsShuffle = document.getElementById('fs-shuffle-btn');
    if (fsShuffle) fsShuffle.addEventListener('click', () => player.toggleShuffle());

    const fsRepeat = document.getElementById('fs-repeat-btn');
    if (fsRepeat) fsRepeat.addEventListener('click', () => player.toggleRepeat());

    const fsLike = document.getElementById('fs-like-btn');
    if (fsLike) fsLike.addEventListener('click', async () => {
      if (!player.currentSong || typeof db === 'undefined') return;
      const isNowFav = await db.toggleFavorite(player.currentSong);
      player.updateLikeBtnUI(isNowFav);
      showToast(isNowFav ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    });

    const fsDl = document.getElementById('fs-download-btn');
    if (fsDl) fsDl.addEventListener('click', async () => {
      if (!player.currentSong || typeof handleDownload !== 'function') return;
      await handleDownload(player.currentSong);
    });

    const fsMenu = document.getElementById('fs-menu-btn');
    if (fsMenu) fsMenu.addEventListener('click', () => {
      if (player.currentSong && typeof openActionSheet === 'function') openActionSheet(player.currentSong);
    });

    // 9. Action Sheet Buttons
    const sheetCancel = document.getElementById('sheet-cancel-btn');
    if (sheetCancel) sheetCancel.addEventListener('click', closeActionSheet);

    const sheetOverlay = document.getElementById('action-sheet-overlay');
    if (sheetOverlay) {
      sheetOverlay.addEventListener('click', (e) => {
        if (e.target.id === 'action-sheet-overlay') closeActionSheet();
      });
    }

    const sheetPlayNext = document.getElementById('sheet-play-next');
    if (sheetPlayNext) sheetPlayNext.addEventListener('click', () => {
      if (activeSheetSong) player.playNext(activeSheetSong);
      closeActionSheet();
    });

    const sheetAddQueue = document.getElementById('sheet-add-queue');
    if (sheetAddQueue) sheetAddQueue.addEventListener('click', () => {
      if (activeSheetSong) player.addToQueue(activeSheetSong);
      closeActionSheet();
    });

    const sheetDl = document.getElementById('sheet-download');
    if (sheetDl) sheetDl.addEventListener('click', async () => {
      if (activeSheetSong && typeof handleDownload === 'function') await handleDownload(activeSheetSong);
      closeActionSheet();
    });

    const sheetLike = document.getElementById('sheet-like');
    if (sheetLike) sheetLike.addEventListener('click', async () => {
      if (activeSheetSong && typeof db !== 'undefined') {
        const isFav = await db.toggleFavorite(activeSheetSong);
        showToast(isFav ? 'Added to Favorites' : 'Removed from Favorites');
        if (typeof loadFavoritesView === 'function') loadFavoritesView();
      }
      closeActionSheet();
    });

    const sheetShare = document.getElementById('sheet-share');
    if (sheetShare) sheetShare.addEventListener('click', () => {
      if (activeSheetSong) {
        if (navigator.share) {
          navigator.share({
            title: activeSheetSong.title,
            text: `Listen to "${activeSheetSong.title}" by ${activeSheetSong.artist} on Anru Music!`,
            url: window.location.href
          }).catch(() => {});
        } else {
          try {
            navigator.clipboard.writeText(`${activeSheetSong.title} by ${activeSheetSong.artist} - ${window.location.href}`);
            showToast('Track link copied to clipboard!');
          } catch(e) {}
        }
      }
      closeActionSheet();
    });

    // 10. Sliders
    const seekSlider = document.getElementById('fs-seek-slider');
    if (seekSlider) seekSlider.addEventListener('input', (e) => player.seek(parseFloat(e.target.value)));

    const volSlider = document.getElementById('fs-vol-slider');
    if (volSlider) volSlider.addEventListener('input', (e) => player.setVolume(parseFloat(e.target.value)));

    // 11. Play All Buttons
    const playAllDl = document.getElementById('play-all-downloads-btn');
    if (playAllDl) playAllDl.addEventListener('click', async () => {
      if (typeof db === 'undefined') return;
      const dls = await db.getAllDownloads();
      if (dls.length > 0) player.playSong(dls[0], dls);
      else showToast('Pehle kuch gaane download karein!');
    });

    const playAllFav = document.getElementById('play-all-favorites-btn');
    if (playAllFav) playAllFav.addEventListener('click', async () => {
      if (typeof db === 'undefined') return;
      const favs = await db.getAllFavorites();
      if (favs.length > 0) player.playSong(favs[0], favs);
      else showToast('Pehle kuch gaane favorite karein!');
    });

    // 12. Render Featured Home Cards Immediately!
    loadHomeFeatured();

    // 13. Initialize Themes and Profile
    try { initThemeEngine(); } catch (e) { console.warn('Theme init notice:', e); }
    try { initProfileAndAuth(); } catch (e) { console.warn('Profile init notice:', e); }
    try { initPWAInstallation(); } catch (e) { console.warn('PWA init notice:', e); }

    // 14. Background Async Setup (Non-blocking)
    if (typeof db !== 'undefined') {
      db.init().then(() => {
        if (typeof updateDownloadBadge === 'function') updateDownloadBadge();
      }).catch(e => {
        console.warn('DB background init notice:', e);
      });
    }

    // 15. Service Worker Registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service Worker active'))
        .catch(err => console.warn('Service worker notice:', err));
    }
  } catch (criticalErr) {
    console.error('Critical app initialization error:', criticalErr);
  }
}

// Dual Readiness Trigger
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

if (typeof window !== 'undefined') { window.switchTab = switchTab; window.performSearch = performSearch; window.loadHomeFeatured = loadHomeFeatured; }
if (typeof globalThis !== 'undefined') { globalThis.switchTab = switchTab; globalThis.performSearch = performSearch; globalThis.loadHomeFeatured = loadHomeFeatured; }
