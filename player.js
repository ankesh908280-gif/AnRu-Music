/**
 * ANRU MUSIC - ADVANCED OFFLINE AUDIO PLAYER & STUDIO DSP (player.js)
 * Features:
 * 1. Web Audio API 5-Band Graphic Equalizer + Real Bass Boost
 * 2. Spotify-Style Queue Manager: Play Next, Add to Queue, Reorder (↑/↓), Clear
 * 3. Smart Sleep Timer with smooth volume fade-out
 * 4. Playback Speed Controller (0.75x, 1.0x, 1.25x, 1.5x)
 * 5. Native MediaSession API integration (lockscreen album art & controls)
 */

class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.currentSong = null;
    this.currentObjectUrl = null;
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all'; // 'none', 'all', 'one'
    this.playbackRate = 1.0;

    // Sleep Timer state
    this.sleepTimerId = null;
    this.sleepTimerEndTime = null;
    this.sleepTimerMode = null; // 'minutes' or 'end_of_song'

    // Web Audio DSP (Equalizer & Bass Boost)
    this.audioCtx = null;
    this.sourceNode = null;
    this.bassNode = null;
    this.eqFilters = [];
    this.eqFrequencies = [60, 230, 910, 3600, 14000];
    this.eqGains = [0, 0, 0, 0, 0];
    this.bassBoostGain = 0;

    this.initAudioListeners();
  }

  initAudioListeners() {
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

    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('ended', () => this.onEnded());

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error notice:', e);
      this.isPlaying = false;
      this.updatePlayPauseUI();
      if (typeof showToast === 'function') {
        showToast('⚠️ Could not play audio file format.');
      }
    });

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) this.audio.currentTime = details.seekTime;
        });
      } catch (e) {}
    }
  }

  // Initialize Web Audio API nodes on user gesture
  initWebAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // Create 5-band BiquadFilterNodes
      let prevNode = this.sourceNode;
      this.eqFilters = this.eqFrequencies.map((freq, idx) => {
        const filter = this.audioCtx.createBiquadFilter();
        if (idx === 0) filter.type = 'lowshelf';
        else if (idx === this.eqFrequencies.length - 1) filter.type = 'highshelf';
        else filter.type = 'peaking';

        filter.frequency.value = freq;
        filter.gain.value = this.eqGains[idx] || 0;
        prevNode.connect(filter);
        prevNode = filter;
        return filter;
      });

      // Bass Boost filter (lowshelf at 80Hz)
      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.value = 80;
      this.bassNode.gain.value = this.bassBoostGain || 0;
      prevNode.connect(this.bassNode);

      this.bassNode.connect(this.audioCtx.destination);
      console.log('[Anru Audio] 5-Band Studio Equalizer & Bass Engine Active 🎧');
    } catch (err) {
      console.warn('Web Audio DSP notice:', err);
    }
  }

  // Play a song object (either from audioBlob or URL)
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

    // Revoke previous blob URL to prevent memory leaks
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    // Determine playable source
    if (song.audioBlob) {
      this.currentObjectUrl = URL.createObjectURL(song.audioBlob);
      this.audio.src = this.currentObjectUrl;
    } else if (song.audioUrl) {
      this.audio.src = song.audioUrl;
    } else {
      if (typeof showToast === 'function') showToast(`⚠️ No audio data for "${song.title}"`);
      return;
    }

    this.audio.playbackRate = this.playbackRate;
    if (this.audio && typeof this.audio.load === 'function') this.audio.load();

    // Start playback
    const playPromise = (this.audio && typeof this.audio.play === 'function') ? this.audio.play() : undefined;
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('Playback gesture notice:', err);
      });
    }

    // Initialize Web Audio DSP on first user play
    this.initWebAudio();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.updateTrackUI();
    this.updateMediaSession();
    this.renderQueueDrawer();
  }

  togglePlay() {
    if (!this.currentSong) {
      if (this.queue.length > 0) this.playSong(this.queue[0]);
      return;
    }

    if (this.audio.paused) {
      this.audio.play().catch(() => {});
      if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
    } else {
      this.audio.pause();
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
      else return; // Stop at end of queue
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
    // If sleep timer set to end of song, pause now
    if (this.sleepTimerMode === 'end_of_song') {
      this.audio.pause();
      this.cancelSleepTimer();
      if (typeof showToast === 'function') showToast('🌙 Sleep timer: playback paused.');
      return;
    }

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
    if (curTimeEl) curTimeEl.textContent = this.formatTime(cur);
    if (durTimeEl) durTimeEl.textContent = this.formatTime(dur);
  }

  seek(percentage) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percentage / 100) * this.audio.duration;
  }

  setVolume(val) {
    this.audio.volume = Math.max(0, Math.min(1, val));
  }

  setSpeed(rate) {
    this.playbackRate = rate;
    this.audio.playbackRate = rate;
    const speedBtn = document.getElementById('fs-speed-btn');
    if (speedBtn) speedBtn.textContent = `${rate}x`;
    if (typeof showToast === 'function') showToast(`Speed: ${rate}x`);
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const btn = document.getElementById('fs-shuffle-btn');
    if (btn) btn.classList.toggle('active', this.isShuffle);
    if (typeof showToast === 'function') showToast(this.isShuffle ? 'Shuffle: ON 🔀' : 'Shuffle: OFF');
  }

  toggleRepeat() {
    const btn = document.getElementById('fs-repeat-btn');
    if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
      if (btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fa-solid fa-repeat"></i><span class="repeat-one-sub">1</span>'; }
      if (typeof showToast === 'function') showToast('Repeat: Current Track 🔂');
    } else if (this.repeatMode === 'one') {
      this.repeatMode = 'none';
      if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; }
      if (typeof showToast === 'function') showToast('Repeat: OFF');
    } else {
      this.repeatMode = 'all';
      if (btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; }
      if (typeof showToast === 'function') showToast('Repeat: All 🔁');
    }
  }

  // ==========================================
  // SPOTIFY-STYLE QUEUE MANAGEMENT
  // ==========================================

  // Play Next: insert right after current song
  playNext(song) {
    if (!song) return;
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      this.queue.splice(this.currentIndex + 1, 0, song);
    } else {
      this.queue.push(song);
    }
    this.renderQueueDrawer();
    if (typeof showToast === 'function') showToast(`Playing next: "${song.title}" ⏭️`);
  }

  // Add to bottom of queue
  addToQueue(song) {
    if (!song) return;
    this.queue.push(song);
    this.renderQueueDrawer();
    if (typeof showToast === 'function') showToast(`Added to queue: "${song.title}" 🎶`);
  }

  // Reorder queue: move song from one index to another
  moveQueueItem(fromIndex, direction) {
    const toIndex = fromIndex + direction;
    if (toIndex < this.currentIndex + 1 || toIndex >= this.queue.length) return;

    const item = this.queue.splice(fromIndex, 1)[0];
    this.queue.splice(toIndex, 0, item);
    this.renderQueueDrawer();
  }

  // Remove song from queue
  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.currentIndex) {
      this.next();
    }
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this.renderQueueDrawer();
  }

  // Clear upcoming songs in queue
  clearUpcomingQueue() {
    if (this.currentIndex >= 0) {
      this.queue = this.queue.slice(0, this.currentIndex + 1);
    } else {
      this.queue = [];
    }
    this.renderQueueDrawer();
    if (typeof showToast === 'function') showToast('Upcoming queue cleared 🧹');
  }

  // Render Queue Drawer with Spotify-style reorder buttons
  renderQueueDrawer() {
    const nowBox = document.getElementById('queue-now-playing');
    const upList = document.getElementById('queue-upcoming-list');
    if (!nowBox || !upList) return;

    if (this.currentSong) {
      nowBox.innerHTML = `
        <img src="${this.currentSong.artwork || 'icon-512.png'}" alt="art" class="queue-thumb" onerror="this.src='icon-512.png'">
        <div class="queue-info">
          <div class="queue-title">${this.currentSong.title}</div>
          <div class="queue-artist">${this.currentSong.artist}</div>
        </div>
        <div class="queue-playing-tag"><i class="fa-solid fa-volume-high"></i> PLAYING</div>
      `;
    } else {
      nowBox.innerHTML = '<div class="empty-sub">No track actively playing</div>';
    }

    const upcoming = this.queue.slice(this.currentIndex + 1);
    if (upcoming.length === 0) {
      upList.innerHTML = '<div class="empty-sub">No upcoming tracks in queue</div>';
      return;
    }

    upList.innerHTML = '';
    upcoming.forEach((song, idx) => {
      const realIdx = this.currentIndex + 1 + idx;
      const item = document.createElement('div');
      item.className = 'queue-row';
      item.innerHTML = `
        <span class="queue-num">${idx + 1}</span>
        <img src="${song.artwork || 'icon-512.png'}" alt="art" class="queue-row-thumb" onerror="this.src='icon-512.png'">
        <div class="queue-row-info">
          <div class="queue-row-title">${song.title}</div>
          <div class="queue-row-artist">${song.artist}</div>
        </div>
        <div class="queue-row-actions">
          <button class="queue-move-btn" title="Move Up" data-action="up" data-index="${realIdx}" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="queue-move-btn" title="Move Down" data-action="down" data-index="${realIdx}" ${idx === upcoming.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="queue-remove-btn" title="Remove" data-action="remove" data-index="${realIdx}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;

      item.querySelector('[data-action="up"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveQueueItem(realIdx, -1);
      });
      item.querySelector('[data-action="down"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveQueueItem(realIdx, 1);
      });
      item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(realIdx);
      });

      item.addEventListener('click', () => {
        this.playSong(song);
      });

      upList.appendChild(item);
    });
  }

  // ==========================================
  // SLEEP TIMER ENGINE
  // ==========================================
  startSleepTimer(minutes) {
    this.cancelSleepTimer();

    if (minutes === 'end_of_song') {
      this.sleepTimerMode = 'end_of_song';
      if (typeof showToast === 'function') showToast('🌙 Sleep timer: stops after current song');
      this.updateSleepTimerUI();
      return;
    }

    const mins = parseInt(minutes, 10);
    if (isNaN(mins) || mins <= 0) return;

    this.sleepTimerMode = 'minutes';
    this.sleepTimerEndTime = Date.now() + mins * 60 * 1000;

    // Check timer every second
    this.sleepTimerId = setInterval(() => {
      const remaining = Math.max(0, this.sleepTimerEndTime - Date.now());
      this.updateSleepTimerUI(remaining);

      // Start fade out in last 10 seconds
      if (remaining <= 10000 && remaining > 0) {
        const factor = remaining / 10000;
        this.audio.volume = Math.max(0, factor);
      }

      if (remaining <= 0) {
        this.audio.pause();
        this.cancelSleepTimer();
        this.audio.volume = 1.0;
        if (typeof showToast === 'function') showToast('🌙 Sleep timer completed. Good night!');
      }
    }, 1000);

    if (typeof showToast === 'function') showToast(`🌙 Sleep timer set for ${mins} minutes`);
    this.updateSleepTimerUI(mins * 60 * 1000);
  }

  cancelSleepTimer() {
    if (this.sleepTimerId) {
      clearInterval(this.sleepTimerId);
      this.sleepTimerId = null;
    }
    this.sleepTimerEndTime = null;
    this.sleepTimerMode = null;
    this.audio.volume = 1.0;
    this.updateSleepTimerUI(0);
  }

  updateSleepTimerUI(remainingMs = 0) {
    const badge = document.getElementById('sleep-timer-badge');
    const statusText = document.getElementById('sleep-timer-status');
    const timerBtn = document.getElementById('fs-sleep-btn');

    if (!this.sleepTimerMode) {
      if (badge) badge.classList.add('hidden');
      if (statusText) statusText.textContent = 'Timer is off';
      if (timerBtn) timerBtn.classList.remove('active');
      return;
    }

    if (timerBtn) timerBtn.classList.add('active');

    if (this.sleepTimerMode === 'end_of_song') {
      if (badge) { badge.classList.remove('hidden'); badge.textContent = 'End of Song'; }
      if (statusText) statusText.textContent = 'Stops after current song finishes';
    } else {
      const totalSec = Math.floor(remainingMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
      if (badge) { badge.classList.remove('hidden'); badge.textContent = timeStr; }
      if (statusText) statusText.textContent = `Stopping in ${timeStr}`;
    }
  }

  // ==========================================
  // 5-BAND EQUALIZER & BASS BOOST
  // ==========================================
  setEQGain(bandIndex, gainVal) {
    this.eqGains[bandIndex] = gainVal;
    if (this.eqFilters[bandIndex]) {
      this.eqFilters[bandIndex].gain.value = gainVal;
    }
    if (typeof db !== 'undefined') {
      db.setSetting('eq_gains', this.eqGains);
    }
  }

  setBassBoost(gainVal) {
    this.bassBoostGain = gainVal;
    if (this.bassNode) {
      this.bassNode.gain.value = gainVal;
    }
    if (typeof db !== 'undefined') {
      db.setSetting('bass_boost', gainVal);
    }
  }

  applyEQPreset(presetName) {
    const presets = {
      flat: [0, 0, 0, 0, 0],
      bass_boost: [6, 4, 1, 0, 1],
      dance: [5, 3, 0, 2, 4],
      vocal: [-2, 1, 5, 3, 0],
      rock: [4, 2, -1, 3, 5]
    };

    const gains = presets[presetName] || presets.flat;
    gains.forEach((g, idx) => {
      this.setEQGain(idx, g);
      const slider = document.getElementById(`eq-band-${idx}`);
      if (slider) slider.value = g;
      const valLabel = document.getElementById(`eq-val-${idx}`);
      if (valLabel) valLabel.textContent = `${g > 0 ? '+' : ''}${g}dB`;
    });

    if (typeof showToast === 'function') showToast(`Equalizer: ${presetName.toUpperCase()}`);
  }

  // ==========================================
  // UI & MEDIASESSION SYNCHRONIZATION
  // ==========================================
  updateTrackUI() {
    if (!this.currentSong) return;
    const song = this.currentSong;

    const miniPlayer = document.getElementById('mini-player');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniThumb = document.getElementById('mini-thumb');

    if (miniPlayer) miniPlayer.classList.remove('hidden');
    if (miniTitle) miniTitle.textContent = song.title;
    if (miniArtist) miniArtist.textContent = song.artist;
    if (miniThumb) miniThumb.src = song.artwork || 'icon-512.png';

    const fsTitle = document.getElementById('fs-title');
    const fsArtist = document.getElementById('fs-artist');
    const fsAlbum = document.getElementById('fs-header-album');
    const fsArt = document.getElementById('fs-artwork');

    if (fsTitle) fsTitle.textContent = song.title;
    if (fsArtist) fsArtist.textContent = song.artist;
    if (fsAlbum) fsAlbum.textContent = song.album || 'Local Studio';
    if (fsArt) fsArt.src = song.artwork || 'icon-512.png';

    this.updatePlayPauseUI();

    // Check favorite status
    if (typeof db !== 'undefined') {
      db.isFavorite(song.id).then(isFav => {
        const likeBtn = document.getElementById('fs-like-btn');
        if (likeBtn) {
          likeBtn.classList.toggle('active', isFav);
          likeBtn.innerHTML = isFav 
            ? '<i class="fa-solid fa-heart" style="color:#ec4899;"></i>' 
            : '<i class="fa-regular fa-heart"></i>';
        }
      });
    }
  }

  updatePlayPauseUI() {
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const fsPlayIcon = document.getElementById('fs-play-icon');
    const miniPlayer = document.getElementById('mini-player');
    const vinylBox = document.getElementById('fs-vinyl-box');

    if (this.isPlaying) {
      if (miniPlayIcon) { miniPlayIcon.classList.remove('fa-play'); miniPlayIcon.classList.add('fa-pause'); }
      if (fsPlayIcon) { fsPlayIcon.classList.remove('fa-play'); fsPlayIcon.classList.add('fa-pause'); }
      if (miniPlayer) miniPlayer.classList.add('playing');
      if (vinylBox) vinylBox.classList.add('rotating');
    } else {
      if (miniPlayIcon) { miniPlayIcon.classList.remove('fa-pause'); miniPlayIcon.classList.add('fa-play'); }
      if (fsPlayIcon) { fsPlayIcon.classList.remove('fa-pause'); fsPlayIcon.classList.add('fa-play'); }
      if (miniPlayer) miniPlayer.classList.remove('playing');
      if (vinylBox) vinylBox.classList.remove('rotating');
    }
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.currentSong) return;
    const song = this.currentSong;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album || 'Anru Studio',
        artwork: [
          { src: song.artwork || 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) {}
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
}

// Global Player Instance
const player = new AudioPlayer();
if (typeof window !== 'undefined') window.player = player;
if (typeof globalThis !== 'undefined') globalThis.player = player;
