/**
 * ANRU MUSIC STUDIO PRO v22.1 - CLIENT-SIDE AUDIO METADATA & COVER ART PARSER
 * Enhanced for Spotdown, Spotify, iTunes, FLAC & Local Downloads
 * Features:
 * 1. Safe UTF-16/UTF-8 decoding without unaligned Uint16Array RangeError crashes
 * 2. Magic-byte binary detection for embedded APIC JPEG/PNG/WebP/GIF artwork
 * 3. Permanent Base64 Data URL conversion (Zero broken/expired blob URLs on reload)
 * 4. Automatic ID3 tag size expansion (No truncated album covers)
 * 5. Spotdown / Web downloader filename tag sanitizer
 * 6. Quick duration extraction from audio file metadata
 */

class ID3Parser {
  /**
   * Main entry point to parse a File or Blob
   */
  static async parseFile(file) {
    const filenameMeta = this.parseFilename(file.name || 'Untitled Song');
    let realDuration = 0;

    // Fast duration probe
    try {
      realDuration = await this.getAudioDuration(file);
    } catch (e) {}

    try {
      // Read initial slice
      let initialSlice = Math.min(file.size, 262144); // 256KB
      let buffer = await file.slice(0, initialSlice).arrayBuffer();
      let view = new DataView(buffer);

      // 1. Check for MP3 ID3v2 tag ('ID3')
      if (buffer.byteLength >= 10 &&
          view.getUint8(0) === 0x49 && // 'I'
          view.getUint8(1) === 0x44 && // 'D'
          view.getUint8(2) === 0x33) { // '3'
        const tagSize = this.readSynchsafeInt(view, 6);
        const fullTagSize = tagSize + 10;
        
        // Expand buffer if embedded cover art causes tag to exceed 256KB
        if (fullTagSize > initialSlice && fullTagSize <= file.size + 10) {
          const readSize = Math.min(file.size, fullTagSize + 1024);
          buffer = await file.slice(0, readSize).arrayBuffer();
          view = new DataView(buffer);
        }

        const id3Meta = this.parseID3v2(view, buffer, buffer.byteLength);
        if (id3Meta) {
          const finalTitle = id3Meta.title || filenameMeta.title;
          const finalArtist = (id3Meta.artist && id3Meta.artist.toLowerCase() !== 'local artist') ? id3Meta.artist : filenameMeta.artist;
          const finalAlbum = id3Meta.album || filenameMeta.album;
          const finalArtwork = id3Meta.artwork || this.generateProceduralCover(finalTitle, finalArtist);

          return {
            title: finalTitle,
            artist: finalArtist,
            album: finalAlbum,
            artwork: finalArtwork,
            duration: realDuration || 0
          };
        }
      }

      // 2. Check for MP4 / M4A / AAC (starts with 'ftyp' at offset 4)
      if (buffer.byteLength >= 12 &&
          view.getUint8(4) === 0x66 && // 'f'
          view.getUint8(5) === 0x74 && // 't'
          view.getUint8(6) === 0x79 && // 'y'
          view.getUint8(7) === 0x70) { // 'p'
        const m4aMeta = this.parseM4A(view, buffer, buffer.byteLength);
        if (m4aMeta) {
          const finalTitle = m4aMeta.title || filenameMeta.title;
          const finalArtist = m4aMeta.artist || filenameMeta.artist;
          const finalAlbum = m4aMeta.album || filenameMeta.album;
          const finalArtwork = m4aMeta.artwork || this.generateProceduralCover(finalTitle, finalArtist);

          return {
            title: finalTitle,
            artist: finalArtist,
            album: finalAlbum,
            artwork: finalArtwork,
            duration: realDuration || 0
          };
        }
      }

      // 3. Check for FLAC (starts with 'fLaC')
      if (buffer.byteLength >= 4 &&
          view.getUint8(0) === 0x66 && // 'f'
          view.getUint8(1) === 0x4c && // 'L'
          view.getUint8(2) === 0x61 && // 'a'
          view.getUint8(3) === 0x43) { // 'C'
        const flacMeta = this.parseFLAC(view, buffer, buffer.byteLength);
        if (flacMeta) {
          const finalTitle = flacMeta.title || filenameMeta.title;
          const finalArtist = flacMeta.artist || filenameMeta.artist;
          const finalAlbum = flacMeta.album || filenameMeta.album;
          const finalArtwork = flacMeta.artwork || this.generateProceduralCover(finalTitle, finalArtist);

          return {
            title: finalTitle,
            artist: finalArtist,
            album: finalAlbum,
            artwork: finalArtwork,
            duration: realDuration || 0
          };
        }
      }

      // Fallback with procedural art
      return {
        title: filenameMeta.title,
        artist: filenameMeta.artist,
        album: filenameMeta.album,
        artwork: this.generateProceduralCover(filenameMeta.title, filenameMeta.artist),
        duration: realDuration || 0
      };
    } catch (e) {
      console.warn('[ID3Parser] Notice parsing', file.name, e);
      return {
        title: filenameMeta.title,
        artist: filenameMeta.artist,
        album: filenameMeta.album,
        artwork: this.generateProceduralCover(filenameMeta.title, filenameMeta.artist),
        duration: realDuration || 0
      };
    }
  }

  /**
   * Fast audio duration helper
   */
  static getAudioDuration(file) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const a = new Audio();
        a.preload = 'metadata';
        let done = false;

        const cleanup = () => {
          if (!done) {
            done = true;
            URL.revokeObjectURL(url);
          }
        };

        const timer = setTimeout(() => {
          cleanup();
          resolve(0);
        }, 800);

        a.onloadedmetadata = () => {
          clearTimeout(timer);
          const dur = Math.round(a.duration || 0);
          cleanup();
          resolve(dur);
        };

        a.onerror = () => {
          clearTimeout(timer);
          cleanup();
          resolve(0);
        };

        a.src = url;
      } catch (err) {
        resolve(0);
      }
    });
  }

  /**
   * Parse ID3v2.2, ID3v2.3, ID3v2.4
   */
  static parseID3v2(view, buffer, sliceSize) {
    const version = view.getUint8(3); // 2, 3, or 4
    const flags = view.getUint8(5);
    const tagSize = this.readSynchsafeInt(view, 6);
    let offset = 10;
    const maxOffset = Math.min(tagSize + 10, sliceSize);

    // Skip Extended Header if present (flag bit 6 = 0x40)
    if (flags & 0x40) {
      if (version === 3 && offset + 4 <= maxOffset) {
        const extSize = view.getUint32(offset);
        offset += 4 + extSize;
      } else if (version === 4 && offset + 4 <= maxOffset) {
        const extSize = this.readSynchsafeInt(view, offset);
        offset += extSize;
      }
    }

    let title = '';
    let artist = '';
    let album = '';
    let artwork = null;

    if (version === 2) {
      // ID3v2.2: 3-char frame IDs, 3-byte size
      while (offset + 6 < maxOffset) {
        let frameId = '';
        for (let i = 0; i < 3; i++) {
          const c = view.getUint8(offset + i);
          if (c < 32 || c > 126) break;
          frameId += String.fromCharCode(c);
        }
        if (frameId.length < 3) break;

        const frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
        if (frameSize <= 0 || offset + 6 + frameSize > maxOffset) break;

        const dataOffset = offset + 6;
        if (frameId === 'TT2') title = title || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TP1' || frameId === 'TP2') artist = artist || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TAL') album = album || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'PIC' && !artwork) {
          artwork = this.decodeID3v22Picture(view, dataOffset, frameSize);
        }

        offset += 6 + frameSize;
      }
    } else {
      // ID3v2.3 & ID3v2.4: 4-char frame IDs, 4-byte size, 2-byte flags
      while (offset + 10 < maxOffset) {
        let frameId = '';
        for (let i = 0; i < 4; i++) {
          const c = view.getUint8(offset + i);
          if (c < 32 || c > 126) break;
          frameId += String.fromCharCode(c);
        }
        if (frameId.length < 4) break;

        const frameSize = (version === 4)
          ? this.readSynchsafeInt(view, offset + 4)
          : view.getUint32(offset + 4);

        if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

        const dataOffset = offset + 10;
        if (frameId === 'TIT2') title = title || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TPE1' || frameId === 'TPE2') artist = artist || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TALB') album = album || this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'APIC' && !artwork) {
          artwork = this.decodeAPICFrame(view, dataOffset, frameSize);
        }

        offset += 10 + frameSize;
      }
    }

    return {
      title: title.trim(),
      artist: artist.trim(),
      album: album.trim(),
      artwork: artwork
    };
  }

  /**
   * Decode APIC Frame (ID3v2.3 / ID3v2.4)
   * Converts directly to Base64 Data URL so it stays permanent across reloads!
   */
  static decodeAPICFrame(view, offset, size) {
    try {
      if (size <= 10) return null;
      const encoding = view.getUint8(offset);
      let curr = offset + 1;
      const end = offset + size;

      // Read MIME type (ISO-8859-1 null-terminated)
      let mimeType = '';
      while (curr < end && view.getUint8(curr) !== 0) {
        mimeType += String.fromCharCode(view.getUint8(curr));
        curr++;
      }
      curr++; // skip null byte

      if (!mimeType || mimeType === '-->') mimeType = 'image/jpeg';
      else if (mimeType.toLowerCase() === 'image/jpg') mimeType = 'image/jpeg';

      if (curr >= end) return null;

      // Picture type (1 byte: e.g. 3 = Front Cover)
      const picType = view.getUint8(curr);
      curr++;

      // Scan for image magic bytes within the next 256 bytes (safe against descriptions)
      let imgStart = -1;
      for (let i = curr; i < Math.min(curr + 256, end - 4); i++) {
        const b0 = view.getUint8(i);
        const b1 = view.getUint8(i + 1);
        if (b0 === 0xff && b1 === 0xd8) { // JPEG
          imgStart = i;
          mimeType = 'image/jpeg';
          break;
        }
        if (b0 === 0x89 && b1 === 0x50 && view.getUint8(i + 2) === 0x4e && view.getUint8(i + 3) === 0x47) { // PNG
          imgStart = i;
          mimeType = 'image/png';
          break;
        }
        if (b0 === 0x52 && b1 === 0x49 && view.getUint8(i + 2) === 0x46 && view.getUint8(i + 3) === 0x46) { // WebP
          imgStart = i;
          mimeType = 'image/webp';
          break;
        }
        if (b0 === 0x47 && b1 === 0x49 && view.getUint8(i + 2) === 0x46) { // GIF
          imgStart = i;
          mimeType = 'image/gif';
          break;
        }
      }

      if (imgStart === -1) {
        // Fallback: Skip description via null terminator
        if (encoding === 0 || encoding === 3) {
          while (curr < end && view.getUint8(curr) !== 0) curr++;
          curr++;
        } else {
          while (curr + 1 < end && !(view.getUint8(curr) === 0 && view.getUint8(curr + 1) === 0)) curr++;
          curr += 2;
        }
        imgStart = curr;
      }

      if (imgStart >= end - 16) return null;
      const imgBytesLength = end - imgStart;
      const imgData = new Uint8Array(view.buffer, view.byteOffset + imgStart, imgBytesLength);

      return this.uint8ArrayToDataURL(imgData, mimeType);
    } catch (e) {
      console.warn('[ID3Parser] APIC parse notice:', e);
      return null;
    }
  }

  /**
   * Decode PIC Frame (ID3v2.2)
   */
  static decodeID3v22Picture(view, offset, size) {
    try {
      if (size <= 5) return null;
      const encoding = view.getUint8(offset);
      let format = '';
      for (let i = 0; i < 3; i++) {
        format += String.fromCharCode(view.getUint8(offset + 1 + i));
      }
      let mimeType = 'image/jpeg';
      if (format.toUpperCase() === 'PNG') mimeType = 'image/png';

      let curr = offset + 5;
      const end = offset + size;

      // Scan for magic bytes
      let imgStart = -1;
      for (let i = curr; i < Math.min(curr + 128, end - 4); i++) {
        const b0 = view.getUint8(i);
        const b1 = view.getUint8(i + 1);
        if (b0 === 0xff && b1 === 0xd8) {
          imgStart = i;
          mimeType = 'image/jpeg';
          break;
        }
        if (b0 === 0x89 && b1 === 0x50) {
          imgStart = i;
          mimeType = 'image/png';
          break;
        }
      }

      if (imgStart === -1) {
        if (encoding === 0) {
          while (curr < end && view.getUint8(curr) !== 0) curr++;
          curr++;
        } else {
          while (curr + 1 < end && !(view.getUint8(curr) === 0 && view.getUint8(curr + 1) === 0)) curr++;
          curr += 2;
        }
        imgStart = curr;
      }

      if (imgStart >= end - 16) return null;
      const imgLength = end - imgStart;
      const imgData = new Uint8Array(view.buffer, view.byteOffset + imgStart, imgLength);

      return this.uint8ArrayToDataURL(imgData, mimeType);
    } catch (e) {
      return null;
    }
  }

  /**
   * Parse MP4 / M4A metadata atoms
   */
  static parseM4A(view, buffer, sliceSize) {
    try {
      let offset = 0;
      let ilstOffset = -1;

      while (offset + 8 < sliceSize) {
        const size = view.getUint32(offset);
        const name = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));

        if (name === 'moov' || name === 'udta' || name === 'meta') {
          offset += (name === 'meta' ? 12 : 8);
          continue;
        }
        if (name === 'ilst') {
          ilstOffset = offset;
          break;
        }
        if (size <= 0) break;
        offset += size;
      }

      if (ilstOffset === -1) return null;

      let subOffset = ilstOffset + 8;
      const ilstSize = view.getUint32(ilstOffset);
      const endIlst = Math.min(ilstOffset + ilstSize, sliceSize);

      let title = '';
      let artist = '';
      let album = '';
      let artwork = null;

      while (subOffset + 8 < endIlst) {
        const itemSize = view.getUint32(subOffset);
        const itemName = String.fromCharCode(view.getUint8(subOffset + 4), view.getUint8(subOffset + 5), view.getUint8(subOffset + 6), view.getUint8(subOffset + 7));

        if (itemName === '©nam') title = this.extractM4AText(view, subOffset, itemSize);
        else if (itemName === '©ART') artist = this.extractM4AText(view, subOffset, itemSize);
        else if (itemName === '©alb') album = this.extractM4AText(view, subOffset, itemSize);
        else if (itemName === 'covr' && !artwork) {
          artwork = this.extractM4ACovr(view, subOffset, itemSize);
        }

        if (itemSize <= 0) break;
        subOffset += itemSize;
      }

      return { title, artist, album, artwork };
    } catch (e) {
      return null;
    }
  }

  static extractM4AText(view, offset, size) {
    try {
      let sub = offset + 8;
      const end = offset + size;
      while (sub + 8 < end) {
        const subSize = view.getUint32(sub);
        const subName = String.fromCharCode(view.getUint8(sub + 4), view.getUint8(sub + 5), view.getUint8(sub + 6), view.getUint8(sub + 7));
        if (subName === 'data') {
          const textBytes = new Uint8Array(view.buffer, view.byteOffset + sub + 16, subSize - 16);
          return new TextDecoder('utf-8').decode(textBytes).trim();
        }
        if (subSize <= 0) break;
        sub += subSize;
      }
    } catch (e) {}
    return '';
  }

  static extractM4ACovr(view, offset, size) {
    try {
      let sub = offset + 8;
      const end = offset + size;
      while (sub + 8 < end) {
        const subSize = view.getUint32(sub);
        const subName = String.fromCharCode(view.getUint8(sub + 4), view.getUint8(sub + 5), view.getUint8(sub + 6), view.getUint8(sub + 7));
        if (subName === 'data') {
          const typeIndicator = view.getUint32(sub + 8) & 0xff;
          const mimeType = (typeIndicator === 14) ? 'image/png' : 'image/jpeg';
          const imgBytes = new Uint8Array(view.buffer, view.byteOffset + sub + 16, subSize - 16);
          return this.uint8ArrayToDataURL(imgBytes, mimeType);
        }
        if (subSize <= 0) break;
        sub += subSize;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Parse FLAC Picture Blocks
   */
  static parseFLAC(view, buffer, sliceSize) {
    try {
      let offset = 4;
      while (offset + 4 < sliceSize) {
        const header = view.getUint8(offset);
        const isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7f;
        const blockSize = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);

        if (blockType === 6) { // METADATA_BLOCK_PICTURE
          let curr = offset + 4;
          const picType = view.getUint32(curr);
          curr += 4;
          const mimeLen = view.getUint32(curr);
          curr += 4;
          let mime = '';
          for (let i = 0; i < mimeLen; i++) mime += String.fromCharCode(view.getUint8(curr + i));
          curr += mimeLen;
          const descLen = view.getUint32(curr);
          curr += 4 + descLen;
          curr += 16; // width, height, color depth, colors
          const dataLen = view.getUint32(curr);
          curr += 4;
          if (dataLen > 0 && curr + dataLen <= sliceSize) {
            const imgBytes = new Uint8Array(view.buffer, view.byteOffset + curr, dataLen);
            return { artwork: this.uint8ArrayToDataURL(imgBytes, mime || 'image/jpeg') };
          }
        }

        offset += 4 + blockSize;
        if (isLast) break;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Helper: Read synchsafe integer
   */
  static readSynchsafeInt(view, offset) {
    return (
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    );
  }

  /**
   * Helper: Decode Text Frame with TextDecoder (handles any byte offset safely)
   */
  static decodeTextFrame(view, offset, size) {
    if (size <= 1) return '';
    const encoding = view.getUint8(offset);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, size - 1);

    try {
      if (encoding === 0) { // ISO-8859-1 / Windows-1252
        return new TextDecoder('windows-1252').decode(bytes).replace(/\0.*$/, '').trim();
      } else if (encoding === 1) { // UTF-16 with BOM
        return new TextDecoder('utf-16').decode(bytes).replace(/\0.*$/, '').trim();
      } else if (encoding === 2) { // UTF-16BE without BOM
        return new TextDecoder('utf-16be').decode(bytes).replace(/\0.*$/, '').trim();
      } else if (encoding === 3) { // UTF-8
        return new TextDecoder('utf-8').decode(bytes).replace(/\0.*$/, '').trim();
      }
    } catch (e) {
      console.warn('[ID3Parser] decodeTextFrame fallback:', e);
    }

    // ASCII fallback
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) break;
      if (bytes[i] >= 32 && bytes[i] <= 126) str += String.fromCharCode(bytes[i]);
    }
    return str.trim();
  }

  /**
   * Converts Uint8Array to persistent Base64 Data URL
   */
  static uint8ArrayToDataURL(bytes, mimeType = 'image/jpeg') {
    try {
      let binary = '';
      const len = bytes.byteLength;
      const chunkSize = 16384;
      for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk);
      }
      return `data:${mimeType};base64,${btoa(binary)}`;
    } catch (e) {
      // Memory fallback
      const blob = new Blob([bytes], { type: mimeType });
      return URL.createObjectURL(blob);
    }
  }

  /**
   * Clean filenames into realistic Title and Artist
   */
  static parseFilename(filename) {
    let clean = filename.replace(/\.[^/.]+$/, '').trim();
    // Remove typical spotdown & download markers
    clean = clean.replace(/_?spotdown(\.org)?/ig, '');
    clean = clean.replace(/\(spotdown(\.org)?\)/ig, '');
    clean = clean.replace(/^[#_]+/, '');
    clean = clean.replace(/\((128k|320k|Pagalworld|mp3|m4a|song|audio)\)/ig, '');
    clean = clean.replace(/\[[^\]]*\]/g, '');
    clean = clean.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

    if (clean.includes(' - ')) {
      const parts = clean.split(' - ');
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(' - ').trim(),
        album: 'Offline Music'
      };
    }

    return {
      title: clean || 'Untitled Song',
      artist: 'Local Artist',
      album: 'Offline Music'
    };
  }

  /**
   * Generates a sleek procedural album art canvas Data URL
   */
  static generateProceduralCover(title = '', artist = '') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      const ctx = canvas.getContext('2d');

      const str = (title + ' ' + artist).toLowerCase();
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }

      const palettes = [
        ['#8b5cf6', '#ec4899', '#3b82f6'],
        ['#00f2fe', '#4facfe', '#000851'],
        ['#f43f5e', '#fb923c', '#701a75'],
        ['#10b981', '#06b6d4', '#064e3b'],
        ['#f59e0b', '#ef4444', '#7c2d12'],
        ['#6366f1', '#a855f7', '#ec4899']
      ];

      const pal = palettes[Math.abs(hash) % palettes.length];

      const grad = ctx.createLinearGradient(0, 0, 320, 320);
      grad.addColorStop(0, pal[0]);
      grad.addColorStop(0.5, pal[1]);
      grad.addColorStop(1, pal[2]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 320, 320);

      // Radial acoustic rings
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      for (let r = 40; r <= 140; r += 25) {
        ctx.beginPath();
        ctx.arc(160, 160, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Bold initial letter
      const letter = (title || 'A').trim().charAt(0).toUpperCase();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 12;
      ctx.font = '900 110px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 160, 160);

      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      return 'icon-512.png';
    }
  }
}

if (typeof window !== 'undefined') {
  window.ID3Parser = ID3Parser;
}
