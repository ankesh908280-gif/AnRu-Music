/**
 * ANRU MUSIC - FULL-LENGTH HIGH-DEFINITION AUDIO ENGINE (api.js)
 * 1. Primary: JioSaavn 320kbps / 160kbps Full Songs API (aac.saavncdn.com direct streams)
 * 2. Backup: YouTube Music Full Audio Streams (Piped / Invidious proxy itag=140)
 * ZERO 30s preview clips. ZERO SoundHelix fake tunes.
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
  _u('aHR0cHM6Ly9zYWF2bi5kZXYvYXBpL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9zYWF2bi5tZS9zZWFyY2gvc29uZ3M='),
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktcHJpdmF0ZS1zaWdtYS52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktMi1oYXJzaC1wYXRlbC52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9qaW8tc2Fhdm4tYXBpLnZlcmNlbC5hcHAvc2VhcmNoL3Nvbmdz')
].filter(Boolean);

// 2. Backup: YouTube Music Audio Streams Mirrors (Full Songs via itag=140 AAC)
const YOUTUBE_SEARCH_MIRRORS = [
  'https://pipedapi.kavin.rocks/search',
  'https://api.piped.yt/search',
  'https://inv.nadeko.net/api/v1/search',
  'https://invidious.nerdvpn.de/api/v1/search'
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
    'Anru Studio Artist'
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
  } else if (raw.media_preview_url) {
    audioUrl = raw.media_preview_url
      .replace('preview.saavncdn.com', 'aac.saavncdn.com')
      .replace('_96_p.mp4', '_320.mp4')
      .replace('_96_p.m4a', '_320.m4a');
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

// Normalize Song Payload from YouTube Music (Full-Length Audio Stream)
function normalizeYoutubePayload(item) {
  if (!item) return null;
  const videoId = (item.url ? item.url.replace('/watch?v=', '') : item.videoId) || '';
  if (!videoId || videoId.length < 5) return null;

  const title = (item.title || 'YouTube Music Track').replace(/\s*\(Official.*?\)/gi, '').trim();
  const artist = item.uploaderName || item.author || 'YouTube Artist';
  const artwork = item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  
  // High-efficiency full audio stream
  const audioUrl = `https://pipedproxy.kavin.rocks/videoplayback?id=${videoId}&itag=140`;

  return {
    id: `yt-${videoId}`,
    title: title,
    artist: artist,
    album: 'YouTube Audio',
    duration: parseInt(item.duration || 210, 10),
    image: artwork,
    artwork: artwork,
    audioUrl: audioUrl,
    source: 'youtube-audio'
  };
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 7500 } = options;
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

// Resolve real full audio on the fly for any song
async function resolveFullSongAudio(title, artist) {
  if (!title) return null;
  const query = `${title} ${artist || ''}`.trim();

  // 1. Try JioSaavn Mirrors first
  for (const mirror of SAAVN_MIRRORS) {
    try {
      const res = await fetchWithTimeout(`${mirror}?query=${encodeURIComponent(query)}&limit=5`, {
        headers: { 'Accept': 'application/json' },
        timeout: 4500
      });
      if (res.ok) {
        const json = await res.json();
        let rawList = [];
        if (json.data && Array.isArray(json.data.results)) rawList = json.data.results;
        else if (json.data && Array.isArray(json.data)) rawList = json.data;
        else if (Array.isArray(json.results)) rawList = json.results;

        for (const raw of rawList) {
          const parsed = normalizeSaavnPayload(raw);
          if (parsed && parsed.audioUrl) return parsed.audioUrl;
        }
      }
    } catch (e) {}
  }

  // 2. Try Direct JioSaavn via CORS Proxy
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=5&p=1&_marker=0&ctx=android&q=' + encodeURIComponent(query))}`;
    const res = await fetchWithTimeout(proxyUrl, { timeout: 4500 });
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.results)) {
        for (const raw of json.results) {
          const parsed = normalizeSaavnPayload(raw);
          if (parsed && parsed.audioUrl) return parsed.audioUrl;
        }
      }
    }
  } catch (e) {}

  // 3. Backup: YouTube Music Audio Stream
  for (const mirror of YOUTUBE_SEARCH_MIRRORS) {
    try {
      const ytUrl = mirror.includes('invidious') || mirror.includes('inv.nadeko.net')
        ? `${mirror}?q=${encodeURIComponent(query)}&type=video`
        : `${mirror}?q=${encodeURIComponent(query)}&filter=music_songs`;

      const res = await fetchWithTimeout(ytUrl, {
        headers: { 'Accept': 'application/json' },
        timeout: 4500
      });
      if (res.ok) {
        const json = await res.json();
        const items = json?.items || json;
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
        timeout: 6500
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

  // B. Direct JioSaavn via CORS Proxy
  onlinePromises.push(
    fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=25&p=1&_marker=0&ctx=android&q=' + encodeURIComponent(query))}`, {
      timeout: 6500
    })
    .then(res => res.ok ? res.json() : null)
    .then(json => {
      if (json && Array.isArray(json.results)) {
        return json.results.map(normalizeSaavnPayload).filter(Boolean);
      }
      return [];
    })
    .catch(() => [])
  );

  // C. YouTube Music API Backup
  onlinePromises.push(
    fetchWithTimeout(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=music_songs`, {
      headers: { 'Accept': 'application/json' },
      timeout: 6000
    })
    .then(res => res.ok ? res.json() : null)
    .then(json => {
      const items = json?.items || json;
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
}
if (typeof globalThis !== 'undefined') { 
  globalThis.searchMusic = searchMusic; 
  globalThis.normalizeSaavnPayload = normalizeSaavnPayload; 
  globalThis.normalizeYoutubePayload = normalizeYoutubePayload;
  globalThis.resolveFullSongAudio = resolveFullSongAudio;
}
