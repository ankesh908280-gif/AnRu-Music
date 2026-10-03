/**
 * ANRU MUSIC STUDIO PRO v16 - PURE CLIENT-SIDE AUDIO METADATA & COVER ART PARSER
 * Supports:
 * 1. ID3v2.2, ID3v2.3, ID3v2.4 (TIT2, TPE1, TALB, APIC, PIC)
 * 2. MP4 / M4A metadata atoms (©nam, ©ART, ©alb, covr)
 * 3. FLAC Metadata Picture blocks (Type 6)
 * 4. High-resolution embedded artwork extraction up to 2MB
 * 5. Procedural Gradient Artwork Fallback for tracks without embedded art
 */

class ID3Parser {
  /**
   * Main entry point to parse a File or Blob
   */
  static async parseFile(file) {
    const filenameMeta = this.parseFilename(file.name || 'Untitled Song');
    try {
      // Read first 2MB to capture high-res embedded album covers
      const sliceSize = Math.min(file.size, 2097152);
      const buffer = await file.slice(0, sliceSize).arrayBuffer();
      const view = new DataView(buffer);

      // 1. Check for MP3 ID3v2 tag
      if (buffer.byteLength >= 10 &&
          view.getUint8(0) === 0x49 && // 'I'
          view.getUint8(1) === 0x44 && // 'D'
          view.getUint8(2) === 0x33) { // '3'
        const id3Meta = this.parseID3v2(view, buffer, sliceSize);
        if (id3Meta) {
          return {
            title: id3Meta.title || filenameMeta.title,
            artist: id3Meta.artist || filenameMeta.artist,
            album: id3Meta.album || filenameMeta.album,
            artwork: id3Meta.artwork || this.generateProceduralCover(id3Meta.title || filenameMeta.title, id3Meta.artist || filenameMeta.artist),
            duration: 0
          };
        }
      }

      // 2. Check for MP4 / M4A / AAC (starts with 'ftyp' at offset 4)
      if (buffer.byteLength >= 12 &&
          view.getUint8(4) === 0x66 && // 'f'
          view.getUint8(5) === 0x74 && // 't'
          view.getUint8(6) === 0x79 && // 'y'
          view.getUint8(7) === 0x70) { // 'p'
        const m4aMeta = this.parseM4A(view, buffer, sliceSize);
        if (m4aMeta) {
          return {
            title: m4aMeta.title || filenameMeta.title,
            artist: m4aMeta.artist || filenameMeta.artist,
            album: m4aMeta.album || filenameMeta.album,
            artwork: m4aMeta.artwork || this.generateProceduralCover(m4aMeta.title || filenameMeta.title, m4aMeta.artist || filenameMeta.artist),
            duration: 0
          };
        }
      }

      // 3. Check for FLAC (starts with 'fLaC')
      if (buffer.byteLength >= 4 &&
          view.getUint8(0) === 0x66 && // 'f'
          view.getUint8(1) === 0x4c && // 'L'
          view.getUint8(2) === 0x61 && // 'a'
          view.getUint8(3) === 0x43) { // 'C'
        const flacMeta = this.parseFLAC(view, buffer, sliceSize);
        if (flacMeta) {
          return {
            title: flacMeta.title || filenameMeta.title,
            artist: flacMeta.artist || filenameMeta.artist,
            album: flacMeta.album || filenameMeta.album,
            artwork: flacMeta.artwork || this.generateProceduralCover(flacMeta.title || filenameMeta.title, flacMeta.artist || filenameMeta.artist),
            duration: 0
          };
        }
      }

      // Fallback with procedural art
      return {
        title: filenameMeta.title,
        artist: filenameMeta.artist,
        album: filenameMeta.album,
        artwork: this.generateProceduralCover(filenameMeta.title, filenameMeta.artist),
        duration: 0
      };
    } catch (e) {
      console.warn('[ID3Parser] Notice parsing', file.name, e);
      return {
        title: filenameMeta.title,
        artist: filenameMeta.artist,
        album: filenameMeta.album,
        artwork: this.generateProceduralCover(filenameMeta.title, filenameMeta.artist),
        duration: 0
      };
    }
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

    let title = '';
    let artist = '';
    let album = '';
    let artwork = null;

    // ID3v2.2 uses 3-char frame IDs and 3-byte size
    if (version === 2) {
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
        if (frameId === 'TT2') title = this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TP1') artist = this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TAL') album = this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'PIC' && !artwork) {
          artwork = this.decodeID3v22Picture(view, dataOffset, frameSize);
        }

        offset += 6 + frameSize;
      }
    } else {
      // ID3v2.3 and ID3v2.4 use 4-char frame IDs and 4-byte size
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
        if (frameId === 'TIT2') title = this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TPE1') artist = this.decodeTextFrame(view, dataOffset, frameSize);
        else if (frameId === 'TALB') album = this.decodeTextFrame(view, dataOffset, frameSize);
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
   */
  static decodeAPICFrame(view, offset, size) {
    try {
      if (size <= 4) return null;
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

      // Skip description
      if (encoding === 0 || encoding === 3) {
        // 1-byte null terminator
        while (curr < end && view.getUint8(curr) !== 0) curr++;
        curr++;
      } else {
        // 2-byte null terminator for UTF-16
        while (curr + 1 < end && !(view.getUint8(curr) === 0 && view.getUint8(curr + 1) === 0)) {
          curr += 2;
        }
        curr += 2;
      }

      const imgBytesLength = end - curr;
      if (imgBytesLength <= 16) return null;

      // Check image magic bytes for JPEG / PNG
      const b0 = view.getUint8(curr);
      const b1 = view.getUint8(curr + 1);
      if (b0 === 0xff && b1 === 0xd8) mimeType = 'image/jpeg';
      else if (b0 === 0x89 && b1 === 0x50) mimeType = 'image/png';
      else if (b0 === 0x47 && b1 === 0x49) mimeType = 'image/gif';
      else if (b0 === 0x52 && b1 === 0x49) mimeType = 'image/webp';

      const imgData = new Uint8Array(view.buffer, curr, imgBytesLength);
      const blob = new Blob([imgData], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (e) {
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

      let curr = offset + 5; // skip encoding, 3-byte format, 1-byte pic type
      const end = offset + size;

      // Skip description
      if (encoding === 0) {
        while (curr < end && view.getUint8(curr) !== 0) curr++;
        curr++;
      } else {
        while (curr + 1 < end && !(view.getUint8(curr) === 0 && view.getUint8(curr + 1) === 0)) curr += 2;
        curr += 2;
      }

      const imgLength = end - curr;
      if (imgLength <= 16) return null;

      const imgData = new Uint8Array(view.buffer, curr, imgLength);
      const blob = new Blob([imgData], { type: mimeType });
      return URL.createObjectURL(blob);
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
      let title = '';
      let artist = '';
      let album = '';
      let artwork = null;

      // Find 'moov' atom
      while (offset + 8 < sliceSize) {
        const atomSize = view.getUint32(offset);
        if (atomSize <= 0) break;
        const atomName = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );

        if (atomName === 'moov' || atomName === 'udta' || atomName === 'meta' || atomName === 'ilst') {
          // Drill into container
          offset += (atomName === 'meta') ? 12 : 8;
          continue;
        }

        // Inside ilst: check tags
        if (atomName === '©nam') {
          title = this.extractM4AText(view, offset, atomSize);
        } else if (atomName === '©ART') {
          artist = this.extractM4AText(view, offset, atomSize);
        } else if (atomName === '©alb') {
          album = this.extractM4AText(view, offset, atomSize);
        } else if (atomName === 'covr') {
          artwork = this.extractM4ACovr(view, offset, atomSize);
        }

        offset += atomSize;
      }

      if (title || artist || artwork) {
        return { title, artist, album, artwork };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  static extractM4AText(view, offset, size) {
    try {
      // Find 'data' subatom inside
      let sub = offset + 8;
      const end = offset + size;
      while (sub + 8 < end) {
        const subSize = view.getUint32(sub);
        const subName = String.fromCharCode(view.getUint8(sub + 4), view.getUint8(sub + 5), view.getUint8(sub + 6), view.getUint8(sub + 7));
        if (subName === 'data') {
          const textBytes = new Uint8Array(view.buffer, sub + 16, subSize - 16);
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
          const imgBytes = new Uint8Array(view.buffer, sub + 16, subSize - 16);
          const blob = new Blob([imgBytes], { type: mimeType });
          return URL.createObjectURL(blob);
        }
        if (subSize <= 0) break;
        sub += subSize;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Parse FLAC METADATA_BLOCK_PICTURE
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
            const imgBytes = new Uint8Array(view.buffer, curr, dataLen);
            const blob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
            return { artwork: URL.createObjectURL(blob) };
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
   * Helper: Decode Text Frame with encoding handling
   */
  static decodeTextFrame(view, offset, size) {
    if (size <= 1) return '';
    const encoding = view.getUint8(offset);
    const bytes = new Uint8Array(view.buffer, offset + 1, size - 1);

    if (encoding === 0) { // ISO-8859-1
      let str = '';
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) break;
        str += String.fromCharCode(bytes[i]);
      }
      return str;
    } else if (encoding === 1 || encoding === 2) { // UTF-16
      const utf16Bytes = new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
      let str = '';
      for (let i = 0; i < utf16Bytes.length; i++) {
        if (utf16Bytes[i] === 0) break;
        if (utf16Bytes[i] !== 0xfeff && utf16Bytes[i] !== 0xfffe) {
          str += String.fromCharCode(utf16Bytes[i]);
        }
      }
      return str;
    } else if (encoding === 3) { // UTF-8
      try {
        return new TextDecoder('utf-8').decode(bytes).replace(/\0.*$/, '');
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  /**
   * Clean filenames into realistic Title and Artist
   */
  static parseFilename(filename) {
    let clean = filename.replace(/\.[^/.]+$/, '').trim();
    // Remove typical download prefixes like #video_, (128k), [320kbps], etc.
    clean = clean.replace(/^[#_]+/, '');
    clean = clean.replace(/\((128k|320k|Pagalworld|mp3|m4a|song)\)/ig, '');
    clean = clean.replace(/\[[^\]]*\]/g, '');
    clean = clean.replace(/_/g, ' ').trim();

    if (clean.includes(' - ')) {
      const parts = clean.split(' - ');
      return {
        title: (parts[1] || parts[0]).trim(),
        artist: parts[0].trim() || 'Local Artist',
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
   * Generates a sleek, high-resolution procedural gradient artwork for songs without embedded art.
   * Gives each artist/song a distinct aesthetic personality instead of a generic fallback logo!
   */
  static generateProceduralCover(title = '', artist = '') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      const ctx = canvas.getContext('2d');

      // Generate consistent hash from title & artist
      const str = (title + ' ' + artist).toLowerCase();
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }

      // Color palettes (Studio Neon & Holographic Vibe)
      const palettes = [
        ['#8b5cf6', '#ec4899', '#3b82f6'], // Aurora
        ['#00f2fe', '#4facfe', '#000851'], // Cyber
        ['#f43f5e', '#fb923c', '#701a75'], // Sunset
        ['#10b981', '#06b6d4', '#064e3b'], // Emerald
        ['#f59e0b', '#ef4444', '#78350f'], // Fire
        ['#ec4899', '#8b5cf6', '#1e1b4b'], // Synthwave
        ['#06b6d4', '#3b82f6', '#1e1b4b']  // Deep Blue
      ];
      const palette = palettes[Math.abs(hash) % palettes.length];

      // Draw background gradient
      const grad = ctx.createLinearGradient(0, 0, 320, 320);
      grad.addColorStop(0, palette[0]);
      grad.addColorStop(0.5, palette[1]);
      grad.addColorStop(1, palette[2]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 320, 320);

      // Draw decorative geometric circles / studio vinyl rings
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(160, 160, 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(160, 160, 75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(160, 160, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Draw centered musical glyph or initial
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 12;
      ctx.font = 'bold 88px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const initial = (title.trim()[0] || '♪').toUpperCase();
      ctx.fillText(initial, 160, 155);

      // Subtitle artist pill
      ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.letterSpacing = '1px';
      const cleanArtist = (artist || 'ANRU STUDIO').toUpperCase().slice(0, 18);
      ctx.fillText(cleanArtist, 160, 240);
      ctx.restore();

      return canvas.toDataURL('image/png');
    } catch (e) {
      return 'icon-512.png';
    }
  }
}

if (typeof window !== 'undefined') window.ID3Parser = ID3Parser;
if (typeof globalThis !== 'undefined') globalThis.ID3Parser = ID3Parser;
