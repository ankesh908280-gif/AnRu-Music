/**
 * ANRU MUSIC - ZERO-LATENCY AUDIO PLAYER & QUEUE ENGINE
 * Supports MediaSession, Spotify-style Up Next Queue, Offline Streams
 */

class PlayerController {
  constructor() {
    this.audio = document.getElementById('main-audio') || new Audio();
    this.currentSong = null;
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'none'; // 'none' | 'all' | 'one'
    this.currentObjectUrl = null;

    this.bindEvents();
  }

  bindEvents() {
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });
    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });
    this.audio.addEventListener('error', (e) => {
      console.warn('Audio stream fallback notice:', e);
      setTimeout(() => this.next(), 1000);
    });

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime && this.audio.duration) {
            this.audio.currentTime = details.seekTime;
          }
        });
      } catch(e) {}
    }
  }

  playSong(song, newQueue = null) {
    if (!song) return;

    if (newQueue && Array.isArray(newQueue)) {
      this.queue = [...newQueue];
      this.currentIndex = this.queue.findIndex(s => s.id === song.id);
    } else if (!this.queue.some(s => s.id === song.id)) {
      this.queue.push(song);
      this.currentIndex = this.queue.length - 1;
    } else {
      this.currentIndex = this.queue.findIndex(s => s.id === song.id);
    }

    this.currentSong = song;

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    this.audio.src = song.audioUrl;
    if (this.audio && typeof this.audio.load === "function") this.audio.load();

    const playPromise = (this.audio && typeof this.audio.play === "function") ? this.audio.play() : undefined;
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('Auto-play notice:', err);
      });
    }

    // Check offline storage
    if (typeof db !== 'undefined') {
      db.getDownload(song.id).then(downloaded => {
        if (downloaded && downloaded.audioBlob) {
          this.currentObjectUrl = URL.createObjectURL(downloaded.audioBlob);
          this.audio.src = this.currentObjectUrl;
          this.audio.play().catch(() => {});
          showToast('Playing from offline storage ⚡');
        }
      }).catch(() => {});
    }

    this.updateTrackUI();
    this.updateMediaSession();
    renderQueueDrawer();
    generateSmartSuggestions(song);
  }

  togglePlay() {
    if (!this.currentSong) {
      if (this.queue.length > 0) this.playSong(this.queue[0]);
      else if (typeof CURATED_FULL_CATALOG !== 'undefined' && CURATED_FULL_CATALOG.length > 0) {
        this.playSong(CURATED_FULL_CATALOG[0], CURATED_FULL_CATALOG);
      }
      return;
    }

    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      if (this.audio && typeof this.audio.pause === "function") this.audio.pause();
    }
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.isShuffle) {
      const nextIndex = Math.floor(Math.random() * this.queue.length);
      this.playSong(this.queue[nextIndex]);
      return;
    }

    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all') nextIndex = 0;
      else return;
    }
    this.playSong(this.queue[nextIndex]);
  }

  previous() {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) prevIndex = this.queue.length - 1;
    this.playSong(this.queue[prevIndex]);
  }

  onEnded() {
    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    } else {
      this.next();
    }
  }

  onTimeUpdate() {
    const cur = this.audio.currentTime || 0;
    const dur = this.audio.duration || this.currentSong?.duration || 1;
    const pct = (cur / dur) * 100;

    const miniFill = document.getElementById('mini-progress-fill');
    if (miniFill) miniFill.style.width = `${pct}%`;

    const seekSlider = document.getElementById('fs-seek-slider');
    if (seekSlider && !seekSlider.matches(':active')) {
      seekSlider.value = pct;
    }

    const curTimeEl = document.getElementById('fs-curr-time');
    const durTimeEl = document.getElementById('fs-duration');
    if (curTimeEl) curTimeEl.textContent = formatTime(cur);
    if (durTimeEl) durTimeEl.textContent = formatTime(dur);
  }

  seek(percentage) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percentage / 100) * this.audio.duration;
  }

  setVolume(val) {
    this.audio.volume = Math.max(0, Math.min(1, val));
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const btn = document.getElementById('fs-shuffle-btn');
    if (btn) btn.classList.toggle('active', this.isShuffle);
    showToast(this.isShuffle ? 'Shuffle Turned ON' : 'Shuffle Turned OFF');
  }

  toggleRepeat() {
    const btn = document.getElementById('fs-repeat-btn');
    if (!btn) return;
    if (this.repeatMode === 'none') {
      this.repeatMode = 'all';
      btn.classList.add('active');
      showToast('Repeat: All Tracks');
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
      btn.classList.add('active');
      showToast('Repeat: Current Song');
    } else {
      this.repeatMode = 'none';
      btn.classList.remove('active');
      showToast('Repeat: OFF');
    }
  }

  updatePlayPauseUI() {
    const miniIcon = document.getElementById('mini-play-icon');
    const fsIcon = document.getElementById('fs-play-icon');
    const eq = document.getElementById('mini-equalizer');

    if (this.isPlaying) {
      if (miniIcon) miniIcon.className = 'fa-solid fa-pause';
      if (fsIcon) fsIcon.className = 'fa-solid fa-pause';
      if (eq) eq.classList.add('active');
    } else {
      if (miniIcon) miniIcon.className = 'fa-solid fa-play';
      if (fsIcon) fsIcon.className = 'fa-solid fa-play';
      if (eq) eq.classList.remove('active');
    }

    const art = document.getElementById('artwork-wrapper');
    if (art) {
      art.style.transform = this.isPlaying ? 'scale(1.04)' : 'scale(1)';
    }

    document.querySelectorAll('.song-item').forEach(el => {
      if (el.dataset.id === this.currentSong?.id) el.classList.add('playing');
      else el.classList.remove('playing');
    });
  }

  async updateTrackUI() {
    if (!this.currentSong) return;
    const song = this.currentSong;

    const miniPlayer = document.getElementById('mini-player');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniThumb = document.getElementById('mini-thumb');

    if (miniPlayer) miniPlayer.classList.remove('hidden');
    if (miniTitle) miniTitle.textContent = song.title;
    if (miniArtist) miniArtist.textContent = song.artist;
    if (miniThumb) miniThumb.src = song.image;

    const fsTitle = document.getElementById('fs-title');
    const fsArtist = document.getElementById('fs-artist');
    const fsAlbum = document.getElementById('fs-header-album');
    const fsArt = document.getElementById('fs-artwork');

    if (fsTitle) fsTitle.textContent = song.title;
    if (fsArtist) fsArtist.textContent = song.artist;
    if (fsAlbum) fsAlbum.textContent = song.album || 'Anru Studio';
    if (fsArt) fsArt.src = song.image;

    let isFav = false;
    let isDl = false;
    if (typeof db !== 'undefined') {
      isFav = await db.isFavorite(song.id);
      isDl = !!(await db.getDownload(song.id));
    }

    this.updateLikeBtnUI(isFav);
    this.updateDownloadBtnUI(isDl);
    this.updatePlayPauseUI();
  }

  updateLikeBtnUI(isFav) {
    const fsLike = document.getElementById('fs-like-btn');
    if (fsLike) {
      fsLike.innerHTML = isFav 
        ? '<i class="fa-solid fa-heart" style="color:#ec4899"></i>' 
        : '<i class="fa-regular fa-heart"></i>';
    }
  }

  updateDownloadBtnUI(isDl) {
    const fsDl = document.getElementById('fs-download-btn');
    if (fsDl) {
      fsDl.innerHTML = isDl
        ? '<i class="fa-solid fa-circle-check" style="color:#10b981"></i>'
        : '<i class="fa-solid fa-arrow-down-to-bracket"></i>';
      fsDl.title = isDl ? 'Downloaded' : 'Download Offline';
    }
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.currentSong) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentSong.title,
        artist: this.currentSong.artist,
        album: this.currentSong.album,
        artwork: [
          { src: this.currentSong.image, sizes: '96x96', type: 'image/png' },
          { src: this.currentSong.image, sizes: '192x192', type: 'image/png' },
          { src: this.currentSong.image, sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch(e) {}
  }

  playNext(song) {
    if (this.currentIndex === -1) {
      this.playSong(song);
      return;
    }
    this.queue.splice(this.currentIndex + 1, 0, song);
    renderQueueDrawer();
    showToast(`"${song.title}" will play next!`);
  }

  addToQueue(song) {
    this.queue.push(song);
    renderQueueDrawer();
    showToast(`Added "${song.title}" to queue`);
  }

  removeFromQueue(index) {
    if (index === this.currentIndex) this.next();
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    renderQueueDrawer();
  }

  moveQueueItem(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    const item = this.queue.splice(fromIndex, 1)[0];
    this.queue.splice(toIndex, 0, item);
    if (fromIndex === this.currentIndex) this.currentIndex = toIndex;
    else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) this.currentIndex--;
    else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) this.currentIndex++;
    renderQueueDrawer();
  }

  clearUpcomingQueue() {
    if (this.currentIndex !== -1) {
      this.queue = this.queue.slice(0, this.currentIndex + 1);
    } else {
      this.queue = [];
    }
    renderQueueDrawer();
    showToast('Upcoming queue cleared');
  }
}

const player = new PlayerController();

// UI Helpers
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatDuration(seconds) {
  return formatTime(seconds);
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  const text = toast.querySelector('.toast-text');
  if (text) text.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2400);
}

function renderSongItem(song, container, options = {}) {
  const item = document.createElement('div');
  item.className = 'song-item';
  item.dataset.id = song.id;

  if (player.currentSong?.id === song.id) {
    item.classList.add('playing');
  }

  item.innerHTML = `
    <img src="${song.image}" alt="art" class="song-item-thumb" loading="lazy" onerror="this.src='icon-512.png'">
    <div class="song-item-info">
      <div class="song-item-title">${song.title}</div>
      <div class="song-item-artist">${song.artist} • ${formatTime(song.duration)}</div>
    </div>
    <div class="song-item-actions">
      <button class="item-act-btn btn-dots" title="More Options" data-id="${song.id}">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
      <button class="item-act-btn btn-like" title="Favorite" data-id="${song.id}">
        <i class="fa-regular fa-heart"></i>
      </button>
    </div>
  `;

  if (typeof db !== 'undefined') {
    db.isFavorite(song.id).then(fav => {
      if (fav) {
        const likeBtn = item.querySelector('.btn-like');
        if (likeBtn) {
          likeBtn.classList.add('liked');
          likeBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        }
      }
    }).catch(() => {});
  }

  item.addEventListener('click', (e) => {
    if (e.target.closest('.item-act-btn')) return;
    player.playSong(song, options.queue);
  });

  const dotsBtn = item.querySelector('.btn-dots');
  if (dotsBtn) {
    dotsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openActionSheet(song);
    });
  }

  const likeBtn = item.querySelector('.btn-like');
  if (likeBtn) {
    likeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (typeof db !== 'undefined') {
        const isNowFav = await db.toggleFavorite(song);
        likeBtn.classList.toggle('liked', isNowFav);
        likeBtn.innerHTML = isNowFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
        showToast(isNowFav ? 'Added to Liked Songs' : 'Removed from Liked Songs');
        if (player.currentSong?.id === song.id) {
          player.updateLikeBtnUI(isNowFav);
        }
        loadFavoritesView();
      }
    });
  }

  container.appendChild(item);
}

function renderMusicCard(song, container, queue) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.dataset.id = song.id;
  card.innerHTML = `
    <div class="card-img-wrapper">
      <img src="${song.image}" alt="art" class="card-img" loading="lazy" onerror="this.src='icon-512.png'">
      <button class="card-play-btn" aria-label="Play">
        <i class="fa-solid fa-play"></i>
      </button>
    </div>
    <div class="card-title">${song.title}</div>
    <div class="card-artist">${song.artist}</div>
  `;

  card.addEventListener('click', () => {
    player.playSong(song, queue);
  });

  container.appendChild(card);
}

async function handleDownload(song) {
  if (typeof db === 'undefined') return;
  const isDl = await db.getDownload(song.id);
  if (isDl) {
    if (confirm(`Remove "${song.title}" from offline downloads?`)) {
      await db.deleteDownload(song.id);
      showToast('Removed from offline downloads');
      updateDownloadBadge();
      loadDownloadsView();
      if (player.currentSong?.id === song.id) player.updateDownloadBtnUI(false);
    }
    return;
  }

  showToast(`Downloading full track "${song.title}"...`);
  try {
    const audioRes = await fetch(song.audioUrl);
    if (!audioRes.ok) throw new Error('Audio download failed');
    const audioBlob = await audioRes.blob();

    await db.saveDownload(song, audioBlob);
    showToast(`"${song.title}" saved offline!`);
    updateDownloadBadge();
    loadDownloadsView();
    if (player.currentSong?.id === song.id) player.updateDownloadBtnUI(true);
  } catch (err) {
    console.warn('Download notice:', err);
    showToast('Download notice: Ready for streaming.');
  }
}

async function updateDownloadBadge() {
  if (typeof db === 'undefined') return;
  const dls = await db.getAllDownloads();
  const count = dls.length;
  const badge = document.getElementById('downloads-badge');
  const countInfo = document.getElementById('download-count-badge');
  const profileStorage = document.getElementById('profile-storage-text');

  if (count > 0) {
    if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }
    if (countInfo) countInfo.textContent = `${count} track${count > 1 ? 's' : ''} saved`;
    if (profileStorage) profileStorage.textContent = `${count} tracks stored offline`;
  } else {
    if (badge) badge.classList.add('hidden');
    if (countInfo) countInfo.textContent = '0 tracks saved';
    if (profileStorage) profileStorage.textContent = '0 tracks saved offline';
  }
}

async function loadDownloadsView() {
  if (typeof db === 'undefined') return;
  const dls = await db.getAllDownloads();
  const container = document.getElementById('downloaded-songs-list');
  if (!container) return;
  container.innerHTML = '';

  if (dls.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-arrow-down-to-bracket empty-icon"></i>
        <h4>Koi song download nahi hai</h4>
        <p>Kisi bhi song ke three dots (...) par click karein aur yahan offline sunein.</p>
      </div>
    `;
    return;
  }

  dls.forEach(song => renderSongItem(song, container, { queue: dls }));
}

async function loadFavoritesView() {
  if (typeof db === 'undefined') return;
  const favs = await db.getAllFavorites();
  const container = document.getElementById('favorite-songs-list');
  if (!container) return;
  container.innerHTML = '';

  if (favs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-heart empty-icon"></i>
        <h4>Abhi tak koi favorite nahi hai</h4>
        <p>Gaane pasand aane par Heart icon dabayein.</p>
      </div>
    `;
    return;
  }

  favs.forEach(song => renderSongItem(song, container, { queue: favs }));
}

let activeSheetSong = null;

function openActionSheet(song) {
  activeSheetSong = song;
  const overlay = document.getElementById('action-sheet-overlay');
  const thumb = document.getElementById('sheet-song-thumb');
  const title = document.getElementById('sheet-song-title');
  const artist = document.getElementById('sheet-song-artist');

  if (thumb) thumb.src = song.image;
  if (title) title.textContent = song.title;
  if (artist) artist.textContent = song.artist;
  if (overlay) overlay.classList.remove('hidden');
}

function closeActionSheet() {
  const overlay = document.getElementById('action-sheet-overlay');
  if (overlay) overlay.classList.add('hidden');
  activeSheetSong = null;
}

function renderQueueDrawer() {
  const nowBox = document.getElementById('queue-now-playing');
  const upList = document.getElementById('queue-upcoming-list');
  if (!nowBox || !upList) return;

  if (player.currentSong) {
    nowBox.innerHTML = `
      <img src="${player.currentSong.image}" alt="art" class="queue-item-thumb" onerror="this.src='icon-512.png'">
      <div class="queue-item-info">
        <div class="queue-item-title">${player.currentSong.title}</div>
        <div class="queue-item-artist">${player.currentSong.artist}</div>
      </div>
      <span style="font-size:11px;font-weight:700;color:var(--accent);">PLAYING</span>
    `;
  } else {
    nowBox.innerHTML = '<span class="queue-empty-text">No active song playing</span>';
  }

  upList.innerHTML = '';
  const upcoming = player.queue.slice(player.currentIndex + 1);

  if (upcoming.length === 0) {
    upList.innerHTML = '<span class="queue-empty-text">Queue is empty. Use 3-dot menu on any song to add!</span>';
    return;
  }

  upcoming.forEach((song, relativeIndex) => {
    const actualIndex = player.currentIndex + 1 + relativeIndex;
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.innerHTML = `
      <img src="${song.image}" alt="art" class="queue-item-thumb" onerror="this.src='icon-512.png'">
      <div class="queue-item-info">
        <div class="queue-item-title">${song.title}</div>
        <div class="queue-item-artist">${song.artist}</div>
      </div>
      <div class="queue-item-actions">
        <button class="queue-ctrl-btn btn-up" title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
        <button class="queue-ctrl-btn btn-down" title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
        <button class="queue-ctrl-btn btn-del" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.queue-ctrl-btn')) return;
      player.playSong(song);
    });

    const upBtn = item.querySelector('.btn-up');
    if (upBtn) {
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actualIndex > player.currentIndex + 1) player.moveQueueItem(actualIndex, actualIndex - 1);
      });
    }

    const downBtn = item.querySelector('.btn-down');
    if (downBtn) {
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actualIndex < player.queue.length - 1) player.moveQueueItem(actualIndex, actualIndex + 1);
      });
    }

    const delBtn = item.querySelector('.btn-del');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.removeFromQueue(actualIndex);
      });
    }

    upList.appendChild(item);
  });
}

function generateSmartSuggestions(currentSong) {
  const container = document.getElementById('fs-suggestions-list');
  if (!container || typeof CURATED_FULL_CATALOG === 'undefined') return;
  container.innerHTML = '';

  const similar = CURATED_FULL_CATALOG
    .filter(s => s.id !== currentSong.id && (s.category === currentSong.category || s.artist.includes(currentSong.artist)))
    .slice(0, 4);

  const pool = similar.length > 0 ? similar : CURATED_FULL_CATALOG.filter(s => s.id !== currentSong.id).slice(0, 4);

  pool.forEach(song => {
    const row = document.createElement('div');
    row.className = 'song-item';
    row.innerHTML = `
      <img src="${song.image}" alt="art" class="song-item-thumb" onerror="this.src='icon-512.png'">
      <div class="song-item-info">
        <div class="song-item-title">${song.title}</div>
        <div class="song-item-artist">${song.artist}</div>
      </div>
      <button class="item-act-btn btn-add" title="Add to Queue"><i class="fa-solid fa-plus"></i></button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-add')) return;
      player.playSong(song);
    });

    const addBtn = row.querySelector('.btn-add');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.addToQueue(song);
      });
    }

    container.appendChild(row);
  });
}

if (typeof window !== 'undefined') {
  window.player = player;
  window.formatTime = formatTime;
  window.showToast = showToast;
  window.renderSongItem = renderSongItem;
  window.renderMusicCard = renderMusicCard;
  window.handleDownload = handleDownload;
  window.updateDownloadBadge = updateDownloadBadge;
  window.loadDownloadsView = loadDownloadsView;
  window.loadFavoritesView = loadFavoritesView;
  window.openActionSheet = openActionSheet;
  window.closeActionSheet = closeActionSheet;
  window.renderQueueDrawer = renderQueueDrawer;
  window.generateSmartSuggestions = generateSmartSuggestions;
}
if (typeof globalThis !== 'undefined') {
  globalThis.player = player;
  globalThis.formatTime = formatTime;
  globalThis.showToast = showToast;
  globalThis.renderSongItem = renderSongItem;
  globalThis.renderMusicCard = renderMusicCard;
  globalThis.handleDownload = handleDownload;
  globalThis.updateDownloadBadge = updateDownloadBadge;
  globalThis.loadDownloadsView = loadDownloadsView;
  globalThis.loadFavoritesView = loadFavoritesView;
  globalThis.openActionSheet = openActionSheet;
  globalThis.closeActionSheet = closeActionSheet;
  globalThis.renderQueueDrawer = renderQueueDrawer;
  globalThis.generateSmartSuggestions = generateSmartSuggestions;
}

if (typeof window !== 'undefined') {
  window.player = player;
  window.formatTime = formatTime;
  window.formatDuration = formatDuration;
  window.showToast = showToast;
  window.renderQueueDrawer = renderQueueDrawer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.player = player;
  globalThis.formatTime = formatTime;
  globalThis.formatDuration = formatDuration;
  globalThis.showToast = showToast;
  globalThis.renderQueueDrawer = renderQueueDrawer;
}
