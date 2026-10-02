/**
 * ANRU MUSIC - ULTIMATE BULLETPROOF AUDIO & SEARCH ENGINE (api.js)
 * Features:
 * 1. Native Client-Side DES-ECB Decryptor for JioSaavn encrypted_media_url (Key: 38346591)
 * 2. Multi-Mirror & Multi-CORS Proxy Parallel Race (saavn.sumit.co, saavn.dev, allorigins, corsproxy.io, codetabs)
 * 3. 320kbps High-Fidelity Audio Streams directly from aac.saavncdn.com
 * 4. Invidious YouTube Music Audio Streams Backup (itag=140)
 * 5. 100% Reliable Offline Fallback & Query Sanitizer
 */

// ==========================================
// 1. PURE JS DES-ECB DECRYPTOR FOR JIOSAAVN
// ==========================================
const _DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2,
  60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6,
  64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1,
  59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5,
  63, 55, 47, 39, 31, 23, 15, 7
];
const _DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32,
  39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30,
  37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26,
  33, 1, 41, 9, 49, 17, 57, 25
];
const _DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9,
  1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27,
  19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15,
  7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29,
  21, 13, 5, 28, 20, 12, 4
];
const _DES_PC2 = [
  14, 17, 11, 24, 1, 5,
  3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8,
  16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55,
  30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53,
  46, 42, 50, 36, 29, 32
];
const _DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const _DES_E = [
  32, 1, 2, 3, 4, 5,
  4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13,
  12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21,
  20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29,
  28, 29, 30, 31, 32, 1
];
const _DES_SBOXES = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11
  ]
];
const _DES_P = [
  16, 7, 20, 21,
  29, 12, 28, 17,
  1, 15, 23, 26,
  5, 18, 31, 10,
  2, 8, 24, 14,
  32, 27, 3, 9,
  19, 13, 30, 6,
  22, 11, 4, 25
];

function decryptJioSaavnToken(b64Cipher, keyStr = '38346591') {
  if (!b64Cipher) return null;
  try {
    const rawBytes = typeof Buffer !== 'undefined'
      ? Array.from(Buffer.from(b64Cipher, 'base64'))
      : Array.from(atob(b64Cipher), c => c.charCodeAt(0));

    if (rawBytes.length === 0 || rawBytes.length % 8 !== 0) return null;

    const keyBits = [];
    for (let i = 0; i < 8; i++) {
      const b = (i < keyStr.length) ? keyStr.charCodeAt(i) : 0;
      for (let j = 7; j >= 0; j--) keyBits.push((b >> j) & 1);
    }

    const pc1Bits = _DES_PC1.map(p => keyBits[p - 1]);
    let C = pc1Bits.slice(0, 28);
    let D = pc1Bits.slice(28, 56);
    const subKeys = [];

    for (let r = 0; r < 16; r++) {
      const shift = _DES_SHIFTS[r];
      C = C.slice(shift).concat(C.slice(0, shift));
      D = D.slice(shift).concat(D.slice(0, shift));
      const cd = C.concat(D);
      subKeys.push(_DES_PC2.map(p => cd[p - 1]));
    }

    const decKeys = subKeys.slice().reverse();
    let outBytes = [];

    for (let offset = 0; offset < rawBytes.length; offset += 8) {
      const blockBits = [];
      for (let i = 0; i < 8; i++) {
        const b = rawBytes[offset + i];
        for (let j = 7; j >= 0; j--) blockBits.push((b >> j) & 1);
      }

      const ipBits = _DES_IP.map(p => blockBits[p - 1]);
      let L = ipBits.slice(0, 32);
      let R = ipBits.slice(32, 64);

      for (let r = 0; r < 16; r++) {
        const prevL = L.slice();
        L = R.slice();

        const eBits = _DES_E.map(p => R[p - 1]);
        const kBits = decKeys[r];
        const xorBits = eBits.map((b, idx) => b ^ kBits[idx]);

        let sOutput = [];
        for (let s = 0; s < 8; s++) {
          const chunk = xorBits.slice(s * 6, s * 6 + 6);
          const row = (chunk[0] << 1) | chunk[5];
          const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
          const val = _DES_SBOXES[s][row * 16 + col];
          for (let b = 3; b >= 0; b--) sOutput.push((val >> b) & 1);
        }

        const fBits = _DES_P.map(p => sOutput[p - 1]);
        R = prevL.map((b, idx) => b ^ fBits[idx]);
      }

      const preOutput = R.concat(L);
      const fpBits = _DES_FP.map(p => preOutput[p - 1]);

      for (let i = 0; i < 8; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) {
          b = (b << 1) | fpBits[i * 8 + j];
        }
        outBytes.push(b);
      }
    }

    const padLen = outBytes[outBytes.length - 1];
    if (padLen >= 1 && padLen <= 8) {
      outBytes = outBytes.slice(0, outBytes.length - padLen);
    }

    const rawUrl = String.fromCharCode.apply(null, outBytes);
    if (!rawUrl.startsWith('http')) return null;

    // Convert to 320kbps / 160kbps high definition stream
    return rawUrl.replace(/_96\.(mp4|m4a)/i, '_320.$1').replace(/_48\.(mp4|m4a)/i, '_320.$1');
  } catch (err) {
    return null;
  }
}

// Base64 runtime decoder
const _u = (b64) => {
  try {
    return atob(b64);
  } catch (e) {
    return '';
  }
};

// JioSaavn Mirror Servers
const SAAVN_MIRRORS = [
  'https://saavn.sumit.co/api/search/songs',
  _u('aHR0cHM6Ly9zYWF2bi5kZXYvYXBpL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktcHJpdmF0ZS1zaWdtYS52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9qaW9zYWF2bi1hcGktMi1oYXJzaC1wYXRlbC52ZXJjZWwuYXBwL3NlYXJjaC9zb25ncw=='),
  _u('aHR0cHM6Ly9zYWF2bi1hcGkudmVyY2VsLmFwcC9zZWFyY2gvc29uZ3M='),
  _u('aHR0cHM6Ly9zYWF2bi5tZS9zZWFyY2gvc29uZ3M=')
].filter(Boolean);

// YouTube Audio Stream Mirrors
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

// Normalize Song Payload from JioSaavn with Decryption
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
  let audioUrl = '';

  // 1. downloadUrl array (from saavn.sumit.co / saavn.dev)
  if (Array.isArray(raw.downloadUrl) && raw.downloadUrl.length) {
    const best320 = raw.downloadUrl.find(u => u.quality === '320kbps') ||
                    raw.downloadUrl.find(u => u.quality === '160kbps') ||
                    raw.downloadUrl.find(u => u.quality === '96kbps') ||
                    raw.downloadUrl[raw.downloadUrl.length - 1];
    if (best320 && (best320.url || best320.link)) audioUrl = best320.url || best320.link;
  }

  // 2. Client-side DES Decryption of encrypted_media_url (from official JioSaavn API)
  if (!audioUrl) {
    const encToken = raw.more_info?.encrypted_media_url || raw.encrypted_media_url;
    if (encToken) {
      audioUrl = decryptJioSaavnToken(encToken);
    }
  }

  // 3. more_info.vlink
  if (!audioUrl && raw.more_info?.vlink) {
    audioUrl = raw.more_info.vlink;
  }

  // 4. media_url
  if (!audioUrl && raw.media_url) {
    audioUrl = raw.media_url;
  }

  // 5. media_preview_url fallback
  if (!audioUrl && (raw.more_info?.media_preview_url || raw.media_preview_url)) {
    audioUrl = raw.more_info?.media_preview_url || raw.media_preview_url;
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

// Parallel Race across Mirrors and CORS Proxies
async function fetchJioSaavnSongs(query, limit = 10) {
  if (!query) return [];
  const cleanQ = query.trim();

  const endpoints = [];

  // 1. Direct Saavn API Mirrors (without custom headers to prevent CORS preflight block)
  for (const mirror of SAAVN_MIRRORS) {
    endpoints.push(
      fetchWithTimeout(`${mirror}?query=${encodeURIComponent(cleanQ)}&limit=${limit}`, { timeout: 4000 })
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

  // 2. Official JioSaavn API via Multiple CORS Proxies (Using web6dot0 & api_version 4)
  const officialUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&ctx=web6dot0&api_version=4&q=${encodeURIComponent(cleanQ)}&n=${limit}&p=1`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(officialUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(officialUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(officialUrl)}`
  ];

  for (const proxy of proxies) {
    endpoints.push(
      fetchWithTimeout(proxy, { timeout: 4500 })
      .then(res => res.ok ? res.text() : null)
      .then(text => {
        if (!text) return null;
        try {
          const json = JSON.parse(text);
          if (!json || !Array.isArray(json.results)) return null;
          const parsed = json.results.map(normalizeSaavnPayload).filter(s => s && s.audioUrl);
          return parsed.length > 0 ? parsed : null;
        } catch (e) {
          return null;
        }
      })
      .catch(() => null)
    );
  }

  // Race endpoints and return first valid results
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

// Resolve real full song audio on the fly (with title cleaning and secondary fallback)
async function resolveFullSongAudio(title, artist) {
  if (!title) return null;

  const cleanTitle = title.replace(/\s*\(.*?\)/gi, '').replace(/[^a-zA-Z0-9\s]/gi, ' ').trim();
  const mainArtist = (artist || '').split(/[,&/]/)[0].replace(/[^a-zA-Z0-9\s]/gi, ' ').trim();

  const queries = [
    `${cleanTitle} ${mainArtist}`.trim(),
    cleanTitle
  ];

  for (const q of queries) {
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
        const res = await fetchWithTimeout(ytUrl, { timeout: 4000 });
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

// Unified Search Engine: JioSaavn Primary + YouTube Backup + Local Catalog
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

  // 1. Local Catalog Matches
  let localMatches = [];
  if (typeof CURATED_FULL_CATALOG !== 'undefined') {
    localMatches = CURATED_FULL_CATALOG.filter(s => {
      const fullText = `${s.title} ${s.artist} ${s.album} ${s.category} ${(s.tags || []).join(' ')} ${(s.moodTags || []).join(' ')}`.toLowerCase();
      return allSearchKeywords.some(word => fullText.includes(word));
    });
  }

  // 2. Online JioSaavn Parallel Search
  let onlineResults = [];
  try {
    onlineResults = await fetchJioSaavnSongs(query, 25);
  } catch (e) {}

  // 3. Deduplicate and merge results (Online results first, then local)
  const combined = [...onlineResults];
  const seenIds = new Set(onlineResults.map(s => s.id));
  const seenTitles = new Set(onlineResults.map(s => s.title.toLowerCase().trim()));

  for (const song of localMatches) {
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
  window.decryptJioSaavnToken = decryptJioSaavnToken;
}
if (typeof globalThis !== 'undefined') { 
  globalThis.searchMusic = searchMusic; 
  globalThis.normalizeSaavnPayload = normalizeSaavnPayload; 
  globalThis.normalizeYoutubePayload = normalizeYoutubePayload;
  globalThis.resolveFullSongAudio = resolveFullSongAudio;
  globalThis.fetchJioSaavnSongs = fetchJioSaavnSongs;
  globalThis.decryptJioSaavnToken = decryptJioSaavnToken;
}
