  async function _bbImageType(file) {
    const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const word = n => String.fromCharCode(...b.slice(n, n + 4));
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
    if (word(0) === '\x89PNG') return 'image/png';
    if (word(0) === 'RIFF' && word(8) === 'WEBP') return 'image/webp';
    if (word(0) === 'GIF8') return 'image/gif';
    if (b[0] === 66 && b[1] === 77) return 'image/bmp';
    if (word(4) === 'ftyp') {
      const brands = [word(8)];
      const size = new DataView(b.buffer).getUint32(0);
      for (let i = 16; i + 4 <= Math.min(size, b.length); i += 4) brands.push(word(i));
      if (brands.some(v => ['avif', 'avis'].includes(v))) return 'image/avif';
      if (brands.some(v => ['heic','heix','heim','heis','hevc','hevx','mif1','msf1'].includes(v))) return 'image/heic';
    }
    return '';
  }

  async function maybeDecodeHeic(file) {
    // This is only called after the browser decoder fails; names and MIME labels
    // from phone pickers cannot force a readable JPEG through the HEIC converter.
    if (await _bbImageType(file) !== 'image/heic') return file;
    if (!window._heic2any) {
      if (!window._bbHeicLoading) {
        window._bbHeicLoading = new Promise((resolve, reject) => {
          if (window.heic2any) { resolve(); return; }
          const script = document.createElement('script');
          const timer = setTimeout(() => { script.remove(); reject(Error('Photo converter could not load. Check your connection and retry.')); }, 30000);
          script.src = 'vendor/heic2any-0.0.4.min.js';
          script.integrity = 'sha384-OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL';
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error('Photo converter could not load. Check your connection and retry.')); };
          document.head.appendChild(script);
        }).catch(error => { window._bbHeicLoading = null; throw error; });
      }
      await window._bbHeicLoading;
      window._heic2any = window.heic2any;
    }
    if (!window._heic2any) throw Error('Photo converter did not start. Reload and retry.');
    let timer;
    try {
      const result = await Promise.race([
        window._heic2any({blob:file,toType:'image/jpeg',quality:0.9}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('HEIC conversion took too long. Try this photo again on its own.')), 90000); })
      ]);
      return Array.isArray(result) ? result[0] : result;
    } catch(error) {
      throw Error(error.message?.includes('too long') ? error.message : 'This HEIC photo could not be decoded. Please try another copy of the photo.');
    } finally { clearTimeout(timer); }
  }

  async function _bbValidateImageBytes(file) {
    try { return !!await _bbImageType(file); }
    catch (_) { return false; }
  }

  async function _bbDecodePhoto(file) {
    if (typeof createImageBitmap === 'function') {
      let timer, expired = false;
      try {
        const bitmap = await Promise.race([
          createImageBitmap(file, {imageOrientation:'from-image'}).then(value => { if (expired) { value.close(); throw Error('Decode timed out'); } return value; }),
          new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(Error('Decode timed out')); }, 30000); })
        ]);
        return {image:bitmap, release:() => bitmap.close()};
      } catch (_) { /* Use the browser's ordinary image decoder next. */ }
      finally { clearTimeout(timer); }
    }
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      const release = () => { img.onload = img.onerror = null; img.src = ''; URL.revokeObjectURL(url); };
      const timer = setTimeout(() => { release(); reject(Error('This photo took too long to open. Try it again on its own.')); }, 30000);
      img.onload = () => { clearTimeout(timer); resolve({image:img, release}); };
      img.onerror = () => { clearTimeout(timer); release(); reject(Error('The browser could not open this photo.')); };
      img.src = url;
    });
  }

  async function _bbCanvasJpeg(canvas, quality) {
    const fallback = () => {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (!data.startsWith('data:image/jpeg;base64,')) throw Error('Your browser could not create a JPEG. Reload and retry.');
      const bytes = atob(data.split(',')[1]);
      return new Blob([Uint8Array.from(bytes, c => c.charCodeAt(0))], {type:'image/jpeg'});
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = blob => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try { resolve(blob?.size && blob.type === 'image/jpeg' ? blob : fallback()); }
        catch (error) { reject(error); }
      };
      // Some mobile browsers return null or never call toBlob's callback.
      // Encode the already-resized canvas instead of rejecting a valid photo.
      const timer = setTimeout(() => finish(null), 5000);
      try { canvas.toBlob(finish, 'image/jpeg', quality); }
      catch (_) { finish(null); }
    });
  }

  async function _bbReadPhoto(file) {
    // Snapshot one file at a time. Decoding and conversion then read stable memory,
    // rather than repeatedly opening an Android gallery/cloud-provider reference.
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const bytes = await file.arrayBuffer();
        if (!bytes.byteLength) throw Object.assign(Error('Empty photo'), {name:'NotReadableError'});
        return new Blob([bytes], {type:file.type || ''});
      } catch (error) {
        if (!['NotReadableError','NotFoundError','SecurityError','AbortError'].includes(error.name)) throw error;
        lastError = error;
        if (!attempt) await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    const error = Error('Cannot read this photo. Tap the upload box to choose a saved copy from Files.');
    error.code = 'photo-unreadable';
    error.cause = lastError;
    throw error;
  }

  async function compressImage(file) {
    file = await _bbReadPhoto(file);
    const type = await _bbImageType(file);
    if (!type) throw Error('Choose a JPEG, PNG, WebP, GIF, BMP, AVIF or HEIC photo.');
    // Correct absent or misleading Android picker MIME labels using the bytes.
    const source = file.type === type ? file : file.slice(0, file.size, type);
    let decoded;
    try { decoded = await _bbDecodePhoto(source); }
    catch (error) {
      if (type !== 'image/heic') throw error;
      const converted = await maybeDecodeHeic(source);
      if (!converted) throw Error('This HEIC photo could not be decoded.');
      decoded = await _bbDecodePhoto(converted);
    }
    const canvas = document.createElement('canvas');
    try {
      const image = decoded.image;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (!width || !height) throw Error('This photo has no readable image data.');
      for (const [max, quality] of [[1200,0.82],[1000,0.65],[800,0.45]]) {
        const scale = Math.min(1, max / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw Error('Your browser could not prepare the photo. Reload and retry.');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await _bbCanvasJpeg(canvas, quality);
        if (blob.size > 0 && blob.size < 4.9 * 1024 * 1024) return blob;
      }
      throw Error('This photo could not be reduced to the upload limit. Try another copy.');
    } finally { decoded.release(); canvas.width = canvas.height = 0; }
  }



export { compressImage, maybeDecodeHeic, _bbImageType, _bbValidateImageBytes };
