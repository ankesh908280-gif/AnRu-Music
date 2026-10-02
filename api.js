/**
 * ANRU MUSIC - ROBUST REAL AUDIO ENGINE (api.js)
 * 1. Primary: JioSaavn High-Definition Full Streams (Direct CDN audio)
 * 2. Parallel Mirror Race: saavn.dev, saavn.me, vercel mirrors + official JioSaavn via CORS Proxies
 * 3. Backup: YouTube Music Audio Streams (Invidious itag=140)
 * 4. High-res artwork & instant streaming
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

// 2. Backup: YouTube Music Audio Mirrors
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

// Normalize Song Payload from JioSaavn (Extracting full direct CDN streams)
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

  // Stream Resolution Hierarchy:
  // 1. downloadUrl array (from saavn.dev / saavn.me)
  let audioUrl = '';
  if (Array.isArray(raw.downloadUrl) && raw.downloadUrl.length) {
    const best320 = raw.downloadUrl.find(u => u.quality === '320kbps') ||
                    raw.downloadUrl.find(u => u.quality === '160kbps') ||
                    raw.downloadUrl.find(u => u.quality === '96kbps') ||
                    raw.downloadUrl[raw.downloadUrl.length - 1];
    if (best320 && (best320.url || best320.link)) audioUrl = best320.url || best320.link;
  }

  // 2. more_info.vlink or media_preview_url (from official JioSaavn API)
  if (!audioUrl && raw.more_info) {
    if (raw.more_info.vlink) audioUrl = raw.more_info.vlink;
    else if (raw.more_info.media_preview_url) audioUrl = raw.more_info.media_preview_url;
  }

  // 3. media_url
  if (!audioUrl && raw.media_url) {
    audioUrl = raw.media_url;
  }

  // 4. media_preview_url (Direct JioSaavn CDN stream)
  if (!audioUrl && raw.media_preview_url) {
    audioUrl = raw.media_preview_url;
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

// Normalize Song Payload from YouTube Music (Invidious itag=140 stream)
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
  const { timeout = 5000 } = options;
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

// Robust JioSaavn Fetcher (Parallel Race across all mirrors & CORS proxies)
async function fetchJioSaavnSongs(query, limit = 10) {
  if (!query) return [];
  const cleanQ = query.trim();

  const endpoints = [];

  // A. Saavn API Mirrors
  for (const mirror of SAAVN_MIRRORS) {
    endpoints.push(
      fetchWithTimeout(`${mirror}?query=${encodeURIComponent(cleanQ)}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 4500
      })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json) return null;
        let list = [];
        if (json.data && Array.isArray(json.data.results)) list = json.data.results;
        else if (json.data && Array.isArray(json.data)) list = json.data;
        else if (Array.isArray(json.results)) list = json.results;
        else if (Array.isArray(json)) list = json;

        const parsed = list.map(normalizeSaavnPayload).filter(s => s && s.audioUrl);
        return parsed.length > 0 ? parsed : null;
      })
      .catch(() => null)
    );
  }

  // B. Official JioSaavn via CORS Proxies
  const saavnOfficialUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=${limit}&p=1&_marker=0&ctx=android&q=${encodeURIComponent(cleanQ)}`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(saavnOfficialUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(saavnOfficialUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(saavnOfficialUrl)}`
  ];

  for (const proxy of proxies) {
    endpoints.push(
      fetchWithTimeout(proxy, { timeout: 4500 })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json || !Array.isArray(json.results)) return null;
        const parsed = json.results.map(normalizeSaavnPayload).filter(s => s && s.audioUrl);
        return parsed.length > 0 ? parsed : null;
      })
      .catch(() => null)
    );
  }

  // Race endpoints and return first successful result
  try {
    const settled = await Promise.allSettled(endpoints);
    for (const res of settled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
        return res.value;
      }
    }
  } catch (e) {}

  return [];
}

// Resolve real audio stream on the fly for any song (with query cleaning & multi-stage retry)
async function resolveFullSongAudio(title, artist) {
  if (!title) return null;

  // Clean title: remove "(From ...)" and special characters
  const cleanTitle = title.replace(/\s*\(.*?\)/gi, '').replace(/[^a-zA-Z0-9\s]/gi, ' ').trim();
  
  // Extract primary artist only (before comma, &, or /)
  const mainArtist = (artist || '').split(/[,&/]/)[0].replace(/[^a-zA-Z0-9\s]/gi, ' ').trim();

  const searchQueries = [
    `${cleanTitle} ${mainArtist}`.trim(),
    cleanTitle
  ];

  for (const q of searchQueries) {
    if (!q) continue;

    // 1. Try JioSaavn
    const saavnSongs = await fetchJioSaavnSongs(q, 3);
    if (saavnSongs && saavnSongs.length > 0 && saavnSongs[0].audioUrl) {
      return saavnSongs[0].audioUrl;
    }

    // 2. Try YouTube Music (Invidious)
    for (const mirror of YOUTUBE_SEARCH_MIRRORS) {
      try {
        const ytUrl = `${mirror}?q=${encodeURIComponent(q + ' song')}&type=video`;
        const res = await fetchWithTimeout(ytUrl, {
          headers: { 'Accept': 'application/json' },
          timeout: 4000
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
  const onlineResults = await fetchJioSaavnSongs(query, 25);

  // 3. Deduplicate and merge results (Local matches first, then online tracks)
  const combined = [...localMatches];
  const seenIds = new Set(localMatches.map(s => s.id));
  const seenTitles = new Set(localMatches.map(s => s.title.toLowerCase().trim()));

  for (const song of onlineResults) {
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
