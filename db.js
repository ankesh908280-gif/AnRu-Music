/**
 * ANRU MUSIC - INDEXEDDB STORAGE & LOCAL PLAYLISTS ENGINE
 * Stores full offline audio blobs, user favorites, and custom playlists.
 * Transparent fallback to safe localStorage if IndexedDB is unavailable.
 */

const storage = {
  get(key, fallback = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage set error:', e);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Storage remove error:', e);
    }
  }
};

class MusicDB {
  constructor() {
    this.dbName = 'AnruMusicProDB';
    this.version = 2; // Upgraded to v2 for custom playlists
    this.db = null;
  }

  async init() {
    if (typeof indexedDB === 'undefined') {
      console.warn('IndexedDB not supported, falling back to local storage');
      return null;
    }

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, this.version);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('downloads')) {
            db.createObjectStore('downloads', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('favorites')) {
            db.createObjectStore('favorites', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('playlists')) {
            db.createObjectStore('playlists', { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('IndexedDB open notice:', event.target.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB init notice:', err);
        resolve(null);
      }
    });
  }

  // ==========================================
  // OFFLINE DOWNLOADS STORE
  // ==========================================
  async saveDownload(song, blob = null) {
    try {
      if (!this.db) await this.init();

      const item = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || 'Single',
        duration: song.duration || 210,
        artwork: song.artwork || song.image || 'icon-512.png',
        image: song.image || song.artwork || 'icon-512.png',
        audioUrl: song.audioUrl,
        blob: blob,
        downloadedAt: Date.now()
      };

      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-downloads', '[]'));
        const existing = list.findIndex(s => s.id === song.id);
        if (existing !== -1) list[existing] = item;
        else list.unshift(item);
        storage.set('anru-local-downloads', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          store.put(item);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async getAllDownloads() {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        return JSON.parse(storage.get('anru-local-downloads', '[]'));
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readonly');
          const store = tx.objectStore('downloads');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  async getDownload(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-downloads', '[]'));
        return list.find(s => s.id === id) || null;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readonly');
          const store = tx.objectStore('downloads');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  }

  async deleteDownload(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        let list = JSON.parse(storage.get('anru-local-downloads', '[]'));
        list = list.filter(s => s.id !== id);
        storage.set('anru-local-downloads', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          store.delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async clearAllDownloads() {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        storage.set('anru-local-downloads', '[]');
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('downloads', 'readwrite');
          const store = tx.objectStore('downloads');
          store.clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  // ==========================================
  // FAVORITES (LIKED SONGS) STORE
  // ==========================================
  async toggleFavorite(song) {
    try {
      if (!this.db) await this.init();
      const isFav = await this.isFavorite(song.id);

      if (isFav) {
        await this.deleteFavorite(song.id);
        return false;
      } else {
        const item = {
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album || 'Single',
          duration: song.duration || 210,
          artwork: song.artwork || song.image || 'icon-512.png',
          image: song.image || song.artwork || 'icon-512.png',
          audioUrl: song.audioUrl,
          addedAt: Date.now()
        };

        if (!this.db) {
          const list = JSON.parse(storage.get('anru-local-favs', '[]'));
          list.unshift(item);
          storage.set('anru-local-favs', JSON.stringify(list));
          return true;
        }

        return new Promise((resolve) => {
          try {
            const tx = this.db.transaction('favorites', 'readwrite');
            const store = tx.objectStore('favorites');
            store.put(item);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        });
      }
    } catch (e) {
      return false;
    }
  }

  async isFavorite(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-favs', '[]'));
        return list.some(s => s.id === id);
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readonly');
          const store = tx.objectStore('favorites');
          const req = store.get(id);
          req.onsuccess = () => resolve(!!req.result);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async deleteFavorite(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        let list = JSON.parse(storage.get('anru-local-favs', '[]'));
        list = list.filter(s => s.id !== id);
        storage.set('anru-local-favs', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readwrite');
          const store = tx.objectStore('favorites');
          store.delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async getAllFavorites() {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        return JSON.parse(storage.get('anru-local-favs', '[]'));
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('favorites', 'readonly');
          const store = tx.objectStore('favorites');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  // ==========================================
  // CUSTOM PLAYLISTS STORE
  // ==========================================
  async createPlaylist(title) {
    try {
      if (!this.db) await this.init();
      const newPl = {
        id: 'pl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        title: title || 'New Playlist',
        songs: [],
        createdAt: Date.now()
      };

      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-playlists', '[]'));
        list.push(newPl);
        storage.set('anru-local-playlists', JSON.stringify(list));
        return newPl;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readwrite');
          const store = tx.objectStore('playlists');
          store.put(newPl);
          tx.oncomplete = () => resolve(newPl);
          tx.onerror = () => resolve(newPl);
        } catch (e) {
          resolve(newPl);
        }
      });
    } catch (e) {
      return { id: 'pl-fallback', title: title, songs: [] };
    }
  }

  async getAllPlaylists() {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        return JSON.parse(storage.get('anru-local-playlists', '[]'));
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readonly');
          const store = tx.objectStore('playlists');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  async getPlaylist(id) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-playlists', '[]'));
        return list.find(p => p.id === id) || null;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readonly');
          const store = tx.objectStore('playlists');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  }

  async addSongToPlaylist(playlistId, song) {
    try {
      const pl = await this.getPlaylist(playlistId);
      if (!pl) return false;

      if (!pl.songs) pl.songs = [];
      const alreadyHas = pl.songs.some(s => s.id === song.id);
      if (!alreadyHas) {
        pl.songs.push({
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album || 'Single',
          duration: song.duration || 210,
          artwork: song.artwork || song.image || 'icon-512.png',
          image: song.image || song.artwork || 'icon-512.png',
          audioUrl: song.audioUrl
        });
      }

      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-playlists', '[]'));
        const idx = list.findIndex(p => p.id === playlistId);
        if (idx !== -1) list[idx] = pl;
        storage.set('anru-local-playlists', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readwrite');
          const store = tx.objectStore('playlists');
          store.put(pl);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async removeSongFromPlaylist(playlistId, songId) {
    try {
      const pl = await this.getPlaylist(playlistId);
      if (!pl || !pl.songs) return false;

      pl.songs = pl.songs.filter(s => s.id !== songId);

      if (!this.db) {
        const list = JSON.parse(storage.get('anru-local-playlists', '[]'));
        const idx = list.findIndex(p => p.id === playlistId);
        if (idx !== -1) list[idx] = pl;
        storage.set('anru-local-playlists', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readwrite');
          const store = tx.objectStore('playlists');
          store.put(pl);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async deletePlaylist(playlistId) {
    try {
      if (!this.db) await this.init();
      if (!this.db) {
        let list = JSON.parse(storage.get('anru-local-playlists', '[]'));
        list = list.filter(p => p.id !== playlistId);
        storage.set('anru-local-playlists', JSON.stringify(list));
        return true;
      }

      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('playlists', 'readwrite');
          const store = tx.objectStore('playlists');
          store.delete(playlistId);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }
}

const db = new MusicDB();

if (typeof window !== 'undefined') {
  window.db = db;
  window.storage = storage;
}
if (typeof globalThis !== 'undefined') {
  globalThis.db = db;
  globalThis.storage = storage;
}
