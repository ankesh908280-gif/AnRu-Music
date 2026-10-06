function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * ANRU MUSIC STUDIO PRO v23.2 - HIGH-PERFORMANCE BATTERY & RAM OPTIMIZED ENGINE
 * 
 * Major Optimizations:
 * 1. ZERO-POWER AUDIO SLEEP: Web Audio AudioContext automatically suspended on pause,
 *    stop, queue end, and sleep timer. Eliminates audio hardware wakelock so mobile CPU
 *    enters deep sleep (Doze mode) with 0% idle battery drain.
 * 2. BACKGROUND WORKLOAD SUPPRESSION: When screen is off / app hidden, all DOM queries,
 *    layout calculations, and 2D canvas renders are completely halted. MediaSession state
 *    is throttled to ultra-low frequency (every 4s).
 * 3. STRICT SINGLE-TRACK RAM FOOTPRINT: Large audioBlobs are purged from memory immediately
 *    for all non-playing songs. Blobs are loaded from IndexedDB on-demand only for the
 *    currently playing song, and Object URLs are immediately revoked to prevent memory leaks.
 * 4. ON-DEMAND DSP PIPELINE: AnalyserNode (FFT) is connected ONLY while the visualizer
 *    modal is visibly rendering on screen. Dynamics compressor is bypassed when normalizer is off.
 * 5. TRUE SHUFFLE BAG & HISTORY: Non-repeating randomized playback cycle with functional
 *    previous-track shuffle navigation.
 * 6. CLEAN QUEUE & ERROR RECOVERY: Graceful UI reset when queue is emptied, auto-skip on
 *    unplayable or missing audio tracks, and automatic queue scrubbing on song deletion.
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
    this.repeatMode = "all"; // "none", "all", "one"
    this.playbackRate = 1.0;

    // Shuffle Bag & History
    this.shuffleBag = [];
    this.shuffleHistory = [];

    // Sleep Timer state
    this.sleepTimerId = null;
    this.sleepTimerEndTime = null;
    this.sleepTimerMode = null; // "minutes" or "end_of_song"
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
    this.postDSPSum = null;
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
    this._lastMediaSessionUpdate = 0;

    this.initAudioListeners();
    this.initProgressSeekbar();
  }

  // ==========================================
  // HARDWARE LIFECYCLE & EVENT LISTENERS
  // ==========================================

  initAudioListeners() {
    this.audio.addEventListener("play", () => {
      this.isPlaying = true;
      this.songPlayStartTime = Date.now();
      this.updatePlayPauseUI();
      document.body.classList.remove("app-paused");
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      this.triggerStateSave(500);
      this.resumeAudioContext();
    });

    this.audio.addEventListener("pause", () => {
      this.isPlaying = false;
      this.recordListeningTime();
      this.updatePlayPauseUI();
      document.body.classList.add("app-paused");
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      this.triggerStateSave(100);
      this.suspendAudioContext();
    });

    this.audio.addEventListener("timeupdate", () => {
      this.onTimeUpdate();
      // Only throttle state saves if foregrounded to eliminate background storage wakeups
      if (!document.hidden) {
        this.triggerStateSave(3000);
      }
    });

    this.audio.addEventListener("loadedmetadata", () => {
      if (this.audio.duration && (!this.currentSong?.duration || this.currentSong.duration <= 0)) {
        this.currentSong.duration = Math.round(this.audio.duration);
        if (typeof db !== "undefined") {
          db.updateSongDuration(this.currentSong.id, this.currentSong.duration);
        }
      }
      this.onTimeUpdate();
    });

    this.audio.addEventListener("ended", () => this.onEnded());

    this.audio.addEventListener("error", (e) => {
      console.warn("[Anru Player] Audio playback error notice:", e);
      this.isPlaying = false;
      this.updatePlayPauseUI();
      this.suspendAudioContext();
      if (typeof showToast === "function") {
        showToast("⚠️ Could not play audio format. Auto-skipping...");
      }
      // Auto-skip unplayable/corrupted tracks cleanly
      setTimeout(() => this.next(), 600);
    });

    // App visibility listener: aggressive battery protection on screen lock
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        document.body.classList.add("screen-hidden");
        // Screen locked or app minimized: shut down canvas animations
        this.stopVisualizer();
        // If music is paused, suspend audio hardware completely to allow CPU deep sleep
        if (!this.isPlaying) {
          this.suspendAudioContext();
        }
      } else {
        document.body.classList.remove("screen-hidden");
        // App returned to foreground: resume audio hardware if playing
        if (this.isPlaying) {
          this.resumeAudioContext();
          this.onTimeUpdate();
        }
        // Restart visualizer if Equalizer modal is currently open
        const eqModal = document.getElementById("equalizer-modal");
        if (eqModal && !eqModal.classList.contains("hidden")) {
          const canvas = document.getElementById("eq-visualizer");
          if (canvas) this.startVisualizer(canvas);
        }
      }
    });

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => { if (this.audio && this.audio.paused) this.togglePlay(); });
        navigator.mediaSession.setActionHandler("pause", () => { if (this.audio && !this.audio.paused) this.togglePlay(); });
        navigator.mediaSession.setActionHandler("previoustrack", () => this.previous());
        navigator.mediaSession.setActionHandler("nexttrack", () => this.next());
        navigator.mediaSession.setActionHandler("stop", () => {
          this.audio.pause();
          this.suspendAudioContext();
          if (navigator.mediaSession) navigator.mediaSession.playbackState = "none";
        });
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (details.seekTime !== undefined) this.audio.currentTime = details.seekTime;
        });
      } catch (e) {}
    }
  }

  // ==========================================
  // WEB AUDIO DSP GRAPH & ZERO-POWER AUDIO SLEEP
  // ==========================================

  initWebAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      // High-buffer latencyHint ensures crackle-free background playback
      this.audioCtx = new AudioContextClass({
        latencyHint: "playback"
      });

      this.audioCtx.onstatechange = () => {
        if (this.audioCtx && this.audioCtx.state === "suspended" && this.isPlaying) {
          this.audioCtx.resume().catch(() => {});
        }
      };

      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // 1. Headroom Preamp Gain
      this.preampGain = this.audioCtx.createGain();
      this.preampGain.gain.value = 1.0;
      this.sourceNode.connect(this.preampGain);

      // 2. 7-Band Equalizer Filters
      let prevNode = this.preampGain;
      this.eqFilters = this.eqFrequencies.map((freq, idx) => {
        const filter = this.audioCtx.createBiquadFilter();
        if (idx === 0) filter.type = "lowshelf";
        else if (idx === this.eqFrequencies.length - 1) filter.type = "highshelf";
        else filter.type = "peaking";

        filter.frequency.value = freq;
        filter.gain.value = this.eqGains[idx] || 0;
        prevNode.connect(filter);
        prevNode = filter;
        return filter;
      });

      // 3. Extra Bass Boost (lowshelf @ 80Hz)
      this.bassNode = this.audioCtx.createBiquadFilter();
      this.bassNode.type = "lowshelf";
      this.bassNode.frequency.value = 80;
      this.bassNode.gain.value = this.bassBoostGain || 0;
      prevNode.connect(this.bassNode);
      prevNode = this.bassNode;

      // 4. Volume Normalizer (DynamicsCompressorNode + Bypass Path)
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

      // 5. 3D Spatial Virtualizer (Stereo Expansion + Clean Bypass)
      this.virtualizerDirectGain = this.audioCtx.createGain();
      this.virtualizerSpatialGain = this.audioCtx.createGain();
      this.virtualizerDirectGain.gain.value = this.isVirtualizerOn ? 0.0 : 1.0;
      this.virtualizerSpatialGain.gain.value = this.isVirtualizerOn ? 1.0 : 0.0;

      postNormSum.connect(this.virtualizerDirectGain);

      this.virtualizerSplitter = this.audioCtx.createChannelSplitter(2);
      this.virtualizerMerger = this.audioCtx.createChannelMerger(2);
      this.virtualizerDelayNode = this.audioCtx.createDelay();
      this.virtualizerDelayNode.delayTime.value = 0.012;
      this.virtualizerSideGain = this.audioCtx.createGain();
      this.virtualizerSideGain.gain.value = 0.85;

      postNormSum.connect(this.virtualizerSplitter);
      this.virtualizerSplitter.connect(this.virtualizerMerger, 0, 0);
      this.virtualizerSplitter.connect(this.virtualizerDelayNode, 1);
      this.virtualizerDelayNode.connect(this.virtualizerSideGain);
      this.virtualizerSideGain.connect(this.virtualizerMerger, 0, 1);

      this.virtualizerMerger.connect(this.virtualizerSpatialGain);

      this.postDSPSum = this.audioCtx.createGain();
      this.virtualizerDirectGain.connect(this.postDSPSum);
      this.virtualizerSpatialGain.connect(this.postDSPSum);

      // 6. On-Demand Analyser (Prepared, but NOT permanently wired into output chain)
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.75;

      // 7. Brickwall Safety Limiter connects directly to DAC destination
      this.limiterNode = this.audioCtx.createDynamicsCompressor();
      this.limiterNode.threshold.value = -0.5;
      this.limiterNode.knee.value = 0;
      this.limiterNode.ratio.value = 20;
      this.limiterNode.attack.value = 0.001;
      this.limiterNode.release.value = 0.05;

      this.postDSPSum.connect(this.limiterNode);
      this.limiterNode.connect(this.audioCtx.destination);

      this.updatePreampGain();
      console.log("[Anru Audio] Battery-Optimized DSP Graph Active ⚡");
    } catch (err) {
      console.warn("[Anru Audio] Web Audio notice:", err);
    }
  }

  // Suspends AudioContext hardware stream to release audio wakelock & save battery
  async suspendAudioContext() {
    if (this.audioCtx && this.audioCtx.state === "running") {
      try {
        await this.audioCtx.suspend();
      } catch (e) {}
    }
  }

  // Resumes AudioContext hardware stream immediately on playback start
  async resumeAudioContext() {
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      try {
        await this.audioCtx.resume();
      } catch (e) {}
    }
  }

  updatePreampGain() {
    if (!this.preampGain || !this.audioCtx) return;
    const maxBoost = Math.max(0, ...this.eqGains, this.bassBoostGain || 0);
    const reductionDb = maxBoost > 0 ? (maxBoost * 0.7) : 0;
    const targetGain = Math.pow(10, -reductionDb / 20);
    this.preampGain.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
  }

  toggleVirtualizer(enable) {
    this.isVirtualizerOn = !!enable;
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      if (this.virtualizerDirectGain && this.virtualizerSpatialGain) {
        this.virtualizerDirectGain.gain.setValueAtTime(this.isVirtualizerOn ? 0.0 : 1.0, now);
        this.virtualizerSpatialGain.gain.setValueAtTime(this.isVirtualizerOn ? 1.0 : 0.0, now);
      }
    }
    if (typeof db !== "undefined") {
      db.setSetting("virtualizer_enabled", this.isVirtualizerOn);
    }
    const btn = document.getElementById("fs-3d-toggle-btn");
    if (btn) btn.classList.toggle("active", this.isVirtualizerOn);
    if (typeof showToast === "function") {
      showToast(this.isVirtualizerOn ? "3D Spatial Audio: ON 🎧" : "3D Spatial Audio: OFF");
    }
  }

  toggleNormalizer(enable) {
    this.isNormalizerOn = !!enable;
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      if (this.normalizerBypassGain && this.normalizerActiveGain) {
        this.normalizerBypassGain.gain.setValueAtTime(this.isNormalizerOn ? 0.0 : 1.0, now);
        this.normalizerActiveGain.gain.setValueAtTime(this.isNormalizerOn ? 1.0 : 0.0, now);
      }
    }
    if (typeof db !== "undefined") {
      db.setSetting("normalizer_enabled", this.isNormalizerOn);
    }
    const btn = document.getElementById("fs-norm-toggle-btn");
    if (btn) btn.classList.toggle("active", this.isNormalizerOn);
    if (typeof showToast === "function") {
      showToast(this.isNormalizerOn ? "Auto Volume Normalizer: ON 🔊" : "Auto Volume Normalizer: OFF");
    }
  }

  // ==========================================
  // REAL-TIME VISUALIZER (ON-DEMAND ACTIVATION)
  // ==========================================

  startVisualizer(canvas) {
    if (!canvas) return;
    this.stopVisualizer();

    this.initWebAudio();
    this.resumeAudioContext();

    // Connect analyser only when visualizer is visible
    if (this.postDSPSum && this.analyser) {
      try {
        this.postDSPSum.connect(this.analyser);
      } catch (e) {}
    }

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const numBars = 16;
    const dataArray = new Uint8Array(this.analyser ? this.analyser.frequencyBinCount : 32);

    const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
    grad.addColorStop(0, "#00f2fe");
    grad.addColorStop(0.5, "#a855f7");
    grad.addColorStop(1, "#ec4899");

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
        let barH = 4;
        if (hasAudio) {
          const val = dataArray[i * 2] || 0;
          barH = Math.max(4, (val / 255) * (height - 8));
        } else {
          barH = Math.max(3, Math.sin(idlePhase + (i * 0.4)) * (height * 0.18) + (height * 0.22));
        }

        const x = i * (barWidth + barSpacing) + (barSpacing / 2);
        const y = height - barH;

        ctx.fillStyle = grad;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barWidth, barH);
        }
      }

      if (!hasAudio) idlePhase += 0.05;
    };

    render();
  }

  stopVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
      this.visualizerAnimationId = null;
    }
    // Disconnect analyser to save CPU cycles from background FFT calculation
    if (this.postDSPSum && this.analyser) {
      try {
        this.postDSPSum.disconnect(this.analyser);
      } catch (e) {}
    }
  }

  setEQGain(bandIndex, gainVal) {
    this.eqGains[bandIndex] = gainVal;
    if (this.eqFilters[bandIndex]) {
      this.eqFilters[bandIndex].gain.value = gainVal;
    }
    this.updatePreampGain();
    if (typeof db !== "undefined") {
      db.setSetting("eq_gains_v16", this.eqGains);
    }
  }

  setBassBoost(gainVal) {
    this.bassBoostGain = gainVal;
    if (this.bassNode) {
      this.bassNode.gain.value = gainVal;
    }
    this.updatePreampGain();
    if (typeof db !== "undefined") {
      db.setSetting("bass_boost_gain", this.bassBoostGain);
    }
  }

  applyEQPreset(presetName) {
    const presets = {
      flat: [0, 0, 0, 0, 0, 0, 0],
      bass_boost: [6, 4, 2, 0, 0, 1, 2],
      electronic: [5, 4, 1, 0, 2, 4, 5],
      rock: [4, 3, -1, -2, 1, 3, 5],
      vocal: [-2, -1, 1, 4, 4, 2, 0],
      audiophile: [1, 0, -1, 0, 1, 2, 3]
    };
    const gains = presets[presetName] || presets.flat;
    gains.forEach((g, idx) => {
      this.setEQGain(idx, g);
      const slider = document.getElementById(`eq-band-${idx}`);
      const valText = document.getElementById(`eq-val-${idx}`);
      if (slider) slider.value = g;
      if (valText) valText.textContent = `${g > 0 ? "+" : ""}${g}dB`;
    });
    if (presetName === "bass_boost") {
      this.setBassBoost(6);
      const bSlider = document.getElementById("bass-boost-slider");
      const bVal = document.getElementById("bass-val");
      if (bSlider) bSlider.value = 6;
      if (bVal) bVal.textContent = "+6dB";
    }
    if (typeof showToast === "function") {
      showToast(`Applied EQ Preset: ${presetName.toUpperCase().replace("_", " ")}`);
    }
  }

  // ==========================================
  // RAM & MEMORY CLEANUP ENGINE
  // ==========================================

  // Purge raw audio binary blobs from RAM for all non-playing tracks
  cleanupMemoryBlobs(activeSongId = null) {
    if (this.queue && Array.isArray(this.queue)) {
      this.queue.forEach(song => {
        if (song && song.id !== activeSongId && song.audioBlob) {
          delete song.audioBlob;
        }
      });
    }
    if (typeof allLibrarySongs !== "undefined" && Array.isArray(allLibrarySongs)) {
      allLibrarySongs.forEach(song => {
        if (song && song.id !== activeSongId && song.audioBlob) {
          delete song.audioBlob;
        }
      });
    }
  }

  // ==========================================
  // PLAYBACK CONTROL & SHUFFLE BAG ENGINE
  // ==========================================

  initShuffleBag() {
    this.shuffleBag = [];
    this.shuffleHistory = [];
    this.refillShuffleBag();
  }

  refillShuffleBag() {
    const indices = [];
    for (let i = 0; i < this.queue.length; i++) {
      if (i !== this.currentIndex) indices.push(i);
    }
    // Fisher-Yates non-repeating shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.shuffleBag = indices;
  }

  async playSong(song, newQueue = null) {
    if (!song) return;

    this.recordListeningTime();

    if (newQueue && Array.isArray(newQueue)) {
      this.queue = [...newQueue];
      this.currentIndex = this.queue.findIndex(s => s.id === song.id);
      this.initShuffleBag();
    } else if (!this.queue.some(s => s.id === song.id)) {
      this.queue.push(song);
      this.currentIndex = this.queue.length - 1;
      if (this.isShuffle) this.refillShuffleBag();
    } else {
      this.currentIndex = this.queue.findIndex(s => s.id === song.id);
    }

    this.currentSong = song;
    this.songPlayStartTime = Date.now();

    // Revoke previous blob URL immediately to avoid memory leak
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    // Keep ONLY the active song in RAM: drop blobs of all other tracks
    this.cleanupMemoryBlobs(song.id);

    // Stream on-demand from IndexedDB
    let blob = song.audioBlob;
    if (!blob && typeof db !== "undefined") {
      try {
        blob = await db.getSongBlob(song.id);
      } catch (e) {}
    }

    if (blob) {
      song.audioBlob = blob; // Kept in memory only while playing!
      this.currentObjectUrl = URL.createObjectURL(blob);
      this.audio.src = this.currentObjectUrl;
    } else if (song.audioUrl) {
      this.audio.src = song.audioUrl;
    } else {
      if (typeof showToast === "function") {
        showToast(`⚠️ No audio file for "${song.title}". Auto-skipping...`);
      }
      setTimeout(() => this.next(), 300);
      return;
    }

    this.audio.playbackRate = this.playbackRate;
    if (this.audio && typeof this.audio.load === "function") this.audio.load();

    const playPromise = (this.audio && typeof this.audio.play === "function") ? this.audio.play() : undefined;
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn("[Anru Player] Playback notice:", err);
      });
    }

    this.initWebAudio();
    this.resumeAudioContext();

    this.generateWaveformBars(song);
    this.updateTrackUI();
    this.updateMediaSession();
    this.renderQueueDrawer();
    this.triggerStateSave(500);
  }

  // Restore player state on app reload without auto-playing aloud
  async loadSavedState(state, allSongs) {
    if (!state || !state.songId || !allSongs || allSongs.length === 0) return;
    const targetSong = allSongs.find(s => s.id === state.songId);
    if (!targetSong) return;

    if (state.queueSongIds && Array.isArray(state.queueSongIds)) {
      this.queue = state.queueSongIds
        .map(id => allSongs.find(s => s.id === id))
        .filter(Boolean);
    }
    if (this.queue.length === 0) {
      this.queue = [targetSong];
    }
    this.currentIndex = this.queue.findIndex(s => s.id === targetSong.id);
    if (this.currentIndex < 0) this.currentIndex = 0;

    this.currentSong = targetSong;
    this.isShuffle = !!state.isShuffle;
    this.repeatMode = state.repeatMode || "all";

    if (this.isShuffle) this.initShuffleBag();

    // Stream on demand from IndexedDB
    let blob = targetSong.audioBlob;
    if (!blob && typeof db !== "undefined") {
      try {
        blob = await db.getSongBlob(targetSong.id);
      } catch (e) {}
    }

    if (blob) {
      targetSong.audioBlob = blob;
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
    console.log("[Anru Player] Resumed saved playback state at:", state.currentTime, "s");
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
    if (this.currentSong && typeof db !== "undefined") {
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
      if (listenedSec >= 5 && typeof db !== "undefined") {
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
      this.resumeAudioContext();
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
      this.suspendAudioContext();
    }
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.isShuffle && this.queue.length > 1) {
      if (!this.shuffleBag || this.shuffleBag.length === 0) {
        this.refillShuffleBag();
      }
      if (this.shuffleBag.length > 0) {
        if (this.currentIndex >= 0) {
          if (!this.shuffleHistory) this.shuffleHistory = [];
          this.shuffleHistory.push(this.currentIndex);
          if (this.shuffleHistory.length > 50) this.shuffleHistory.shift();
        }
        const nextIndex = this.shuffleBag.pop();
        this.playSong(this.queue[nextIndex]);
        return;
      }
    }

    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === "all") {
        nextIndex = 0;
      } else {
        // Natural end of queue reached without repeat
        this.onQueueFinished();
        return;
      }
    }

    if (this.currentIndex >= 0) {
      if (!this.shuffleHistory) this.shuffleHistory = [];
      this.shuffleHistory.push(this.currentIndex);
      if (this.shuffleHistory.length > 50) this.shuffleHistory.shift();
    }
    this.playSong(this.queue[nextIndex]);
  }

  previous() {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    // In shuffle mode, navigate back through shuffle history
    if (this.isShuffle && this.shuffleHistory && this.shuffleHistory.length > 0) {
      const prevIdx = this.shuffleHistory.pop();
      if (prevIdx >= 0 && prevIdx < this.queue.length) {
        this.playSong(this.queue[prevIdx]);
        return;
      }
    }

    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) prevIndex = this.queue.length - 1;
    this.playSong(this.queue[prevIndex]);
  }

  onEnded() {
    this.recordListeningTime();

    if (this.sleepTimerMode === "end_of_song") {
      this.audio.pause();
      this.suspendAudioContext();
      this.cancelSleepTimer();
      if (typeof showToast === "function") showToast("🌙 Sleep timer: playback paused.");
      return;
    }

    if (this.repeatMode === "one") {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    } else {
      this.next();
    }
  }

  onQueueFinished() {
    this.isPlaying = false;
    this.audio.pause();
    this.suspendAudioContext();
    this.updatePlayPauseUI();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    if (typeof showToast === "function") showToast("Queue playback completed 🎵");
  }

  // ==========================================
  // PROGRESS & INTERPOLATION (THROTTLED IN BG)
  // ==========================================

  onTimeUpdate() {
    if (!this.currentSong) return;

    const cur = this.audio.currentTime || 0;
    const dur = this.audio.duration || this.currentSong?.duration || 1;
    const pct = Math.min(100, Math.max(0, (cur / dur) * 100));

    // BATTERY CRITICAL: Skip all DOM queries and canvas renders when screen is hidden
    if (document.hidden) {
      if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession && this.audio.duration && !isNaN(this.audio.duration)) {
        const now = Date.now();
        if (now - (this._lastMediaSessionUpdate || 0) > 4000) {
          this._lastMediaSessionUpdate = now;
          try {
            navigator.mediaSession.setPositionState({
              duration: this.audio.duration,
              playbackRate: this.audio.playbackRate || 1.0,
              position: Math.min(this.audio.duration, Math.max(0, cur))
            });
          } catch (e) {}
        }
      }
      return;
    }

    // Active foreground UI updates
    const progressFill = document.getElementById("fs-progress-fill");
    const progressThumb = document.getElementById("fs-progress-thumb");
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressThumb) progressThumb.style.left = `${pct}%`;

    const miniFill = document.getElementById("mini-progress-fill");
    if (miniFill) miniFill.style.width = `${pct}%`;

    const curTimeEl = document.getElementById("fs-curr-time");
    const durTimeEl = document.getElementById("fs-duration");
    if (curTimeEl) curTimeEl.textContent = this.formatTime(cur);
    if (durTimeEl) durTimeEl.textContent = this.formatTime(dur);

    // Update Waveform Seekbar Canvas
    this.drawWaveformSeekbar(pct);

    // Foreground MediaSession Position State
    if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession && this.audio.duration && !isNaN(this.audio.duration)) {
      const now = Date.now();
      if (now - (this._lastMediaSessionUpdate || 0) > 2000) {
        this._lastMediaSessionUpdate = now;
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
    const progressWrap = document.getElementById("fs-progress-wrap");
    if (!progressWrap) return;

    const handleSeek = (e) => {
      const rect = progressWrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = (clickX / rect.width) * 100;
      this.seek(pct);
    };

    progressWrap.addEventListener("click", handleSeek);

    let isSeeking = false;
    progressWrap.addEventListener("mousedown", (e) => { isSeeking = true; handleSeek(e); });
    window.addEventListener("mousemove", (e) => { if (isSeeking) handleSeek(e); });
    window.addEventListener("mouseup", () => { isSeeking = false; });

    progressWrap.addEventListener("touchstart", (e) => { isSeeking = true; handleSeek(e); }, { passive: true });
    window.addEventListener("touchmove", (e) => { if (isSeeking) handleSeek(e); }, { passive: true });
    window.addEventListener("touchend", () => { isSeeking = false; });
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
    const speedBtn = document.getElementById("fs-speed-btn");
    if (speedBtn) speedBtn.textContent = `${rate}x`;
    if (typeof showToast === "function") showToast(`Speed: ${rate}x`);
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle) this.initShuffleBag();
    const btn = document.getElementById("fs-shuffle-btn");
    if (btn) btn.classList.toggle("active", this.isShuffle);
    if (typeof showToast === "function") showToast(this.isShuffle ? "Shuffle: ON 🔀" : "Shuffle: OFF");
    this.triggerStateSave(100);
  }

  toggleRepeat() {
    const btn = document.getElementById("fs-repeat-btn");
    if (this.repeatMode === "all") {
      this.repeatMode = "one";
      if (btn) { btn.classList.add("active"); btn.innerHTML = '<i class="fa-solid fa-repeat"></i><span class="repeat-one-sub">1</span>'; }
      if (typeof showToast === "function") showToast("Repeat: Current Track 🔂");
    } else if (this.repeatMode === "one") {
      this.repeatMode = "none";
      if (btn) { btn.classList.remove("active"); btn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; }
      if (typeof showToast === "function") showToast("Repeat: OFF");
    } else {
      this.repeatMode = "all";
      if (btn) { btn.classList.add("active"); btn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; }
      if (typeof showToast === "function") showToast("Repeat: All 🔁");
    }
    this.triggerStateSave(100);
  }

  // ==========================================
  // INTERACTIVE WAVEFORM SEEKBAR
  // ==========================================

  generateWaveformBars(song) {
    if (!song) return;
    const str = ((song.title || "") + (song.artist || "") + (song.duration || 180)).toLowerCase();
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

    canvas.addEventListener("click", seekWithEvent);

    let isDragging = false;
    canvas.addEventListener("mousedown", (e) => { isDragging = true; seekWithEvent(e); });
    window.addEventListener("mousemove", (e) => { if (isDragging) seekWithEvent(e); });
    window.addEventListener("mouseup", () => { isDragging = false; });

    canvas.addEventListener("touchstart", (e) => { isDragging = true; seekWithEvent(e); }, { passive: true });
    window.addEventListener("touchmove", (e) => { if (isDragging) seekWithEvent(e); }, { passive: true });
    window.addEventListener("touchend", () => { isDragging = false; });
  }

  drawWaveformSeekbar(progressPct = 0) {
    if (document.hidden) return;

    const fsPlayer = document.getElementById("fullscreen-player");
    if (!fsPlayer || fsPlayer.classList.contains("hidden")) return;

    if (!this.waveformCanvas) {
      this.waveformCanvas = document.getElementById("fs-waveform-canvas");
      if (this.waveformCanvas) this.initWaveformCanvas(this.waveformCanvas);
    }
    if (!this.waveformCanvas) return;

    const rect = this.waveformCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (targetW > 0 && targetH > 0 && (this.waveformCanvas.width !== targetW || this.waveformCanvas.height !== targetH)) {
      this.waveformCanvas.width = targetW;
      this.waveformCanvas.height = targetH;
    }

    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (this.waveformBars.length === 0) {
      this.generateWaveformBars(this.currentSong || { title: "Audio" });
    }

    const totalBars = this.waveformBars.length;
    const barWidth = 4;
    const barSpacing = (width - (totalBars * barWidth)) / Math.max(1, totalBars - 1);
    const splitX = (progressPct / 100) * width;

    const playedGrad = ctx.createLinearGradient(0, height, 0, 0);
    playedGrad.addColorStop(0, "#ec4899");
    playedGrad.addColorStop(1, "#a855f7");

    for (let i = 0; i < totalBars; i++) {
      const barH = this.waveformBars[i] * height;
      const x = i * (barWidth + barSpacing);
      const y = (height - barH) / 2;

      ctx.beginPath();
      if (x <= splitX) {
        ctx.fillStyle = playedGrad;
        ctx.shadowColor = "rgba(168, 85, 247, 0.4)";
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.shadowColor = "transparent";
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
  // MOBILE TOUCH SWIPE GESTURES
  // ==========================================

  initSwipeGestures() {
    const mini = document.getElementById("mini-player");
    let touchStartX = 0;
    let touchStartY = 0;

    if (mini) {
      mini.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      mini.addEventListener("touchend", (e) => {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            this.next();
          } else {
            this.previous();
          }
        }
      });
    }

    const fsPlayer = document.getElementById("fullscreen-player");
    let fsTouchStartY = 0;
    let fsTouchStartX = 0;

    if (fsPlayer) {
      fsPlayer.addEventListener("touchstart", (e) => {
        fsTouchStartY = e.touches[0].clientY;
        fsTouchStartX = e.touches[0].clientX;
      }, { passive: true });

      fsPlayer.addEventListener("touchend", (e) => {
        const deltaY = e.changedTouches[0].clientY - fsTouchStartY;
        const deltaX = e.changedTouches[0].clientX - fsTouchStartX;

        if (deltaY > 90 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
          const fsModal = document.getElementById("fullscreen-player");
          if (fsModal) fsModal.classList.add("hidden");
        }
      });
    }
  }

  // ==========================================
  // QUEUE MANAGEMENT & RECOVERY
  // ==========================================

  playNext(song) {
    if (!song) return;
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      this.queue.splice(this.currentIndex + 1, 0, song);
    } else {
      this.queue.push(song);
    }
    if (this.isShuffle) this.refillShuffleBag();
    this.renderQueueDrawer();
    this.triggerStateSave(100);
    if (typeof showToast === "function") showToast(`Playing next: "${song.title}"`);
  }

  addToQueue(song) {
    if (!song) return;
    this.queue.push(song);
    if (this.isShuffle) this.refillShuffleBag();
    this.renderQueueDrawer();
    this.triggerStateSave(100);
    if (typeof showToast === "function") showToast(`Added to queue: "${song.title}"`);
  }

  moveQueueItem(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= this.queue.length || toIndex >= this.queue.length) return;
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    if (this.currentSong) {
      this.currentIndex = this.queue.findIndex(s => s.id === this.currentSong.id);
    }
    if (this.isShuffle) this.refillShuffleBag();
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
        this.suspendAudioContext();
        this.resetPlayerUI();
      }
    } else {
      this.queue.splice(index, 1);
      if (index < this.currentIndex) {
        this.currentIndex--;
      }
    }
    if (this.isShuffle) this.refillShuffleBag();
    this.renderQueueDrawer();
    this.triggerStateSave(100);
  }

  // Remove song by ID from queue when deleted from library
  removeSongById(songId) {
    if (!songId) return;
    const index = this.queue.findIndex(s => s.id === songId);
    if (index >= 0) {
      this.removeFromQueue(index);
    }
  }

  // Remove multiple songs by ID when batch deleted
  removeSongsByIds(songIds) {
    if (!songIds || songIds.length === 0) return;
    const idSet = new Set(songIds);
    const wasPlayingDeleted = this.currentSong && idSet.has(this.currentSong.id);

    this.queue = this.queue.filter(s => !idSet.has(s.id));
    if (this.queue.length === 0) {
      this.audio.pause();
      this.suspendAudioContext();
      this.resetPlayerUI();
    } else if (wasPlayingDeleted) {
      let nextIndex = Math.min(this.currentIndex, this.queue.length - 1);
      if (nextIndex < 0) nextIndex = 0;
      this.playSong(this.queue[nextIndex]);
    } else if (this.currentSong) {
      this.currentIndex = this.queue.findIndex(s => s.id === this.currentSong.id);
    }
    if (this.isShuffle) this.refillShuffleBag();
    this.renderQueueDrawer();
    this.triggerStateSave(100);
  }

  clearUpcomingQueue() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      this.queue = [this.queue[this.currentIndex]];
      this.currentIndex = 0;
    } else {
      this.queue = [];
      this.audio.pause();
      this.suspendAudioContext();
      this.resetPlayerUI();
    }
    if (this.isShuffle) this.refillShuffleBag();
    this.renderQueueDrawer();
    this.triggerStateSave(100);
    if (typeof showToast === "function") showToast("Upcoming queue cleared 🧹");
  }

  resetPlayerUI() {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    this.cleanupMemoryBlobs(null);
    this.audio.src = "";
    this.currentSong = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.updatePlayPauseUI();

    // Hide Mini Player when nothing is loaded or playing
    const miniPlayer = document.getElementById("mini-player");
    if (miniPlayer) {
      miniPlayer.classList.add("hidden");
    }

    // Reset Mini Player
    const miniTitle = document.getElementById("mini-title");
    const miniArtist = document.getElementById("mini-artist");
    const miniThumb = document.getElementById("mini-thumb") || document.getElementById("mini-art");
    const miniFill = document.getElementById("mini-progress-fill");
    if (miniTitle) miniTitle.textContent = "Select a Song";
    if (miniArtist) miniArtist.textContent = "Artist";
    if (miniThumb) miniThumb.src = "icon-512.png";
    if (miniFill) miniFill.style.width = "0%";

    // Reset Fullscreen Player
    const fsTitle = document.getElementById("fs-title");
    const fsArtist = document.getElementById("fs-artist");
    const fsArt = document.getElementById("fs-art");
    const fsProgressFill = document.getElementById("fs-progress-fill");
    const fsProgressThumb = document.getElementById("fs-progress-thumb");
    const fsCurrTime = document.getElementById("fs-curr-time");
    const fsDuration = document.getElementById("fs-duration");
    if (fsTitle) fsTitle.textContent = "No track playing";
    if (fsArtist) fsArtist.textContent = "Select a song from library";
    if (fsArt) fsArt.src = "icon-512.png";
    if (fsProgressFill) fsProgressFill.style.width = "0%";
    if (fsProgressThumb) fsProgressThumb.style.left = "0%";
    if (fsCurrTime) fsCurrTime.textContent = "0:00";
    if (fsDuration) fsDuration.textContent = "0:00";

    this.waveformBars = [];
    if (this.waveformCanvas) {
      const ctx = this.waveformCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
  }

  renderQueueDrawer() {
    const nowPlayingBox = document.getElementById("queue-now-playing");
    const upcomingList = document.getElementById("queue-upcoming-list");
    const headerCount = document.getElementById("fs-queue-count");

    if (headerCount) headerCount.textContent = `${this.queue.length}`;

    if (nowPlayingBox) {
      if (this.currentSong) {
        nowPlayingBox.innerHTML = `
          <img src="${this.currentSong.artwork || "icon-512.png"}" class="queue-thumb" alt="cover" onerror="this.src='icon-512.png'">
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

    if (upcomingList) {
      upcomingList.innerHTML = "";

      if (this.queue.length === 0) {
        upcomingList.innerHTML = '<div class="empty-sub">Queue is empty. Tap any song in Library to play!</div>';
        return;
      }

      this.queue.forEach((song, idx) => {
        const isNowPlaying = idx === this.currentIndex;
        const row = document.createElement("div");
        row.className = `queue-row ${isNowPlaying ? "now-playing" : ""}`;
        row.dataset.index = idx;
        row.draggable = true;

        row.innerHTML = `
          <div class="queue-drag-handle" title="Hold & Drag to reorder"><i class="fa-solid fa-grip-lines"></i></div>
          <img src="${song.artwork || "icon-512.png"}" class="queue-thumb queue-row-thumb" alt="cover" onerror="this.src='icon-512.png'">
          <div class="queue-info">
            <div class="queue-title ${isNowPlaying ? "highlight" : ""}">${escapeHtml(song.title)}</div>
            <div class="queue-artist">${escapeHtml(song.artist)}</div>
          </div>
          <div class="queue-actions">
            ${idx > 0 ? `<button class="queue-btn move-up" title="Move Up"><i class="fa-solid fa-chevron-up"></i></button>` : ""}
            ${idx < this.queue.length - 1 ? `<button class="queue-btn move-down" title="Move Down"><i class="fa-solid fa-chevron-down"></i></button>` : ""}
            <button class="queue-btn remove-track" title="Remove"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `;

        row.querySelector(".queue-info")?.addEventListener("click", () => {
          this.playSong(song);
        });

        row.querySelector(".move-up")?.addEventListener("click", (e) => {
          e.stopPropagation();
          this.moveQueueItem(idx, idx - 1);
        });

        row.querySelector(".move-down")?.addEventListener("click", (e) => {
          e.stopPropagation();
          this.moveQueueItem(idx, idx + 1);
        });

        row.querySelector(".remove-track")?.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeFromQueue(idx);
        });

        // Desktop Drag and Drop
        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", idx);
          row.classList.add("touch-dragging");
        });

        row.addEventListener("dragend", () => {
          row.classList.remove("touch-dragging");
          upcomingList.querySelectorAll(".queue-row").forEach(r => r.classList.remove("drag-over"));
        });

        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          row.classList.add("drag-over");
        });

        row.addEventListener("dragleave", () => {
          row.classList.remove("drag-over");
        });

        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.classList.remove("drag-over");
          const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
          const toIndex = idx;
          if (!isNaN(fromIndex) && fromIndex !== toIndex) {
            this.moveQueueItem(fromIndex, toIndex);
          }
        });

        // Mobile Touch Drag Handle
        const handle = row.querySelector(".queue-drag-handle");
        if (handle) {
          handle.addEventListener("touchstart", (e) => {
            row.classList.add("touch-dragging");
            if (navigator.vibrate) navigator.vibrate(25);
          }, { passive: true });

          handle.addEventListener("touchmove", (e) => {
            const currentY = e.touches[0].clientY;
            const elementUnder = document.elementFromPoint(e.touches[0].clientX, currentY);
            const targetRow = elementUnder?.closest(".queue-row");
            
            upcomingList.querySelectorAll(".queue-row").forEach(r => r.classList.remove("drag-over"));
            if (targetRow && targetRow !== row) {
              targetRow.classList.add("drag-over");
            }
          }, { passive: true });

          handle.addEventListener("touchend", (e) => {
            row.classList.remove("touch-dragging");
            const endY = e.changedTouches[0].clientY;
            const elementUnder = document.elementFromPoint(e.changedTouches[0].clientX, endY);
            const targetRow = elementUnder?.closest(".queue-row");
            upcomingList.querySelectorAll(".queue-row").forEach(r => r.classList.remove("drag-over"));

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
  // SLEEP TIMER ENGINE (WITH ZERO-POWER SHUTDOWN)
  // ==========================================

  startSleepTimer(minutes) {
    this.cancelSleepTimer();

    this._preTimerVolume = this.audio.volume;

    if (minutes === "end_of_song") {
      this.sleepTimerMode = "end_of_song";
      if (typeof showToast === "function") showToast("🌙 Sleep timer: stops after current song");
      this.updateSleepTimerUI();
      return;
    }

    const mins = parseInt(minutes, 10);
    if (isNaN(mins) || mins <= 0) return;

    this.sleepTimerMode = "minutes";
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
        this.suspendAudioContext();
        this.cancelSleepTimer();
        if (typeof showToast === "function") showToast("🌙 Sleep timer completed. Good night!");
      }
    }, 1000);

    if (typeof showToast === "function") showToast(`🌙 Sleep timer set for ${mins} minutes`);
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
    const badge = document.getElementById("sleep-timer-badge");
    const fsBadge = document.getElementById("fs-sleep-badge");

    if (!this.sleepTimerMode) {
      if (badge) badge.classList.add("hidden");
      if (fsBadge) fsBadge.classList.add("hidden");
      return;
    }

    if (this.sleepTimerMode === "end_of_song") {
      if (badge) { badge.classList.remove("hidden"); badge.textContent = "End of song"; }
      if (fsBadge) { fsBadge.classList.remove("hidden"); fsBadge.textContent = "End of song"; }
      return;
    }

    const totalSec = Math.floor(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const str = `${m}:${s < 10 ? "0" : ""}${s}`;

    if (badge) { badge.classList.remove("hidden"); badge.textContent = str; }
    if (fsBadge) { fsBadge.classList.remove("hidden"); fsBadge.textContent = str; }
  }

  // ==========================================
  // UI SYNC & MEDIA SESSION
  // ==========================================

  updateTrackUI() {
    if (!this.currentSong) return;
    const song = this.currentSong;

    // Immediately reveal floating mini-player controller at bottom
    const miniPlayer = document.getElementById("mini-player");
    if (miniPlayer) {
      miniPlayer.classList.remove("hidden");
    }

    // Update Mini Player metadata
    const miniTitle = document.getElementById("mini-title");
    const miniArtist = document.getElementById("mini-artist");
    const miniThumb = document.getElementById("mini-thumb") || document.getElementById("mini-art");

    if (miniTitle) miniTitle.textContent = song.title;
    if (miniArtist) miniArtist.textContent = song.artist;
    if (miniThumb) miniThumb.src = song.artwork || "icon-512.png";

    // Update Fullscreen Player metadata
    const fsTitle = document.getElementById("fs-title");
    const fsArtist = document.getElementById("fs-artist");
    const fsAlbum = document.getElementById("fs-header-album") || document.getElementById("fs-album");
    const fsArtwork = document.getElementById("fs-artwork") || document.getElementById("fs-art");

    if (fsTitle) fsTitle.textContent = song.title;
    if (fsArtist) fsArtist.textContent = song.artist;
    if (fsAlbum) fsAlbum.textContent = song.album || "Offline Music";
    if (fsArtwork) fsArtwork.src = song.artwork || "icon-512.png";

    const likeBtn = document.getElementById("fs-like-btn");
    if (typeof db !== "undefined" && likeBtn) {
      db.isFavorite(song.id).then(isFav => {
        likeBtn.classList.toggle("active", isFav);
        const icon = likeBtn.querySelector("i");
        if (icon) {
          icon.className = isFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
        }
      });
    }

    // Highlight currently playing song row in library list
    document.querySelectorAll(".song-row").forEach(row => {
      const isCurrent = row.dataset.id === song.id;
      row.classList.toggle("playing", isCurrent);
      const playHover = row.querySelector(".row-play-hover i");
      if (playHover) {
        playHover.className = (isCurrent && this.isPlaying) ? "fa-solid fa-pause" : "fa-solid fa-play";
      }
    });

    this.updatePlayPauseUI();
  }

  updatePlayPauseUI() {
    const miniPlayIcon = document.querySelector("#mini-play-btn i") || document.getElementById("mini-play-icon");
    const fsPlayIcon = document.querySelector("#fs-play-btn i");
    const vinylBox = document.querySelector(".fs-vinyl-box");
    const miniEq = document.getElementById("mini-equalizer");

    if (this.isPlaying) {
      if (miniPlayIcon) { miniPlayIcon.classList.remove("fa-play"); miniPlayIcon.classList.add("fa-pause"); }
      if (fsPlayIcon) { fsPlayIcon.classList.remove("fa-play"); fsPlayIcon.classList.add("fa-pause"); }
      if (vinylBox) vinylBox.classList.add("rotating");
      if (miniEq) miniEq.classList.remove("hidden");
    } else {
      if (miniPlayIcon) { miniPlayIcon.classList.remove("fa-pause"); miniPlayIcon.classList.add("fa-play"); }
      if (fsPlayIcon) { fsPlayIcon.classList.remove("fa-pause"); fsPlayIcon.classList.add("fa-play"); }
      if (vinylBox) vinylBox.classList.remove("rotating");
      if (miniEq) miniEq.classList.add("hidden");
    }

    if (this.currentSong) {
      document.querySelectorAll(".song-row").forEach(row => {
        const isCurrent = row.dataset.id === this.currentSong.id;
        row.classList.toggle("playing", isCurrent);
        const playHover = row.querySelector(".row-play-hover i");
        if (playHover) {
          playHover.className = (isCurrent && this.isPlaying) ? "fa-solid fa-pause" : "fa-solid fa-play";
        }
      });
    }
  }

  updateMediaSession() {
    if (!("mediaSession" in navigator) || !this.currentSong) return;
    const song = this.currentSong;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album || "Anru Studio",
        artwork: [
          { src: song.artwork || "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      });
    } catch (e) {}
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }
}

const player = new AudioPlayer();
if (typeof window !== "undefined") window.player = player;
if (typeof globalThis !== "undefined") globalThis.player = player;
