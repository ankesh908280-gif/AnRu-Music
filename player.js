/**
 * ANRU MUSIC STUDIO PRO v16 - ADVANCED OFFLINE AUDIO PLAYER & STUDIO DSP (player.js)
 * 1. 7-Band Studio Graphic Equalizer + Real-time Audio Visualizer Canvas (Web Audio API)
 * 2. Bass Boost & Treble Enhancer DSP
 * 3. Mobile Touch & Desktop Drag-and-Drop Queue Reordering
 * 4. Custom Sleep Timer with Stepper & Minute Input
 * 5. Automatic Listening Stats Logging to IndexedDB
 * 6. Native MediaSession API integration (lockscreen art & controls)
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

    // Listening stats tracking
    this.songPlayStartTime = 0;
    this.songListenedDuration = 0;

    // Web Audio DSP (7-Band Equalizer, Bass Boost, Treble & Visualizer)
    this.audioCtx = null;
    this.sourceNode = null;
    this.analyser = null;
    this.bassNode = null;
    this.trebleNode = null;
    this.eqFilters = [];
    this.eqFrequencies = [60, 150, 400, 1000, 2500, 6000, 15000];
    this.eqGains = [0, 0, 0, 0, 0, 0, 0];
    this.bassBoostGain = 0;
    this.trebleBoostGain = 0;
    this.visualizerAnimationId = null;

    this.initAudioListeners();
  }

  initAudioListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.songPlayStartTime = Date.now();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.recordListeningTime();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });

    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('ended', () => this.onEnded());

    this.audio.addEventListener('error', (e) => {
      console.warn('[Anru Player] Audio playback error notice:', e);
      this.isPlaying = false;
      this.updatePlayPauseUI();
      if (typeof showToast === 'function') {
        showToast('⚠️ Could not play audio format.');
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

  // ==========================================
  // WEB AUDIO DSP (7-BAND EQ & ANALYSER)
  // ==========================================

  initWebAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // Create AnalyserNode for Real-Time Visualizer
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      // Create 7-Band Equalizer Filters
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

      // Extra Bass Boost (lowshelf @ 80Hz)
      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.value = 80;
      this.bassNode.gain.value = this.bassBoostGain || 0;
      prevNode.connect(this.bassNode);
      prevNode = this.bassNode;

      // Connect to Analyser
      prevNode.connect(this.analyser);

      // Connect Analyser to Destination (Speakers/Headphones)
      this.analyser.connect(this.audioCtx.destination);
      console.log('[Anru Audio] 7-Band Studio Equalizer & Analyser Active ⚡');
    } catch (err) {
      console.warn('[Anru Audio] Web Audio notice:', err);
    }
  }

  startVisualizer(canvas) {
    if (!canvas || !this.analyser) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      this.visualizerAnimationId = requestAnimationFrame(render);
      this.analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 1.6;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.95;
        const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.2)');
        grad.addColorStop(0.6, '#a855f7');
        grad.addColorStop(1, '#ec4899');

        ctx.fillStyle = grad;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, canvas.height - barHeight, barWidth - 2, barHeight, [4, 4, 0, 0]);
        } else {
          ctx.rect(x, canvas.height - barHeight, barWidth - 2, barHeight);
        }
        ctx.fill();

        x += barWidth;
      }
    };

    if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
    render();
  }

  stopVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
      this.visualizerAnimationId = null;
    }
  }

  setEQGain(bandIndex, gainVal) {
    this.eqGains[bandIndex] = gainVal;
    if (this.eqFilters[bandIndex]) {
      this.eqFilters[bandIndex].gain.value = gainVal;
    }
    if (typeof db !== 'undefined') {
      db.setSetting('eq_gains_v16', this.eqGains);
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
      flat: [0, 0, 0, 0, 0, 0, 0],
      bass_boost: [7, 5, 2, 0, 0, 1, 2],
      dance: [6, 4, 1, -1, 2, 4, 5],
      rock: [5, 3, -1, 1, 3, 5, 6],
      vocal: [-2, 0, 4, 5, 3, 1, 0],
      pop: [2, 4, 3, 1, 2, 4, 3],
      hiphop: [8, 6, 2, 0, 1, 2, 3]
    };

    const gains = presets[presetName] || presets.flat;
    gains.forEach((g, idx) => {
      this.setEQGain(idx, g);
      const slider = document.getElementById(`eq-band-${idx}`);
      if (slider) slider.value = g;
      const valLabel = document.getElementById(`eq-val-${idx}`);
      if (valLabel) valLabel.textContent = `${g > 0 ? '+' : ''}${g}dB`;
    });

    if (typeof showToast === 'function') {
      showToast(`EQ: ${presetName.toUpperCase()}`);
    }
  }

  // ==========================================
  // PLAYBACK CONTROL
  // ==========================================

  async playSong(song, newQueue = null) {
    if (!song) return;

    this.recordListeningTime();

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
    this.songPlayStartTime = Date.now();
    this.songListenedDuration = 0;

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

    const playPromise = (this.audio && typeof this.audio.play === 'function') ? this.audio.play() : undefined;
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('[Anru Player] Playback notice:', err);
      });
    }

    this.initWebAudio();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.updateTrackUI();
    this.updateMediaSession();
    this.renderQueueDrawer();
  }

  recordListeningTime() {
    if (this.currentSong && this.songPlayStartTime > 0) {
      const listenedSec = Math.floor((Date.now() - this.songPlayStartTime) / 1000);
      if (listenedSec >= 5 && typeof db !== 'undefined') {
        db.logPlayEvent(this.currentSong, listenedSec);
      }
      this.songPlayStartTime = 0;
    }
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
      else return; // Stop at end
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
    this.recordListeningTime();

    // Sleep timer: End of Song check
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
  // SPOTIFY-STYLE QUEUE MANAGEMENT & REORDER
  // ==========================================

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

  addToQueue(song) {
    if (!song) return;
    this.queue.push(song);
    this.renderQueueDrawer();
    if (typeof showToast === 'function') showToast(`Added to queue: "${song.title}" 🎶`);
  }

  moveQueueItem(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= this.queue.length || toIndex >= this.queue.length) return;
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    // Maintain current song index
    if (this.currentSong) {
      this.currentIndex = this.queue.findIndex(s => s.id === this.currentSong.id);
    }
    this.renderQueueDrawer();
    if (navigator.vibrate) navigator.vibrate(30);
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.currentIndex) {
      this.next();
    }
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this.renderQueueDrawer();
  }

  clearUpcomingQueue() {
    if (this.currentIndex >= 0) {
      this.queue = this.queue.slice(0, this.currentIndex + 1);
    } else {
      this.queue = [];
    }
    this.renderQueueDrawer();
    if (typeof showToast === 'function') showToast('Upcoming queue cleared 🧹');
  }

  // Render Queue with Touch & Mouse Drag and Drop
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
      item.dataset.index = realIdx;
      item.draggable = true;

      item.innerHTML = `
        <div class="queue-drag-handle" title="Hold & Drag to Reorder">
          <i class="fa-solid fa-grip-lines"></i>
        </div>
        <span class="queue-num">${idx + 1}</span>
        <img src="${song.artwork || 'icon-512.png'}" alt="art" class="queue-row-thumb" onerror="this.src='icon-512.png'">
        <div class="queue-row-info">
          <div class="queue-row-title">${song.title}</div>
          <div class="queue-row-artist">${song.artist}</div>
        </div>
        <div class="queue-row-actions">
          <button class="queue-remove-btn" title="Remove" data-action="remove" data-index="${realIdx}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;

      // Tap row to play
      item.addEventListener('click', (e) => {
        if (e.target.closest('.queue-drag-handle') || e.target.closest('.queue-remove-btn')) return;
        this.playSong(song);
      });

      // Remove button
      item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(realIdx);
      });

      // Drag and Drop (Mouse / Desktop)
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', realIdx);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(fromIdx)) {
          this.moveQueueItem(fromIdx, realIdx);
        }
      });

      // Touch Drag & Drop (Mobile Support)
      const handle = item.querySelector('.queue-drag-handle');
      if (handle) {
        let touchStartY = 0;
        let activeRow = null;

        handle.addEventListener('touchstart', (e) => {
          touchStartY = e.touches[0].clientY;
          activeRow = item;
          activeRow.classList.add('touch-dragging');
          if (navigator.vibrate) navigator.vibrate(40);
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
          if (!activeRow) return;
          const touchY = e.touches[0].clientY;
          // Find element under touch point
          const targetEl = document.elementFromPoint(e.touches[0].clientX, touchY);
          const targetRow = targetEl ? targetEl.closest('.queue-row') : null;
          document.querySelectorAll('.queue-row').forEach(r => r.classList.remove('drag-over'));
          if (targetRow && targetRow !== activeRow) {
            targetRow.classList.add('drag-over');
          }
        }, { passive: true });

        handle.addEventListener('touchend', (e) => {
          if (!activeRow) return;
          activeRow.classList.remove('touch-dragging');
          const lastTouch = e.changedTouches[0];
          const targetEl = document.elementFromPoint(lastTouch.clientX, lastTouch.clientY);
          const targetRow = targetEl ? targetEl.closest('.queue-row') : null;
          document.querySelectorAll('.queue-row').forEach(r => r.classList.remove('drag-over'));

          if (targetRow && targetRow !== activeRow) {
            const toIdx = parseInt(targetRow.dataset.index, 10);
            if (!isNaN(toIdx)) {
              this.moveQueueItem(realIdx, toIdx);
            }
          }
          activeRow = null;
        });
      }

      upList.appendChild(item);
    });
  }

  // ==========================================
  // SLEEP TIMER ENGINE (PRESETS + CUSTOM)
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

    this.sleepTimerId = setInterval(() => {
      const remaining = Math.max(0, this.sleepTimerEndTime - Date.now());
      this.updateSleepTimerUI(remaining);

      // Smooth volume fade out in last 15 seconds
      if (remaining <= 15000 && remaining > 0) {
        const factor = remaining / 15000;
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
    const studioStatus = document.getElementById('studio-st-status');
    const timerBtn = document.getElementById('fs-sleep-btn');

    if (!this.sleepTimerMode) {
      if (badge) badge.classList.add('hidden');
      if (statusText) statusText.textContent = 'Timer is off';
      if (studioStatus) studioStatus.textContent = 'Off (Tap to configure)';
      if (timerBtn) timerBtn.classList.remove('active');
      return;
    }

    if (timerBtn) timerBtn.classList.add('active');

    if (this.sleepTimerMode === 'end_of_song') {
      if (badge) { badge.classList.remove('hidden'); badge.textContent = 'End of Song'; }
      if (statusText) statusText.textContent = 'Stops after current song finishes';
      if (studioStatus) studioStatus.textContent = 'Stops after current track';
    } else {
      const totalSec = Math.floor(remainingMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
      if (badge) { badge.classList.remove('hidden'); badge.textContent = timeStr; }
      if (statusText) statusText.textContent = `Stopping in ${timeStr}`;
      if (studioStatus) studioStatus.textContent = `Stopping in ${timeStr}`;
    }
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

const player = new AudioPlayer();
if (typeof window !== 'undefined') window.player = player;
if (typeof globalThis !== 'undefined') globalThis.player = player;
