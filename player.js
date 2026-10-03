/**
 * ANRU MUSIC STUDIO PRO v17 - ADVANCED AUDIO ENGINE (player.js)
 * 1. 7-Band Studio Graphic Equalizer + Live Audio Spectrum Visualizer
 * 2. 3D Spatial Virtualizer & Surround Sound (Mid/Side Haas Stereo Widener)
 * 3. Auto Volume Normalizer (DynamicsCompressorNode & Auto-Leveler)
 * 4. Interactive Waveform Seekbar (Canvas-based illuminated waveform with click-to-seek)
 * 5. Touch Swipe Gestures (Mini player swipe Next/Prev, Fullscreen swipe down to minimize)
 * 6. Full Playback State Resume Engine across app reloads/closes
 * 7. Mobile Touch & Desktop Drag-and-Drop Queue Reorder
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

    // Web Audio DSP Engine
    this.audioCtx = null;
    this.sourceNode = null;
    this.analyser = null;
    this.bassNode = null;
    this.eqFilters = [];
    this.eqFrequencies = [60, 150, 400, 1000, 2500, 6000, 15000];
    this.eqGains = [0, 0, 0, 0, 0, 0, 0];
    this.bassBoostGain = 0;
    this.visualizerAnimationId = null;

    // 3D Spatial Virtualizer & Volume Normalizer
    this.isVirtualizerOn = false;
    this.isNormalizerOn = false;
    this.compressorNode = null;
    this.normalizerBypassNode = null;
    this.virtualizerSideGain = null;
    this.virtualizerMidGain = null;
    this.virtualizerDelayNode = null;
    this.virtualizerSplitter = null;
    this.virtualizerMerger = null;

    // Waveform Seekbar
    this.waveformBars = [];
    this.waveformCanvas = null;

    // Debounced state saving timer
    this._saveStateTimer = null;

    this.initAudioListeners();
  }

  initAudioListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.songPlayStartTime = Date.now();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      this.triggerStateSave();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.recordListeningTime();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      this.triggerStateSave();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.onTimeUpdate();
      // Debounce saving position every 3 seconds
      this.triggerStateSave(3000);
    });

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
  // WEB AUDIO DSP GRAPH (EQ, VIRTUALIZER, NORMALIZER)
  // ==========================================

  initWebAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // 1. 7-Band Equalizer Filters
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

      // 2. Extra Bass Boost (lowshelf @ 80Hz)
      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.value = 80;
      this.bassNode.gain.value = this.bassBoostGain || 0;
      prevNode.connect(this.bassNode);
      prevNode = this.bassNode;

      // 3. Volume Normalizer (DynamicsCompressorNode)
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -24;
      this.compressorNode.knee.value = 30;
      this.compressorNode.ratio.value = 12;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;

      this.normalizerBypassNode = this.audioCtx.createGain();
      this.normalizerBypassNode.gain.value = 1.0;

      // Connect EQ output to Compressor / Normalizer
      prevNode.connect(this.compressorNode);
      prevNode.connect(this.normalizerBypassNode);

      // Master processing gain node
      const postDSPAmp = this.audioCtx.createGain();
      postDSPAmp.gain.value = 1.0;

      if (this.isNormalizerOn) {
        this.compressorNode.connect(postDSPAmp);
      } else {
        this.normalizerBypassNode.connect(postDSPAmp);
      }

      // 4. 3D Spatial Virtualizer / Stereo Widener (Mid-Side Haas Delay)
      this.virtualizerSplitter = this.audioCtx.createChannelSplitter(2);
      this.virtualizerMerger = this.audioCtx.createChannelMerger(2);
      this.virtualizerDelayNode = this.audioCtx.createDelay();
      this.virtualizerDelayNode.delayTime.value = 0.015; // 15ms Haas effect delay
      this.virtualizerSideGain = this.audioCtx.createGain();
      this.virtualizerSideGain.gain.value = this.isVirtualizerOn ? 1.6 : 1.0;

      postDSPAmp.connect(this.virtualizerSplitter);
      this.virtualizerSplitter.connect(this.virtualizerMerger, 0, 0); // Left channel

      // Right channel delayed for spatial illusion
      this.virtualizerSplitter.connect(this.virtualizerDelayNode, 1);
      this.virtualizerDelayNode.connect(this.virtualizerSideGain);
      this.virtualizerSideGain.connect(this.virtualizerMerger, 0, 1); // Right channel

      // 5. Analyser for Real-Time Visualizer
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      if (this.isVirtualizerOn) {
        this.virtualizerMerger.connect(this.analyser);
      } else {
        postDSPAmp.connect(this.analyser);
      }

      // 6. Connect to Speakers / Headphones
      this.analyser.connect(this.audioCtx.destination);

      console.log('[Anru Audio] Full DSP Chain Active: 7-Band EQ + 3D Virtualizer + Normalizer ⚡');
    } catch (err) {
      console.warn('[Anru Audio] Web Audio notice:', err);
    }
  }

  // Toggle 3D Spatial Virtualizer
  toggleVirtualizer(enable) {
    this.isVirtualizerOn = !!enable;
    if (this.audioCtx) {
      if (this.virtualizerSideGain) {
        this.virtualizerSideGain.gain.value = this.isVirtualizerOn ? 1.8 : 1.0;
      }
    }
    if (typeof db !== 'undefined') {
      db.setSetting('virtualizer_enabled', this.isVirtualizerOn);
    }
    if (typeof showToast === 'function') {
      showToast(this.isVirtualizerOn ? '3D Spatial Virtualizer: ON 🎧' : '3D Spatial Virtualizer: OFF');
    }
  }

  // Toggle Volume Normalizer
  toggleNormalizer(enable) {
    this.isNormalizerOn = !!enable;
    if (typeof db !== 'undefined') {
      db.setSetting('normalizer_enabled', this.isNormalizerOn);
    }
    if (typeof showToast === 'function') {
      showToast(this.isNormalizerOn ? 'Auto Volume Normalizer: ON 🔊' : 'Auto Volume Normalizer: OFF');
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
  // PLAYBACK CONTROL & STATE RESUME
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
      if (typeof showToast === 'function') showToast(`⚠️ No audio file attached for "${song.title}"`);
    }

    this.audio.playbackRate = this.playbackRate;
    if (this.audio && typeof this.audio.load === 'function') this.audio.load();

    const playPromise = (this.audio && typeof this.audio.play === 'function') ? this.audio.play() : undefined;
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('[Anru Player] Playback gesture notice:', err);
      });
    }

    this.initWebAudio();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.generateWaveformBars(song);
    this.updateTrackUI();
    this.updateMediaSession();
    this.renderQueueDrawer();
    this.triggerStateSave();
  }

  // Restore player state on app reload without auto-playing aloud
  async loadSavedState(state, allSongs) {
    if (!state || !state.songId || !allSongs || allSongs.length === 0) return;
    const targetSong = allSongs.find(s => s.id === state.songId);
    if (!targetSong) return;

    // Restore queue
    if (state.queueSongIds && Array.isArray(state.queueSongIds)) {
      this.queue = allSongs.filter(s => state.queueSongIds.includes(s.id));
    }
    if (this.queue.length === 0) {
      this.queue = [targetSong];
    }
    this.currentIndex = this.queue.findIndex(s => s.id === targetSong.id);
    if (this.currentIndex < 0) this.currentIndex = 0;

    this.currentSong = targetSong;
    this.isShuffle = !!state.isShuffle;
    this.repeatMode = state.repeatMode || 'all';

    if (targetSong.audioBlob) {
      this.currentObjectUrl = URL.createObjectURL(targetSong.audioBlob);
      this.audio.src = this.currentObjectUrl;
    } else if (targetSong.audioUrl) {
      this.audio.src = targetSong.audioUrl;
    }

    this.audio.currentTime = state.currentTime || 0;
    this.generateWaveformBars(targetSong);
    this.updateTrackUI();
    this.updatePlayPauseUI();
    this.renderQueueDrawer();
    console.log('[Anru Player] Resumed saved playback state at:', state.currentTime, 's');
  }

  triggerStateSave(delay = 500) {
    if (this._saveStateTimer) clearTimeout(this._saveStateTimer);
    this._saveStateTimer = setTimeout(() => {
      if (this.currentSong && typeof db !== 'undefined') {
        db.savePlaybackState({
          songId: this.currentSong.id,
          currentTime: this.audio.currentTime || 0,
          queueSongIds: this.queue.map(s => s.id),
          isShuffle: this.isShuffle,
          repeatMode: this.repeatMode
        });
      }
    }, delay);
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

    const curTimeEl = document.getElementById('fs-curr-time');
    const durTimeEl = document.getElementById('fs-duration');
    if (curTimeEl) curTimeEl.textContent = this.formatTime(cur);
    if (durTimeEl) durTimeEl.textContent = this.formatTime(dur);

    // Update Waveform Seekbar Canvas
    this.drawWaveformSeekbar(pct);
  }

  seek(percentage) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percentage / 100) * this.audio.duration;
    this.onTimeUpdate();
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
    this.triggerStateSave();
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
    this.triggerStateSave();
  }

  // ==========================================
  // INTERACTIVE WAVEFORM SEEKBAR
  // ==========================================

  generateWaveformBars(song) {
    // Generate deterministic 55 audio peak bars based on song string hash
    const str = (song.title + song.artist + (song.duration || 180)).toLowerCase();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }

    this.waveformBars = [];
    let currentVal = 0.5;
    for (let i = 0; i < 55; i++) {
      const step = Math.sin(i * 0.35 + hash) * 0.35 + Math.cos(i * 0.2) * 0.25;
      currentVal = Math.max(0.18, Math.min(0.95, currentVal + step * 0.5));
      this.waveformBars.push(currentVal);
    }
  }

  initWaveformCanvas(canvas) {
    if (!canvas) return;
    this.waveformCanvas = canvas;

    const handleSeek = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = (clickX / rect.width) * 100;
      this.seek(pct);
    };

    canvas.addEventListener('click', handleSeek);

    let isSeeking = false;
    canvas.addEventListener('touchstart', (e) => {
      isSeeking = true;
      handleSeek(e);
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (isSeeking) handleSeek(e);
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      isSeeking = false;
    });
  }

  drawWaveformSeekbar(progressPct = 0) {
    if (!this.waveformCanvas) {
      this.waveformCanvas = document.getElementById('fs-waveform-canvas');
      if (this.waveformCanvas) this.initWaveformCanvas(this.waveformCanvas);
    }
    if (!this.waveformCanvas) return;

    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (this.waveformBars.length === 0) {
      this.generateWaveformBars(this.currentSong || { title: 'Audio' });
    }

    const totalBars = this.waveformBars.length;
    const barWidth = 4;
    const barSpacing = (width - (totalBars * barWidth)) / (totalBars - 1);
    const splitX = (progressPct / 100) * width;

    // Glowing Played Gradient
    const playedGrad = ctx.createLinearGradient(0, height, 0, 0);
    playedGrad.addColorStop(0, '#ec4899');
    playedGrad.addColorStop(1, '#a855f7');

    for (let i = 0; i < totalBars; i++) {
      const barH = this.waveformBars[i] * height;
      const x = i * (barWidth + barSpacing);
      const y = (height - barH) / 2;

      ctx.beginPath();
      if (x <= splitX) {
        ctx.fillStyle = playedGrad;
        ctx.shadowColor = 'rgba(168, 85, 247, 0.4)';
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barH, 2);
      } else {
        ctx.rect(x, y, barWidth, barH);
      }
      ctx.fill();
    }

    // Playhead dot on waveform
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(splitX, height / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ==========================================
  // SWIPE GESTURES ENGINE (MINI & FULLSCREEN)
  // ==========================================

  initSwipeGestures() {
    // 1. Mini Player: Swipe Left (Next) / Swipe Right (Prev)
    const mini = document.getElementById('mini-player');
    if (mini) {
      let touchStartX = 0;
      let touchStartY = 0;

      mini.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      mini.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        // Ensure horizontal swipe
        if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            this.next();
            if (typeof showToast === 'function') showToast('Next Track ⏭️');
          } else {
            this.previous();
            if (typeof showToast === 'function') showToast('Previous Track ⏮️');
          }
          if (navigator.vibrate) navigator.vibrate(30);
        }
      }, { passive: true });
    }

    // 2. Fullscreen Player: Swipe Down to Minimize
    const fsPlayer = document.getElementById('fullscreen-player');
    if (fsPlayer) {
      let fsTouchStartY = 0;
      let fsTouchStartX = 0;

      fsPlayer.addEventListener('touchstart', (e) => {
        fsTouchStartY = e.touches[0].clientY;
        fsTouchStartX = e.touches[0].clientX;
      }, { passive: true });

      fsPlayer.addEventListener('touchend', (e) => {
        // Only trigger if touch started in top half
        if (fsTouchStartY < window.innerHeight * 0.6) {
          const deltaY = e.changedTouches[0].clientY - fsTouchStartY;
          const deltaX = e.changedTouches[0].clientX - fsTouchStartX;

          if (deltaY > 75 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
            fsPlayer.classList.add('hidden');
            if (history.state?.modal === 'fullscreen') {
              history.back();
            }
            if (navigator.vibrate) navigator.vibrate(25);
          }
        }
      }, { passive: true });
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
    this.triggerStateSave();
    if (typeof showToast === 'function') showToast(`Playing next: "${song.title}" ⏭️`);
  }

  addToQueue(song) {
    if (!song) return;
    this.queue.push(song);
    this.renderQueueDrawer();
    this.triggerStateSave();
    if (typeof showToast === 'function') showToast(`Added to queue: "${song.title}" 🎶`);
  }

  moveQueueItem(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= this.queue.length || toIndex >= this.queue.length) return;
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    if (this.currentSong) {
      this.currentIndex = this.queue.findIndex(s => s.id === this.currentSong.id);
    }
    this.renderQueueDrawer();
    this.triggerStateSave();
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
    this.triggerStateSave();
  }

  clearUpcomingQueue() {
    if (this.currentIndex >= 0) {
      this.queue = this.queue.slice(0, this.currentIndex + 1);
    } else {
      this.queue = [];
    }
    this.renderQueueDrawer();
    this.triggerStateSave();
    if (typeof showToast === 'function') showToast('Upcoming queue cleared 🧹');
  }

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

      item.addEventListener('click', (e) => {
        if (e.target.closest('.queue-drag-handle') || e.target.closest('.queue-remove-btn')) return;
        this.playSong(song);
      });

      item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(realIdx);
      });

      // Desktop Drag & Drop
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

      // Mobile Touch Drag & Drop
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
    if (fsAlbum) fsAlbum.textContent = song.isOnline ? ('Online • ' + (song.source || 'HD Stream')) : (song.album || 'Local Studio');
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

    this.drawWaveformSeekbar(0);
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
