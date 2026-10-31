/**
 * ANRU VIDEO STUDIO PRO v27.0 - STANDALONE PLAYIT 4K HDR ENGINE (video.js)
 *
 * Key Features:
 * 1. ZERO-COPY DIRECT PHONE STREAMING: Reads video files directly from local storage via
 *    FileSystemDirectoryHandle / File references without copying gigabytes into Chrome IndexedDB.
 * 2. 1-CLICK CINEMA HDR BOOST: Combines SVG Unsharp-Mask Convolution + Color Vibrance Matrix +
 *    dynamic contrast/saturation tuning for instant PLAYit-style HDR visual pop.
 * 3. 200% VOLUME BOOSTER & 3D SURROUND AUDIO: Web Audio API GainNode (up to 200%), 80Hz Bass Boost,
 *    and Binaural Haas 3D Spatial Surround with automatic AudioContext suspension on pause/close.
 * 4. PLAYIT SMART TOUCH GESTURES:
 *    - Left Vertical Swipe: Brightness control (20% to 150%)
 *    - Right Vertical Swipe: Volume & 200% Audio Booster (0% to 200%)
 *    - Horizontal Swipe / Double-Tap Left & Right: Instant ±10s Seek with HUD feedback
 * 5. POP-UP PIP, BACKGROUND AUDIO MODE, CHILD SCREEN LOCK, ASPECT RATIO, SPEED & AUTO-RESUME.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class PlayItVideoStudio {
  constructor() {
    this.videos = []; // Array of { id, title, folder, fileSize, duration, thumb, lastTime, file, fileHandle, dateModified }
    this.sessionFiles = new Map(); // id -> File or FileSystemFileHandle
    this.sessionByKey = new Map(); // "fileSize|fileName" -> File or Handle

    this.viewMode = 'all'; // 'all' or 'folders'
    this.activeFolder = null;
    this.currentVideo = null;
    this.currentIndex = -1;
    this.currentObjectUrl = null;

    // Player Enhancements & States
    this.isHdrOn = false;
    this.is3dAudioOn = false;
    this.isLocked = false;
    this.isBackgroundAudioMode = false;
    this.volumePct = 100; // 0 to 200%
    this.brightnessPct = 100; // 20 to 150%
    this.playbackSpeeds = [0.75, 1.0, 1.25, 1.5, 2.0];
    this.playbackRate = 1.0;
    this.aspectModes = ['fit', 'fill', '16-9', 'stretch'];
    this.aspectLabels = { 'fit': 'Fit', 'fill': 'Crop', '16-9': '16:9', 'stretch': 'Stretch' };
    this.aspectIndex = 0;

    // Web Audio 200% Booster + 3D Surround
    this.audioCtx = null;
    this.sourceNode = null;
    this.boostGainNode = null;
    this.bassFilterNode = null;
    this.directGainNode = null;
    this.spatialGainNode = null;
    this.limiterNode = null;

    // Timers
    this._hudHideTimer = null;
    this._gestureHudTimer = null;
    this._lastSaveTime = 0;

    this.videoEl = document.getElementById('playit-video-el');
    this.overlayEl = document.getElementById('playit-player-overlay');
    this.hudLayer = document.getElementById('playit-hud-layer');
    this.dimmerLayer = document.getElementById('playit-dimmer-layer');

    this.init();
  }

  async init() {
    this.applySavedTheme();
    this.bindLibraryControls();
    this.bindPlayerControls();
    this.bindTouchGestures();
    this.bindHardwareBackButton();
    await this.loadSavedVideoCatalog();
  }

  applySavedTheme() {
    let savedTheme = 'aurora';
    try {
      savedTheme = localStorage.getItem('anru_theme') || 'aurora';
    } catch (e) {}
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  // ==========================================
  // 1. ZERO-COPY VIDEO CATALOG & AUTO FOLDER SCANNER
  // ==========================================

  async loadSavedVideoCatalog() {
    if (typeof db !== 'undefined') {
      const savedList = await db.getSetting('zero_copy_video_catalog_v1', []);
      if (Array.isArray(savedList) && savedList.length > 0) {
        this.videos = savedList.map(v => ({
          ...v,
          file: null
        }));
      }
      this.isHdrOn = await db.getSetting('video_hdr_enabled', false);
      this.is3dAudioOn = await db.getSetting('video_3d_enabled', false);
    }
    this.syncEnhancementPillsUI();
    this.renderLibrary();
    this.updateContinueWatchingBanner();
  }

  async saveVideoCatalog() {
    if (typeof db === 'undefined') return;
    // Save ONLY lightweight metadata & FileSystemFileHandle (0 MB video copy!)
    const serializable = this.videos.map(v => ({
      id: v.id,
      title: v.title,
      fileName: v.fileName,
      folder: v.folder || 'Phone Videos',
      fileSize: v.fileSize || 0,
      duration: v.duration || 0,
      thumb: v.thumb || '',
      lastTime: v.lastTime || 0,
      dateModified: v.dateModified || Date.now(),
      fileHandle: v.fileHandle || null
    }));
    await db.setSetting('zero_copy_video_catalog_v1', serializable);
  }

  async scanDirectoryRecursively(dirHandle, parentFolderName = 'Phone Videos', outList = []) {
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          if (/\.(mp4|mkv|webm|mov|avi|m4v|3gp)$/i.test(entry.name)) {
            try {
              const file = await entry.getFile();
              file._fileHandle = entry;
              file._folderName = parentFolderName;
              outList.push(file);
            } catch (e) {}
          }
        } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
          await this.scanDirectoryRecursively(entry, entry.name, outList);
        }
      }
    } catch (e) {}
    return outList;
  }

  bindLibraryControls() {
    const scanFolderBtn = document.getElementById('vid-scan-folder-btn');
    const addFilesBtn = document.getElementById('vid-add-files-btn');
    const emptyFolderBtn = document.getElementById('vid-empty-folder-btn');
    const emptyFilesBtn = document.getElementById('vid-empty-files-btn');
    const fileInput = document.getElementById('vid-file-picker');
    const folderInput = document.getElementById('vid-folder-picker');

    const triggerFolderScan = async () => {
      if (typeof window.showDirectoryPicker === 'function') {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
          this.showToast('Scanning phone videos (Zero-Copy)... ⚡');
          const files = await this.scanDirectoryRecursively(dirHandle, dirHandle.name || 'Movies');
          if (files.length > 0) {
            await this.ingestVideoFiles(files);
          } else {
            this.showToast('⚠️ No video files found in this folder.');
          }
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      folderInput?.click();
    };

    const triggerFilesPick = async () => {
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
              description: 'Video Files',
              accept: { 'video/*': ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.3gp'] }
            }]
          });
          const files = [];
          for (const h of handles) {
            const f = await h.getFile();
            f._fileHandle = h;
            f._folderName = 'Selected Videos';
            files.push(f);
          }
          if (files.length > 0) await this.ingestVideoFiles(files);
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      fileInput?.click();
    };

    scanFolderBtn?.addEventListener('click', triggerFolderScan);
    emptyFolderBtn?.addEventListener('click', triggerFolderScan);
    addFilesBtn?.addEventListener('click', triggerFilesPick);
    emptyFilesBtn?.addEventListener('click', triggerFilesPick);

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) this.ingestVideoFiles(e.target.files);
      e.target.value = '';
    });

    folderInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) this.ingestVideoFiles(e.target.files);
      e.target.value = '';
    });

    // Subtabs: All Videos vs Folders
    document.querySelectorAll('.vid-subtab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.vid-subtab').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.viewMode = e.currentTarget.dataset.mode || 'all';
        this.activeFolder = null;
        document.getElementById('vid-folder-breadcrumb')?.classList.add('hidden');
        this.renderLibrary();
      });
    });

    document.getElementById('vid-folder-back-btn')?.addEventListener('click', () => {
      this.activeFolder = null;
      document.getElementById('vid-folder-breadcrumb')?.classList.add('hidden');
      this.renderLibrary();
    });

    // Search & Sort
    const searchInput = document.getElementById('vid-search-input');
    const clearSearchBtn = document.getElementById('vid-clear-search-btn');
    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearSearchBtn?.classList.toggle('hidden', q.length === 0);
      this.renderLibrary();
    });

    clearSearchBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      clearSearchBtn.classList.add('hidden');
      this.renderLibrary();
    });

    document.getElementById('vid-sort-select')?.addEventListener('change', () => {
      this.renderLibrary();
    });

    // Continue watching banner
    document.getElementById('vid-continue-banner')?.addEventListener('click', (e) => {
      if (e.target.closest('#vc-dismiss-btn')) return;
      const resumable = this.getMostRecentResumableVideo();
      if (resumable) this.playVideo(resumable, true);
    });

    document.getElementById('vc-dismiss-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('vid-continue-banner')?.classList.add('hidden');
    });

    // Background Audio Mini-Bar controls
    document.getElementById('vbg-content')?.addEventListener('click', (e) => {
      if (e.target.closest('.mini-action-btn')) return;
      this.returnFromBackgroundAudioToVideo();
    });
    document.getElementById('vbg-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });
    document.getElementById('vbg-prev-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playPreviousVideo();
    });
    document.getElementById('vbg-next-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playNextVideo();
    });
    document.getElementById('vbg-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stopAndClosePlayer();
    });
  }

  async ingestVideoFiles(fileList) {
    const rawFiles = Array.from(fileList).filter(f => {
      return (f.type && f.type.startsWith('video/')) || /\.(mp4|mkv|webm|mov|avi|m4v|3gp)$/i.test(f.name);
    });

    if (rawFiles.length === 0) {
      this.showToast('⚠️ No supported video files found.');
      return;
    }

    this.showToast(`Linking ${rawFiles.length} video(s) (0 MB Copy)... 🎬`);

    let added = 0;
    let relinked = 0;

    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      const key = `${file.size}|${(file.name || '').toLowerCase().trim()}`;
      this.sessionByKey.set(key, file._fileHandle || file);

      // Extract folder name from webkitRelativePath or _folderName
      let folderName = file._folderName || 'Phone Videos';
      if (file.webkitRelativePath && file.webkitRelativePath.includes('/')) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length >= 2) folderName = parts[parts.length - 2];
      }

      const existing = this.videos.find(v => v.fileSize === file.size && (v.fileName || '').toLowerCase() === file.name.toLowerCase());
      if (existing) {
        existing.file = file;
        if (file._fileHandle) existing.fileHandle = file._fileHandle;
        this.sessionFiles.set(existing.id, file._fileHandle || file);
        relinked++;
        continue;
      }

      const id = `vid-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`;
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[._]+/g, ' ').trim() || file.name;

      // Probe video duration & capture poster thumbnail quickly
      const meta = await this.probeVideoThumbnailAndDuration(file, cleanTitle);

      const newVid = {
        id: id,
        title: cleanTitle,
        fileName: file.name,
        folder: folderName,
        fileSize: file.size || 0,
        duration: meta.duration || 0,
        thumb: meta.thumb || this.generateFallbackVideoPoster(cleanTitle),
        lastTime: 0,
        dateModified: file.lastModified || Date.now(),
        file: file,
        fileHandle: file._fileHandle || null
      };

      this.sessionFiles.set(id, file._fileHandle || file);
      this.videos.push(newVid);
      added++;
    }

    await this.saveVideoCatalog();
    this.renderLibrary();
    this.updateContinueWatchingBanner();

    if (added > 0) {
      this.showToast(`✅ Linked ${added} video(s) directly from phone storage!`);
    } else if (relinked > 0) {
      this.showToast(`⚡ Relinked ${relinked} video(s) for instant playback!`);
    }
  }

  probeVideoThumbnailAndDuration(file, title) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const tempVid = document.createElement('video');
        tempVid.preload = 'metadata';
        tempVid.muted = true;
        tempVid.playsInline = true;

        let done = false;
        const finish = (res) => {
          if (done) return;
          done = true;
          try {
            tempVid.removeAttribute('src');
            tempVid.load();
            URL.revokeObjectURL(url);
          } catch (e) {}
          resolve(res);
        };

        const timeout = setTimeout(() => {
          finish({ duration: 0, thumb: this.generateFallbackVideoPoster(title) });
        }, 1200);

        tempVid.onloadedmetadata = () => {
          const dur = Math.round(tempVid.duration || 0);
          // Seek to 1.5s or 15% of video to grab a clean non-black frame
          const seekTarget = dur > 6 ? Math.min(3, dur * 0.15) : 0.1;
          try {
            tempVid.currentTime = seekTarget;
          } catch (e) {
            clearTimeout(timeout);
            finish({ duration: dur, thumb: this.generateFallbackVideoPoster(title) });
          }
        };

        tempVid.onseeked = () => {
          clearTimeout(timeout);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 280;
            canvas.height = 158;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(tempVid, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
            finish({ duration: Math.round(tempVid.duration || 0), thumb: dataUrl });
          } catch (err) {
            finish({ duration: Math.round(tempVid.duration || 0), thumb: this.generateFallbackVideoPoster(title) });
          }
        };

        tempVid.onerror = () => {
          clearTimeout(timeout);
          finish({ duration: 0, thumb: this.generateFallbackVideoPoster(title) });
        };

        tempVid.src = url;
      } catch (e) {
        resolve({ duration: 0, thumb: this.generateFallbackVideoPoster(title) });
      }
    });
  }

  generateFallbackVideoPoster(title = 'Video') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 158;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 280, 158);
      grad.addColorStop(0, '#1e1438');
      grad.addColorStop(0.5, '#4c1d95');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 280, 158);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('4K HDR', 140, 79);
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return 'icon-512.png';
    }
  }

  // ==========================================
  // 2. RENDER VIDEO LIBRARY & FOLDERS
  // ==========================================

  getFilteredAndSortedVideos(folderFilter = null) {
    const q = (document.getElementById('vid-search-input')?.value || '').trim().toLowerCase();
    const sortBy = document.getElementById('vid-sort-select')?.value || 'date-new';

    let list = [...this.videos];
    if (folderFilter) {
      list = list.filter(v => (v.folder || 'Phone Videos') === folderFilter);
    }
    if (q) {
      list = list.filter(v => `${v.title} ${v.folder}`.toLowerCase().includes(q));
    }

    if (sortBy === 'title-asc') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortBy === 'size-desc') {
      list.sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
    } else if (sortBy === 'duration-desc') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else {
      list.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
    }
    return list;
  }

  renderLibrary() {
    const gridEl = document.getElementById('vid-grid-container');
    const foldersEl = document.getElementById('vid-folders-container');
    const emptyEl = document.getElementById('vid-empty-state');
    const totalCountEl = document.getElementById('vid-total-count');
    const folderCountEl = document.getElementById('vid-folder-count');

    const folderMap = new Map();
    this.videos.forEach(v => {
      const f = v.folder || 'Phone Videos';
      folderMap.set(f, (folderMap.get(f) || 0) + 1);
    });

    if (totalCountEl) totalCountEl.textContent = this.videos.length;
    if (folderCountEl) folderCountEl.textContent = folderMap.size;

    if (this.videos.length === 0) {
      gridEl.innerHTML = '';
      foldersEl.innerHTML = '';
      gridEl.classList.add('hidden');
      foldersEl.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
      return;
    }

    emptyEl?.classList.add('hidden');

    // Folders Grid Mode (when no specific folder is open)
    if (this.viewMode === 'folders' && !this.activeFolder) {
      gridEl.classList.add('hidden');
      foldersEl.classList.remove('hidden');
      foldersEl.innerHTML = '';

      folderMap.forEach((count, folderName) => {
        const card = document.createElement('div');
        card.className = 'vid-folder-card glass-card';
        card.innerHTML = `
          <div class="vf-icon-box"><i class="fa-solid fa-folder-open"></i></div>
          <div class="vf-meta">
            <div class="vf-name">${escapeHtml(folderName)}</div>
            <div class="vf-count">${count} ${count === 1 ? 'Video' : 'Videos'}</div>
          </div>
          <i class="fa-solid fa-chevron-right chevron-ico"></i>
        `;
        card.addEventListener('click', () => {
          this.activeFolder = folderName;
          const bc = document.getElementById('vid-folder-breadcrumb');
          const bcTitle = document.getElementById('vfb-folder-name');
          const bcMeta = document.getElementById('vfb-folder-meta');
          if (bcTitle) bcTitle.textContent = folderName;
          if (bcMeta) bcMeta.textContent = `${count} ${count === 1 ? 'Video' : 'Videos'}`;
          bc?.classList.remove('hidden');
          this.renderLibrary();
        });
        foldersEl.appendChild(card);
      });
      return;
    }

    // Videos List Mode
    foldersEl.classList.add('hidden');
    gridEl.classList.remove('hidden');
    gridEl.innerHTML = '';

    const list = this.getFilteredAndSortedVideos(this.activeFolder);
    if (list.length === 0) {
      gridEl.innerHTML = '<div class="empty-sub">No matching videos found.</div>';
      return;
    }

    list.forEach(vid => {
      const card = document.createElement('div');
      card.className = 'vid-card';
      const resumePct = (vid.duration > 0 && vid.lastTime > 3)
        ? Math.min(98, Math.round((vid.lastTime / vid.duration) * 100))
        : 0;

      card.innerHTML = `
        <div class="vid-thumb-box">
          <img src="${vid.thumb || 'icon-512.png'}" alt="thumb" class="vid-thumb-img" loading="lazy" onerror="this.src='icon-512.png'">
          <span class="vid-hdr-tag">HDR</span>
          <span class="vid-duration-chip">${this.formatTime(vid.duration)}</span>
          ${resumePct > 0 ? `<div class="vid-resume-bar"><div class="vid-resume-fill" style="width:${resumePct}%;"></div></div>` : ''}
        </div>
        <div class="vid-info">
          <div class="vid-title">${escapeHtml(vid.title)}</div>
          <div class="vid-sub-meta">
            <span class="vid-folder-pill"><i class="fa-solid fa-folder-open"></i> ${escapeHtml(vid.folder || 'Videos')}</span>
            <span>${this.formatBytes(vid.fileSize)}</span>
            ${resumePct > 0 ? `<span style="color:var(--accentCyan);">• Resume ${this.formatTime(vid.lastTime)}</span>` : ''}
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.playVideo(vid, true);
      });

      gridEl.appendChild(card);
    });
  }

  getMostRecentResumableVideo() {
    const candidates = this.videos.filter(v => v.lastTime > 5 && (!v.duration || v.lastTime < v.duration - 5));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    return candidates[0];
  }

  updateContinueWatchingBanner() {
    const banner = document.getElementById('vid-continue-banner');
    if (!banner) return;
    const resumable = this.getMostRecentResumableVideo();
    if (!resumable) {
      banner.classList.add('hidden');
      return;
    }
    const thumbEl = document.getElementById('vc-thumb');
    const titleEl = document.getElementById('vc-title');
    const timeEl = document.getElementById('vc-time-left');
    const fillEl = document.getElementById('vc-progress-fill');

    if (thumbEl) thumbEl.src = resumable.thumb || 'icon-512.png';
    if (titleEl) titleEl.textContent = resumable.title;
    if (timeEl) timeEl.textContent = `Resume from ${this.formatTime(resumable.lastTime)} / ${this.formatTime(resumable.duration)}`;
    if (fillEl && resumable.duration > 0) {
      fillEl.style.width = `${Math.min(100, (resumable.lastTime / resumable.duration) * 100)}%`;
    }
    banner.classList.remove('hidden');
  }

  // ==========================================
  // 3. ZERO-COPY FILE RESOLUTION & PLAYBACK ENGINE
  // ==========================================

  async resolveVideoFile(vid) {
    if (!vid) return null;
    if (vid.file instanceof Blob) return vid.file;

    const sessionEntry = this.sessionFiles.get(vid.id) ||
      this.sessionByKey.get(`${vid.fileSize}|${(vid.fileName || '').toLowerCase().trim()}`);

    if (sessionEntry) {
      if (sessionEntry instanceof Blob) return sessionEntry;
      if (typeof sessionEntry.getFile === 'function') {
        try {
          if (typeof sessionEntry.queryPermission === 'function') {
            let p = await sessionEntry.queryPermission({ mode: 'read' });
            if (p !== 'granted' && typeof sessionEntry.requestPermission === 'function') {
              p = await sessionEntry.requestPermission({ mode: 'read' });
            }
          }
          return await sessionEntry.getFile();
        } catch (e) {}
      }
    }

    if (vid.fileHandle && typeof vid.fileHandle.getFile === 'function') {
      try {
        if (typeof vid.fileHandle.queryPermission === 'function') {
          let p = await vid.fileHandle.queryPermission({ mode: 'read' });
          if (p !== 'granted' && typeof vid.fileHandle.requestPermission === 'function') {
            p = await vid.fileHandle.requestPermission({ mode: 'read' });
          }
        }
        const f = await vid.fileHandle.getFile();
        vid.file = f;
        this.sessionFiles.set(vid.id, f);
        return f;
      } catch (e) {}
    }
    return null;
  }

  async playVideo(vid, resumeFromSaved = true) {
    if (!vid) return;

    const fileBlob = await this.resolveVideoFile(vid);
    if (!fileBlob) {
      this.showToast('📂 Tap "Scan Folder" once to link phone storage for this video (Zero-Copy Mode)');
      return;
    }

    this.currentVideo = vid;
    const list = this.getFilteredAndSortedVideos(this.activeFolder);
    this.currentIndex = list.findIndex(v => v.id === vid.id);

    if (this.currentObjectUrl) {
      try { URL.revokeObjectURL(this.currentObjectUrl); } catch (e) {}
    }

    this.currentObjectUrl = URL.createObjectURL(fileBlob);
    this.videoEl.src = this.currentObjectUrl;
    this.videoEl.playbackRate = this.playbackRate;

    // Update HUD titles
    const titleEl = document.getElementById('vp-video-title');
    const subEl = document.getElementById('vp-video-sub');
    if (titleEl) titleEl.textContent = vid.title;
    if (subEl) subEl.textContent = `${vid.folder || 'Phone Video'} • ${this.formatBytes(vid.fileSize)} • Zero-Copy`;

    // Show Fullscreen Player Overlay
    this.isBackgroundAudioMode = false;
    document.getElementById('vid-bg-audio-bar')?.classList.add('hidden');
    this.overlayEl?.classList.remove('hidden');
    if (window.history?.state?.modal !== 'video_player') {
      window.history.pushState({ modal: 'video_player' }, '');
    }

    this.syncEnhancementPillsUI();
    this.showHudTemporarily();

    const onLoaded = () => {
      this.videoEl.removeEventListener('loadedmetadata', onLoaded);
      if (this.videoEl.duration && !isNaN(this.videoEl.duration)) {
        vid.duration = Math.round(this.videoEl.duration);
      }
      if (resumeFromSaved && vid.lastTime > 3 && (!vid.duration || vid.lastTime < vid.duration - 4)) {
        try {
          this.videoEl.currentTime = vid.lastTime;
          this.showToast(`▶️ Resumed from ${this.formatTime(vid.lastTime)}`);
        } catch (e) {}
      }
      this.initWebAudioBooster();
      this.resumeAudioContext();
      this.videoEl.play().catch(() => {});
      this.updateMediaSession();
    };

    this.videoEl.addEventListener('loadedmetadata', onLoaded);
  }

  // ==========================================
  // 4. 1-CLICK CINEMA HDR & 200% VOLUME + 3D AUDIO BOOSTER
  // ==========================================

  initWebAudioBooster() {
    if (this.audioCtx || !this.videoEl) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioCtx = new AudioCtx({ latencyHint: 'playback' });
      this.sourceNode = this.audioCtx.createMediaElementSource(this.videoEl);

      // 1. 200% Volume Booster GainNode (0.0 to 2.0)
      this.boostGainNode = this.audioCtx.createGain();
      this.boostGainNode.gain.value = this.volumePct / 100;

      // 2. Cinema Warm Bass Filter (80Hz lowshelf)
      this.bassFilterNode = this.audioCtx.createBiquadFilter();
      this.bassFilterNode.type = 'lowshelf';
      this.bassFilterNode.frequency.value = 80;
      this.bassFilterNode.gain.value = this.is3dAudioOn ? 4.5 : 1.5;

      this.sourceNode.connect(this.boostGainNode);
      this.boostGainNode.connect(this.bassFilterNode);

      // 3. 3D Cinema Surround Splitter/Haas Crossfeed
      this.directGainNode = this.audioCtx.createGain();
      this.spatialGainNode = this.audioCtx.createGain();
      this.directGainNode.gain.value = this.is3dAudioOn ? 0.0 : 1.0;
      this.spatialGainNode.gain.value = this.is3dAudioOn ? 1.0 : 0.0;

      this.bassFilterNode.connect(this.directGainNode);

      const splitter = this.audioCtx.createChannelSplitter(2);
      const merger = this.audioCtx.createChannelMerger(2);
      const delayL = this.audioCtx.createDelay();
      const delayR = this.audioCtx.createDelay();
      delayL.delayTime.value = 0.013;
      delayR.delayTime.value = 0.011;
      const crossL = this.audioCtx.createGain();
      const crossR = this.audioCtx.createGain();
      crossL.gain.value = 0.28;
      crossR.gain.value = 0.28;

      this.bassFilterNode.connect(splitter);
      splitter.connect(merger, 0, 0);
      splitter.connect(delayL, 0);
      delayL.connect(crossL);
      crossL.connect(merger, 0, 1);

      splitter.connect(merger, 1, 1);
      splitter.connect(delayR, 1);
      delayR.connect(crossR);
      crossR.connect(merger, 0, 0);

      merger.connect(this.spatialGainNode);

      // 4. Safety Brickwall Limiter (prevents speaker distortion even at 200% boost!)
      this.limiterNode = this.audioCtx.createDynamicsCompressor();
      this.limiterNode.threshold.value = -0.6;
      this.limiterNode.knee.value = 6;
      this.limiterNode.ratio.value = 18;
      this.limiterNode.attack.value = 0.002;
      this.limiterNode.release.value = 0.08;

      this.directGainNode.connect(this.limiterNode);
      this.spatialGainNode.connect(this.limiterNode);
      this.limiterNode.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('[Anru Video Audio] Booster notice:', e);
    }
  }

  async resumeAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try { await this.audioCtx.resume(); } catch (e) {}
    }
  }

  async suspendAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'running') {
      try { await this.audioCtx.suspend(); } catch (e) {}
    }
  }

  toggleHdrMode() {
    this.isHdrOn = !this.isHdrOn;
    if (typeof db !== 'undefined') db.setSetting('video_hdr_enabled', this.isHdrOn);
    this.syncEnhancementPillsUI();
    this.showToast(this.isHdrOn ? '✨ Cinema HDR 10+ Applied!' : 'HDR Mode: OFF');
  }

  toggle3dAudio() {
    this.is3dAudioOn = !this.is3dAudioOn;
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.directGainNode?.gain.setValueAtTime(this.is3dAudioOn ? 0.0 : 1.0, now);
      this.spatialGainNode?.gain.setValueAtTime(this.is3dAudioOn ? 1.0 : 0.0, now);
      if (this.bassFilterNode) {
        this.bassFilterNode.gain.setValueAtTime(this.is3dAudioOn ? 4.5 : 1.5, now);
      }
    }
    if (typeof db !== 'undefined') db.setSetting('video_3d_enabled', this.is3dAudioOn);
    this.syncEnhancementPillsUI();
    this.showToast(this.is3dAudioOn ? '🎧 3D Cinema Surround + Bass: ON' : '3D Surround: OFF');
  }

  setVolumePct(pct) {
    this.volumePct = Math.max(0, Math.min(200, Math.round(pct)));
    if (this.boostGainNode && this.audioCtx) {
      this.boostGainNode.gain.setValueAtTime(this.volumePct / 100, this.audioCtx.currentTime);
      this.videoEl.volume = 1.0;
    } else if (this.videoEl) {
      this.videoEl.volume = Math.min(1.0, this.volumePct / 100);
    }
    this.syncEnhancementPillsUI();
  }

  setBrightnessPct(pct) {
    this.brightnessPct = Math.max(20, Math.min(150, Math.round(pct)));
    if (this.dimmerLayer) {
      if (this.brightnessPct < 100) {
        this.dimmerLayer.style.opacity = ((100 - this.brightnessPct) / 100) * 0.78;
      } else {
        this.dimmerLayer.style.opacity = '0';
      }
    }
    this.applyVideoVisualFilters();
  }

  applyVideoVisualFilters() {
    if (!this.videoEl) return;
    const brightFactor = this.brightnessPct > 100 ? (1 + (this.brightnessPct - 100) * 0.006) : 1.0;
    if (this.isHdrOn) {
      this.videoEl.classList.add('hdr-active');
      this.videoEl.style.filter = `url(#anru-cinema-hdr-filter) contrast(1.16) saturate(1.28) brightness(${(1.05 * brightFactor).toFixed(2)})`;
    } else {
      this.videoEl.classList.remove('hdr-active');
      this.videoEl.style.filter = brightFactor !== 1.0 ? `brightness(${brightFactor.toFixed(2)})` : 'none';
    }
  }

  syncEnhancementPillsUI() {
    const hdrBtn = document.getElementById('vp-hdr-btn');
    const hdrBadge = document.getElementById('hdr-live-indicator');
    const boostBtn = document.getElementById('vp-boost-btn');
    const boostLbl = document.getElementById('vp-boost-label');
    const audio3dBtn = document.getElementById('vp-3daudio-btn');

    if (hdrBtn) hdrBtn.classList.toggle('active', this.isHdrOn);
    if (hdrBadge) hdrBadge.classList.toggle('hidden', !this.isHdrOn);
    if (audio3dBtn) audio3dBtn.classList.toggle('active', this.is3dAudioOn);

    if (boostLbl) boostLbl.textContent = `${this.volumePct}% Vol`;
    if (boostBtn) boostBtn.classList.toggle('boost-active', this.volumePct > 100);

    this.applyVideoVisualFilters();
  }

  // ==========================================
  // 5. PLAYER HUD CONTROLS, PIP, LOCK & BACKGROUND AUDIO
  // ==========================================

  bindPlayerControls() {
    if (!this.videoEl) return;

    this.videoEl.addEventListener('play', () => {
      this.resumeAudioContext();
      this.updatePlayPauseIcons(true);
      this.showHudTemporarily();
    });

    this.videoEl.addEventListener('pause', () => {
      this.updatePlayPauseIcons(false);
      if (!this.videoEl.ended) {
        this.saveCurrentVideoProgress();
        setTimeout(() => {
          if (this.videoEl.paused) this.suspendAudioContext();
        }, 400);
      }
    });

    this.videoEl.addEventListener('timeupdate', () => {
      const cur = this.videoEl.currentTime || 0;
      const dur = this.videoEl.duration || this.currentVideo?.duration || 1;
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));

      const fill = document.getElementById('vp-seekbar-fill');
      const thumb = document.getElementById('vp-seekbar-thumb');
      const curEl = document.getElementById('vp-curr-time');
      const totEl = document.getElementById('vp-total-time');
      const bgFill = document.getElementById('vbg-progress-fill');

      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      if (curEl) curEl.textContent = this.formatTime(cur);
      if (totEl) totEl.textContent = this.formatTime(dur);
      if (bgFill) bgFill.style.width = `${pct}%`;

      const now = Date.now();
      if (now - this._lastSaveTime > 4000) {
        this._lastSaveTime = now;
        this.saveCurrentVideoProgress();
      }
    });

    this.videoEl.addEventListener('ended', () => {
      if (this.currentVideo) {
        this.currentVideo.lastTime = 0;
        this.saveVideoCatalog();
      }
      this.playNextVideo();
    });

    // Top Bar Buttons
    document.getElementById('vp-back-btn')?.addEventListener('click', () => {
      this.exitFullscreenPlayer();
    });

    document.getElementById('vp-hdr-btn')?.addEventListener('click', () => {
      this.toggleHdrMode();
      this.showHudTemporarily();
    });

    document.getElementById('vp-boost-btn')?.addEventListener('click', () => {
      this.initWebAudioBooster();
      const nextVol = this.volumePct < 100 ? 100 : (this.volumePct === 100 ? 150 : (this.volumePct === 150 ? 200 : 100));
      this.setVolumePct(nextVol);
      this.showToast(nextVol > 100 ? `🔊 Ultra Audio Boost: ${nextVol}%` : '🔊 Volume: 100% Normal');
      this.showHudTemporarily();
    });

    document.getElementById('vp-bgaudio-btn')?.addEventListener('click', () => {
      this.enableBackgroundAudioMode();
    });

    document.getElementById('vp-pip-btn')?.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (this.videoEl.requestPictureInPicture) {
          await this.videoEl.requestPictureInPicture();
          this.showToast('📺 Floating Pop-up Window Active');
        } else {
          this.showToast('ℹ️ Pop-up PiP not supported on this device browser');
        }
      } catch (e) {
        this.showToast('ℹ️ Tap play first to open Pop-up PiP');
      }
    });

    // Center Transport Controls
    document.getElementById('vp-play-pause-btn')?.addEventListener('click', () => {
      this.togglePlay();
      this.showHudTemporarily();
    });

    document.getElementById('vp-rew-10-btn')?.addEventListener('click', () => {
      this.seekRelative(-10);
      this.showHudTemporarily();
    });

    document.getElementById('vp-fwd-10-btn')?.addEventListener('click', () => {
      this.seekRelative(10);
      this.showHudTemporarily();
    });

    document.getElementById('vp-prev-vid-btn')?.addEventListener('click', () => {
      this.playPreviousVideo();
    });

    document.getElementById('vp-next-vid-btn')?.addEventListener('click', () => {
      this.playNextVideo();
    });

    // Seekbar Drag & Click
    const seekWrap = document.getElementById('vp-seekbar-wrap');
    if (seekWrap) {
      const seekFromEvent = (e) => {
        const rect = seekWrap.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        if (this.videoEl.duration) {
          this.videoEl.currentTime = pct * this.videoEl.duration;
        }
        this.showHudTemporarily();
      };

      seekWrap.addEventListener('click', seekFromEvent);
      let dragging = false;
      seekWrap.addEventListener('touchstart', (e) => { dragging = true; seekFromEvent(e); }, { passive: true });
      window.addEventListener('touchmove', (e) => { if (dragging) seekFromEvent(e); }, { passive: true });
      window.addEventListener('touchend', () => { dragging = false; });
    }

    // Bottom Utility Buttons
    document.getElementById('vp-lock-btn')?.addEventListener('click', () => {
      this.setScreenLock(true);
    });

    document.getElementById('playit-unlock-btn')?.addEventListener('click', () => {
      this.setScreenLock(false);
    });

    document.getElementById('vp-speed-btn')?.addEventListener('click', () => {
      const idx = (this.playbackSpeeds.indexOf(this.playbackRate) + 1) % this.playbackSpeeds.length;
      this.playbackRate = this.playbackSpeeds[idx];
      this.videoEl.playbackRate = this.playbackRate;
      const lbl = document.getElementById('vp-speed-label');
      if (lbl) lbl.textContent = `${this.playbackRate}x`;
      this.showToast(`⚡ Playback Speed: ${this.playbackRate}x`);
      this.showHudTemporarily();
    });

    document.getElementById('vp-3daudio-btn')?.addEventListener('click', () => {
      this.initWebAudioBooster();
      this.toggle3dAudio();
      this.showHudTemporarily();
    });

    document.getElementById('vp-aspect-btn')?.addEventListener('click', () => {
      this.aspectIndex = (this.aspectIndex + 1) % this.aspectModes.length;
      const mode = this.aspectModes[this.aspectIndex];
      this.videoEl.classList.remove('aspect-fit', 'aspect-fill', 'aspect-16-9', 'aspect-stretch');
      this.videoEl.classList.add(`aspect-${mode}`);
      const lbl = document.getElementById('vp-aspect-label');
      if (lbl) lbl.textContent = this.aspectLabels[mode];
      this.showToast(`📐 Aspect Ratio: ${this.aspectLabels[mode]}`);
      this.showHudTemporarily();
    });

    document.getElementById('vp-rotate-btn')?.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement && this.overlayEl.requestFullscreen) {
          await this.overlayEl.requestFullscreen();
        }
        if (screen.orientation && screen.orientation.lock) {
          const curType = screen.orientation.type || '';
          if (curType.includes('portrait')) {
            await screen.orientation.lock('landscape');
            this.showToast('🔄 Rotated to Landscape');
          } else {
            await screen.orientation.lock('portrait');
            this.showToast('🔄 Rotated to Portrait');
          }
        } else {
          this.showToast('🔄 Rotate your phone for full landscape view');
        }
      } catch (e) {
        this.showToast('🔄 Auto-rotate ready');
      }
      this.showHudTemporarily();
    });
  }

  // ==========================================
  // 6. PLAYIT SMART TOUCH GESTURES (BRIGHTNESS, VOLUME 200%, DOUBLE-TAP SEEK)
  // ==========================================

  bindTouchGestures() {
    const stage = document.getElementById('playit-video-stage');
    if (!stage) return;

    let startX = 0;
    let startY = 0;
    let startVal = 0;
    let gestureMode = null; // 'brightness', 'volume', 'seek'
    let isSwiping = false;
    let lastTapTime = 0;

    stage.addEventListener('touchstart', (e) => {
      if (this.isLocked) return;
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      gestureMode = null;
      isSwiping = false;
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      if (this.isLocked || e.touches.length !== 1) return;
      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;
      const dx = curX - startX;
      const dy = startY - curY; // positive = swipe UP

      if (!gestureMode) {
        if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.3) {
          const screenW = window.innerWidth || 360;
          if (startX < screenW * 0.48) {
            gestureMode = 'brightness';
            startVal = this.brightnessPct;
          } else {
            gestureMode = 'volume';
            this.initWebAudioBooster();
            startVal = this.volumePct;
          }
          isSwiping = true;
        } else if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          gestureMode = 'seek';
          startVal = this.videoEl.currentTime || 0;
          isSwiping = true;
        }
      }

      if (gestureMode === 'brightness') {
        const deltaPct = (dy / 180) * 100;
        this.setBrightnessPct(startVal + deltaPct);
        this.showGestureHud('fa-sun', `Brightness ${this.brightnessPct}%`, ((this.brightnessPct - 20) / 130) * 100);
      } else if (gestureMode === 'volume') {
        const deltaPct = (dy / 180) * 140;
        this.setVolumePct(startVal + deltaPct);
        this.showGestureHud('fa-volume-high', `Volume ${this.volumePct}%`, (this.volumePct / 200) * 100);
      } else if (gestureMode === 'seek' && this.videoEl.duration) {
        const deltaSec = Math.round((dx / 220) * 45);
        const target = Math.max(0, Math.min(this.videoEl.duration, startVal + deltaSec));
        this.videoEl.currentTime = target;
        const sign = deltaSec >= 0 ? `+${deltaSec}s` : `${deltaSec}s`;
        this.showGestureHud(deltaSec >= 0 ? 'fa-forward-step' : 'fa-backward-step', `${this.formatTime(target)} (${sign})`, (target / this.videoEl.duration) * 100);
      }
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      if (isSwiping) {
        isSwiping = false;
        gestureMode = null;
        return;
      }

      if (this.isLocked) {
        const unlockBtn = document.getElementById('playit-unlock-btn');
        unlockBtn?.classList.remove('hidden');
        clearTimeout(this._hudHideTimer);
        this._hudHideTimer = setTimeout(() => unlockBtn?.classList.add('hidden'), 3000);
        return;
      }

      const now = Date.now();
      const tapX = e.changedTouches[0]?.clientX || 0;
      const screenW = window.innerWidth || 360;

      // Double-tap Left / Right 35% of screen for instant ±10s Seek
      if (now - lastTapTime < 280) {
        if (tapX < screenW * 0.38) {
          this.seekRelative(-10);
          this.flashDoubleTapZone('dtap-left');
          lastTapTime = 0;
          return;
        } else if (tapX > screenW * 0.62) {
          this.seekRelative(10);
          this.flashDoubleTapZone('dtap-right');
          lastTapTime = 0;
          return;
        }
      }
      lastTapTime = now;

      // Single tap toggles HUD visibility
      if (this.hudLayer?.classList.contains('hud-hidden')) {
        this.showHudTemporarily();
      } else {
        this.hudLayer?.classList.add('hud-hidden');
      }
    });
  }

  showGestureHud(iconClass, text, barPct) {
    const hud = document.getElementById('playit-gesture-hud');
    const icon = document.getElementById('hud-icon');
    const txt = document.getElementById('hud-text');
    const fill = document.getElementById('hud-bar-fill');

    if (icon) icon.className = `fa-solid ${iconClass}`;
    if (txt) txt.textContent = text;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, barPct))}%`;

    hud?.classList.remove('hidden');
    clearTimeout(this._gestureHudTimer);
    this._gestureHudTimer = setTimeout(() => {
      hud?.classList.add('hidden');
    }, 900);
  }

  flashDoubleTapZone(zoneId) {
    const el = document.getElementById(zoneId);
    if (!el) return;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 550);
  }

  showHudTemporarily() {
    if (this.isLocked) return;
    this.hudLayer?.classList.remove('hud-hidden');
    clearTimeout(this._hudHideTimer);
    if (!this.videoEl?.paused) {
      this._hudHideTimer = setTimeout(() => {
        if (!this.videoEl?.paused) {
          this.hudLayer?.classList.add('hud-hidden');
        }
      }, 3800);
    }
  }

  setScreenLock(locked) {
    this.isLocked = !!locked;
    const unlockBtn = document.getElementById('playit-unlock-btn');
    if (this.isLocked) {
      this.hudLayer?.classList.add('hud-hidden');
      unlockBtn?.classList.remove('hidden');
      this.showToast('🔒 Screen Controls Locked');
    } else {
      unlockBtn?.classList.add('hidden');
      this.showHudTemporarily();
      this.showToast('🔓 Screen Controls Unlocked');
    }
  }

  // ==========================================
  // 7. TRANSPORT, BACKGROUND AUDIO & HARDWARE BACK
  // ==========================================

  togglePlay() {
    if (!this.videoEl) return;
    if (this.videoEl.paused) {
      this.resumeAudioContext();
      this.videoEl.play().catch(() => {});
    } else {
      this.videoEl.pause();
    }
  }

  updatePlayPauseIcons(isPlaying) {
    const mainIcon = document.getElementById('vp-play-pause-icon');
    const bgIcon = document.getElementById('vbg-play-icon');
    if (mainIcon) {
      mainIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    if (bgIcon) {
      bgIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
  }

  seekRelative(seconds) {
    if (!this.videoEl || !this.videoEl.duration) return;
    this.videoEl.currentTime = Math.max(0, Math.min(this.videoEl.duration, (this.videoEl.currentTime || 0) + seconds));
  }

  playNextVideo() {
    const list = this.getFilteredAndSortedVideos(this.activeFolder);
    if (list.length === 0) return;
    const nextIdx = (this.currentIndex + 1) % list.length;
    this.playVideo(list[nextIdx], false);
  }

  playPreviousVideo() {
    const list = this.getFilteredAndSortedVideos(this.activeFolder);
    if (list.length === 0) return;
    const prevIdx = (this.currentIndex - 1 + list.length) % list.length;
    this.playVideo(list[prevIdx], false);
  }

  enableBackgroundAudioMode() {
    if (!this.currentVideo) return;
    this.isBackgroundAudioMode = true;
    this.overlayEl?.classList.add('hidden');

    const bgBar = document.getElementById('vid-bg-audio-bar');
    const bgTitle = document.getElementById('vbg-title');
    const bgThumb = document.getElementById('vbg-thumb');
    if (bgTitle) bgTitle.textContent = this.currentVideo.title;
    if (bgThumb) bgThumb.src = this.currentVideo.thumb || 'icon-512.png';
    bgBar?.classList.remove('hidden');

    this.showToast('🎧 Playing Video in Background Audio Mode');
  }

  returnFromBackgroundAudioToVideo() {
    this.isBackgroundAudioMode = false;
    document.getElementById('vid-bg-audio-bar')?.classList.add('hidden');
    this.overlayEl?.classList.remove('hidden');
    this.showHudTemporarily();
  }

  saveCurrentVideoProgress() {
    if (!this.currentVideo || !this.videoEl) return;
    const cur = Math.round(this.videoEl.currentTime || 0);
    if (cur > 3) {
      this.currentVideo.lastTime = cur;
      this.currentVideo.lastWatchedAt = Date.now();
      this.saveVideoCatalog();
    }
  }

  exitFullscreenPlayer() {
    this.saveCurrentVideoProgress();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (!this.isBackgroundAudioMode) {
      this.stopAndClosePlayer();
    } else {
      this.overlayEl?.classList.add('hidden');
    }
    this.renderLibrary();
    this.updateContinueWatchingBanner();
  }

  stopAndClosePlayer() {
    this.saveCurrentVideoProgress();
    this.isBackgroundAudioMode = false;
    this.videoEl?.pause();
    this.suspendAudioContext();
    this.overlayEl?.classList.add('hidden');
    document.getElementById('vid-bg-audio-bar')?.classList.add('hidden');
    this.renderLibrary();
    this.updateContinueWatchingBanner();
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.currentVideo) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentVideo.title,
        artist: this.currentVideo.folder || 'Anru Video Studio',
        album: 'PLAYit 4K HDR Player',
        artwork: [{ src: this.currentVideo.thumb || 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.playPreviousVideo());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.playNextVideo());
    } catch (e) {}
  }

  bindHardwareBackButton() {
    window.addEventListener('popstate', () => {
      if (this.overlayEl && !this.overlayEl.classList.contains('hidden')) {
        if (this.isLocked) {
          this.showToast('🔒 Unlock screen first to go back');
          window.history.pushState({ modal: 'video_player' }, '');
          return;
        }
        this.exitFullscreenPlayer();
      } else if (this.activeFolder) {
        this.activeFolder = null;
        document.getElementById('vid-folder-breadcrumb')?.classList.add('hidden');
        this.renderLibrary();
      }
    });
  }

  // ==========================================
  // 8. UTILITIES
  // ==========================================

  formatTime(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return '0:00';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return 'Local File';
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  showToast(msg) {
    let toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.videoStudio = new PlayItVideoStudio();
});
