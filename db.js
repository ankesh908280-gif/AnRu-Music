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

  async saveSong(songData) {
    await this.initPromise;
    this.invalidateCache();

    const record = {
      id: songData.id || ('local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6)),
      title: songData.title || 'Untitled Song',
      artist: songData.artist || 'Local Artist',
      album: songData.album || 'Offline Music',
      duration: songData.duration || 0,
      artwork: songData.artwork || 'icon-512.png',
      audioBlob: songData.audioBlob,
      dateAdded: songData.dateAdded || Date.now(),
      fileSize: songData.fileSize || (songData.audioBlob ? songData.audioBlob.size : 0),
      fileName: songData.fileName || ''
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

  async getAllSongs() {
    await this.initPromise;
    if (!this.db) {
      const list = [...this.mem.songs];
      list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
      return list;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs'], 'readonly');
      const store = tx.objectStore('songs');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        this._cachedSongMeta = list;
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async getSongBlob(id) {
    if (!id) return null;
    await this.initPromise;
    if (!this.db) {
      const s = this.mem.songs.find(s => s.id === id);
      return s ? s.audioBlob : null;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const req = store.get(id);
        req.onsuccess = () => {
          resolve(req.result ? req.result.audioBlob : null);
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

  async getListeningStats(timeframe = 'week') {
    const history = await this.getAllPlayHistory();
    const now = Date.now();
    const oneDayMs = 86400000;

    let cutoff = 0;
    let daysCount = 7;
    if (timeframe === 'day') {
      cutoff = now - oneDayMs;
      daysCount = 1;
    } else if (timeframe === 'week') {
      cutoff = now - (7 * oneDayMs);
      daysCount = 7;
    } else if (timeframe === 'month') {
      cutoff = now - (30 * oneDayMs);
      daysCount = 30;
    } else if (timeframe === 'year') {
      cutoff = now - (365 * oneDayMs);
      daysCount = 365;
    }

    const filtered = history.filter(h => (h.timestamp || 0) >= cutoff);
    let totalSeconds = 0;
    filtered.forEach(e => totalSeconds += (e.duration || 30));

    const totalMinutes = Math.round(totalSeconds / 60);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const dailyAvgMinutes = Math.round(totalMinutes / Math.max(1, daysCount));

    return {
      totalHours,
      totalPlays: filtered.length,
      dailyAvgMinutes,
      totalSeconds
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
