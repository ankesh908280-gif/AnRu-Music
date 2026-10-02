/**
 * ANRU MUSIC - MAIN APPLICATION COORDINATOR
 * Unified Architecture: catalog.js, db.js, api.js, player.js, auth.js
 */

let searchDebounceTimer = null;
let activeSheetSong = null;
let activeDetailPlaylistId = null;

// ==========================================
// 1. TAB SWITCHING (4 UNIFIED TABS)
// ==========================================
function switchTab(tabName) {
  try {
    document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));

    const targetView = document.getElementById(`view-${tabName}`);
    const targetNav = document.getElementById(`nav-${tabName}`);

    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    // Hide search bar on Playlists & Profile views for a clean, distraction-free UI
    const searchSection = document.querySelector('.search-section');
    if (searchSection) {
      if (tabName === 'profile' || tabName === 'playlists') {
        searchSection.classList.add('hidden');
      } else {
        searchSection.classList.remove('hidden');
      }
    }

    window.scrollTo({ top: 0, behavior: 'instant' });

    if (tabName === 'playlists') {
      renderPlaylistsView();
    } else if (tabName === 'profile') {
      if (typeof updateAppUserUI === 'function') updateAppUserUI();
    } else if (tabName === 'home') {
      loadHomeFeatured();
    }
  } catch (err) {
    console.warn('switchTab notice:', err);
  }
}

// ==========================================
// 2. YOUTUBE MUSIC STYLE HOME & QUICK PICKS
// ==========================================
function loadHomeFeatured() {
  try {
    const bhojpuriCards = document.getElementById('home-bhojpuri-cards');
    const bollywoodCards = document.getElementById('home-bollywood-cards');
    const punjabiCards = document.getElementById('home-punjabi-cards');
    const bhaktiCards = document.getElementById('home-bhakti-cards');

    if (typeof CURATED_FULL_CATALOG === 'undefined') return;

    // Render Quick Picks (2x2 Grid)
    renderQuickPicks();

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

    if (bhaktiCards) {
      const bhaktiSongs = CURATED_FULL_CATALOG.filter(s => s.category === 'bhakti');
      bhaktiCards.innerHTML = '';
      bhaktiSongs.forEach(song => renderMusicCard(song, bhaktiCards, bhaktiSongs));
    }
  } catch (err) {
    console.warn('loadHomeFeatured notice:', err);
  }
}

// Render YouTube Music 2x2 Quick Picks Grid
function renderQuickPicks() {
  const grid = document.getElementById('yt-quick-grid');
  if (!grid || typeof CURATED_FULL_CATALOG === 'undefined') return;

  const picks = CURATED_FULL_CATALOG.slice(0, 4);
  grid.innerHTML = '';

  picks.forEach(song => {
    const card = document.createElement('div');
    card.className = 'yt-quick-card';
    card.innerHTML = `
      <div class="yt-quick-art-box">
        <img src="${song.artwork || song.image || "icon-512.png"}" alt="${song.title}" class="yt-quick-art" loading="lazy">
        <div class="yt-quick-play-overlay">
          <i class="fa-solid fa-play"></i>
        </div>
      </div>
      <div class="yt-quick-meta">
        <div class="yt-quick-title">${song.title}</div>
        <div class="yt-quick-artist">${song.artist}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      player.playSong(song, CURATED_FULL_CATALOG);
    });

    grid.appendChild(card);
  });
}

// YouTube Music Mood Filter
function filterHomeByMood(mood, label) {
  const shelfContainer = document.getElementById('yt-mood-shelf-container');
  const shelfTitle = document.getElementById('yt-mood-shelf-title');
  const shelfCards = document.getElementById('yt-mood-shelf-cards');

  if (!shelfContainer || !shelfCards || typeof CURATED_FULL_CATALOG === 'undefined') return;

  if (mood === 'all') {
    shelfContainer.classList.add('hidden');
    return;
  }

  let filtered = [];
  if (mood === 'trending') {
    filtered = CURATED_FULL_CATALOG.slice(0, 8);
  } else {
    filtered = CURATED_FULL_CATALOG.filter(s => 
      (s.moodTags && s.moodTags.includes(mood)) || 
      (s.category && s.category === mood)
    );
  }

  if (filtered.length === 0) {
    filtered = CURATED_FULL_CATALOG.slice(0, 6);
  }

  shelfTitle.textContent = (label || mood).toUpperCase() + ' VIBES';
  shelfCards.innerHTML = '';
  filtered.forEach(song => renderMusicCard(song, shelfCards, filtered));
  shelfContainer.classList.remove('hidden');

  shelfContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================
// 3. PLAYLISTS SYSTEM (UNIFIED MUSIC LIBRARY)
// ==========================================
async function renderPlaylistsView() {
  const overview = document.getElementById('playlists-overview');
  const detail = document.getElementById('playlist-detail-view');
  const customGrid = document.getElementById('custom-playlists-grid');

  if (overview) overview.classList.remove('hidden');
  if (detail) detail.classList.add('hidden');

  // Update counts
  if (typeof updateProfileStats === 'function') await updateProfileStats();

  if (!customGrid || typeof db === 'undefined') return;

  const customPlaylists = await db.getAllPlaylists();
  customGrid.innerHTML = '';

  if (customPlaylists.length === 0) {
    customGrid.innerHTML = `
      <div class="empty-state" style="padding:20px 0;">
        <i class="fa-solid fa-folder-plus empty-icon" style="font-size:32px;"></i>
        <h4>No custom playlists yet</h4>
        <p>Click "+ New Playlist" above to create your first personal mix!</p>
      </div>
    `;
    return;
  }

  customPlaylists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'custom-pl-card glass-card';
    card.innerHTML = `
      <div class="custom-pl-icon">
        <i class="fa-solid fa-music"></i>
      </div>
      <div class="custom-pl-info">
        <div class="custom-pl-title">${pl.title}</div>
        <div class="custom-pl-sub">${pl.songs ? pl.songs.length : 0} tracks • Created ${new Date(pl.createdAt).toLocaleDateString()}</div>
      </div>
      <button class="custom-pl-play-btn" title="Open Playlist">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    `;

    card.addEventListener('click', () => {
      openPlaylistDetail(pl.id, 'custom');
    });

    customGrid.appendChild(card);
  });
}

// Open Specific Playlist Detail View
async function openPlaylistDetail(playlistId, type) {
  const overview = document.getElementById('playlists-overview');
  const detail = document.getElementById('playlist-detail-view');
  const titleEl = document.getElementById('detail-pl-title');
  const metaEl = document.getElementById('detail-pl-meta');
  const iconEl = document.getElementById('detail-pl-icon');
  const delBtn = document.getElementById('detail-pl-del-btn');
  const songsList = document.getElementById('detail-pl-songs-list');
  const playAllBtn = document.getElementById('detail-pl-play-all');
  const shuffleBtn = document.getElementById('detail-pl-shuffle');

  if (!detail || !songsList || typeof db === 'undefined') return;

  overview.classList.add('hidden');
  detail.classList.remove('hidden');

  activeDetailPlaylistId = playlistId;

  let songs = [];
  let playlistTitle = 'Playlist';

  if (type === 'offline') {
    playlistTitle = 'Offline Downloads';
    songs = await db.getAllDownloads();
    if (iconEl) {
      iconEl.className = 'fa-solid fa-circle-down detail-hero-icon cyan';
    }
    if (delBtn) delBtn.classList.add('hidden');
  } else if (type === 'liked') {
    playlistTitle = 'Liked Songs';
    songs = await db.getAllFavorites();
    if (iconEl) {
      iconEl.className = 'fa-solid fa-heart detail-hero-icon pink';
    }
    if (delBtn) delBtn.classList.add('hidden');
  } else {
    const pl = await db.getPlaylist(playlistId);
    if (!pl) return;
    playlistTitle = pl.title;
    songs = pl.songs || [];
    if (iconEl) {
      iconEl.className = 'fa-solid fa-list-ul detail-hero-icon purple';
    }
    if (delBtn) {
      delBtn.classList.remove('hidden');
      delBtn.onclick = async () => {
        if (typeof window !== "undefined" && window.confirm ? window.confirm(`Delete playlist "${playlistTitle}"?`) : true) {
          await db.deletePlaylist(playlistId);
          showToast('Playlist deleted');
          renderPlaylistsView();
        }
      };
    }
  }

  if (titleEl) titleEl.textContent = playlistTitle;
  if (metaEl) metaEl.textContent = `${songs.length} Tracks • High Fidelity`;

  songsList.innerHTML = '';
  if (songs.length === 0) {
    songsList.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-music empty-icon"></i>
        <h4>No songs in this playlist</h4>
        <p>Use the 3-dots (...) menu on any song to add it here.</p>
      </div>
    `;
  } else {
    songs.forEach(song => {
      renderSongItem(song, songsList, { queue: songs, playlistId: type === 'custom' ? playlistId : null });
    });
  }

  // Play All
  if (playAllBtn) {
    playAllBtn.onclick = () => {
      if (songs.length > 0) player.playSong(songs[0], songs);
      else showToast('Playlist is empty');
    };
  }

  // Shuffle
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      if (songs.length > 0) {
        const shuffled = [...songs].sort(() => Math.random() - 0.5);
        player.playSong(shuffled[0], shuffled);
        showToast('Shuffled & Playing');
      } else {
        showToast('Playlist is empty');
      }
    };
  }
}

// Add Song to Custom Playlist Modal
async function promptAddToPlaylist(song) {
  const modal = document.getElementById('playlist-picker-modal');
  const listEl = document.getElementById('playlist-picker-list');
  const songTitleEl = document.getElementById('picker-song-title');
  const createNewBtn = document.getElementById('picker-create-new-pl');
  const closeBtn = document.getElementById('playlist-picker-close');

  if (!modal || !listEl || typeof db === 'undefined') return;

  if (songTitleEl) songTitleEl.textContent = `Add "${song.title}" to:`;
  modal.classList.remove('hidden');

  const playlists = await db.getAllPlaylists();
  listEl.innerHTML = '';

  if (playlists.length === 0) {
    listEl.innerHTML = '<p style="color:var(--textMuted);font-size:12px;text-align:center;padding:10px;">No custom playlists yet. Create one below!</p>';
  } else {
    playlists.forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'picker-pl-item';
      btn.innerHTML = `<i class="fa-solid fa-folder-music"></i> <span>${pl.title}</span>`;
      btn.onclick = async () => {
        await db.addSongToPlaylist(pl.id, song);
        modal.classList.add('hidden');
        showToast(`Added to "${pl.title}"! 🎵`);
        updateProfileStats();
      };
      listEl.appendChild(btn);
    });
  }

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }

  if (createNewBtn) {
    createNewBtn.onclick = async () => {
      const name = (typeof window !== 'undefined' && window.prompt ? window.prompt('Enter new playlist name:') : 'My Playlist');
      if (name && name.trim()) {
        const newPl = await db.createPlaylist(name.trim());
        await db.addSongToPlaylist(newPl.id, song);
        modal.classList.add('hidden');
        showToast(`Created "${name}" & added song! 🎵`);
        updateProfileStats();
      }
    };
  }
}

// ==========================================
// 4. SEARCH FUNCTIONALITY
// ==========================================
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
              <h4>No matching tracks found</h4>
              <p>Try searching for Pawan Singh, Arijit Singh, Kesariya, or Punjabi hits.</p>
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

// ==========================================
// 5. RENDERING HELPERS (CARDS & ROWS)
// ==========================================
function renderMusicCard(song, container, queueContext) {
  const card = document.createElement('div');
  card.className = 'music-card glass-card';
  card.innerHTML = `
    <div class="card-art-box">
      <img src="${song.artwork || song.image || "icon-512.png"}" alt="${song.title}" class="card-art" loading="lazy">
      <button class="card-play-btn" aria-label="Play ${song.title}">
        <i class="fa-solid fa-play"></i>
      </button>
      <span class="card-duration">${formatDuration(song.duration)}</span>
    </div>
    <div class="card-meta">
      <div class="card-title">${song.title}</div>
      <div class="card-artist">${song.artist}</div>
    </div>
  `;

  card.addEventListener('click', () => {
    player.playSong(song, queueContext || [song]);
  });

  container.appendChild(card);
}

function renderSongItem(song, container, options = {}) {
  const item = document.createElement('div');
  item.className = 'song-item glass-card';
  const isCurrentlyPlaying = player.currentSong && player.currentSong.id === song.id;
  if (isCurrentlyPlaying) item.classList.add('playing');

  item.innerHTML = `
    <div class="song-art-box">
      <img src="${song.artwork || song.image || "icon-512.png"}" alt="${song.title}" class="song-thumb" loading="lazy">
      <div class="song-play-overlay">
        <i class="fa-solid ${isCurrentlyPlaying && player.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
      </div>
    </div>
    <div class="song-meta">
      <div class="song-title">${song.title}</div>
      <div class="song-artist">${song.artist} • ${formatDuration(song.duration)}</div>
    </div>
    <div class="song-actions">
      <button class="action-circle-btn menu-btn" title="Options">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
    </div>
  `;

  // Play click
  item.addEventListener('click', (e) => {
    if (e.target.closest('.action-circle-btn')) return;
    player.playSong(song, options.queue || [song]);
  });

  // 3-dots Menu
  const menuBtn = item.querySelector('.menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openActionSheet(song, options.playlistId);
    });
  }

  container.appendChild(item);
}

// 3-Dot Action Sheet Management
function openActionSheet(song, playlistId = null) {
  activeSheetSong = song;
  const overlay = document.getElementById('action-sheet-overlay');
  const title = document.getElementById('sheet-song-title');
  const artist = document.getElementById('sheet-song-artist');
  const thumb = document.getElementById('sheet-song-thumb');

  if (title) title.textContent = song.title;
  if (artist) artist.textContent = song.artist;
  if (thumb) thumb.src = song.artwork;

  if (overlay) overlay.classList.remove('hidden');
}

function closeActionSheet() {
  const overlay = document.getElementById('action-sheet-overlay');
  if (overlay) overlay.classList.add('hidden');
  activeSheetSong = null;
}

// Offline Download Manager
async function handleDownload(song) {
  try {
    showToast(`Downloading "${song.title}"...`);
    if (typeof db !== 'undefined') {
      await db.saveDownload(song);
      showToast(`Saved for offline play! ⚡`);
      updateProfileStats();
    }
  } catch(e) {
    showToast('Download error, please retry');
  }
}

// ==========================================
// 6. THEMES & PWA INSTALLATION
// ==========================================
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
    }
  });

  window.addEventListener('appinstalled', () => {
    pwaBtn.classList.add('hidden');
    deferredPrompt = null;
    showToast('Anru Music is now installed!');
  });
}

// ==========================================
// 7. CORE APP INITIALIZATION
// ==========================================
function initApp() {
  try {
    // 1. Bottom Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab(tab.dataset.tab);
      });
    });

    // 2. Brand & Hero Buttons
    const brandBtn = document.getElementById('brand-home-btn');
    if (brandBtn) brandBtn.addEventListener('click', () => switchTab('home'));

    const exploreBtn = document.getElementById('hero-explore-btn');
    if (exploreBtn) exploreBtn.addEventListener('click', () => performSearch('trending hindi hits'));

    // 3. Search Bar
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

    // 4. YouTube Music Mood & Activity Chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const mood = chip.dataset.mood;
        const query = chip.dataset.query;

        if (mood) {
          filterHomeByMood(mood, chip.textContent.trim());
        } else if (query) {
          performSearch(query);
        }
      });
    });

    // 5. Section "See All"
    document.querySelectorAll('.section-see-all').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.preventDefault();
        performSearch(tag.dataset.tag);
      });
    });

    // 6. Playlists Tab Cards (Offline Downloads & Liked Songs)
    const cardOffline = document.getElementById('card-playlist-offline');
    if (cardOffline) {
      cardOffline.addEventListener('click', () => {
        openPlaylistDetail('offline', 'offline');
      });
    }

    const cardLiked = document.getElementById('card-playlist-liked');
    if (cardLiked) {
      cardLiked.addEventListener('click', () => {
        openPlaylistDetail('liked', 'liked');
      });
    }

    const createPlBtn = document.getElementById('create-playlist-btn');
    if (createPlBtn) {
      createPlBtn.addEventListener('click', async () => {
        const name = (typeof window !== 'undefined' && window.prompt ? window.prompt('Enter new playlist name:') : 'My Playlist');
        if (name && name.trim()) {
          await db.createPlaylist(name.trim());
          showToast(`Playlist "${name.trim()}" created! 🎵`);
          renderPlaylistsView();
        }
      });
    }

    const backPlBtn = document.getElementById('detail-pl-back-btn');
    if (backPlBtn) {
      backPlBtn.addEventListener('click', () => {
        renderPlaylistsView();
      });
    }

    // 7. Mini Player Controls
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

    // 8. Queue Drawer
    const queueDrawer = document.getElementById('queue-drawer');
    const openQueue = () => {
      if (typeof player !== 'undefined' && player.renderQueueDrawer) player.renderQueueDrawer();
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

    // 9. Fullscreen Player Controls
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
      updateProfileStats();
    });

    const fsDl = document.getElementById('fs-download-btn');
    if (fsDl) fsDl.addEventListener('click', async () => {
      if (!player.currentSong) return;
      await handleDownload(player.currentSong);
    });

    const fsMenu = document.getElementById('fs-menu-btn');
    if (fsMenu) fsMenu.addEventListener('click', () => {
      if (player.currentSong) openActionSheet(player.currentSong);
    });

    // 10. Action Sheet Buttons
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

    const sheetAddCustomPl = document.getElementById('sheet-add-custom-playlist');
    if (sheetAddCustomPl) sheetAddCustomPl.addEventListener('click', () => {
      const song = activeSheetSong;
      closeActionSheet();
      if (song) promptAddToPlaylist(song);
    });

    const sheetDl = document.getElementById('sheet-download');
    if (sheetDl) sheetDl.addEventListener('click', async () => {
      if (activeSheetSong) await handleDownload(activeSheetSong);
      closeActionSheet();
    });

    const sheetLike = document.getElementById('sheet-like');
    if (sheetLike) sheetLike.addEventListener('click', async () => {
      if (activeSheetSong && typeof db !== 'undefined') {
        const isFav = await db.toggleFavorite(activeSheetSong);
        showToast(isFav ? 'Added to Liked Songs' : 'Removed from Liked Songs');
        updateProfileStats();
      }
      closeActionSheet();
    });

    const sheetShare = document.getElementById('sheet-share');
    if (sheetShare) sheetShare.addEventListener('click', () => {
      if (activeSheetSong) {
        if (typeof navigator !== 'undefined' && navigator.share) {
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

    // 11. Sliders
    const seekSlider = document.getElementById('fs-seek-slider');
    if (seekSlider) seekSlider.addEventListener('input', (e) => player.seek(parseFloat(e.target.value)));

    const volSlider = document.getElementById('fs-vol-slider');
    if (volSlider) volSlider.addEventListener('input', (e) => player.setVolume(parseFloat(e.target.value)));

    // 12. Load Initial Data
    loadHomeFeatured();

    // 13. Initialize Sub-engines
    try { initThemeEngine(); } catch (e) { console.warn('Theme init notice:', e); }
    try { initProfileAndAuth(); } catch (e) { console.warn('Profile init notice:', e); }
    try { initPWAInstallation(); } catch (e) { console.warn('PWA init notice:', e); }

    // 14. Initialize DB and sync stats
    if (typeof db !== 'undefined') {
      db.init().then(() => {
        updateProfileStats();
      }).catch(e => console.warn('DB init notice:', e));
    }

    // 15. Register Service Worker
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service Worker active'))
        .catch(err => console.warn('Service worker notice:', err));
    }
  } catch (err) {
    console.error('Critical app init error:', err);
  }
}

// Dual Readiness Trigger
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Global Exports
if (typeof window !== 'undefined') {
  window.switchTab = switchTab;
  window.performSearch = performSearch;
  window.loadHomeFeatured = loadHomeFeatured;
  window.renderPlaylistsView = renderPlaylistsView;
  window.openPlaylistDetail = openPlaylistDetail;
  window.promptAddToPlaylist = promptAddToPlaylist;
  window.filterHomeByMood = filterHomeByMood;
}
if (typeof globalThis !== 'undefined') {
  globalThis.switchTab = switchTab;
  globalThis.performSearch = performSearch;
  globalThis.loadHomeFeatured = loadHomeFeatured;
  globalThis.renderPlaylistsView = renderPlaylistsView;
  globalThis.openPlaylistDetail = openPlaylistDetail;
  globalThis.promptAddToPlaylist = promptAddToPlaylist;
  globalThis.filterHomeByMood = filterHomeByMood;
}
