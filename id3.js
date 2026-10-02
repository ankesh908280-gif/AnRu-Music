/**
 * ANRU MUSIC - PURE JS ID3 TAG & EMBEDDED ARTWORK PARSER (id3.js)
 * High-speed client-side parser for ID3v2.3 & ID3v2.4
 * Zero external libraries, works with native browser File / ArrayBuffer.
 */

class ID3Parser {
  static async parseFile(file) {
    const defaultMeta = this.parseFilename(file.name);
    try {
      // Read first 128KB of the file (ID3v2 tags are located at the beginning)
      const sliceSize = Math.min(file.size, 131072);
      const buffer = await file.slice(0, sliceSize).arrayBuffer();
      const view = new DataView(buffer);

      // Check for ID3 header
      if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
        return defaultMeta;
      }

      const version = view.getUint8(3); // 3 for ID3v2.3, 4 for ID3v2.4
      const tagSize = this.readSynchsafeInt(view, 6);
      let offset = 10;
      const maxOffset = Math.min(tagSize + 10, sliceSize);

      let title = '';
      let artist = '';
      let album = '';
      let coverBlobUrl = null;

      while (offset + 10 < maxOffset) {
        // Read 4-character Frame ID
        let frameId = '';
        for (let i = 0; i < 4; i++) {
          const charCode = view.getUint8(offset + i);
          if (charCode === 0) break;
          frameId += String.fromCharCode(charCode);
        }

        if (frameId.length < 4) break;

        const frameSize = version === 4 
          ? this.readSynchsafeInt(view, offset + 4) 
          : view.getUint32(offset + 4);

        if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

        const frameDataOffset = offset + 10;

        if (frameId === 'TIT2') { // Title
          title = this.decodeTextFrame(view, frameDataOffset, frameSize);
        } else if (frameId === 'TPE1') { // Artist
          artist = this.decodeTextFrame(view, frameDataOffset, frameSize);
        } else if (frameId === 'TALB') { // Album
          album = this.decodeTextFrame(view, frameDataOffset, frameSize);
        } else if (frameId === 'APIC' && !coverBlobUrl) { // Attached Picture (Cover)
          coverBlobUrl = this.decodePictureFrame(view, frameDataOffset, frameSize);
        }

        offset += 10 + frameSize;
      }

      return {
        title: title.trim() || defaultMeta.title,
        artist: artist.trim() || defaultMeta.artist,
        album: album.trim() || defaultMeta.album,
        artwork: coverBlobUrl || 'icon-512.png',
        duration: 0
      };
    } catch (e) {
      console.warn('ID3 parse notice for', file.name, e);
      return defaultMeta;
    }
  }

  static readSynchsafeInt(view, offset) {
    return (
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    );
  }

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

  static decodePictureFrame(view, offset, size) {
    try {
      const encoding = view.getUint8(offset);
      let curr = offset + 1;

      // Extract MIME type (null-terminated ISO-8859-1 string)
      let mimeType = '';
      while (curr < offset + size && view.getUint8(curr) !== 0) {
        mimeType += String.fromCharCode(view.getUint8(curr));
        curr++;
      }
      curr++; // skip null byte
      if (!mimeType) mimeType = 'image/jpeg';

      const picType = view.getUint8(curr); // e.g. 3 = Front Cover
      curr++;

      // Skip description
      if (encoding === 0 || encoding === 3) {
        while (curr < offset + size && view.getUint8(curr) !== 0) curr++;
        curr++;
      } else {
        while (curr + 1 < offset + size && !(view.getUint8(curr) === 0 && view.getUint8(curr + 1) === 0)) curr += 2;
        curr += 2;
      }

      const imgBytesLength = (offset + size) - curr;
      if (imgBytesLength <= 0) return null;

      const imgData = new Uint8Array(view.buffer, curr, imgBytesLength);
      const blob = new Blob([imgData], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  static parseFilename(filename) {
    const clean = filename.replace(/\.[^/.]+$/, '').trim();
    if (clean.includes(' - ')) {
      const parts = clean.split(' - ');
      return {
        title: parts[1]?.trim() || clean,
        artist: parts[0]?.trim() || 'Local Artist',
        album: 'Offline Music',
        artwork: 'icon-512.png',
        duration: 0
      };
    }
    return {
      title: clean,
      artist: 'Local Artist',
      album: 'Offline Music',
      artwork: 'icon-512.png',
      duration: 0
    };
  }
}

if (typeof window !== 'undefined') window.ID3Parser = ID3Parser;
if (typeof globalThis !== 'undefined') globalThis.ID3Parser = ID3Parser;
