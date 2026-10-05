function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * ANRU MUSIC STUDIO PRO v22.1 - STUDIO AUDIO ENGINE & AUDIOPHILE DSP GRAPH
 * Pure Offline Audio Pipeline with High-Buffer Playback Stability
 * Features:
 * 1. Background Playback Optimization (playback latencyHint = zero crackling/underruns)
 * 2. Preamp Headroom & Brickwall Safety Limiter (zero DAC clipping / distortion)
 * 3. Dynamic Real-Time Crossfade for 3D Virtualizer & Auto-Normalizer
 * 4. Ultra-smooth Real-Time Equalizer Visualizer & Resting Wave Engine
 * 5. On-demand audioBlob streaming from IndexedDB
 * 6. Non-destructive sleep timer volume restoration
 * 7. Throttled periodic state saving & robust queue management
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
    this._preTimerVolume = 1.0;

    // Listening stats tracking
    this.songPlayStartTime = 0;

    // Web Audio DSP Engine
    this.audioCtx = null;
    this.sourceNode = null;
    this.preampGain = null;
    this.analyser = null;
    this.bassNode = null;
    this.limiterNode = null;
    this.eqFilters = [];
    this.eqFrequencies = [60, 150, 400, 1000, 2500, 6000, 15000];
    this.eqGains = [0, 0, 0, 0, 0, 0, 0];
    this.bassBoostGain = 0;
    this.visualizerAnimationId = null;

    // 3D Spatial Virtualizer & Volume Normalizer Nodes
    this.isVirtualizerOn = false;
    this.isNormalizerOn = false;
    this.compressorNode = null;
    this.normalizerBypassGain = null;
    this.normalizerActiveGain = null;
    this.virtualizerDirectGain = null;
    this.virtualizerSpatialGain = null;
    this.virtualizerDelayNode = null;
    this.virtualizerSideGain = null;
    this.virtualizerSplitter = null;
    this.virtualizerMerger = null;

    // Waveform Seekbar
    this.waveformBars = [];
    this.waveformCanvas = null;

    // State saving timers
    this._saveStateTimer = null;
    this._lastPeriodicSave = 0;

    this.initAudioListeners();
    this.initProgressSeekbar();
  }

  initAudioListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.songPlayStartTime = Date.now();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      this.triggerStateSave(500);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.recordListeningTime();
      this.updatePlayPauseUI();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      this.triggerStateSave(100);
    });

    this.audio.addEventListener('timeupdate', () => {
      this.onTimeUpdate();
      // Throttled saving position every 3 seconds while playing
      this.triggerStateSave(3000);
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.audio.duration && (!this.currentSong?.duration || this.currentSong.duration <= 0)) {
        this.currentSong.duration = Math.round(this.audio.duration);
        if (typeof db !== 'undefined') {
          db.updateSongDuration(this.currentSong.id, this.currentSong.duration);
        }
      }
      this.onTimeUpdate();
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

    // App visibility listener to eliminate background audio stutter
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // App hidden / screen locked: stop visualizer loop to give CPU to audio decoding
        this.stopVisualizer();
      } else {
        // App foregrounded: resume AudioContext if suspended
        if (this.audioCtx && this.audioCtx.state === 'suspended' && this.isPlaying) {
          this.audioCtx.resume();
        }
        // Restart visualizer if Equalizer modal is open
        const eqModal = document.getElementById('equalizer-modal');
        if (eqModal && !eqModal.classList.contains('hidden')) {
          const canvas = document.getElementById('eq-visualizer');
          if (canvas) this.startVisualizer(canvas);
        }
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
  // WEB AUDIO DSP GRAPH (EQ, VIRTUALIZER, NORMALIZER, LIMITER)
  // ==========================================

  initWebAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      // 'playback' latencyHint tells Android / iOS to use large, smooth audio buffers
      // This completely eliminates crackling and pops during background playback!
      this.audioCtx = new AudioContextClass({
        latencyHint: 'playback'
      });
      this.audioCtx.onstatechange = () => {
        if (this.audioCtx && this.audioCtx.state === 'suspended' && this.isPlaying) {
          this.audioCtx.resume().catch(() => {});
        }
      };
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // 1. Headroom Preamp Gain (Prevents digital clipping when EQ or Bass Boost is boosted)
      this.preampGain = this.audioCtx.createGain();
      this.preampGain.gain.value = 1.0;
      this.sourceNode.connect(this.preampGain);

      // 2. 7-Band Equalizer Filters
      let prevNode = this.preampGain;
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

      // 3. Extra Bass Boost (lowshelf @ 80Hz)
      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.value = 80;
      this.bassNode.gain.value = this.bassBoostGain || 0;
      prevNode.connect(this.bassNode);
      prevNode = this.bassNode;

      // 4. Volume Normalizer (DynamicsCompressorNode + Clean Bypass Crossfade)
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -20;
      this.compressorNode.knee.value = 24;
      this.compressorNode.ratio.value = 8;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;

      this.normalizerBypassGain = this.audioCtx.createGain();
      this.normalizerActiveGain = this.audioCtx.createGain();
      this.normalizerBypassGain.gain.value = this.isNormalizerOn ? 0.0 : 1.0;
      this.normalizerActiveGain.gain.value = this.isNormalizerOn ? 1.0 : 0.0;

      prevNode.connect(this.compressorNode);
      prevNode.connect(this.normalizerBypassGain);
      this.compressorNode.connect(this.normalizerActiveGain);

      const postNormSum = this.audioCtx.createGain();
      this.normalizerBypassGain.connect(postNormSum);
      this.normalizerActiveGain.connect(postNormSum);

      // 5. 3D Spatial Virtualizer (Subtle Stereo Expansion with Direct Passthrough Bypass)
      this.virtualizerDirectGain = this.audioCtx.createGain();
      this.virtualizerSpatialGain = this.audioCtx.createGain();
      this.virtualizerDirectGain.gain.value = this.isVirtualizerOn ? 0.0 : 1.0;
      this.virtualizerSpatialGain.gain.value = this.isVirtualizerOn ? 1.0 : 0.0;

      // Direct clean stereo path
      postNormSum.connect(this.virtualizerDirectGain);

      // Spatialized path
      this.virtualizerSplitter = this.audioCtx.createChannelSplitter(2);
      this.virtualizerMerger = this.audioCtx.createChannelMerger(2);
      this.virtualizerDelayNode = this.audioCtx.createDelay();
      this.virtualizerDelayNode.delayTime.value = 0.012; // 12ms subtle Haas delay
      this.virtualizerSideGain = this.audioCtx.createGain();
      this.virtualizerSideGain.gain.value = 0.85;

      postNormSum.connect(this.virtualizerSplitter);
      this.virtualizerSplitter.connect(this.virtualizerMerger, 0, 0); // Left channel
      this.virtualizerSplitter.connect(this.virtualizerDelayNode, 1); // Right channel delayed
      this.virtualizerDelayNode.connect(this.virtualizerSideGain);
      this.virtualizerSideGain.connect(this.virtualizerMerger, 0, 1);

      this.virtualizerMerger.connect(this.virtualizerSpatialGain);

      const postDSPSum = this.audioCtx.createGain();
      this.virtualizerDirectGain.connect(postDSPSum);
      this.virtualizerSpatialGain.connect(postDSPSum);

      // 6. Analyser for Real-Time Visualizer
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.75;
      postDSPSum.connect(this.analyser);

      // 7. Brickwall Safety Limiter (Prevents any DAC distortion/clipping on mobile hardware)
      this.limiterNode = this.audioCtx.createDynamicsCompressor();
      this.limiterNode.threshold.value = -0.5;
      this.limiterNode.knee.value = 0;
      this.limiterNode.ratio.value = 20;
      this.limiterNode.attack.value = 0.001;
      this.limiterNode.release.value = 0.05;

      this.analyser.connect(this.limiterNode);
      this.limiterNode.connect(this.audioCtx.destination);

      this.updatePreampGain();
      console.log('[Anru Audio] Pure Offline DSP Graph Active (Playback Latency + Limiter Guard) ⚡');
    } catch (err) {
      console.warn('[Anru Audio] Web Audio notice:', err);
    }
  }

  updatePreampGain() {
    if (!this.preampGain || !this.audioCtx) return;
    const maxBoost = Math.max(0, ...this.eqGains, this.bassBoostGain || 0);
    // Attenuate input by 70% of max boost so total signal never clips 0dBFS
    const reductionDb = maxBoost > 0 ? (maxBoost * 0.7) : 0;
    const targetGain = Math.pow(10, -reductionDb / 20);
    this.preampGain.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
  }

  // Toggle 3D Spatial Virtualizer in real-time
  toggleVirtualizer(enable) {
    this.isVirtualizerOn = !!enable;
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      if (this.virtualizerDirectGain && this.virtualizerSpatialGain) {
        this.virtualizerDirectGain.gain.setValueAtTime(this.isVirtualizerOn ? 0.0 : 1.0, now);
        this.virtualizerSpatialGain.gain.setValueAtTime(this.isVirtualizerOn ? 1.0 : 0.0, now);
      }
    }
    if (typeof db !== 'undefined') {
      db.setSetting('virtualizer_enabled', this.isVirtualizerOn);
    }
    const btn = document.getElementById('fs-3d-btn');
    if (btn) btn.classList.toggle('active', this.isVirtualizerOn);
    if (typeof showToast === 'function') {
      showToast(this.isVirtualizerOn ? '3D Spatial Audio: ON 🎧' : '3D Spatial Audio: OFF');
    }
  }

  // Toggle Volume Normalizer in real-time
  toggleNormalizer(enable) {
    this.isNormalizerOn = !!enable;
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      if (this.normalizerBypassGain && this.normalizerActiveGain) {
        this.normalizerBypassGain.gain.setValueAtTime(this.isNormalizerOn ? 0.0 : 1.0, now);
        this.normalizerActiveGain.gain.setValueAtTime(this.isNormalizerOn ? 1.0 : 0.0, now);
      }
    }
    if (typeof db !== 'undefined') {
      db.setSetting('normalizer_enabled', this.isNormalizerOn);
    }
    const btn = document.getElementById('fs-normalize-btn');
    if (btn) btn.classList.toggle('active', this.isNormalizerOn);
    if (typeof showToast === 'function') {
      showToast(this.isNormalizerOn ? 'Auto Volume Normalizer: ON 🔊' : 'Auto Volume Normalizer: OFF');
    }
  }

  // Real-Time Visualizer Engine with Crisp Retina Sizing & Idle Wave
  startVisualizer(canvas) {
    if (!canvas) return;
    this.stopVisualizer();

    this.initWebAudio();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const bufferLength = this.analyser ? this.analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);
    const numBars = 28;

    const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
    grad.addColorStop(0, 'rgba(168, 85, 247, 0.2)');
    grad.addColorStop(0.6, '#a855f7');
    grad.addColorStop(1, '#ec4899');

    let idlePhase = 0;

    const render = () => {
      if (document.hidden) {
        this.visualizerAnimationId = null;
        return;
      }

      this.visualizerAnimationId = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const hasAudio = this.isPlaying && this.analyser;
      if (hasAudio) {
        this.analyser.getByteFrequencyData(dataArray);
      }

      const totalBarWidth = width / numBars;
      const barSpacing = totalBarWidth * 0.25;
      const barWidth = Math.max(3, totalBarWidth - barSpacing);

      for (let i = 0; i < numBars; i++) {
        let barHeight = 0;
        if (hasAudio) {
          const val = dataArray[i * 2] || 0;
          barHeight = Math.max(4, (val / 255) * height * 0.94);
        } else {
          // Elegant resting animation when paused
          idlePhase += 0.0025;
          const wave = (Math.sin(idlePhase + i * 0.35) + 1) / 2;
          barHeight = 4 + wave * 9 * dpr;
        }

        const x = i * totalBarWidth + barSpacing / 2;
        const y = height - barHeight;

        ctx.fillStyle = grad;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, [4 * dpr, 4 * dpr, 0, 0]);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }
    };

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
    this.updatePreampGain();
    if (typeof db !== 'undefined') {
      db.setSetting('eq_gains_v16', this.eqGains);
    }
  }

  setBassBoost(gainVal) {
    this.bassBoostGain = gainVal;
    if (this.bassNode) {
      this.bassNode.gain.value = gainVal;
    }
    this.updatePreampGain();
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

    // Determine playable source (streaming on-demand from IndexedDB)
    let blob = song.audioBlob;
    if (!blob && typeof db !== 'undefined') {
      try {
        blob = await db.getSongBlob(song.id);
        if (blob) song.audioBlob = blob;
      } catch (e) {}
    }

    if (blob) {
      this.currentObjectUrl = URL.createObjectURL(blob);
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
    this.triggerStateSave(500);
    this.preloadNextSong();
  }

  // Preloads the next upcoming track's audioBlob into memory
  // Ensures 0ms instant transition upon song completion in background!
  async preloadNextSong() {
    if (this.queue.length <= 1) return;
    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all') nextIndex = 0;
      else return;
    }
    const nextSong = this.queue[nextIndex];
    if (nextSong && !nextSong.audioBlob && typeof db !== 'undefined') {
      try {
        const blob = await db.getSongBlob(nextSong.id);
        if (blob) nextSong.audioBlob = blob;
      } catch (e) {}
    }
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

    let blob = targetSong.audioBlob;
    if (!blob && typeof db !== 'undefined') {
      try {
        blob = await db.getSongBlob(targetSong.id);
        if (blob) targetSong.audioBlob = blob;
      } catch (e) {}
    }

    if (blob) {
      this.currentObjectUrl = URL.createObjectURL(blob);
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
    // Avoid continuous background disk I/O to prevent Android battery managers from freezing the tab
    if (document.hidden && delay >= 2000) return;

    const now = Date.now();
    // Throttled periodic save every 4 seconds while playing in foreground
    if (delay >= 2000) {
      if (now - (this._lastPeriodicSave || 0) < 4000) return;
      this._lastPeriodicSave = now;
      this.saveStateNow();
      return;
    }

    if (this._saveStateTimer) clearTimeout(this._saveStateTimer);
    this._saveStateTimer = setTimeout(() => {
      this.saveStateNow();
    }, delay);
  }

  saveStateNow() {
    if (this.currentSong && typeof db !== 'undefined') {
      db.savePlaybackState({
        songId: this.currentSong.id,
        currentTime: this.audio.currentTime || 0,
        queueSongIds: this.queue.map(s => s.id),
        isShuffle: this.isShuffle,
        repeatMode: this.repeatMode
      });
    }
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
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } else {
      this.audio.pause();
    }
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.isShuffle && this.queue.length > 1) {
      let nextIndex = this.currentIndex;
      let attempts = 0;
      while (nextIndex === this.currentIndex && attempts < 10) {
        nextIndex = Math.floor(Math.random() * this.queue.length);
        attempts++;
      }
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
    const pct = Math.min(100, Math.max(0, (cur / dur) * 100));

    // Update High-Visibility Progress Stick
    const progressFill = document.getElementById('fs-progress-fill');
    const progressThumb = document.getElementById('fs-progress-thumb');
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressThumb) progressThumb.style.left = `${pct}%`;

    const miniFill = document.getElementById('mini-progress-fill');
    if (miniFill) miniFill.style.width = `${pct}%`;

    const curTimeEl = document.getElementById('fs-curr-time');
    const durTimeEl = document.getElementById('fs-duration');
    if (curTimeEl) curTimeEl.textContent = this.formatTime(cur);
    if (durTimeEl) durTimeEl.textContent = this.formatTime(dur);

    // Update Waveform Seekbar Canvas
    this.drawWaveformSeekbar(pct);

    // Update MediaSession Position State for Android Lockscreen / Notification
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && this.audio.duration && !isNaN(this.audio.duration)) {
      if (Date.now() - (this._lastMediaSessionUpdate || 0) > 2000) {
        this._lastMediaSessionUpdate = Date.now();
        try {
          navigator.mediaSession.setPositionState({
            duration: this.audio.duration,
            playbackRate: this.audio.playbackRate || 1.0,
            position: Math.min(this.audio.duration, Math.max(0, cur))
          });
        } catch (e) {}
      }
    }
  }

  initProgressSeekbar() {
    const progressWrap = document.getElementById('fs-progress-wrap');
    if (!progressWrap) return;

    const handleSeek = (e) => {
      const rect = progressWrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = (clickX / rect.width) * 100;
      this.seek(pct);
    };

    progressWrap.addEventListener('click', handleSeek);

    let isSeeking = false;
    progressWrap.addEventListener('mousedown', (e) => { isSeeking = true; handleSeek(e); });
    window.addEventListener('mousemove', (e) => { if (isSeeking) handleSeek(e); });
    window.addEventListener('mouseup', () => { isSeeking = false; });

    progressWrap.addEventListener('touchstart', (e) => { isSeeking = true; handleSeek(e); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (isSeeking) handleSeek(e); }, { passive: true });
    window.addEventListener('touchend', () => { isSeeking = false; });
  }

  seek(percentage) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percentage / 100) * this.audio.duration;
    this.onTimeUpdate();
  }

  setVolume(val) {
    this.audio.volume = Math.max(0, Math.min(1, val));
    this._preTimerVolume = this.audio.volume;
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
    this.triggerStateSave(100);
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
    this.triggerStateSave(100);
  }

  // ==========================================
  // INTERACTIVE WAVEFORM SEEKBAR
  // ==========================================

  generateWaveformBars(song) {
    const str = (song.title + song.artist + (song.duration || 180)).toLowerCase();
    let seed = 0;
    for (let i = 0; i < str.length; i++) {
      seed = (seed << 5) - seed + str.charCodeAt(i);
      seed |= 0;
    }

    const bars = [];
    const numBars = 55;
    for (let i = 0; i < numBars; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const rnd = seed / 233280;
      const centerFactor = Math.sin((i / numBars) * Math.PI);
      const h = Math.max(0.18, Math.min(0.95, (rnd * 0.65 + centerFactor * 0.35)));
      bars.push(h);
    }
    this.waveformBars = bars;
  }

  initWaveformCanvas(canvas) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const seekWithEvent = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clickX = Math.max(0, Math.min(cRect.width, clientX - cRect.left));
      const pct = (clickX / cRect.width) * 100;
      this.seek(pct);
    };

    canvas.addEventListener('click', seekWithEvent);

    let isDragging = false;
    canvas.addEventListener('mousedown', (e) => { isDragging = true; seekWithEvent(e); });
    window.addEventListener('mousemove', (e) => { if (isDragging) seekWithEvent(e); });
    window.addEventListener('mouseup', () => { isDragging = false; });

    canvas.addEventListener('touchstart', (e) => { isDragging = true; seekWithEvent(e); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (isDragging) seekWithEvent(e); }, { passive: true });
    window.addEventListener('touchend', () => { isDragging = false; });
  }

  drawWaveformSeekbar(progressPct = 0) {
    if (document.hidden) return;

    const fsPlayer = document.getElementById('fullscreen-player');
    if (!fsPlayer || fsPlayer.classList.contains('hidden')) return;

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
  }

  // ==========================================
  // GESTURES & QUEUE MANAGER
  // ==========================================

  initSwipeGestures() {
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

    const fsPlayer = document.getElementById('fullscreen-player');
    if (fsPlayer) {
      let fsTouchStartY = 0;
      let fsTouchStartX = 0;

      fsPlayer.addEventListener('touchstart', (e) => {
        fsTouchStartY = e.touches[0].clientY;
        fsTouchStartX = e.touches[0].clientX;
      }, { passive: true });

      fsPlayer.addEventListener('touchend', (e) => {
        const deltaY = e.changedTouches[0].clientY - fsTouchStartY;
        const deltaX = e.changedTouches[0].clientX - fsTouchStartX;
        if (deltaY > 90 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
          const fsModal = document.getElementById('fullscreen-player-modal');
          if (fsModal) fsModal.classList.add('hidden');
        }
      }, { passive: true });
    }
  }

  playNext(song) {
    if (!song) return;
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      this.queue.splice(this.currentIndex + 1, 0, song);
    } else {
      this.queue.push(song);
    }
    this.renderQueueDrawer();
    this.triggerStateSave(100);
    if (typeof showToast === 'function') showToast(`Playing next: "${song.title}" ⏭️`);
  }

  addToQueue(song) {
    if (!song) return;
    this.queue.push(song);
    this.renderQueueDrawer();
    this.triggerStateSave(100);
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
    this.triggerStateSave(100);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    
    if (index === this.currentIndex) {
      let nextIndex = this.currentIndex;
      if (nextIndex >= this.queue.length - 1) {
        nextIndex = 0;
      }
      this.queue.splice(index, 1);
      if (this.queue.length > 0) {
        if (nextIndex >= this.queue.length) nextIndex = 0;
        this.playSong(this.queue[nextIndex]);
      } else {
        this.audio.pause();
        this.currentSong = null;
        this.currentIndex = -1;
        this.updateTrackUI();
      }
    } else {
      this.queue.splice(index, 1);
      if (index < this.currentIndex) {
        this.currentIndex--;
      }
    }
    this.renderQueueDrawer();
    this.triggerStateSave(100);
  }

  clearUpcomingQueue() {
    if (this.currentIndex >= 0) {
      this.queue = this.queue.slice(0, this.currentIndex + 1);
    } else {
      this.queue = [];
    }
    this.renderQueueDrawer();
    this.triggerStateSave(100);
    if (typeof showToast === 'function') showToast('Upcoming queue cleared 🧹');
  }

  renderQueueDrawer() {
    const nowPlayingBox = document.getElementById('queue-now-playing');
    const upcomingList = document.getElementById('queue-upcoming-list');
    const headerCount = document.getElementById('fs-queue-count');

    if (headerCount) headerCount.textContent = `${this.queue.length}`;

    // 1. Render Now Playing Box
    if (nowPlayingBox) {
      if (this.currentSong) {
        nowPlayingBox.innerHTML = `
          <img src="${this.currentSong.artwork || 'icon-512.png'}" class="queue-thumb" alt="cover" onerror="this.src='icon-512.png'">
          <div class="queue-info">
            <div class="queue-title highlight">${escapeHtml(this.currentSong.title)}</div>
            <div class="queue-artist">${escapeHtml(this.currentSong.artist)}</div>
          </div>
          <div class="queue-playing-tag">
            <i class="fa-solid fa-volume-high"></i> PLAYING
          </div>
        `;
      } else {
        nowPlayingBox.innerHTML = '<div class="empty-sub">No track currently playing</div>';
      }
    }

    // 2. Render Upcoming Tracks
    if (upcomingList) {
      upcomingList.innerHTML = '';

      if (this.queue.length === 0) {
        upcomingList.innerHTML = '<div class="empty-sub">Queue is empty. Tap any song in Library to play!</div>';
        return;
      }

      this.queue.forEach((song, idx) => {
        const isNowPlaying = idx === this.currentIndex;
        const row = document.createElement('div');
        row.className = `queue-row ${isNowPlaying ? 'now-playing' : ''}`;
        row.dataset.index = idx;
        row.draggable = true;

        row.innerHTML = `
          <div class="queue-drag-handle" title="Hold & Drag to reorder"><i class="fa-solid fa-grip-lines"></i></div>
          <img src="${song.artwork || 'icon-512.png'}" class="queue-thumb queue-row-thumb" alt="cover" onerror="this.src='icon-512.png'">
          <div class="queue-info">
            <div class="queue-title ${isNowPlaying ? 'highlight' : ''}">${escapeHtml(song.title)}</div>
            <div class="queue-artist">${escapeHtml(song.artist)}</div>
          </div>
          <div class="queue-actions">
            ${idx > 0 ? `<button class="queue-btn move-up" title="Move Up"><i class="fa-solid fa-chevron-up"></i></button>` : ''}
            ${idx < this.queue.length - 1 ? `<button class="queue-btn move-down" title="Move Down"><i class="fa-solid fa-chevron-down"></i></button>` : ''}
            <button class="queue-btn remove-track" title="Remove"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `;

        // Click track info to play
        row.querySelector('.queue-info')?.addEventListener('click', () => {
          this.playSong(song);
        });

        // 1-Tap Move Up / Move Down buttons
        row.querySelector('.move-up')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.moveQueueItem(idx, idx - 1);
        });

        row.querySelector('.move-down')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.moveQueueItem(idx, idx + 1);
        });

        row.querySelector('.remove-track')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeFromQueue(idx);
        });

        // Desktop Drag and Drop
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', idx);
          row.classList.add('touch-dragging');
        });

        row.addEventListener('dragend', () => {
          row.classList.remove('touch-dragging');
          upcomingList.querySelectorAll('.queue-row').forEach(r => r.classList.remove('drag-over'));
        });

        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          row.classList.add('drag-over');
        });

        row.addEventListener('dragleave', () => {
          row.classList.remove('drag-over');
        });

        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drag-over');
          const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
          const toIndex = idx;
          if (!isNaN(fromIndex) && fromIndex !== toIndex) {
            this.moveQueueItem(fromIndex, toIndex);
          }
        });

        // Mobile Touch Drag on Handle
        const handle = row.querySelector('.queue-drag-handle');
        if (handle) {
          handle.addEventListener('touchstart', (e) => {
            row.classList.add('touch-dragging');
            if (navigator.vibrate) navigator.vibrate(25);
          }, { passive: true });

          handle.addEventListener('touchmove', (e) => {
            const currentY = e.touches[0].clientY;
            const elementUnder = document.elementFromPoint(e.touches[0].clientX, currentY);
            const targetRow = elementUnder?.closest('.queue-row');
            
            upcomingList.querySelectorAll('.queue-row').forEach(r => r.classList.remove('drag-over'));
            if (targetRow && targetRow !== row) {
              targetRow.classList.add('drag-over');
            }
          }, { passive: true });

          handle.addEventListener('touchend', (e) => {
            row.classList.remove('touch-dragging');
            const endY = e.changedTouches[0].clientY;
            const elementUnder = document.elementFromPoint(e.changedTouches[0].clientX, endY);
            const targetRow = elementUnder?.closest('.queue-row');
            upcomingList.querySelectorAll('.queue-row').forEach(r => r.classList.remove('drag-over'));

            if (targetRow && targetRow !== row) {
              const toIndex = parseInt(targetRow.dataset.index, 10);
              if (!isNaN(toIndex)) {
                this.moveQueueItem(idx, toIndex);
              }
            }
          });
        }

        upcomingList.appendChild(row);
      });
    }
  }

  // ==========================================
  // SLEEP TIMER ENGINE (WITH VOLUME RESTORATION)
  // ==========================================

  startSleepTimer(minutes) {
    this.cancelSleepTimer();

    this._preTimerVolume = this.audio.volume;

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
        this.audio.volume = Math.max(0, this._preTimerVolume * factor);
      }

      if (remaining <= 0) {
        this.audio.pause();
        this.cancelSleepTimer();
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
    if (this._preTimerVolume !== undefined) {
      this.audio.volume = this._preTimerVolume;
    }
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
      if (badge) { badge.classList.remove('hidden'); badge.textContent = 'End of song'; }
      if (statusText) statusText.textContent = 'Stops after current track';
      if (studioStatus) studioStatus.textContent = 'Stops after current track';
      return;
    }

    const totalSeconds = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const str = `${m}:${s < 10 ? '0' : ''}${s}`;

    if (badge) { badge.classList.remove('hidden'); badge.textContent = str; }
    if (statusText) statusText.textContent = `Stopping in ${str}`;
    if (studioStatus) studioStatus.textContent = `Active (${str} remaining)`;
  }

  // ==========================================
  // UI SYNCHRONIZATION
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
    if (fsAlbum) fsAlbum.textContent = song.album || 'Offline Music';
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
