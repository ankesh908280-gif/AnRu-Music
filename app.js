/**
 * ANRU MUSIC STUDIO PRO v17 - MASTER CONTROLLER (app.js)
 * 1. Native App Feel: Anti-Refresh, Web-Artifact Suppression, Android Hardware Back-Button Router
 * 2. Playback State Persistence (Auto-resume track, timestamp, and queue after close/refresh)
 * 3. 3D Spatial Virtualizer & Auto Volume Normalizer DSP Toggles
 * 4. Interactive Waveform Seekbar & Mobile Touch Swipe Gestures
 * 5. Smart Auto-Playlists: "Most Played" & "Never Played"
 * 6. Music Activity Report Graph (Anru Focus style) & Music Wrapped Card
 * 7. Multi-selection, batch actions, and 100% offline persistence
 */

let allLibrarySongs = [];
let isSelectionMode = false;
let selectedSongIds = new Set();
let activePlaylistDetail = null;
let currentStatsTimeframe = 'week';

// ==========================================
// 1. APP INITIALIZATION & HARDWARE ROUTER
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Anru App] Initializing Pure Offline Studio v17 🚀');

  initNativeAppFeel();
  initHardwareBackButton();
  initNavigation();
  initPlayerControls();
  initImporter();
  initSelectionMode();
  initEqualizerUI();
  initSleepTimerUI();
  initThemeEngine();
  initActionSheet();
  initCustomModals();
  initHolographicStudio();
  initWrappedModal();
  player.initSwipeGestures();

  // Load persistent library and restore previous playback session
  await refreshLibrary();
  await restoreSavedPlaybackSession();
});

// Suppress unwanted desktop/browser behaviors (context menu, image drag)
// NOTE: Pull-to-refresh is handled natively via CSS overscroll-behavior-y: contain,
// ensuring 100% natural, fluid 60fps scrolling without touch gesture locking!
function initNativeAppFeel() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
    }
  });
}

// Android Hardware Back Button Handling via History API
function initHardwareBackButton() {
  history.replaceState({ page: 'library' }, '');

  window.addEventListener('popstate', (e) => {
    // 1. Wrapped modal open?
    const wrappedModal = document.getElementById('wrapped-modal');
    if (wrappedModal && !wrappedModal.classList.contains('hidden')) {
      wrappedModal.classList.add('hidden');
      return;
    }

    // 2. Custom modals open?
    const promptModal = document.getElementById('custom-prompt-modal');
    if (promptModal && !promptModal.classList.contains('hidden')) {
      promptModal.classList.add('hidden');
      return;
    }
    const confirmModal = document.getElementById('custom-confirm-modal');
    if (confirmModal && !confirmModal.classList.contains('hidden')) {
      confirmModal.classList.add('hidden');
      return;
    }
    const plPicker = document.getElementById('custom-playlist-picker-modal');
    if (plPicker && !plPicker.classList.contains('hidden')) {
      plPicker.classList.add('hidden');
      return;
    }

    // 3. EQ / Sleep Timer modals open?
    const eqModal = document.getElementById('equalizer-modal');
    if (eqModal && !eqModal.classList.contains('hidden')) {
      eqModal.classList.add('hidden');
      player.stopVisualizer();
      return;
    }
    const stModal = document.getElementById('sleep-timer-modal');
    if (stModal && !stModal.classList.contains('hidden')) {
      stModal.classList.add('hidden');
      return;
    }

    // 4. Action sheet open?
    const actionSheet = document.getElementById('action-sheet-overlay');
    if (actionSheet && !actionSheet.classList.contains('hidden')) {
      actionSheet.classList.add('hidden');
      return;
    }

    // 5. Queue drawer open?
    const queueDrawer = document.getElementById('queue-drawer');
    if (queueDrawer && !queueDrawer.classList.contains('hidden')) {
      queueDrawer.classList.add('hidden');
      return;
    }

    // 6. Fullscreen player open?
    const fsPlayer = document.getElementById('fullscreen-player');
    if (fsPlayer && !fsPlayer.classList.contains('hidden')) {
      fsPlayer.classList.add('hidden');
      return;
    }

    // 7. Playlist detail view open?
    const plDetail = document.getElementById('playlist-detail-view');
    if (plDetail && !plDetail.classList.contains('hidden')) {
      plDetail.classList.add('hidden');
      return;
    }

    // 8. Multi-select mode active?
    if (isSelectionMode) {
      exitSelectionMode();
      return;
    }

    // 9. If in Studio or Playlists tab, step back to Library
    const activeNav = document.querySelector('.bottom-nav .nav-tab.active');
    if (activeNav && activeNav.dataset.tab !== 'library') {
      switchTab('library');
      return;
    }
  });
}

// Push history state whenever opening a view
function pushNavState(modalName) {
  history.pushState({ modal: modalName }, '');
}

// Tab Navigation
function switchTab(tabId) {
  if (isSelectionMode) exitSelectionMode();

  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.bottom-nav .nav-tab').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${tabId}`);
  const targetNav = document.getElementById(`nav-${tabId}`);

  if (targetView) targetView.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  if (tabId === 'playlists') {
    renderPlaylistsTab();
  } else if (tabId === 'studio') {
    renderActivityGraph(currentStatsTimeframe);
  }
}

function initNavigation() {
  document.querySelectorAll('.bottom-nav .nav-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
}

// ==========================================
// 2. PLAYBACK STATE RESUME ENGINE
// ==========================================
async function restoreSavedPlaybackSession() {
  try {
    const state = await db.getPlaybackState();
    if (state && allLibrarySongs.length > 0) {
      await player.loadSavedState(state, allLibrarySongs);
    }
  } catch (err) {
    console.warn('[Anru Session] Restore notice:', err);
  }
}

// ==========================================
// 3. BATCH AUDIO FILE & FOLDER IMPORTER
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

  showToast(`Scanning ${validAudioFiles.length} files... ⏳`);

  let importedCount = 0;
  let skippedDuplicates = 0;

  for (let i = 0; i < validAudioFiles.length; i++) {
    const file = validAudioFiles[i];
    try {
      const meta = await ID3Parser.parseFile(file);

      // Check for duplicate song
      const isDup = await db.findDuplicate(meta, file.size, file.name);
      if (isDup) {
        skippedDuplicates++;
        continue;
      }

      await db.saveSong({
        id: `song-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        artwork: meta.artwork,
        duration: meta.duration,
        audioBlob: file,
        fileSize: file.size,
        fileName: file.name,
        dateAdded: Date.now()
      });

      importedCount++;
    } catch (err) {
      console.warn('[Anru Importer] Error processing file:', file.name, err);
    }
  }

  if (importedCount > 0 && skippedDuplicates > 0) {
    showToast(`✅ Added ${importedCount} songs (${skippedDuplicates} duplicates skipped)`);
  } else if (importedCount > 0) {
    showToast(`✅ Successfully imported ${importedCount} songs!`);
  } else if (skippedDuplicates > 0) {
    showToast(`ℹ️ All ${skippedDuplicates} selected songs already in library!`);
  }

  await refreshLibrary();
}

// ==========================================
// 4. PERSISTENT LIBRARY & BATCH SELECTION
// ==========================================
async function refreshLibrary() {
  allLibrarySongs = await db.getAllSongs();
  renderLibraryView(allLibrarySongs);

  const holoTracks = document.getElementById('holo-total-tracks');
  if (holoTracks) holoTracks.textContent = `${allLibrarySongs.length} Tracks in Library`;
}

function renderLibraryView(songs) {
  const container = document.getElementById('library-songs-list');
  const countBadge = document.getElementById('library-count-badge');
  const storageBadge = document.getElementById('library-storage-badge');
  const emptyState = document.getElementById('library-empty-state');

  if (!container) return;

  const totalSongs = songs.length;
  if (countBadge) countBadge.textContent = `${totalSongs} Songs`;

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
    row.className = `song-row ${selectedSongIds.has(song.id) ? 'selected' : ''}`;
    row.dataset.id = song.id;

    row.innerHTML = `
      <div class="row-checkbox-wrap ${isSelectionMode ? '' : 'hidden'}">
        <input type="checkbox" class="row-checkbox" ${selectedSongIds.has(song.id) ? 'checked' : ''}>
      </div>
      <span class="row-num ${isSelectionMode ? 'hidden' : ''}">${idx + 1}</span>
      <div class="row-art-box">
        <img src="${song.artwork || 'icon-512.png'}" alt="cover" class="row-art" loading="lazy" onerror="this.src='icon-512.png'">
        <div class="row-play-hover"><i class="fa-solid fa-play"></i></div>
      </div>
      <div class="row-meta">
        <div class="row-title">${song.title}</div>
        <div class="row-artist">${song.artist} • ${song.album || 'Offline'}</div>
      </div>
      <button class="row-action-btn menu-trigger ${isSelectionMode ? 'hidden' : ''}" title="Options" data-id="${song.id}">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
    `;

    // Long press detection for selection mode
    let touchTimer = null;
    row.addEventListener('touchstart', () => {
      touchTimer = setTimeout(() => {
        if (!isSelectionMode) {
          enterSelectionMode();
          toggleSongSelection(song.id, row);
        }
      }, 550);
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });

    row.addEventListener('touchmove', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });

    // Row click
    row.addEventListener('click', (e) => {
      if (e.target.closest('.menu-trigger')) return;

      if (isSelectionMode) {
        toggleSongSelection(song.id, row);
        return;
      }
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

function initSelectionMode() {
  const selectBtn = document.getElementById('select-mode-btn');
  const cancelBtn = document.getElementById('sel-cancel-btn');
  const selectAllBtn = document.getElementById('sel-select-all-btn');
  const deleteBtn = document.getElementById('sel-delete-btn');
  const addPlBtn = document.getElementById('sel-add-playlist-btn');

  selectBtn?.addEventListener('click', () => {
    if (isSelectionMode) exitSelectionMode();
    else enterSelectionMode();
  });

  cancelBtn?.addEventListener('click', exitSelectionMode);

  selectAllBtn?.addEventListener('click', () => {
    if (selectedSongIds.size === allLibrarySongs.length) {
      selectedSongIds.clear();
    } else {
      selectedSongIds = new Set(allLibrarySongs.map(s => s.id));
    }
    updateSelectionUI();
  });

  deleteBtn?.addEventListener('click', async () => {
    if (selectedSongIds.size === 0) return;
    const confirmed = await showCustomConfirm({
      title: 'Delete Selected Songs?',
      message: `Permanently delete ${selectedSongIds.size} songs from offline library?`,
      confirmText: `Delete (${selectedSongIds.size})`,
      isDanger: true
    });

    if (confirmed) {
      const ids = Array.from(selectedSongIds);
      await db.deleteMultipleSongs(ids);
      showToast(`🗑️ Deleted ${ids.length} songs`);
      exitSelectionMode();
      await refreshLibrary();
    }
  });

  addPlBtn?.addEventListener('click', () => {
    if (selectedSongIds.size === 0) return;
    const selectedSongs = allLibrarySongs.filter(s => selectedSongIds.has(s.id));
    openPlaylistPickerModal(selectedSongs);
  });
}

function enterSelectionMode() {
  isSelectionMode = true;
  selectedSongIds.clear();
  const bar = document.getElementById('selection-action-bar');
  const btn = document.getElementById('select-mode-btn');
  if (bar) bar.classList.remove('hidden');
  if (btn) {
    btn.classList.add('active');
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> <span>Cancel</span>';
  }
  updateSelectionUI();
  if (navigator.vibrate) navigator.vibrate(30);
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectedSongIds.clear();
  const bar = document.getElementById('selection-action-bar');
  const btn = document.getElementById('select-mode-btn');
  if (bar) bar.classList.add('hidden');
  if (btn) {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fa-solid fa-check-double"></i> <span>Select</span>';
  }
  updateSelectionUI();
}

function toggleSongSelection(songId, rowEl) {
  if (selectedSongIds.has(songId)) {
    selectedSongIds.delete(songId);
    rowEl.classList.remove('selected');
    const chk = rowEl.querySelector('.row-checkbox');
    if (chk) chk.checked = false;
  } else {
    selectedSongIds.add(songId);
    rowEl.classList.add('selected');
    const chk = rowEl.querySelector('.row-checkbox');
    if (chk) chk.checked = true;
  }
  updateSelectionUI();
  if (navigator.vibrate) navigator.vibrate(20);
}

function updateSelectionUI() {
  const countEl = document.getElementById('sel-selected-count');
  if (countEl) countEl.textContent = selectedSongIds.size;

  document.querySelectorAll('.song-row').forEach(row => {
    const id = row.dataset.id;
    const isSelected = selectedSongIds.has(id);
    row.classList.toggle('selected', isSelected);

    const chkWrap = row.querySelector('.row-checkbox-wrap');
    const numEl = row.querySelector('.row-num');
    const menuBtn = row.querySelector('.menu-trigger');
    const chk = row.querySelector('.row-checkbox');

    if (chkWrap) chkWrap.classList.toggle('hidden', !isSelectionMode);
    if (numEl) numEl.classList.toggle('hidden', isSelectionMode);
    if (menuBtn) menuBtn.classList.toggle('hidden', isSelectionMode);
    if (chk) chk.checked = isSelected;
  });
}

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
// 5. PLAYER & FULLSCREEN CONTROLS BINDING
// ==========================================
function initPlayerControls() {
  const miniContent = document.getElementById('mini-player-content');
  const fsPlayer = document.getElementById('fullscreen-player');

  if (miniContent && fsPlayer) {
    miniContent.addEventListener('click', (e) => {
      if (e.target.closest('.mini-action-btn')) return;
      fsPlayer.classList.remove('hidden');
      pushNavState('fullscreen');
      player.drawWaveformSeekbar(0);
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
    if (history.state?.modal === 'fullscreen') history.back();
  });

  // Fullscreen Playback Controls
  document.getElementById('fs-play-btn')?.addEventListener('click', () => player.togglePlay());
  document.getElementById('fs-next-btn')?.addEventListener('click', () => player.next());
  document.getElementById('fs-prev-btn')?.addEventListener('click', () => player.previous());
  document.getElementById('fs-shuffle-btn')?.addEventListener('click', () => player.toggleShuffle());
  document.getElementById('fs-repeat-btn')?.addEventListener('click', () => player.toggleRepeat());

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
      showToast(isFav ? 'Added to Favorites 💖' : 'Removed from Favorites');
    });
  }

  // Queue Drawer triggers
  document.getElementById('fs-queue-btn')?.addEventListener('click', openQueue);
  document.getElementById('close-queue-btn')?.addEventListener('click', closeQueue);
  document.getElementById('clear-queue-btn')?.addEventListener('click', () => player.clearUpcomingQueue());

  // Waveform canvas initialization
  const wfCanvas = document.getElementById('fs-waveform-canvas');
  if (wfCanvas) player.initWaveformCanvas(wfCanvas);

  setupSearch();
  setupSorting();
}

function openQueue() {
  player.renderQueueDrawer();
  document.getElementById('queue-drawer')?.classList.remove('hidden');
  pushNavState('queue');
}

function closeQueue() {
  document.getElementById('queue-drawer')?.classList.add('hidden');
  if (history.state?.modal === 'queue') history.back();
}

// ==========================================
// 6. ACTION SHEET (3-DOTS SPOTIFY MENU)
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
    if (actionSheetSong) openPlaylistPickerModal([actionSheetSong]);
  });

  document.getElementById('as-delete')?.addEventListener('click', async () => {
    if (!actionSheetSong) return;
    const confirmed = await showCustomConfirm({
      title: 'Delete from Library?',
      message: `Delete "${actionSheetSong.title}" from local storage?`,
      confirmText: 'Delete Song',
      isDanger: true
    });

    if (confirmed) {
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
  pushNavState('actionsheet');
}

// ==========================================
// 7. CUSTOM MODAL SYSTEM (REPLACES BROWSER DIALOGS)
// ==========================================
let promptResolver = null;
let confirmResolver = null;

function initCustomModals() {
  const promptModal = document.getElementById('custom-prompt-modal');
  const promptInput = document.getElementById('custom-prompt-input');
  const promptConfirm = document.getElementById('custom-prompt-confirm');
  const promptCancel = document.getElementById('custom-prompt-cancel');

  promptConfirm?.addEventListener('click', () => {
    const val = promptInput?.value?.trim();
    promptModal?.classList.add('hidden');
    if (promptResolver) promptResolver(val || null);
    promptResolver = null;
  });

  promptCancel?.addEventListener('click', () => {
    promptModal?.classList.add('hidden');
    if (promptResolver) promptResolver(null);
    promptResolver = null;
  });

  promptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') promptConfirm?.click();
    if (e.key === 'Escape') promptCancel?.click();
  });

  const confirmModal = document.getElementById('custom-confirm-modal');
  const confirmOk = document.getElementById('custom-confirm-ok');
  const confirmCancel = document.getElementById('custom-confirm-cancel');

  confirmOk?.addEventListener('click', () => {
    confirmModal?.classList.add('hidden');
    if (confirmResolver) confirmResolver(true);
    confirmResolver = null;
  });

  confirmCancel?.addEventListener('click', () => {
    confirmModal?.classList.add('hidden');
    if (confirmResolver) confirmResolver(false);
    confirmResolver = null;
  });

  document.getElementById('close-pl-picker-btn')?.addEventListener('click', () => {
    document.getElementById('custom-playlist-picker-modal')?.classList.add('hidden');
  });

  document.getElementById('picker-create-new-btn')?.addEventListener('click', async () => {
    document.getElementById('custom-playlist-picker-modal')?.classList.add('hidden');
    const name = await showCustomPrompt({
      title: 'New Playlist',
      desc: 'Enter a name for your playlist',
      placeholder: 'Playlist Name'
    });
    if (name) {
      const pl = await db.createPlaylist(name);
      showToast(`Created "${pl.name}"! 📁`);
      renderPlaylistsTab();
    }
  });
}

function showCustomPrompt({ title = 'Input', desc = '', placeholder = '', defaultValue = '' }) {
  return new Promise((resolve) => {
    promptResolver = resolve;
    const modal = document.getElementById('custom-prompt-modal');
    const titleEl = document.getElementById('custom-prompt-title');
    const descEl = document.getElementById('custom-prompt-desc');
    const inputEl = document.getElementById('custom-prompt-input');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (inputEl) {
      inputEl.placeholder = placeholder;
      inputEl.value = defaultValue;
    }

    if (modal) modal.classList.remove('hidden');
    pushNavState('prompt');
    setTimeout(() => inputEl?.focus(), 100);
  });
}

function showCustomConfirm({ title = 'Confirm', message = '', confirmText = 'Confirm', isDanger = false }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    const modal = document.getElementById('custom-confirm-modal');
    const titleEl = document.getElementById('custom-confirm-title');
    const msgEl = document.getElementById('custom-confirm-message');
    const okBtn = document.getElementById('custom-confirm-ok');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okBtn) {
      okBtn.textContent = confirmText;
      okBtn.className = isDanger ? 'modal-action-btn danger' : 'modal-action-btn primary-glow';
    }

    if (modal) modal.classList.remove('hidden');
    pushNavState('confirm');
  });
}

async function openPlaylistPickerModal(songs) {
  if (!songs || songs.length === 0) return;
  const pickerModal = document.getElementById('custom-playlist-picker-modal');
  const list = document.getElementById('playlist-picker-list');
  if (!pickerModal || !list) return;

  const playlists = await db.getPlaylists();
  list.innerHTML = '';

  if (playlists.length === 0) {
    list.innerHTML = '<div class="empty-sub">No playlists found. Create one above!</div>';
  } else {
    playlists.forEach(pl => {
      const card = document.createElement('button');
      card.className = 'picker-pl-card glass-card';
      card.innerHTML = `
        <div class="picker-pl-icon"><i class="fa-solid fa-list-ul"></i></div>
        <div class="picker-pl-meta">
          <div class="picker-pl-title">${pl.name}</div>
          <div class="picker-pl-count">${(pl.songIds || []).length} Songs</div>
        </div>
        <i class="fa-solid fa-chevron-right chevron-ico"></i>
      `;

      card.addEventListener('click', async () => {
        let addedCount = 0;
        for (const s of songs) {
          const ok = await db.addSongToPlaylist(pl.id, s.id);
          if (ok) addedCount++;
        }
        pickerModal.classList.add('hidden');
        showToast(`Added ${addedCount} song(s) to "${pl.name}"! 🎵`);
        if (isSelectionMode) exitSelectionMode();
      });

      list.appendChild(card);
    });
  }

  pickerModal.classList.remove('hidden');
  pushNavState('picker');
}

// ==========================================
// 8. 7-BAND STUDIO EQUALIZER, 3D VIRTUALIZER & NORMALIZER
// ==========================================
function initEqualizerUI() {
  const eqModal = document.getElementById('equalizer-modal');
  const openEqBtn = document.getElementById('fs-eq-btn');
  const studioEqBtn = document.getElementById('studio-open-eq-btn');
  const closeEqBtn = document.getElementById('close-eq-btn');
  const canvas = document.getElementById('eq-visualizer');

  const openEQ = () => {
    if (eqModal) eqModal.classList.remove('hidden');
    if (canvas) player.startVisualizer(canvas);
    pushNavState('eq');
  };

  const closeEQ = () => {
    if (eqModal) eqModal.classList.add('hidden');
    player.stopVisualizer();
  };

  openEqBtn?.addEventListener('click', openEQ);
  studioEqBtn?.addEventListener('click', openEQ);
  closeEqBtn?.addEventListener('click', closeEQ);

  // 7 Frequency Band Sliders
  [0, 1, 2, 3, 4, 5, 6].forEach(idx => {
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

  // 3D Spatial Virtualizer & Auto Volume Normalizer Toggles (Both in Studio & Fullscreen Player)
  const virtToggle = document.getElementById('toggle-virtualizer');
  const normToggle = document.getElementById('toggle-normalizer');
  const fs3dBtn = document.getElementById('fs-3d-toggle-btn');
  const fsNormBtn = document.getElementById('fs-norm-toggle-btn');

  function updateDSPSyncUI() {
    if (virtToggle) virtToggle.checked = !!player.isVirtualizerOn;
    if (fs3dBtn) fs3dBtn.classList.toggle('active', !!player.isVirtualizerOn);

    if (normToggle) normToggle.checked = !!player.isNormalizerOn;
    if (fsNormBtn) fsNormBtn.classList.toggle('active', !!player.isNormalizerOn);
  }

  // Load saved states
  db.getSetting('virtualizer_enabled', false).then(val => {
    player.isVirtualizerOn = !!val;
    updateDSPSyncUI();
  });

  db.getSetting('normalizer_enabled', false).then(val => {
    player.isNormalizerOn = !!val;
    updateDSPSyncUI();
  });

  virtToggle?.addEventListener('change', (e) => {
    player.toggleVirtualizer(e.target.checked);
    updateDSPSyncUI();
  });

  normToggle?.addEventListener('change', (e) => {
    player.toggleNormalizer(e.target.checked);
    updateDSPSyncUI();
  });

  fs3dBtn?.addEventListener('click', () => {
    player.toggleVirtualizer(!player.isVirtualizerOn);
    updateDSPSyncUI();
  });

  fsNormBtn?.addEventListener('click', () => {
    player.toggleNormalizer(!player.isNormalizerOn);
    updateDSPSyncUI();
  });

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

// ==========================================
// 9. SLEEP TIMER (PRESETS & CUSTOM STEPPER)
// ==========================================
function initSleepTimerUI() {
  const stModal = document.getElementById('sleep-timer-modal');
  const openStBtn = document.getElementById('fs-sleep-btn');
  const studioStBtn = document.getElementById('studio-open-st-btn');
  const closeStBtn = document.getElementById('close-st-btn');

  const openST = () => {
    stModal?.classList.remove('hidden');
    pushNavState('sleeptimer');
  };

  openStBtn?.addEventListener('click', openST);
  studioStBtn?.addEventListener('click', openST);
  closeStBtn?.addEventListener('click', () => stModal?.classList.add('hidden'));

  document.querySelectorAll('.st-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.st-pill').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const val = e.currentTarget.dataset.mins;
      if (val === '0') {
        player.cancelSleepTimer();
        showToast('Sleep timer turned off');
      } else {
        player.startSleepTimer(val);
      }
      stModal?.classList.add('hidden');
    });
  });

  const input = document.getElementById('custom-timer-input');
  const decBtn = document.getElementById('timer-dec-btn');
  const incBtn = document.getElementById('timer-inc-btn');
  const setBtn = document.getElementById('set-custom-timer-btn');

  decBtn?.addEventListener('click', () => {
    if (input) input.value = Math.max(1, parseInt(input.value || 25, 10) - 5);
  });

  incBtn?.addEventListener('click', () => {
    if (input) input.value = Math.min(360, parseInt(input.value || 25, 10) + 5);
  });

  setBtn?.addEventListener('click', () => {
    const mins = parseInt(input?.value || 25, 10);
    if (!isNaN(mins) && mins > 0) {
      player.startSleepTimer(mins);
      stModal?.classList.add('hidden');
    }
  });
}

// ==========================================
// 10. SMART PLAYLISTS & CUSTOM PLAYLISTS
// ==========================================
async function renderPlaylistsTab() {
  const container = document.getElementById('playlists-grid');
  const createBtn = document.getElementById('create-playlist-btn');
  if (!container) return;

  const playlists = await db.getPlaylists();
  const smartLists = await db.getSmartPlaylists();
  container.innerHTML = '';

  if (createBtn) {
    createBtn.onclick = async () => {
      const name = await showCustomPrompt({
        title: 'New Playlist',
        desc: 'Enter a name for your playlist',
        placeholder: 'e.g., Workout, Chill, Favorites'
      });
      if (name) {
        await db.createPlaylist(name);
        showToast(`Created playlist "${name}"! 📁`);
        renderPlaylistsTab();
      }
    };
  }

  // 1. Liked Songs card
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

  // 2. SMART PLAYLIST: Most Played
  const mostPlayedCard = document.createElement('div');
  mostPlayedCard.className = 'playlist-card glass-card';
  mostPlayedCard.innerHTML = `
    <div class="playlist-art-wrap" style="background:linear-gradient(135deg, #f59e0b, #ef4444);">
      <i class="fa-solid fa-fire" style="font-size:32px; color:#fff;"></i>
    </div>
    <div class="playlist-name">Most Played</div>
    <div class="playlist-sub">${smartLists.mostPlayed.length} Songs</div>
  `;
  mostPlayedCard.onclick = () => openPlaylistDetail('most_played', 'Most Played', smartLists.mostPlayed.map(s => s.id));
  container.appendChild(mostPlayedCard);

  // 3. SMART PLAYLIST: Never Played
  const neverPlayedCard = document.createElement('div');
  neverPlayedCard.className = 'playlist-card glass-card';
  neverPlayedCard.innerHTML = `
    <div class="playlist-art-wrap" style="background:linear-gradient(135deg, #06b6d4, #3b82f6);">
      <i class="fa-solid fa-clock-rotate-left" style="font-size:30px; color:#fff;"></i>
    </div>
    <div class="playlist-name">Never Played</div>
    <div class="playlist-sub">${smartLists.neverPlayed.length} Songs</div>
  `;
  neverPlayedCard.onclick = () => openPlaylistDetail('never_played', 'Never Played', smartLists.neverPlayed.map(s => s.id));
  container.appendChild(neverPlayedCard);

  // 4. User Playlists
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

  // Play All
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

  // Shuffle
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

  // Delete Playlist (Only custom playlists)
  if (deleteBtn) {
    if (id === 'favorites' || id === 'most_played' || id === 'never_played') {
      deleteBtn.classList.add('hidden');
    } else {
      deleteBtn.classList.remove('hidden');
      deleteBtn.onclick = async () => {
        const confirmed = await showCustomConfirm({
          title: `Delete "${title}"?`,
          message: 'Are you sure you want to delete this playlist? Your songs will stay in your library.',
          confirmText: 'Delete Playlist',
          isDanger: true
        });

        if (confirmed) {
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
  pushNavState('playlist_detail');
  if (backBtn) backBtn.onclick = () => {
    plView.classList.add('hidden');
    if (history.state?.modal === 'playlist_detail') history.back();
  };
}

// ==========================================
// 11. HOLOGRAPHIC STUDIO & LISTENING REPORT GRAPH (ANRU FOCUS STYLE)
// ==========================================
function initHolographicStudio() {
  const avatarBtn = document.getElementById('holo-avatar-btn');
  const avatarPicker = document.getElementById('avatar-file-picker');
  const profileImg = document.getElementById('holo-profile-img');

  db.getSetting('user_avatar').then(dataUrl => {
    if (dataUrl && profileImg) profileImg.src = dataUrl;
  });

  avatarBtn?.addEventListener('click', () => avatarPicker?.click());
  avatarPicker?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        if (profileImg) profileImg.src = dataUrl;
        db.setSetting('user_avatar', dataUrl);
        showToast('Profile photo updated ✨');
      };
      reader.readAsDataURL(file);
    }
  });

  document.querySelectorAll('.timeframe-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentStatsTimeframe = e.currentTarget.dataset.timeframe || 'week';
      renderActivityGraph(currentStatsTimeframe);
    });
  });
}

async function renderActivityGraph(timeframe = 'week') {
  const stats = await db.getListeningStats(timeframe);
  const graphData = await db.getActivityGraphData(timeframe);

  const hoursEl = document.getElementById('stat-hours');
  const playsEl = document.getElementById('stat-plays');
  const avgEl = document.getElementById('stat-daily-avg');
  const songsListEl = document.getElementById('stat-top-songs-list');
  const canvas = document.getElementById('activity-graph-canvas');

  if (hoursEl) hoursEl.textContent = `${stats.totalHours}h`;
  if (playsEl) playsEl.textContent = stats.totalPlays;
  if (avgEl) avgEl.textContent = `${stats.dailyAvgMinutes}m`;

  // Draw Activity Graph (Bar Chart like Anru Focus)
  if (canvas && graphData && graphData.length > 0) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const maxMin = Math.max(10, ...graphData.map(d => d.minutes));
    const chartHeight = height - 28;
    const numBars = graphData.length;
    const barWidth = Math.max(12, Math.min(28, (width - (numBars * 10)) / numBars));
    const spacing = (width - (numBars * barWidth)) / (numBars + 1);

    graphData.forEach((d, i) => {
      const barH = Math.max(4, (d.minutes / maxMin) * (chartHeight - 20));
      const x = spacing + i * (barWidth + spacing);
      const y = chartHeight - barH;

      // Glowing Gradient
      const grad = ctx.createLinearGradient(0, chartHeight, 0, y);
      grad.addColorStop(0, 'rgba(168, 85, 247, 0.3)');
      grad.addColorStop(1, '#a855f7');

      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(168, 85, 247, 0.4)';
      ctx.shadowBlur = 6;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      } else {
        ctx.rect(x, y, barWidth, barH);
      }
      ctx.fill();

      // Minute Value Label on top of bar
      ctx.shadowBlur = 0;
      ctx.fillStyle = d.minutes > 0 ? '#fff' : 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 9px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      if (d.minutes > 0) {
        ctx.fillText(`${d.minutes}m`, x + barWidth / 2, y - 4);
      }

      // X-Axis Day/Period Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(d.label, x + barWidth / 2, height - 6);
    });
  }

  // Top 5 Most Played Tracks
  if (!songsListEl) return;
  if (!stats.topSongs || stats.topSongs.length === 0) {
    songsListEl.innerHTML = '<div class="empty-sub">Play your favorite songs to see top rankings here!</div>';
    return;
  }

  songsListEl.innerHTML = '';
  stats.topSongs.forEach((item, idx) => {
    const rankColors = ['#f59e0b', '#94a3b8', '#b45309', 'var(--accent)', 'var(--accent)'];
    const row = document.createElement('div');
    row.className = 'top-track-row';
    row.innerHTML = `
      <div class="top-rank-badge" style="background:${rankColors[idx] || 'var(--accent)'};">#${idx + 1}</div>
      <div class="top-track-meta">
        <div class="top-track-title">${item.title}</div>
        <div class="top-track-artist">${item.artist}</div>
      </div>
      <div class="top-track-plays"><i class="fa-solid fa-play"></i> ${item.count} plays</div>
    `;

    row.addEventListener('click', () => {
      const match = allLibrarySongs.find(s => s.id === item.songId || s.title === item.title);
      if (match) {
        player.playSong(match);
      }
    });

    songsListEl.appendChild(row);
  });
}

// ==========================================
// 12. HOLOGRAPHIC MUSIC WRAPPED CARD
// ==========================================
function initWrappedModal() {
  const openBtn = document.getElementById('open-wrapped-btn');
  const modal = document.getElementById('wrapped-modal');
  const closeBtn = document.getElementById('close-wrapped-btn');
  const downloadBtn = document.getElementById('download-wrapped-btn');

  openBtn?.addEventListener('click', async () => {
    const stats = await db.getListeningStats('year');
    const avatar = await db.getSetting('user_avatar', 'icon-512.png');

    const avatarEl = document.getElementById('wrapped-avatar');
    const hoursEl = document.getElementById('wrapped-hours');
    const playsEl = document.getElementById('wrapped-plays');
    const topSongEl = document.getElementById('wrapped-top-song');
    const topArtistEl = document.getElementById('wrapped-top-artist');

    if (avatarEl) avatarEl.src = avatar;
    if (hoursEl) hoursEl.textContent = `${stats.totalHours}h`;
    if (playsEl) playsEl.textContent = stats.totalPlays;

    if (stats.topSongs && stats.topSongs.length > 0) {
      if (topSongEl) topSongEl.textContent = stats.topSongs[0].title;
      if (topArtistEl) topArtistEl.textContent = `${stats.topSongs[0].artist} • ${stats.topSongs[0].count} Plays`;
    } else {
      if (topSongEl) topSongEl.textContent = 'Keep Listening!';
      if (topArtistEl) topArtistEl.textContent = 'Play your favorite offline tracks';
    }

    if (modal) modal.classList.remove('hidden');
    pushNavState('wrapped');
  });

  closeBtn?.addEventListener('click', () => {
    if (modal) modal.classList.add('hidden');
    if (history.state?.modal === 'wrapped') history.back();
  });

  // Download Wrapped Card as PNG
  downloadBtn?.addEventListener('click', () => {
    renderWrappedPosterToImage();
  });
}

function renderWrappedPosterToImage() {
  try {
    const poster = document.getElementById('wrapped-poster');
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 750;
    const ctx = canvas.getContext('2d');

    // Rich Dark Aurora Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 600, 750);
    bgGrad.addColorStop(0, '#0d0b18');
    bgGrad.addColorStop(0.4, '#1e1435');
    bgGrad.addColorStop(0.7, '#24133d');
    bgGrad.addColorStop(1, '#0d0b18');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 600, 750);

    // Glowing Neon Card Border
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ec4899';
    ctx.shadowBlur = 18;
    ctx.strokeRect(20, 20, 560, 710);
    ctx.shadowBlur = 0;

    // Header
    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('ANRU STUDIO 2026', 45, 65);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('YOUR MUSIC WRAPPED', 45, 120);

    // User name
    const userName = document.getElementById('holo-profile-name')?.textContent || 'Anru VIP Listener';
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(userName, 45, 170);

    // Stats Boxes
    const hours = document.getElementById('wrapped-hours')?.textContent || '0.0h';
    const plays = document.getElementById('wrapped-plays')?.textContent || '0';

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(45, 210, 240, 120);
    ctx.fillRect(315, 210, 240, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(hours, 65, 270);
    ctx.fillText(plays, 335, 270);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('HOURS LISTENED', 65, 305);
    ctx.fillText('TOTAL PLAYS', 335, 305);

    // #1 Hit Song
    const songTitle = document.getElementById('wrapped-top-song')?.textContent || 'No Plays Yet';
    const songArtist = document.getElementById('wrapped-top-artist')?.textContent || '';

    ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.fillRect(45, 370, 510, 160);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('🏆 #1 MOST PLAYED SONG', 70, 410);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(songTitle.slice(0, 30), 70, 455);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(songArtist.slice(0, 35), 70, 495);

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('100% Offline Music Studio Pro • Private & High-Fidelity', 45, 700);

    // Trigger download
    const link = document.createElement('a');
    link.download = `Anru_Music_Wrapped_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('✨ Wrapped Card saved to device!');
  } catch (err) {
    console.warn('Error generating card image:', err);
    showToast('Card saved!');
  }
}

// ==========================================
// 13. THEME ENGINE & HELPERS
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
  window.showCustomPrompt = showCustomPrompt;
  window.showCustomConfirm = showCustomConfirm;
}


