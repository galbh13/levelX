import { Platform } from 'react-native';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

// ── Uploading a picked file to Supabase Storage, on BOTH web and the APK ──────
//
// WHY THIS FILE EXISTS. The obvious code — `fetch(asset.uri)` → `.blob()` →
// `storage.upload(path, blob)` — works on web and FAILS on native Android with a
// bare "Network request failed". On React Native a Blob is only a handle to
// native data (it holds no bytes in JS), so pushing it back through fetch either
// sends an empty body or blows up in the networking layer — supabase-js documents
// this exact caveat ("For React Native, using either Blob, File or FormData does
// not work as intended"). Big camera clips make it worse: reading a 50 MB file
// into JS memory is a good way to get killed by Android.
//
// The pattern that DOES work on device is the one the signature-video upload
// already uses: hand React Native a FormData file DESCRIPTOR — { uri, name, type }
// — and let the native networking layer stream the file straight off disk. No
// bytes ever pass through JS. We post that to Supabase Storage's REST endpoint
// (the same one storage-js posts to), which accepts multipart/form-data.
//
// XHR rather than fetch, because RN's fetch discards upload progress and gives us
// no timeout control; XHR gives both.

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;   // big clip on a slow phone connection

// A friendlier message than the raw "Network request failed" the transport throws.
const NETWORK_HINT =
  'Upload failed — the connection dropped mid-upload. Stay on Wi-Fi if you can, keep the app open, and try again.';

function extOf(uri, fallback) {
  return (uri.split('.').pop() ?? fallback).toLowerCase().split('?')[0];
}

// Native-only: multipart POST of a file URI to Supabase Storage, via XHR.
async function uploadNative(bucket, path, asset, { contentType, upsert, onProgress }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const ext  = extOf(asset.uri, 'bin');
  const name = `upload.${ext.length <= 4 ? ext : 'bin'}`;

  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', { uri: asset.uri, name, type: contentType });

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upsert', String(!!upsert));
    // NOTE: do NOT set Content-Type — RN fills in the multipart boundary itself.

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status}).`;
      try { msg = JSON.parse(xhr.responseText)?.message ?? msg; } catch {}
      reject(new Error(msg));
    };
    xhr.onerror   = () => reject(new Error(NETWORK_HINT));
    xhr.ontimeout = () => reject(new Error('Upload timed out — try a shorter clip or a better connection.'));
    xhr.onabort   = () => reject(new Error('Upload cancelled.'));
    xhr.send(form);
  });
}

// Web: the browser has real Blobs, so the plain supabase-js path is correct.
async function uploadWeb(bucket, path, asset, { contentType, upsert, maxBytes, sizeLabel }) {
  const blob = await (await fetch(asset.uri)).blob();
  assertSize(blob.size, maxBytes, sizeLabel);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: blob.type || contentType, upsert: !!upsert });
  if (error) throw error;
}

function assertSize(bytes, maxBytes, sizeLabel = 'file') {
  if (!bytes || !maxBytes || bytes <= maxBytes) return;
  throw new Error(
    `That ${sizeLabel} is ${(bytes / 1024 / 1024).toFixed(0)} MB. Max is ${Math.round(maxBytes / 1024 / 1024)} MB` +
    (sizeLabel === 'clip' ? ' — lower the recording quality on your phone and try again.' : '.')
  );
}

// Upload an expo-image-picker asset to `bucket/path`. Returns the public URL.
// `asset` needs { uri } and, on native, ideally { fileSize } for the size guard.
export async function uploadAssetToBucket(bucket, path, asset, opts = {}) {
  const {
    contentType = `application/octet-stream`,
    upsert = true, maxBytes = null, sizeLabel = 'file', onProgress,
  } = opts;

  if (Platform.OS === 'web') {
    await uploadWeb(bucket, path, asset, { contentType, upsert, maxBytes, sizeLabel });
  } else {
    // The picker reports the size, so we can reject an oversized clip BEFORE
    // spending the user's data on it (no need to read the file to find out).
    assertSize(asset.fileSize, maxBytes, sizeLabel);
    await uploadNative(bucket, path, asset, { contentType, upsert, onProgress });
  }

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

// Convenience for video pickers: builds the storage path's extension + MIME type.
export function videoMeta(uri) {
  const ext = extOf(uri, 'mp4');
  const safe = ext.length <= 4 ? ext : 'mp4';
  return { ext: safe, contentType: `video/${safe === 'mov' ? 'quicktime' : safe}` };
}
