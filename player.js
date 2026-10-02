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

  async playSong(song, newQueue = null) {
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

    // Immediately update UI so mini player & fullscreen player display track info
    this.updateTrackUI();
    this.updateMediaSession();
    renderQueueDrawer();

    // Check if audioUrl is missing or is SoundHelix/30s preview
    const needsFullStream = !song.audioUrl ||
      song.audioUrl.includes('soundhelix') ||
      song.audioUrl.includes('audio-ssl.itunes.apple.com');

    if (needsFullStream && typeof window.resolveFullSongAudio === 'function') {
      if (typeof showToast === 'function') {
        showToast(`Loading "${song.title}" from JioSaavn HD... 🎵`);
      }
      try {
        const fullStream = await window.resolveFullSongAudio(song.title, song.artist);
        if (fullStream) {
          song.audioUrl = fullStream;
          console.log('[Anru Audio Engine] Resolved full stream from JioSaavn/YT:', fullStream);
        }
      } catch (err) {
        console.warn('Real audio resolution error:', err);
      }
    }

    if (song.audioUrl) {
      this.audio.src = song.audioUrl;
      if (this.audio && typeof this.audio.load === "function") this.audio.load();

      const playPromise = (this.audio && typeof this.audio.play === "function") ? this.audio.play() : undefined;
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('Auto-play notice:', err);
        });
      }
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

    if (typeof generateSmartSuggestions === "function") generateSmartSuggestions(song);
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
        : '<i class="fa-solid fa-download"></i>';
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


// Playback UI Utilities
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

function renderQueueDrawer() {
  const nowBox = document.getElementById('queue-now-playing');
  const upList = document.getElementById('queue-upcoming-list');
  if (!nowBox || !upList) return;

  if (player.currentSong) {
    nowBox.innerHTML = `
      <img src="${player.currentSong.artwork || player.currentSong.image || 'icon-512.png'}" alt="art" class="queue-thumb" onerror="this.src='icon-512.png'">
      <div class="queue-info">
        <div class="queue-title">${player.currentSong.title}</div>
        <div class="queue-artist">${player.currentSong.artist}</div>
      </div>
      <div class="queue-playing-tag"><i class="fa-solid fa-volume-high"></i> PLAYING</div>
    `;
  } else {
    nowBox.innerHTML = '<div class="empty-sub">No track actively playing</div>';
  }

  const upcoming = player.queue.slice(player.currentIndex + 1);
  upList.innerHTML = '';

  if (upcoming.length === 0) {
    upList.innerHTML = '<div class="empty-sub">No upcoming tracks in queue</div>';
    return;
  }

  upcoming.forEach((song, idx) => {
    const realIdx = player.currentIndex + 1 + idx;
    const item = document.createElement('div');
    item.className = 'queue-row';
    item.innerHTML = `
      <span class="queue-num">${idx + 1}</span>
      <img src="${song.artwork || song.image || 'icon-512.png'}" alt="art" class="queue-row-thumb" onerror="this.src='icon-512.png'">
      <div class="queue-row-info">
        <div class="queue-row-title">${song.title}</div>
        <div class="queue-row-artist">${song.artist}</div>
      </div>
      <button class="queue-remove-btn" title="Remove" data-index="${realIdx}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    const rmBtn = item.querySelector('.queue-remove-btn');
    if (rmBtn) {
      rmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.removeFromQueue(realIdx);
      });
    }

    item.addEventListener('click', () => {
      player.currentIndex = realIdx;
      player.playSong(song);
    });

    upList.appendChild(item);
  });
}


function generateSmartSuggestions(currentSong) {
  try {
    if (typeof CURATED_FULL_CATALOG === 'undefined' || !currentSong) return;
    const sameCat = CURATED_FULL_CATALOG.filter(s => s.id !== currentSong.id && s.category === currentSong.category);
    if (player.queue.length <= 1 && sameCat.length > 0) {
      const moreTracks = sameCat.slice(0, 3);
      moreTracks.forEach(t => player.queue.push(t));
      renderQueueDrawer();
    }
  } catch (err) {
    console.warn('generateSmartSuggestions notice:', err);
  }
}

// Global Exports
const playerExports = {
  PlayerController,
  player,
  formatTime,
  formatDuration,
  showToast,
  renderQueueDrawer
};

if (typeof window !== 'undefined') {
  Object.assign(window, playerExports);
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, playerExports);
}
