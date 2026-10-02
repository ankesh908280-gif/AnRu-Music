/**
 * ANRU MUSIC STUDIO PRO - OFFLINE APP CONTROLLER (app.js)
 * 1. Zero-auth instant studio interface
 * 2. Multi-File & Folder Batch Importer with pure JS ID3 metadata & artwork parsing
 * 3. 100% Offline IndexedDB Library with real-time instant search & sorting
 * 4. Spotify-Style Queue, Sleep Timer, and 5-Band Studio Equalizer Controls
 */

let allLibrarySongs = [];
let activePlaylistDetail = null;

// ==========================================
// 1. APP INITIALIZATION & NAVIGATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Anru App] Initializing Pure Offline Studio v15 🚀');

  initNavigation();
  initPlayerControls();
  initImporter();
  initEqualizerUI();
  initSleepTimerUI();
  initThemeEngine();
  initActionSheet();

  // Load persistent library from IndexedDB
  await refreshLibrary();
});

// Tab Navigation
function switchTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${tabId}`);
  const targetNav = document.getElementById(`nav-${tabId}`);

  if (targetView) targetView.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  if (tabId === 'playlists') {
    renderPlaylistsTab();
  }
}

function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
}

// ==========================================
// 2. BATCH AUDIO FILE & FOLDER IMPORTER
// ==========================================
function initImporter() {
  const fileInput = document.getElementById('local-file-picker');
  const folderInput = document.getElementById('local-folder-picker');
  const importFileBtn = document.getElementById('import-files-btn');
  const importFolderBtn = document.getElementById('import-folder-btn');
  const emptyImportBtn = document.getElementById('empty-import-btn');

  if (importFileBtn && fileInput) {
    importFileBtn.addEventListener('click', () => fileInput.click());
  }
  if (importFolderBtn && folderInput) {
    importFolderBtn.addEventListener('click', () => folderInput.click());
  }
  if (emptyImportBtn && fileInput) {
    emptyImportBtn.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFilesImport(e.target.files));
  }
  if (folderInput) {
    folderInput.addEventListener('change', (e) => handleFilesImport(e.target.files));
  }
}

async function handleFilesImport(fileList) {
  if (!fileList || fileList.length === 0) return;

  const validAudioFiles = Array.from(fileList).filter(file => {
    return file.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(file.name);
  });

  if (validAudioFiles.length === 0) {
    showToast('⚠️ No audio files found in selection.');
    return;
  }

  showToast(`Importing ${validAudioFiles.length} songs... ⏳`);

  let importedCount = 0;
  for (let i = 0; i < validAudioFiles.length; i++) {
    const file = validAudioFiles[i];
    try {
      // Parse ID3 metadata and embedded artwork
      const meta = await ID3Parser.parseFile(file);

      // Save to IndexedDB
      await db.saveSong({
        id: `song-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        artwork: meta.artwork,
        duration: meta.duration,
        audioBlob: file,
        fileSize: file.size
      });

      importedCount++;
    } catch (err) {
      console.warn('Import error for file:', file.name, err);
    }
  }

  showToast(`✅ Successfully imported ${importedCount} songs to library!`);
  await refreshLibrary();
}

// ==========================================
// 3. PERSISTENT LIBRARY RENDERING & SEARCH
// ==========================================
async function refreshLibrary() {
  allLibrarySongs = await db.getAllSongs();
  renderLibraryView(allLibrarySongs);
}

function renderLibraryView(songs) {
  const container = document.getElementById('library-songs-list');
  const countBadge = document.getElementById('library-count-badge');
  const storageBadge = document.getElementById('library-storage-badge');
  const emptyState = document.getElementById('library-empty-state');

  if (!container) return;

  const totalSongs = songs.length;
  if (countBadge) countBadge.textContent = `${totalSongs} Songs`;

  // Calculate total storage
  let totalBytes = 0;
  songs.forEach(s => totalBytes += (s.fileSize || 0));
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  if (storageBadge) storageBadge.textContent = totalBytes > 1073741824 ? `${(totalBytes / 1073741824).toFixed(2)} GB` : `${mb} MB`;

  if (totalSongs === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  container.innerHTML = '';

  songs.forEach((song, idx) => {
    const row = document.createElement('div');
    row.className = 'song-row';
    row.innerHTML = `
      <span class="row-num">${idx + 1}</span>
      <div class="row-art-box">
        <img src="${song.artwork || 'icon-512.png'}" alt="cover" class="row-art" loading="lazy" onerror="this.src='icon-512.png'">
        <div class="row-play-hover"><i class="fa-solid fa-play"></i></div>
      </div>
      <div class="row-meta">
        <div class="row-title">${song.title}</div>
        <div class="row-artist">${song.artist} • ${song.album || 'Single'}</div>
      </div>
      <button class="row-action-btn menu-trigger" title="Options" data-id="${song.id}">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
    `;

    // Row click -> Play song
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-action-btn')) return;
      player.playSong(song, songs);
    });

    // 3-dots Menu
    const menuBtn = row.querySelector('.menu-trigger');
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openActionSheet(song);
      });
    }

    container.appendChild(row);
  });
}

// Instant Offline Search (Filters all local songs in 0.001s)
function setupSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search-btn');

  if (input) {
    input.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (clearBtn) clearBtn.classList.toggle('hidden', q.length === 0);

      if (!q) {
        renderLibraryView(allLibrarySongs);
        return;
      }

      const filtered = allLibrarySongs.filter(s => {
        const full = `${s.title} ${s.artist} ${s.album}`.toLowerCase();
        return full.includes(q);
      });

      renderLibraryView(filtered);
    });
  }

  if (clearBtn && input) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      renderLibraryView(allLibrarySongs);
    });
  }
}

// Library Sort Dropdown
function setupSorting() {
  const sortSelect = document.getElementById('library-sort-select');
  if (!sortSelect) return;

  sortSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    const sorted = [...allLibrarySongs];

    if (val === 'title-asc') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (val === 'title-desc') {
      sorted.sort((a, b) => b.title.localeCompare(a.title));
    } else if (val === 'artist-asc') {
      sorted.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (val === 'date-old') {
      sorted.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
    } else { // date-new
      sorted.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    }

    renderLibraryView(sorted);
  });
}

// ==========================================
// 4. PLAYER & FULLSCREEN CONTROLS BINDING
// ==========================================
function initPlayerControls() {
  // Mini Player Click -> Open Fullscreen
  const miniContent = document.getElementById('mini-player-content');
  const fsPlayer = document.getElementById('fullscreen-player');

  if (miniContent && fsPlayer) {
    miniContent.addEventListener('click', (e) => {
      if (e.target.closest('.mini-action-btn')) return;
      fsPlayer.classList.remove('hidden');
    });
  }

  // Mini Controls
  document.getElementById('mini-play-btn')?.addEventListener('click', () => player.togglePlay());
  document.getElementById('mini-next-btn')?.addEventListener('click', () => player.next());
  document.getElementById('mini-queue-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openQueue();
  });

  // Fullscreen Close Button
  document.getElementById('fs-close-btn')?.addEventListener('click', () => {
    if (fsPlayer) fsPlayer.classList.add('hidden');
  });

  // Fullscreen Playback Controls
  document.getElementById('fs-play-btn')?.addEventListener('click', () => player.togglePlay());
  document.getElementById('fs-next-btn')?.addEventListener('click', () => player.next());
  document.getElementById('fs-prev-btn')?.addEventListener('click', () => player.previous());
  document.getElementById('fs-shuffle-btn')?.addEventListener('click', () => player.toggleShuffle());
  document.getElementById('fs-repeat-btn')?.addEventListener('click', () => player.toggleRepeat());

  // Seeker
  const seekSlider = document.getElementById('fs-seek-slider');
  if (seekSlider) {
    seekSlider.addEventListener('input', (e) => player.seek(parseFloat(e.target.value)));
  }

  // Volume
  const volSlider = document.getElementById('fs-vol-slider');
  if (volSlider) {
    volSlider.addEventListener('input', (e) => player.setVolume(parseFloat(e.target.value)));
  }

  // Speed Toggle Button
  const speedBtn = document.getElementById('fs-speed-btn');
  if (speedBtn) {
    const speeds = [0.75, 1.0, 1.25, 1.5];
    speedBtn.addEventListener('click', () => {
      const curIdx = speeds.indexOf(player.playbackRate);
      const nextIdx = (curIdx + 1) % speeds.length;
      player.setSpeed(speeds[nextIdx]);
    });
  }

  // Favorite Button
  const likeBtn = document.getElementById('fs-like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      if (!player.currentSong) return;
      const isFav = await db.toggleFavorite(player.currentSong.id);
      likeBtn.classList.toggle('active', isFav);
      likeBtn.innerHTML = isFav 
        ? '<i class="fa-solid fa-heart" style="color:#ec4899;"></i>' 
        : '<i class="fa-regular fa-heart"></i>';
      showToast(isFav ? 'Added to Favorites ❤️' : 'Removed from Favorites');
    });
  }

  // Queue Drawer triggers
  document.getElementById('fs-queue-btn')?.addEventListener('click', openQueue);
  document.getElementById('close-queue-btn')?.addEventListener('click', closeQueue);
  document.getElementById('clear-queue-btn')?.addEventListener('click', () => player.clearUpcomingQueue());

  setupSearch();
  setupSorting();
}

function openQueue() {
  player.renderQueueDrawer();
  document.getElementById('queue-drawer')?.classList.remove('hidden');
}

function closeQueue() {
  document.getElementById('queue-drawer')?.classList.add('hidden');
}

// ==========================================
// 5. ACTION SHEET (3-DOTS SPOTIFY MENU)
// ==========================================
let actionSheetSong = null;

function initActionSheet() {
  const overlay = document.getElementById('action-sheet-overlay');
  const cancelBtn = document.getElementById('as-cancel-btn');

  if (cancelBtn && overlay) {
    cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  }

  // Action Buttons
  document.getElementById('as-play-next')?.addEventListener('click', () => {
    if (actionSheetSong) player.playNext(actionSheetSong);
    overlay.classList.add('hidden');
  });

  document.getElementById('as-add-queue')?.addEventListener('click', () => {
    if (actionSheetSong) player.addToQueue(actionSheetSong);
    overlay.classList.add('hidden');
  });

  document.getElementById('as-add-playlist')?.addEventListener('click', () => {
    overlay.classList.add('hidden');
    if (actionSheetSong) promptAddToPlaylist(actionSheetSong);
  });

  document.getElementById('as-delete')?.addEventListener('click', async () => {
    if (actionSheetSong && confirm(`Delete "${actionSheetSong.title}" from library?`)) {
      await db.deleteSong(actionSheetSong.id);
      showToast('Deleted from library 🗑️');
      overlay.classList.add('hidden');
      await refreshLibrary();
    }
  });
}

function openActionSheet(song) {
  actionSheetSong = song;
  const overlay = document.getElementById('action-sheet-overlay');
  const titleEl = document.getElementById('as-title');
  const artistEl = document.getElementById('as-artist');
  const thumbEl = document.getElementById('as-thumb');

  if (titleEl) titleEl.textContent = song.title;
  if (artistEl) artistEl.textContent = song.artist;
  if (thumbEl) thumbEl.src = song.artwork || 'icon-512.png';

  if (overlay) overlay.classList.remove('hidden');
}

// ==========================================
// 6. STUDIO EQUALIZER & SLEEP TIMER MODALS
// ==========================================
function initEqualizerUI() {
  const eqModal = document.getElementById('equalizer-modal');
  const openEqBtn = document.getElementById('fs-eq-btn');
  const studioEqBtn = document.getElementById('studio-open-eq-btn');
  const closeEqBtn = document.getElementById('close-eq-btn');

  if (openEqBtn && eqModal) {
    openEqBtn.addEventListener('click', () => eqModal.classList.remove('hidden'));
  }
  if (studioEqBtn && eqModal) {
    studioEqBtn.addEventListener('click', () => eqModal.classList.remove('hidden'));
  }
  if (closeEqBtn && eqModal) {
    closeEqBtn.addEventListener('click', () => eqModal.classList.add('hidden'));
  }

  // 5 Frequency Band Sliders
  [0, 1, 2, 3, 4].forEach(idx => {
    const slider = document.getElementById(`eq-band-${idx}`);
    const valText = document.getElementById(`eq-val-${idx}`);
    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (valText) valText.textContent = `${val > 0 ? '+' : ''}${val}dB`;
        player.setEQGain(idx, val);
      });
    }
  });

  // Bass Boost Slider
  const bassSlider = document.getElementById('bass-boost-slider');
  const bassValText = document.getElementById('bass-val');
  if (bassSlider) {
    bassSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (bassValText) bassValText.textContent = `${val}dB`;
      player.setBassBoost(val);
    });
  }

  // EQ Presets
  document.querySelectorAll('.eq-preset-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.eq-preset-chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const preset = e.currentTarget.dataset.preset;
      player.applyEQPreset(preset);
    });
  });
}

function initSleepTimerUI() {
  const stModal = document.getElementById('sleep-timer-modal');
  const openStBtn = document.getElementById('fs-sleep-btn');
  const studioStBtn = document.getElementById('studio-open-st-btn');
  const closeStBtn = document.getElementById('close-st-btn');

  if (openStBtn && stModal) {
    openStBtn.addEventListener('click', () => stModal.classList.remove('hidden'));
  }
  if (studioStBtn && stModal) {
    studioStBtn.addEventListener('click', () => stModal.classList.remove('hidden'));
  }
  if (closeStBtn && stModal) {
    closeStBtn.addEventListener('click', () => stModal.classList.add('hidden'));
  }

  // Timer Pills
  document.querySelectorAll('.st-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.st-pill').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const val = e.currentTarget.dataset.mins;
      if (val === '0') {
        player.cancelSleepTimer();
        showToast('Sleep timer cancelled');
      } else {
        player.startSleepTimer(val);
      }
      if (stModal) stModal.classList.add('hidden');
    });
  });
}

// ==========================================
// 7. OFFLINE PLAYLISTS VIEW
// ==========================================
async function renderPlaylistsTab() {
  const container = document.getElementById('playlists-grid');
  const createBtn = document.getElementById('create-playlist-btn');
  if (!container) return;

  const playlists = await db.getPlaylists();
  container.innerHTML = '';

  if (createBtn) {
    createBtn.onclick = async () => {
      const name = prompt('Enter playlist name:');
      if (name && name.trim()) {
        await db.createPlaylist(name.trim());
        showToast(`Created playlist "${name.trim()}"! 📁`);
        renderPlaylistsTab();
      }
    };
  }

  // Add Favorites card
  const favIds = await db.getAllFavorites();
  const favCard = document.createElement('div');
  favCard.className = 'playlist-card glass-card';
  favCard.innerHTML = `
    <div class="playlist-art-wrap" style="background:linear-gradient(135deg, #ec4899, #8b5cf6);">
      <i class="fa-solid fa-heart" style="font-size:32px; color:#fff;"></i>
    </div>
    <div class="playlist-name">Liked Songs</div>
    <div class="playlist-sub">${favIds.length} Songs</div>
  `;
  favCard.onclick = () => openPlaylistDetail('favorites', 'Liked Songs', favIds);
  container.appendChild(favCard);

  // User Playlists
  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'playlist-card glass-card';
    card.innerHTML = `
      <div class="playlist-art-wrap">
        <i class="fa-solid fa-music" style="font-size:32px; color:var(--accent);"></i>
      </div>
      <div class="playlist-name">${pl.name}</div>
      <div class="playlist-sub">${(pl.songIds || []).length} Songs</div>
    `;
    card.onclick = () => openPlaylistDetail(pl.id, pl.name, pl.songIds || []);
    container.appendChild(card);
  });
}

function openPlaylistDetail(id, title, songIds) {
  const plView = document.getElementById('playlist-detail-view');
  const titleEl = document.getElementById('pl-detail-title');
  const countEl = document.getElementById('pl-detail-count');
  const listEl = document.getElementById('pl-detail-songs');
  const backBtn = document.getElementById('pl-detail-back-btn');
  const playAllBtn = document.getElementById('pl-play-all-btn');
  const shuffleBtn = document.getElementById('pl-shuffle-btn');
  const deleteBtn = document.getElementById('pl-delete-btn');

  if (!plView || !listEl) return;

  if (titleEl) titleEl.textContent = title;
  const plSongs = allLibrarySongs.filter(s => songIds.includes(s.id));
  if (countEl) countEl.textContent = `${plSongs.length} Songs`;

  // Bind Play All
  if (playAllBtn) {
    playAllBtn.onclick = () => {
      if (plSongs.length > 0) {
        player.playSong(plSongs[0], plSongs);
        showToast(`Playing "${title}" ▶`);
      } else {
        showToast('Playlist is empty.');
      }
    };
  }

  // Bind Shuffle
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      if (plSongs.length > 0) {
        const shuffled = [...plSongs].sort(() => Math.random() - 0.5);
        player.playSong(shuffled[0], shuffled);
        showToast(`Shuffling "${title}" 🔀`);
      } else {
        showToast('Playlist is empty.');
      }
    };
  }

  // Bind Delete for custom playlists
  if (deleteBtn) {
    if (id === 'favorites') {
      deleteBtn.classList.add('hidden');
    } else {
      deleteBtn.classList.remove('hidden');
      deleteBtn.onclick = async () => {
        if (confirm(`Delete playlist "${title}"?`)) {
          await db.deletePlaylist(id);
          plView.classList.add('hidden');
          renderPlaylistsTab();
          showToast(`Deleted playlist "${title}" 🗑️`);
        }
      };
    }
  }

  listEl.innerHTML = '';
  if (plSongs.length === 0) {
    listEl.innerHTML = '<div class="empty-sub">No songs in this playlist yet. Add songs using the 3-dots menu on any track!</div>';
  } else {
    plSongs.forEach((song, idx) => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.innerHTML = `
        <span class="row-num">${idx + 1}</span>
        <div class="row-art-box">
          <img src="${song.artwork || 'icon-512.png'}" alt="cover" class="row-art" onerror="this.src='icon-512.png'">
          <div class="row-play-hover"><i class="fa-solid fa-play"></i></div>
        </div>
        <div class="row-meta">
          <div class="row-title">${song.title}</div>
          <div class="row-artist">${song.artist} • ${song.album || 'Single'}</div>
        </div>
        <button class="row-action-btn menu-trigger" title="Options" data-id="${song.id}">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      `;

      row.onclick = (e) => {
        if (e.target.closest('.row-action-btn')) return;
        player.playSong(song, plSongs);
      };

      const menuBtn = row.querySelector('.menu-trigger');
      if (menuBtn) {
        menuBtn.onclick = (e) => {
          e.stopPropagation();
          openActionSheet(song);
        };
      }

      listEl.appendChild(row);
    });
  }

  plView.classList.remove('hidden');
  if (backBtn) backBtn.onclick = () => plView.classList.add('hidden');
}

async function promptAddToPlaylist(song) {
  const playlists = await db.getPlaylists();
  if (playlists.length === 0) {
    const create = confirm('No custom playlists yet. Create one now?');
    if (create) {
      const name = prompt('Playlist name:');
      if (name && name.trim()) {
        const newPl = await db.createPlaylist(name.trim());
        await db.addSongToPlaylist(newPl.id, song.id);
        showToast(`Added to "${name.trim()}"!`);
      }
    }
    return;
  }

  const names = playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const choice = prompt(`Choose playlist (number):\n${names}`);
  const idx = parseInt(choice, 10) - 1;
  if (!isNaN(idx) && playlists[idx]) {
    await db.addSongToPlaylist(playlists[idx].id, song.id);
    showToast(`Added to "${playlists[idx].name}"! 🎵`);
  }
}

// ==========================================
// 8. THEME ENGINE & HELPERS
// ==========================================
function initThemeEngine() {
  let savedTheme = 'aurora';
  try {
    savedTheme = localStorage.getItem('anru_theme') || 'aurora';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', savedTheme);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    if (btn.dataset.theme === savedTheme) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', (e) => {
      const t = e.currentTarget.dataset.theme;
      if (t) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('anru_theme', t); } catch (err) {}
        showToast(`Theme: ${t.toUpperCase()}`);
      }
    });
  });
}

function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Global exports
if (typeof window !== 'undefined') {
  window.switchTab = switchTab;
  window.refreshLibrary = refreshLibrary;
  window.showToast = showToast;
}
