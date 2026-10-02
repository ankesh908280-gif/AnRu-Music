/**
 * ANRU MUSIC - HIGH-DEFINITION REAL AUDIO ENGINE (api.js)
 * 1. Primary: JioSaavn 320kbps / 160kbps Full Song API (Direct aac.saavncdn.com CDN streams)
 * 2. Backup: YouTube Music Full Audio Streams (Invidious / Piped proxy itag=140)
 * 3. Dynamic Home Shelves Feed from JioSaavn
 * ZERO 30s clips. ZERO SoundHelix fake tunes.
 */

// Base64 runtime decoder
const _u = (b64) => {
  try {
    return atob(b64);
  } catch (e) {
    return '';
  }
};

// 1. Primary: JioSaavn Full-Length HD Audio API Mirrors
const SAAVN_MIRRORS = [
  _u('aHR0cHM6Ly9zYWF2bi5kZXYvYXBpL3NlYXJjaC9zb25ncw=='), // https://saavn.dev/api/search/songs
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktcHJpdmF0ZS1zaWdtYS52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktMi1oYXJzaC1wYXRlbC52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9zYWF2bi1hcGkudmVyY2VsLmFwcC9zZWFyY2gvc29uZ3M='),
  _u('aHR0cHM6Ly9qaW8tc2Fhdm4tYXBpLnZlcmNlbC5hcHAvc2VhcmNoL3Nvbmdz'),
  _u('aHR0cHM6Ly9zYWF2bi5tZS9zZWFyY2gvc29uZ3M=')
].filter(Boolean);

// 2. Backup: YouTube Music Audio Mirrors (Full AAC itag=140 streams)
const YOUTUBE_SEARCH_MIRRORS = [
  'https://inv.nadeko.net/api/v1/search',
  'https://invidious.nerdvpn.de/api/v1/search',
  'https://vid.puffyan.us/api/v1/search'
];

function decodeHtml(html) {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

// Normalize Song Payload from JioSaavn (Extracting full 320k/160k CDN streams)
function normalizeSaavnPayload(raw) {
  if (!raw) return null;

  const title = decodeHtml(raw.name || raw.song || raw.title || 'Unknown Title')
    .replace(/\&quot;/g, '"')
    .replace(/\&#039;/g, "'")
    .replace(/\s*\(From\s+.*?\)/gi, '')
    .trim();

  const artist = decodeHtml(
    raw.primaryArtists ||
    raw.singers ||
    raw.primary_artists ||
    raw.artist ||
    (Array.isArray(raw.artists?.primary) ? raw.artists.primary.map(a => a.name).join(', ') : '') ||
    'JioSaavn Artist'
  ).trim();

  const album = decodeHtml(raw.album?.name || raw.album || 'Single').trim();

  // Artwork resolution (500x500 HD)
  let image = 'icon-512.png';
  if (Array.isArray(raw.image) && raw.image.length) {
    const best = raw.image.find(img => img.quality === '500x500') || raw.image[raw.image.length - 1];
    if (best && (best.url || best.link)) image = best.url || best.link;
  } else if (typeof raw.image === 'string') {
    image = raw.image.replace('150x150', '500x500');
  }

  // 320kbps / 160kbps Full Song Stream Resolution from JioSaavn CDN
  let audioUrl = '';
  if (Array.isArray(raw.downloadUrl) && raw.downloadUrl.length) {
    const best320 = raw.downloadUrl.find(u => u.quality === '320kbps') ||
                    raw.downloadUrl.find(u => u.quality === '160kbps') ||
                    raw.downloadUrl.find(u => u.quality === '96kbps') ||
                    raw.downloadUrl[raw.downloadUrl.length - 1];
    if (best320 && (best320.url || best320.link)) audioUrl = best320.url || best320.link;
  } else if (raw.media_url) {
    audioUrl = raw.media_url;
  }

  if (!audioUrl) return null;

  return {
    id: `saavn-${raw.id || Math.random().toString(36).substr(2, 9)}`,
    title: title,
    artist: artist,
    album: album,
    duration: parseInt(raw.duration || 215, 10),
    image: image,
    artwork: image,
    audioUrl: audioUrl,
    source: 'jiosaavn-320k'
  };
}

// Normalize Song Payload from YouTube Music (Invidious Full Audio Stream)
function normalizeYoutubePayload(item) {
  if (!item) return null;
  const videoId = item.videoId || (item.url ? item.url.replace('/watch?v=', '') : '') || '';
  if (!videoId || videoId.length < 5) return null;

  const title = (item.title || 'YouTube Music Track').replace(/\s*\(Official.*?\)/gi, '').trim();
  const artist = item.author || item.uploaderName || 'YouTube Artist';
  const artwork = (item.videoThumbnails && item.videoThumbnails[0]?.url) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  
  // Real full audio stream from Invidious proxy (native itag=140 AAC audio)
  const audioUrl = `https://inv.nadeko.net/latest_version?id=${videoId}&itag=140`;

  return {
    id: `yt-${videoId}`,
    title: title,
    artist: artist,
    album: 'YouTube Audio',
    duration: parseInt(item.lengthSeconds || item.duration || 210, 10),
    image: artwork,
    artwork: artwork,
    audioUrl: audioUrl,
    source: 'youtube-audio'
  };
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 6000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Fetch Songs list from JioSaavn API (Used for Home Shelves and search)
async function fetchJioSaavnSongs(query, limit = 10) {
  if (!query) return [];

  // Try direct saavn mirrors
  for (const mirror of SAAVN_MIRRORS) {
    try {
      const res = await fetchWithTimeout(`${mirror}?query=${encodeURIComponent(query)}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 4500
      });
      if (res.ok) {
        const json = await res.json();
        let list = [];
        if (json.data && Array.isArray(json.data.results)) list = json.data.results;
        else if (json.data && Array.isArray(json.data)) list = json.data;
        else if (Array.isArray(json.results)) list = json.results;
        else if (Array.isArray(json)) list = json;

        const parsed = list.map(normalizeSaavnPayload).filter(s => s && s.audioUrl);
        if (parsed.length > 0) return parsed;
      }
    } catch (e) {}
  }

  // Fallback to CORS proxy with official JioSaavn
  try {
    const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=${limit}&p=1&_marker=0&ctx=android&q=${encodeURIComponent(query)}`;
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(saavnUrl)}`;
    const res = await fetchWithTimeout(proxyUrl, { timeout: 4500 });
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.results)) {
        const parsed = json.results.map(normalizeSaavnPayload).filter(s => s && s.audioUrl);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch (e) {}

  return [];
}

// Resolve real full audio on the fly for any song
async function resolveFullSongAudio(title, artist) {
  if (!title) return null;
  const cleanTitle = title.replace(/\s*\(.*?\)/g, '').trim();
  const query = `${cleanTitle} ${artist || ''}`.trim();

  // 1. Try JioSaavn Mirrors first
  const saavnResults = await fetchJioSaavnSongs(query, 5);
  if (saavnResults.length > 0 && saavnResults[0].audioUrl) {
    return saavnResults[0].audioUrl;
  }

  // 2. Backup: YouTube Music Audio Stream (Invidious)
  for (const mirror of YOUTUBE_SEARCH_MIRRORS) {
    try {
      const ytUrl = `${mirror}?q=${encodeURIComponent(query + ' song')}&type=video`;
      const res = await fetchWithTimeout(ytUrl, {
        headers: { 'Accept': 'application/json' },
        timeout: 4500
      });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items) && items.length > 0) {
          const parsed = normalizeYoutubePayload(items[0]);
          if (parsed && parsed.audioUrl) return parsed.audioUrl;
        }
      }
    } catch (e) {}
  }

  return null;
}

// Unified Search Engine: JioSaavn Primary + YouTube Backup
async function searchMusic(query) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim().toLowerCase();

  // Smart Mood Synonyms Mapping
  const synonymMap = {
    'energize': ['dance', 'party', 'punjabi', 'upbeat', 'workout', 'bhojpuri'],
    'workout': ['gym', 'beats', 'punjabi', 'energize', 'fitness'],
    'party': ['club', 'dance', 'dj', 'remix', 'bhojpuri', 'punjabi'],
    'relax': ['lofi', 'chill', 'soft', 'romance', 'acoustic'],
    'romance': ['love', 'arijit', 'romantic', 'heart', 'slow'],
    'bhakti': ['devotional', 'bhajan', 'aarti', 'chalisa', 'spiritual'],
    'trending': ['hits', 'popular', 'bollywood', 'hindi', 'bhojpuri']
  };

  const extraKeywords = synonymMap[cleanQ] || [];
  const allSearchKeywords = [cleanQ, ...cleanQ.split(/\s+/).filter(w => w.length >= 2), ...extraKeywords];

  // 1. Instant Local Catalog Search (Zero Network Delay)
  let localMatches = [];
  if (typeof CURATED_FULL_CATALOG !== 'undefined') {
    localMatches = CURATED_FULL_CATALOG.filter(s => {
      const fullText = `${s.title} ${s.artist} ${s.album} ${s.category} ${(s.tags || []).join(' ')} ${(s.moodTags || []).join(' ')}`.toLowerCase();
      return allSearchKeywords.some(word => fullText.includes(word));
    });
  }

  // 2. Fetch Online Audio Engines in Parallel (JioSaavn Primary + YouTube Backup)
  const onlinePromises = [];

  // A. JioSaavn Mirrors
  for (const mirror of SAAVN_MIRRORS.slice(0, 3)) {
    onlinePromises.push(
      fetchWithTimeout(`${mirror}?query=${encodeURIComponent(query)}&limit=25`, {
        headers: { 'Accept': 'application/json' },
        timeout: 6000
      })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json) return [];
        let rawList = [];
        if (json.data && Array.isArray(json.data.results)) rawList = json.data.results;
        else if (json.data && Array.isArray(json.data)) rawList = json.data;
        else if (Array.isArray(json.results)) rawList = json.results;
        else if (Array.isArray(json)) rawList = json;
        return rawList.map(normalizeSaavnPayload).filter(Boolean);
      })
      .catch(() => [])
    );
  }

  // B. YouTube Music API Backup
  onlinePromises.push(
    fetchWithTimeout(`https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(query + ' song')}&type=video`, {
      headers: { 'Accept': 'application/json' },
      timeout: 5500
    })
    .then(res => res.ok ? res.json() : null)
    .then(items => {
      if (Array.isArray(items) && items.length > 0) {
        return items.slice(0, 15).map(normalizeYoutubePayload).filter(Boolean);
      }
      return [];
    })
    .catch(() => [])
  );

  // Wait for all online engines to respond
  let apiResults = [];
  try {
    const settled = await Promise.allSettled(onlinePromises);
    settled.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
        apiResults.push(...result.value);
      }
    });
  } catch (e) {}

  // 3. Deduplicate and merge results (Local matches first, then online tracks)
  const combined = [...localMatches];
  const seenIds = new Set(localMatches.map(s => s.id));
  const seenTitles = new Set(localMatches.map(s => s.title.toLowerCase().trim()));

  for (const song of apiResults) {
    const cleanTitle = song.title.toLowerCase().trim();
    if (!seenIds.has(song.id) && !seenTitles.has(cleanTitle)) {
      combined.push(song);
      seenIds.add(song.id);
      seenTitles.add(cleanTitle);
    }
  }

  return combined;
}

if (typeof window !== 'undefined') { 
  window.searchMusic = searchMusic; 
  window.normalizeSaavnPayload = normalizeSaavnPayload; 
  window.normalizeYoutubePayload = normalizeYoutubePayload;
  window.resolveFullSongAudio = resolveFullSongAudio;
  window.fetchJioSaavnSongs = fetchJioSaavnSongs;
}
if (typeof globalThis !== 'undefined') { 
  globalThis.searchMusic = searchMusic; 
  globalThis.normalizeSaavnPayload = normalizeSaavnPayload; 
  globalThis.normalizeYoutubePayload = normalizeYoutubePayload;
  globalThis.resolveFullSongAudio = resolveFullSongAudio;
  globalThis.fetchJioSaavnSongs = fetchJioSaavnSongs;
}
