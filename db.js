/**
 * ANRU MUSIC - PERSISTENT OFFLINE STORAGE ENGINE (db.js)
 * IndexedDB storage for songs, audio Blobs, custom playlists & studio settings.
 * Retains all files permanently so songs are never lost on reload.
 * Includes graceful memory fallback if IndexedDB is sandboxed or denied.
 */

class MusicDatabase {
  constructor() {
    this.dbName = 'AnruLocalMusicDB';
    this.dbVersion = 1;
    this.db = null;
    this.mem = {
      songs: [],
      playlists: [],
      favorites: new Set(),
      settings: {}
    };
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('IndexedDB not supported, using memory fallback.');
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
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        };

        request.onsuccess = (e) => {
          this.db = e.target.result;
          console.log('[Anru DB] IndexedDB Persistent Storage Ready ⚡');
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
      dateAdded: Date.now(),
      fileSize: songData.fileSize || (songData.audioBlob ? songData.audioBlob.size : 0)
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
