/**
 * ANRU MUSIC STUDIO PRO v17 - PERSISTENT OFFLINE STORAGE & ANALYTICS ENGINE (db.js)
 * 1. Persistent Storage for Songs, Blobs, Custom Playlists & Favorites
 * 2. Playback State Persistence (Resume track, position, and queue after app reload/close)
 * 3. Daily / Weekly / Monthly Activity Graph Aggregator (Like Anru Focus)
 * 4. Smart Auto-Playlists: Most Played & Never Played
 * 5. Duplicate song prevention
 */

class MusicDatabase {
  constructor() {
    this.dbName = 'AnruLocalMusicDB';
    this.dbVersion = 3; // Incremented for activity graph & smart playlists
    this.db = null;
    this.mem = {
      songs: [],
      playlists: [],
      favorites: new Set(),
      playHistory: [],
      settings: {}
    };
    this.initPromise = this.init();
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
          console.log('[Anru DB] IndexedDB Storage Ready v17 ⚡');
          resolve(this.db);
        };

        request.onerror = (e) => {
          console.warn('[Anru DB] IndexedDB error, using memory fallback:', e.target.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('[Anru DB] IndexedDB exception, using memory fallback:', err);
        resolve(null);
      }
    });
  }

  // Duplicate Check
  async findDuplicate(meta, fileSize = 0, fileName = '') {
    await this.initPromise;
    const songs = await this.getAllSongs();
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
    const record = {
      id: songData.id || ('local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6)),
      title: songData.title || 'Untitled Song',
      artist: songData.artist || 'Local Artist',
      album: songData.album || 'Local Library',
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
      const tx = this.db.transaction(['songs'], 'readwrite');
      const store = tx.objectStore('songs');
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllSongs() {
    await this.initPromise;
    if (!this.db) {
      return [...this.mem.songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs'], 'readonly');
      const store = tx.objectStore('songs');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async deleteSong(id) {
    await this.initPromise;
    if (!this.db) {
      this.mem.songs = this.mem.songs.filter(s => s.id !== id);
      this.mem.favorites.delete(id);
      this.mem.playlists.forEach(pl => {
        pl.songIds = pl.songIds.filter(sid => sid !== id);
      });
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs', 'favorites'], 'readwrite');
      tx.objectStore('songs').delete(id);
      tx.objectStore('favorites').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async deleteMultipleSongs(ids) {
    await this.initPromise;
    if (!ids || ids.length === 0) return true;

    if (!this.db) {
      const idSet = new Set(ids);
      this.mem.songs = this.mem.songs.filter(s => !idSet.has(s.id));
      ids.forEach(id => this.mem.favorites.delete(id));
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs', 'favorites'], 'readwrite');
      const songStore = tx.objectStore('songs');
      const favStore = tx.objectStore('favorites');
      ids.forEach(id => {
        songStore.delete(id);
        favStore.delete(id);
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async clearAllSongs() {
    await this.initPromise;
    if (!this.db) {
      this.mem.songs = [];
      this.mem.favorites.clear();
      return true;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['songs', 'favorites'], 'readwrite');
      tx.objectStore('songs').clear();
      tx.objectStore('favorites').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // Favorites
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
      } else {
        store.put({ id: id, addedAt: Date.now() });
      }
      tx.oncomplete = () => resolve(!isFav);
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
      req.onsuccess = () => resolve(req.result.map(f => f.id));
      req.onerror = () => resolve([]);
    });
  }

  // Playlists
  async createPlaylist(name) {
    await this.initPromise;
    const pl = {
      id: ('pl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5)),
      name: name.trim() || 'My Playlist',
      songIds: [],
      createdAt: Date.now()
    };

    if (!this.db) {
      this.mem.playlists.push(pl);
      return pl;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.add(pl);
      req.onsuccess = () => resolve(pl);
      req.onerror = () => reject(req.error);
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
      if (pl && !pl.songIds.includes(songId)) {
        pl.songIds.push(songId);
        return true;
      }
      return false;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      const getReq = store.get(playlistId);
      getReq.onsuccess = () => {
        const pl = getReq.result;
        if (!pl) { resolve(false); return; }
        if (!pl.songIds.includes(songId)) {
          pl.songIds.push(songId);
          store.put(pl);
        }
        resolve(true);
      };
      getReq.onerror = () => resolve(false);
    });
  }

  async removeSongFromPlaylist(playlistId, songId) {
    await this.initPromise;
    if (!this.db) {
      const pl = this.mem.playlists.find(p => p.id === playlistId);
      if (pl) {
        pl.songIds = pl.songIds.filter(id => id !== songId);
        return true;
      }
      return false;
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playlists'], 'readwrite');
      const store = tx.objectStore('playlists');
      const getReq = store.get(playlistId);
      getReq.onsuccess = () => {
        const pl = getReq.result;
        if (!pl) { resolve(false); return; }
        pl.songIds = pl.songIds.filter(id => id !== songId);
        store.put(pl);
        resolve(true);
      };
      getReq.onerror = () => resolve(false);
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
      tx.objectStore('playlists').delete(playlistId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // ==========================================
  // PLAYBACK STATE PERSISTENCE (RESUME ACROSS RELOAD)
  // ==========================================

  async savePlaybackState(state) {
    await this.initPromise;
    await this.setSetting('last_playback_state', {
      songId: state.songId,
      currentTime: state.currentTime || 0,
      queueSongIds: state.queueSongIds || [],
      isShuffle: !!state.isShuffle,
      repeatMode: state.repeatMode || 'all',
      savedAt: Date.now()
    });
  }

  async getPlaybackState() {
    await this.initPromise;
    return await this.getSetting('last_playback_state', null);
  }

  // ==========================================
  // SMART PLAYLISTS: MOST PLAYED & NEVER PLAYED
  // ==========================================

  async getSmartPlaylists() {
    await this.initPromise;
    const allSongs = await this.getAllSongs();
    const history = await this.getAllPlayHistory();

    const playCountMap = {};
    history.forEach(h => {
      playCountMap[h.songId] = (playCountMap[h.songId] || 0) + 1;
    });

    // Most Played: at least 1 play, sorted by plays descending
    const mostPlayed = allSongs
      .filter(s => (playCountMap[s.id] || 0) > 0)
      .sort((a, b) => (playCountMap[b.id] || 0) - (playCountMap[a.id] || 0));

    // Never Played: exactly 0 plays
    const neverPlayed = allSongs.filter(s => (playCountMap[s.id] || 0) === 0);

    return {
      mostPlayed,
      neverPlayed
    };
  }

  // ==========================================
  // LISTENING HISTORY & MUSIC REPORT GRAPH (ANRU FOCUS STYLE)
  // ==========================================

  async logPlayEvent(song, secondsListened = 30) {
    if (!song) return;
    await this.initPromise;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
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
      console.warn('[Anru DB] Error logging play event', e);
    }
  }

  async getAllPlayHistory() {
    await this.initPromise;
    if (!this.db) return [...this.mem.playHistory];

    return new Promise((resolve) => {
      const tx = this.db.transaction(['playHistory'], 'readonly');
      const store = tx.objectStore('playHistory');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  /**
   * Generates graph activity data (bar chart buckets like Anru Focus)
   * Week: Past 7 days with day labels (Mon, Tue, etc.)
   * Month: Past 4 weeks (W1, W2, W3, W4)
   * Year: 12 months (Jan..Dec)
   */
  async getActivityGraphData(timeframe = 'week') {
    const history = await this.getAllPlayHistory();
    const now = new Date();

    if (timeframe === 'week') {
      // Last 7 days
      const days = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        days.push({
          label: i === 0 ? 'Today' : dayNames[d.getDay()],
          dateStr: dateStr,
          seconds: 0
        });
      }

      history.forEach(h => {
        const match = days.find(d => d.dateStr === h.dateStr);
        if (match) {
          match.seconds += (h.duration || 30);
        }
      });

      return days.map(d => ({
        label: d.label,
        minutes: Math.round(d.seconds / 60)
      }));
    } else if (timeframe === 'month') {
      // Past 4 weeks
      const weeks = [
        { label: 'W-3', minutes: 0 },
        { label: 'W-2', minutes: 0 },
        { label: 'W-1', minutes: 0 },
        { label: 'This Wk', minutes: 0 }
      ];
      const nowTs = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      history.forEach(h => {
        const age = nowTs - h.timestamp;
        if (age < oneWeekMs) weeks[3].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 2) weeks[2].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 3) weeks[1].minutes += Math.round((h.duration || 30) / 60);
        else if (age < oneWeekMs * 4) weeks[0].minutes += Math.round((h.duration || 30) / 60);
      });

      return weeks;
    } else {
      // 12 Months
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => ({
        label: m,
        minutes: 0
      }));

      const currentYear = now.getFullYear();
      history.forEach(h => {
        const d = new Date(h.timestamp);
        if (d.getFullYear() === currentYear) {
          months[d.getMonth()].minutes += Math.round((h.duration || 30) / 60);
        }
      });

      return months;
    }
  }

  async getListeningStats(timeframe = 'week') {
    const events = await this.getAllPlayHistory();
    const now = Date.now();
    let cutoff = 0;
    if (timeframe === 'week') cutoff = now - (7 * 24 * 60 * 60 * 1000);
    else if (timeframe === 'month') cutoff = now - (30 * 24 * 60 * 60 * 1000);
    else cutoff = now - (365 * 24 * 60 * 60 * 1000);

    const filtered = events.filter(e => (e.timestamp || 0) >= cutoff);

    let totalSeconds = 0;
    const songCountMap = {};

    filtered.forEach(e => {
      totalSeconds += (e.duration || 30);
      const sKey = e.songId || e.title;
      if (!songCountMap[sKey]) {
        songCountMap[sKey] = {
          songId: e.songId,
          title: e.title,
          artist: e.artist,
          count: 0
        };
      }
      songCountMap[sKey].count++;
    });

    const topSongs = Object.values(songCountMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const totalHours = (totalSeconds / 3600).toFixed(1);
    const totalMinutes = Math.round(totalSeconds / 60);
    const dailyAvgMinutes = Math.round(totalMinutes / (timeframe === 'week' ? 7 : (timeframe === 'month' ? 30 : 365)));

    return {
      timeframe,
      totalHours,
      totalMinutes,
      dailyAvgMinutes,
      totalPlays: filtered.length,
      topSongs
    };
  }

  async getSetting(key, defaultVal = null) {
    await this.initPromise;
    if (!this.db) return (this.mem.settings[key] !== undefined ? this.mem.settings[key] : defaultVal);

    return new Promise((resolve) => {
      const tx = this.db.transaction(['settings'], 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.val : defaultVal);
      req.onerror = () => resolve(defaultVal);
    });
  }

  async setSetting(key, val) {
    await this.initPromise;
    if (!this.db) {
      this.mem.settings[key] = val;
      return;
    }

    const tx = this.db.transaction(['settings'], 'readwrite');
    tx.objectStore('settings').put({ key, val });
  }
}

const db = new MusicDatabase();
if (typeof window !== 'undefined') window.db = db;
if (typeof globalThis !== 'undefined') globalThis.db = db;
