/**
 * ANRU MUSIC STUDIO PRO v22.1 - OFFLINE CLIENT-SIDE STORAGE & DSP STATE ENGINE
 * 100% Offline IndexedDB Engine.
 * Features:
 * 1. Audio blob on-demand retrieval (getSongBlob) for ultra-low RAM usage
 * 2. In-memory metadata caching for instantaneous duplicate detection
 * 3. Atomic playlist cleanup when songs are deleted (Zero orphaned tracks)
 * 4. Song duration updater
 * 5. Full offline favorites, smart playlists, and listening statistics
 */

class MusicDatabase {
  constructor() {
    this.dbName = 'AnruMusicStudioProDB_v16';
    this.dbVersion = 4;
    this.db = null;
    this._cachedSongMeta = null;
    // Zero-Copy in-memory File reference map (reads directly from phone storage with 0 MB browser duplication)
    this._sessionFiles = new Map(); // id -> File or FileSystemFileHandle
    this._sessionFilesByKey = new Map(); // "fileSize|fileName" -> File

    // Fallback in-memory store if IndexedDB is blocked
    this.mem = {
      songs: [],
      playlists: [],
      favorites: new Set(),
      playHistory: [],
      settings: {}
    };

    this.initPromise = this.init();
  }

  invalidateCache() {
    this._cachedSongMeta = null;
  }

  async init() {
    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('[Anru DB] IndexedDB not supported, using memory fallback.');
          resolve(null);
          return;
        }

        const request = window.indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('songs')) {
            const songStore = db.createObjectStore('songs', { keyPath: 'id' });
            songStore.createIndex('title', 'title', { unique: false });
            songStore.createIndex('artist', 'artist', { unique: false });
            songStore.createIndex('dateAdded', 'dateAdded', { unique: false });
          }
          if (!db.objectStoreNames.contains('playlists')) {
            db.createObjectStore('playlists', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('favorites')) {
            db.createObjectStore('favorites', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('playHistory')) {
            const histStore = db.createObjectStore('playHistory', { keyPath: 'id', autoIncrement: true });
            histStore.createIndex('timestamp', 'timestamp', { unique: false });
            histStore.createIndex('songId', 'songId', { unique: false });
            histStore.createIndex('dateStr', 'dateStr', { unique: false });
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        };

        request.onsuccess = (e) => {
          this.db = e.target.result;
          console.log('[Anru DB] Local IndexedDB ready ⚡ (v' + this.dbVersion + ')');
          resolve(this.db);
        };

        request.onerror = (e) => {
          console.warn('[Anru DB] IndexedDB open error, using memory:', e);
          resolve(null);
        };
      } catch (err) {
        console.warn('[Anru DB] Exception opening IndexedDB:', err);
        resolve(null);
      }
    });
  }

  // ==========================================
  // SONGS & AUDIO BLOBS
  // ==========================================

  async findDuplicate(meta, fileSize = 0, fileName = '') {
    await this.initPromise;
    const songs = this._cachedSongMeta || await this.getAllSongs();
    const cleanTitle = (meta.title || '').toLowerCase().trim();
    const cleanArtist = (meta.artist || '').toLowerCase().trim();
    const cleanFilename = (fileName || '').toLowerCase().trim();

    return songs.find(s => {
      const sTitle = (s.title || '').toLowerCase().trim();
      const sArtist = (s.artist || '').toLowerCase().trim();
      const sName = (s.fileName || '').toLowerCase().trim();

      if (cleanTitle && sTitle === cleanTitle && cleanArtist !== 'local artist' && sArtist === cleanArtist) {
        return true;
      }
      if (fileSize > 0 && s.fileSize === fileSize && (cleanFilename && sName === cleanFilename)) {
        return true;
      }
      if (cleanTitle && sTitle === cleanTitle && fileSize > 0 && s.fileSize === fileSize) {
        return true;
      }
      return false;
    });
  }

  registerZeroCopyFile(id, fileOrHandle, fileSize = 0, fileName = '') {
    if (!fileOrHandle) return;
    if (id) this._sessionFiles.set(id, fileOrHandle);
    const cleanName = (fileName || fileOrHandle.name || '').toLowerCase().trim();
    const size = fileSize || fileOrHandle.size || 0;
    if (cleanName && size > 0) {
      this._sessionFilesByKey.set(`${size}|${cleanName}`, fileOrHandle);
    }
  }

  async saveSong(songData) {
    await this.initPromise;
    this.invalidateCache();

    const id = songData.id || ('local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6));
    const fileSize = songData.fileSize || (songData.audioBlob ? songData.audioBlob.size : 0);
    const fileName = songData.fileName || (songData.audioBlob && songData.audioBlob.name) || '';

    // ZERO-COPY ENGINE: Keep local File reference in session map and FileSystemFileHandle in DB,
    // NEVER store multi-MB binary audioBlob inside IndexedDB by default!
    if (songData.audioBlob) {
      this.registerZeroCopyFile(id, songData.audioBlob, fileSize, fileName);
    }
    if (songData.fileHandle) {
      this.registerZeroCopyFile(id, songData.fileHandle, fileSize, fileName);
    }

    const record = {
      id: id,
      title: songData.title || 'Untitled Song',
      artist: songData.artist || 'Local Artist',
      album: songData.album || 'Offline Music',
      duration: songData.duration || 0,
      artwork: songData.artwork || 'icon-512.png',
      fileHandle: songData.fileHandle || null,
      isZeroCopy: true,
      dateAdded: songData.dateAdded || Date.now(),
      fileSize: fileSize,
      fileName: fileName
    };

    if (!this.db) {
      const idx = this.mem.songs.findIndex(s => s.id === record.id);
      if (idx >= 0) this.mem.songs[idx] = record;
      else this.mem.songs.push(record);
      return record;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  async saveSongsBatch(songsDataArray) {
    if (!songsDataArray || songsDataArray.length === 0) return [];
    await this.initPromise;
    this.invalidateCache();

    const records = songsDataArray.map((songData, idx) => {
      const id = songData.id || ('local-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).substr(2, 6));
      const fileSize = songData.fileSize || (songData.audioBlob ? songData.audioBlob.size : 0);
      const fileName = songData.fileName || (songData.audioBlob && songData.audioBlob.name) || '';

      if (songData.audioBlob) {
        this.registerZeroCopyFile(id, songData.audioBlob, fileSize, fileName);
      }
      if (songData.fileHandle) {
        this.registerZeroCopyFile(id, songData.fileHandle, fileSize, fileName);
      }

      return {
        id: id,
        title: songData.title || 'Untitled Song',
        artist: songData.artist || 'Local Artist',
        album: songData.album || 'Offline Music',
        duration: songData.duration || 0,
        artwork: songData.artwork || 'icon-512.png',
        fileHandle: songData.fileHandle || null,
        isZeroCopy: true,
        dateAdded: songData.dateAdded || (Date.now() + idx),
        fileSize: fileSize,
        fileName: fileName
      };
    });

    if (!this.db) {
      records.forEach(record => {
        const idx = this.mem.songs.findIndex(s => s.id === record.id);
        if (idx >= 0) this.mem.songs[idx] = record;
        else this.mem.songs.push(record);
      });
      return records;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        records.forEach(record => store.put(record));
        tx.oncomplete = () => resolve(records);
        tx.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Purge heavy legacy audioBlobs from IndexedDB while keeping all song metadata, playlists, and history intact!
  async purgeLegacyCopiedBlobs() {
    await this.initPromise;
    if (!this.db) return 0;
    this.invalidateCache();

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        const req = store.getAll();
        let freedBytes = 0;
        req.onsuccess = () => {
          const all = req.result || [];
          all.forEach(item => {
            if (item.audioBlob) {
              freedBytes += (item.audioBlob.size || item.fileSize || 0);
              this.registerZeroCopyFile(item.id, item.audioBlob, item.fileSize, item.fileName);
              delete item.audioBlob;
              item.isZeroCopy = true;
              store.put(item);
            }
          });
        };
        tx.oncomplete = () => resolve(freedBytes);
        tx.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  }

  async getAllSongs() {
    await this.initPromise;
    if (!this.db) {
      const list = [...this.mem.songs];
      list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
      return list;
    }

    if (this._cachedSongMeta) {
      return [...this._cachedSongMeta];
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs'], 'readonly');
      const store = tx.objectStore('songs');
      const req = store.getAll();
      req.onsuccess = () => {
        const rawList = req.result || [];
        let hasLegacyBlobs = false;
        const list = rawList.map(item => {
          if (item.audioBlob) {
            hasLegacyBlobs = true;
            this.registerZeroCopyFile(item.id, item.audioBlob, item.fileSize, item.fileName);
          }
          const { audioBlob, ...meta } = item;
          return meta;
        });
        // Automatically migrate any old duplicated blobs in background to free browser disk space!
        if (hasLegacyBlobs) {
          setTimeout(() => this.purgeLegacyCopiedBlobs(), 800);
        }
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        this._cachedSongMeta = list;
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async resolveHandleOrBlob(entry) {
    if (!entry) return null;
    if (entry instanceof Blob) return entry;
    if (typeof entry.getFile === 'function') {
      try {
        if (typeof entry.queryPermission === 'function') {
          let perm = await entry.queryPermission({ mode: 'read' });
          if (perm !== 'granted' && typeof entry.requestPermission === 'function') {
            perm = await entry.requestPermission({ mode: 'read' });
          }
        }
        return await entry.getFile();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async getSongBlob(id) {
    if (!id) return null;
    await this.initPromise;

    // 1. Check Zero-Copy Session File / Handle Map first (0ms, 0 MB browser storage)
    if (this._sessionFiles.has(id)) {
      const resolved = await this.resolveHandleOrBlob(this._sessionFiles.get(id));
      if (resolved) return resolved;
    }

    // 2. Check by fileSize|fileName match in session map
    if (this._cachedSongMeta) {
      const meta = this._cachedSongMeta.find(s => s.id === id);
      if (meta) {
        const key = `${meta.fileSize || 0}|${(meta.fileName || '').toLowerCase().trim()}`;
        if (this._sessionFilesByKey.has(key)) {
          const resolved = await this.resolveHandleOrBlob(this._sessionFilesByKey.get(key));
          if (resolved) {
            this._sessionFiles.set(id, resolved);
            return resolved;
          }
        }
      }
    }

    if (!this.db) {
      const s = this.mem.songs.find(s => s.id === id);
      return s ? (s.audioBlob || null) : null;
    }

    // 3. Fallback to persistent FileSystemFileHandle or legacy audioBlob in IndexedDB
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const req = store.get(id);
        req.onsuccess = async () => {
          const rec = req.result;
          if (!rec) {
            resolve(null);
            return;
          }
          if (rec.fileHandle) {
            const file = await this.resolveHandleOrBlob(rec.fileHandle);
            if (file) {
              this.registerZeroCopyFile(id, file, rec.fileSize, rec.fileName);
              resolve(file);
              return;
            }
          }
          if (rec.audioBlob) {
            resolve(rec.audioBlob);
            return;
          }
          resolve(null);
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async updateSongDuration(id, duration) {
    if (!id || !duration || duration <= 0) return;
    await this.initPromise;
    if (!this.db) {
      const s = this.mem.songs.find(s => s.id === id);
      if (s) s.duration = duration;
      return;
    }

    try {
      const tx = this.db.transaction(['songs'], 'readwrite');
      const store = tx.objectStore('songs');
      const req = store.get(id);
      req.onsuccess = () => {
        const song = req.result;
        if (song) {
          song.duration = duration;
          store.put(song);
          if (this._cachedSongMeta) {
            const cached = this._cachedSongMeta.find(s => s.id === id);
            if (cached) cached.duration = duration;
          }
        }
      };
    } catch (e) {}
  }

  async deleteSong(id) {
    await this.initPromise;
    this.invalidateCache();

    if (!this.db) {
      this.mem.songs = this.mem.songs.filter(s => s.id !== id);
      this.mem.favorites.delete(id);
      this.mem.playlists.forEach(pl => {
        pl.songIds = (pl.songIds || []).filter(sid => sid !== id);
      });
      return true;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs', 'favorites', 'playlists'], 'readwrite');
        tx.objectStore('songs').delete(id);
        tx.objectStore('favorites').delete(id);

        const plStore = tx.objectStore('playlists');
        const req = plStore.getAll();
        req.onsuccess = () => {
          const playlists = req.result || [];
          playlists.forEach(pl => {
            if (pl.songIds && pl.songIds.includes(id)) {
              pl.songIds = pl.songIds.filter(sid => sid !== id);
              plStore.put(pl);
            }
          });
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async deleteMultipleSongs(ids) {
    await this.initPromise;
    if (!ids || ids.length === 0) return true;
    this.invalidateCache();
    const idSet = new Set(ids);

    if (!this.db) {
      this.mem.songs = this.mem.songs.filter(s => !idSet.has(s.id));
      ids.forEach(id => this.mem.favorites.delete(id));
      this.mem.playlists.forEach(pl => {
        pl.songIds = (pl.songIds || []).filter(sid => !idSet.has(sid));
      });
      return true;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs', 'favorites', 'playlists'], 'readwrite');
        const songStore = tx.objectStore('songs');
        const favStore = tx.objectStore('favorites');
        const plStore = tx.objectStore('playlists');

        ids.forEach(id => {
          songStore.delete(id);
          favStore.delete(id);
        });

        const req = plStore.getAll();
        req.onsuccess = () => {
          const playlists = req.result || [];
          playlists.forEach(pl => {
            if (pl.songIds && pl.songIds.some(sid => idSet.has(sid))) {
              pl.songIds = pl.songIds.filter(sid => !idSet.has(sid));
              plStore.put(pl);
            }
          });
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async clearAllSongs() {
    await this.initPromise;
    this.invalidateCache();

    if (!this.db) {
      this.mem.songs = [];
      this.mem.favorites.clear();
      this.mem.playlists.forEach(pl => pl.songIds = []);
      return true;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs', 'favorites', 'playlists'], 'readwrite');
        tx.objectStore('songs').clear();
        tx.objectStore('favorites').clear();

        const plStore = tx.objectStore('playlists');
        const req = plStore.getAll();
        req.onsuccess = () => {
          const playlists = req.result || [];
          playlists.forEach(pl => {
            pl.songIds = [];
            plStore.put(pl);
          });
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  // ==========================================
  // FAVORITES
  // ==========================================

  async toggleFavorite(id) {
    await this.initPromise;
    const isFav = await this.isFavorite(id);

    if (!this.db) {
      if (isFav) this.mem.favorites.delete(id);
      else this.mem.favorites.add(id);
      return !isFav;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['favorites'], 'readwrite');
      const store = tx.objectStore('favorites');
      if (isFav) {
        store.delete(id);
        tx.oncomplete = () => resolve(false);
      } else {
        store.put({ id, dateAdded: Date.now() });
        tx.oncomplete = () => resolve(true);
      }
      tx.onerror = () => resolve(false);
    });
  }

  async isFavorite(id) {
    await this.initPromise;
    if (!this.db) return this.mem.favorites.has(id);

    return new Promise((resolve) => {
      const tx = this.db.transaction(['favorites'], 'readonly');
      const store = tx.objectStore('favorites');
      const req = store.get(id);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  }

  async getAllFavorites() {
    await this.initPromise;
    if (!this.db) return Array.from(this.mem.favorites);

    return new Promise((resolve) => {
      const tx = this.db.transaction(['favorites'], 'readonly');
      const store = tx.objectStore('favorites');
      const req = store.getAll();
      req.onsuccess = () => {
        resolve((req.result || []).map(f => f.id));
      };
      req.onerror = () => resolve([]);
    });
  }

  // ==========================================
  // CUSTOM PLAYLISTS
  // ==========================================

  async createPlaylist(name) {
    await this.initPromise;
    const playlist = {
      id: 'pl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      name: name.trim() || 'New Playlist',
      songIds: [],
      dateCreated: Date.now()
    };

    if (!this.db) {
      this.mem.playlists.push(playlist);
      return playlist;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      store.put(playlist);
      tx.oncomplete = () => resolve(playlist);
      tx.onerror = () => resolve(null);
    });
  }

  async getPlaylists() {
    await this.initPromise;
    if (!this.db) return [...this.mem.playlists];

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readonly');
      const store = tx.objectStore('playlists');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async addSongToPlaylist(playlistId, songId) {
    await this.initPromise;
    if (!this.db) {
      const pl = this.mem.playlists.find(p => p.id === playlistId);
      if (pl && !pl.songIds.includes(songId)) pl.songIds.push(songId);
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.get(playlistId);
      req.onsuccess = () => {
        const pl = req.result;
        if (pl) {
          if (!pl.songIds) pl.songIds = [];
          if (!pl.songIds.includes(songId)) {
            pl.songIds.push(songId);
            store.put(pl);
          }
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  async addSongsToPlaylistBatch(playlistId, songIdsArray) {
    if (!playlistId || !songIdsArray || songIdsArray.length === 0) return 0;
    await this.initPromise;
    if (!this.db) {
      const pl = this.mem.playlists.find(p => p.id === playlistId);
      let added = 0;
      if (pl) {
        if (!pl.songIds) pl.songIds = [];
        songIdsArray.forEach(sid => {
          if (!pl.songIds.includes(sid)) {
            pl.songIds.push(sid);
            added++;
          }
        });
      }
      return added;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['playlists'], 'readwrite');
        const store = tx.objectStore('playlists');
        const req = store.get(playlistId);
        let added = 0;
        req.onsuccess = () => {
          const pl = req.result;
          if (pl) {
            if (!pl.songIds) pl.songIds = [];
            songIdsArray.forEach(sid => {
              if (!pl.songIds.includes(sid)) {
                pl.songIds.push(sid);
                added++;
              }
            });
            if (added > 0) store.put(pl);
          }
        };
        tx.oncomplete = () => resolve(added);
        tx.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  }

  async removeSongFromPlaylist(playlistId, songId) {
    await this.initPromise;
    if (!this.db) {
      const pl = this.mem.playlists.find(p => p.id === playlistId);
      if (pl) pl.songIds = (pl.songIds || []).filter(id => id !== songId);
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.get(playlistId);
      req.onsuccess = () => {
        const pl = req.result;
        if (pl && pl.songIds) {
          pl.songIds = pl.songIds.filter(id => id !== songId);
          store.put(pl);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  async deletePlaylist(playlistId) {
    await this.initPromise;
    if (!this.db) {
      this.mem.playlists = this.mem.playlists.filter(p => p.id !== playlistId);
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      store.delete(playlistId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // ==========================================
  // PLAYBACK STATE RESTORATION
  // ==========================================

  async savePlaybackState(state) {
    return this.setSetting('last_playback_session', state);
  }

  async getPlaybackState() {
    return this.getSetting('last_playback_session', null);
  }

  // ==========================================
  // SMART PLAYLIST GENERATOR (MOST PLAYED, NEVER PLAYED)
  // ==========================================

  async getSmartPlaylists() {
    await this.initPromise;
    const allSongs = await this.getAllSongs();
    const history = await this.getAllPlayHistory();

    const playCountMap = {};
    history.forEach(h => {
      playCountMap[h.songId] = (playCountMap[h.songId] || 0) + 1;
    });

    const mostPlayed = allSongs
      .filter(s => (playCountMap[s.id] || 0) > 0)
      .sort((a, b) => (playCountMap[b.id] || 0) - (playCountMap[a.id] || 0));

    const neverPlayed = allSongs.filter(s => (playCountMap[s.id] || 0) === 0);

    return {
      mostPlayed,
      neverPlayed
    };
  }

  // ==========================================
  // LISTENING HISTORY & MUSIC REPORT GRAPH
  // ==========================================

  async logPlayEvent(song, secondsListened = 30) {
    if (!song) return;
    await this.initPromise;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const event = {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      duration: secondsListened,
      timestamp: Date.now(),
      dateStr: dateStr
    };

    if (!this.db) {
      this.mem.playHistory.push(event);
      return;
    }

    try {
      const tx = this.db.transaction(['playHistory'], 'readwrite');
      tx.objectStore('playHistory').add(event);
    } catch (e) {
      console.warn('[Anru DB] Error logging history:', e);
    }
  }

  async getAllPlayHistory() {
    await this.initPromise;
    if (!this.db) return [...this.mem.playHistory];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['playHistory'], 'readonly');
        const store = tx.objectStore('playHistory');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async getListeningStats(timeframe = 'week', monthFilter = 'all') {
    const history = await this.getAllPlayHistory();
    const now = new Date();
    const oneDayMs = 86400000;

    // 1. Filter for Activity Graph top metrics (strictly by timeframe: day/week/month/year)
    let cutoff = 0;
    let daysCount = 7;
    if (timeframe === 'day') {
      cutoff = Date.now() - oneDayMs;
      daysCount = 1;
    } else if (timeframe === 'week') {
      cutoff = Date.now() - (7 * oneDayMs);
      daysCount = 7;
    } else if (timeframe === 'month') {
      cutoff = Date.now() - (30 * oneDayMs);
      daysCount = 30;
    } else if (timeframe === 'year') {
      cutoff = Date.now() - (365 * oneDayMs);
      daysCount = 365;
    }
    const timeframeFiltered = history.filter(h => (h.timestamp || 0) >= cutoff);

    let totalSeconds = 0;
    timeframeFiltered.forEach(e => totalSeconds += (e.duration || 30));

    const totalMinutes = Math.round(totalSeconds / 60);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const dailyAvgMinutes = Math.round(totalMinutes / daysCount);

    // 2. Filter for Top 5 Most Played Tracks (all = true All Time, this_month, or specific month 0..11)
    let topFiltered = [];
    if (monthFilter === 'all') {
      topFiltered = history;
    } else if (monthFilter === 'this_month') {
      topFiltered = history.filter(h => {
        const d = new Date(h.timestamp || 0);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    } else {
      const targetMonth = parseInt(monthFilter, 10);
      topFiltered = history.filter(h => {
        const d = new Date(h.timestamp || 0);
        return d.getMonth() === targetMonth && d.getFullYear() === now.getFullYear();
      });
    }

    // Calculate Top 5 Most Played Tracks for the selected monthFilter
    const songPlayMap = {};
    topFiltered.forEach(h => {
      if (!songPlayMap[h.songId]) {
        songPlayMap[h.songId] = {
          songId: h.songId,
          title: h.title,
          artist: h.artist,
          playCount: 0,
          totalSeconds: 0
        };
      }
      songPlayMap[h.songId].playCount++;
      songPlayMap[h.songId].totalSeconds += (h.duration || 30);
    });

    const allSongs = await this.getAllSongs();
    const allSongsMap = new Map(allSongs.map(s => [s.id, s]));

    const topSongs = Object.values(songPlayMap)
      .sort((a, b) => (b.playCount - a.playCount) || (b.totalSeconds - a.totalSeconds))
      .slice(0, 5)
      .map(item => {
        const fullSong = allSongsMap.get(item.songId);
        return {
          ...item,
          title: fullSong ? fullSong.title : item.title,
          artist: fullSong ? fullSong.artist : item.artist,
          album: fullSong ? fullSong.album : 'Offline Music',
          artwork: fullSong ? fullSong.artwork : 'icon-512.png',
          fullSong: fullSong || null
        };
      });

    return {
      totalHours,
      totalPlays: timeframeFiltered.length,
      dailyAvgMinutes,
      totalSeconds,
      topSongs
    };
  }

  async getActivityGraphData(timeframe = 'week') {
    const history = await this.getAllPlayHistory();
    const now = new Date();

    if (timeframe === 'week') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const result = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dayName = days[d.getDay()];
        const dateStr = d.toISOString().slice(0, 10);
        result.push({ label: dayName, dateStr: dateStr, minutes: 0 });
      }

      history.forEach(h => {
        const match = result.find(r => r.dateStr === h.dateStr);
        if (match) match.minutes += Math.round((h.duration || 30) / 60);
      });

      return result;
    }

    if (timeframe === 'month') {
      const weeks = [
        { label: 'W1', minutes: 0 },
        { label: 'W2', minutes: 0 },
        { label: 'W3', minutes: 0 },
        { label: 'W4', minutes: 0 }
      ];
      const oneWeekMs = 7 * 86400000;
      history.forEach(h => {
        const age = Date.now() - (h.timestamp || 0);
        if (age < oneWeekMs) weeks[3].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 2) weeks[2].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 3) weeks[1].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 4) weeks[0].minutes += Math.round((h.duration || 30) / 60);
      });
      return weeks;
    }

    if (timeframe === 'year') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const result = months.map(m => ({ label: m, minutes: 0 }));
      const currentYear = now.getFullYear();
      history.forEach(h => {
        const d = new Date(h.timestamp || 0);
        if (d.getFullYear() === currentYear) {
          const mIdx = d.getMonth();
          if (result[mIdx]) {
            result[mIdx].minutes += Math.round((h.duration || 30) / 60);
          }
        }
      });
      return result;
    }

    if (timeframe === 'day') {
      const segments = [
        { label: 'Night', minutes: 0 },
        { label: 'Morning', minutes: 0 },
        { label: 'Afternoon', minutes: 0 },
        { label: 'Evening', minutes: 0 }
      ];
      const oneDayMs = 86400000;
      history.forEach(h => {
        if (Date.now() - (h.timestamp || 0) < oneDayMs) {
          const hr = new Date(h.timestamp || 0).getHours();
          const mins = Math.round((h.duration || 30) / 60);
          if (hr < 6) segments[0].minutes += mins;
          else if (hr < 12) segments[1].minutes += mins;
          else if (hr < 18) segments[2].minutes += mins;
          else segments[3].minutes += mins;
        }
      });
      return segments;
    }

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => ({ label: m, minutes: 0 }));
    history.forEach(h => {
      const d = new Date(h.timestamp || 0);
      if (d.getFullYear() === now.getFullYear()) {
        months[d.getMonth()].minutes += Math.round((h.duration || 30) / 60);
      }
    });
    return months;
  }

  // ==========================================
  // SETTINGS KEY-VALUE STORE
  // ==========================================

  async getSetting(key, defaultVal = null) {
    await this.initPromise;
    if (!this.db) return this.mem.settings[key] !== undefined ? this.mem.settings[key] : defaultVal;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['settings'], 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : defaultVal);
        req.onerror = () => resolve(defaultVal);
      } catch (e) {
        resolve(defaultVal);
      }
    });
  }

  async setSetting(key, val) {
    await this.initPromise;
    if (!this.db) {
      this.mem.settings[key] = val;
      return true;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['settings'], 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key, value: val });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.db = new MusicDatabase();
}
