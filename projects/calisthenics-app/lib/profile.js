import { Platform } from 'react-native';
import { supabase } from './supabase';
import { computeLvl, computeClassMax } from './computeLvl';
import { evaluatePrestige, prestigeStars } from './prestige';
import { DEFAULT_JOB } from './jobs';

// Player profile ("Hunter Status") helpers — the portrait + one signature video,
// plus a derived read of everything the status card shows (name · LVL · class ·
// prestige stars). See DATABASE.md `profiles` (avatar_url / signature_video_url)
// and migration 20260723_player_profiles.sql.

export const PROFILE_BUCKET   = 'profile-media';   // avatars only (Supabase Storage)
export const MAX_AVATAR_MB    = 8;
export const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;
export const MAX_SIGNATURE_MB    = 50;
export const MAX_SIGNATURE_BYTES = MAX_SIGNATURE_MB * 1024 * 1024;

// ── Signature videos → Cloudinary (transcodes to H.264) ─────────────────────
// Phones record HEVC/H.265, which desktop browsers can't decode (audio plays,
// frame is black). Cloudinary transcodes server-side, so the clip plays on phone
// AND desktop. The phone only waits for a normal upload; the heavy conversion runs
// on Cloudinary, not the device. Unsigned upload preset → no secret in the client.
// (Avatars stay in Supabase Storage — images have no codec problem.)
const CLOUDINARY_CLOUD  = 'lwfbixc6';
const CLOUDINARY_PRESET = 'levelx_signatures';

// Always-H.264 delivery URL for a Cloudinary video public_id — the codec desktop
// browsers can decode (f_mp4 container + vc_h264 codec; q_auto for size).
function cloudinaryH264Url(publicId) {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/f_mp4,vc_h264,q_auto/${publicId}.mp4`;
}

// Everything the Hunter Status screen renders for ONE player. The identity line
// (LVL / class / stars) is computed the SAME way HomeScreen and the leaderboard
// do it — nothing is stored for it. Works for the signed-in player OR any group
// co-member (co-member reads of profiles / class_quests / completions are allowed
// by the shares_group_with RLS the leaderboard already relies on).
export async function fetchHunterProfile(userId) {
  if (!userId) return null;

  const { data: p } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, signature_video_url, class_id, job, prestige_count')
    .eq('id', userId)
    .single();
  if (!p) return null;

  const [classRes, lvlVal, maxLvlVal, questsRes, complRes, classCountRes] = await Promise.all([
    p.class_id
      ? supabase.from('classes').select('name, prestige_at, order_index').eq('id', p.class_id).single()
      : Promise.resolve({ data: null }),
    computeLvl(userId, p.class_id),
    computeClassMax(p.class_id),
    p.class_id
      ? supabase.from('class_quests').select('id, name, chain, quest_type, prerequisites').eq('class_id', p.class_id)
      : Promise.resolve({ data: [] }),
    supabase.from('student_quest_completions').select('quest_id').eq('student_id', userId),
    // Per-job class count — stars reflect classes overcome within the player's own
    // job ladder, not the total across every job.
    supabase.from('classes').select('id', { count: 'exact', head: true }).eq('job', p.job ?? DEFAULT_JOB),
  ]);

  const prestigeEval = evaluatePrestige({
    job:          p.job ?? DEFAULT_JOB,
    orderIndex:   classRes.data?.order_index ?? 0,
    quests:       questsRes.data ?? [],
    completedIds: new Set((complRes.data ?? []).map(c => c.quest_id)),
    lvl:          lvlVal ?? 0,
    prestigeAt:   classRes.data?.prestige_at ?? 80,
  });
  const stars = prestigeStars({
    orderIndex:    classRes.data?.order_index ?? 0,
    classCount:    classCountRes.count ?? null,
    finalClassMet: prestigeEval.ok,
  });

  return {
    id:                p.id,
    fullName:          p.full_name ?? null,
    avatarUrl:         p.avatar_url ?? null,
    signatureVideoUrl: p.signature_video_url ?? null,
    className:         classRes.data?.name ?? null,
    lvl:               lvlVal ?? 0,
    maxLvl:            maxLvlVal ?? 0,
    stars,
    prestigeReady:     prestigeEval.ok,
  };
}

// Upload/replace a file in the profile-media bucket, then point the given profile
// column at it and delete the PREVIOUS file (these are permanent, so replace
// instead of accumulate). `kind` = 'avatar' | 'signature'; `urlCol`/`pathCol` are
// the profile columns to write. Shared by the two public helpers below.
async function replaceProfileFile(userId, asset, { kind, urlCol, pathCol, maxBytes, defaultExt, contentPrefix, sizeLabel }) {
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new Error(`That ${sizeLabel} is ${(blob.size / 1024 / 1024).toFixed(0)} MB. Max is ${maxBytes / 1024 / 1024} MB.`);
  }

  const ext  = (asset.uri.split('.').pop() ?? defaultExt).toLowerCase().split('?')[0];
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(PROFILE_BUCKET)
    .upload(path, blob, { contentType: blob.type || `${contentPrefix}/${ext}`, upsert: true });
  if (upErr) throw upErr;

  const { data: { publicUrl } } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path);

  // Read the old path BEFORE overwriting so we can drop the stale file after.
  const { data: prev } = await supabase.from('profiles').select(pathCol).eq('id', userId).single();

  const { error: updErr } = await supabase
    .from('profiles')
    .update({ [urlCol]: publicUrl, [pathCol]: path })
    .eq('id', userId);
  if (updErr) throw updErr;

  const oldPath = prev?.[pathCol];
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(PROFILE_BUCKET).remove([oldPath]).catch(() => {});
  }
  return publicUrl;
}

// Replace the player's portrait. `asset` is an expo-image-picker Images asset.
export function uploadAvatar(userId, asset) {
  return replaceProfileFile(userId, asset, {
    kind: 'avatar', urlCol: 'avatar_url', pathCol: 'avatar_path',
    maxBytes: MAX_AVATAR_BYTES, defaultExt: 'jpg', contentPrefix: 'image', sizeLabel: 'image',
  });
}

// Replace the player's signature-move clip. Uploads the raw clip to Cloudinary
// (which transcodes to H.264), then stores the H.264 delivery URL + the Cloudinary
// public_id on the profile. `asset` is an expo-image-picker Videos asset.
export async function uploadSignatureVideo(userId, asset) {
  const form = new FormData();

  if (Platform.OS === 'web') {
    // Web (incl. levelx.expo.app in a phone browser): send the real Blob/File.
    const res = await fetch(asset.uri);
    const blob = await res.blob();
    if (blob.size > MAX_SIGNATURE_BYTES) {
      throw new Error(`That clip is ${(blob.size / 1024 / 1024).toFixed(0)} MB. Max is ${MAX_SIGNATURE_MB} MB.`);
    }
    const ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase().split('?')[0];
    // Pass a filename so Cloudinary reliably detects the video resource.
    form.append('file', blob, `signature.${ext.length <= 4 ? ext : 'mp4'}`);
  } else {
    // Native RN: FormData takes a { uri, name, type } file descriptor.
    const ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase().split('?')[0];
    form.append('file', { uri: asset.uri, name: `signature.${ext}`, type: `video/${ext}` });
  }
  form.append('upload_preset', CLOUDINARY_PRESET);

  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
    { method: 'POST', body: form },
  );
  const data = await resp.json();
  if (!resp.ok || !data.public_id) {
    throw new Error(data?.error?.message || 'Video upload failed.');
  }

  const url = cloudinaryH264Url(data.public_id);
  const { error } = await supabase
    .from('profiles')
    .update({ signature_video_url: url, signature_video_path: data.public_id })
    .eq('id', userId);
  if (error) throw error;
  return url;
}

// Clear the signature clip: its DB pointers (+ a LEGACY Supabase file if any).
// Cloudinary assets aren't deleted from the client (that needs a signed API call);
// they're small and just fall out of use — acceptable.
export async function removeSignatureVideo(userId) {
  const { data: prev } = await supabase
    .from('profiles').select('signature_video_path').eq('id', userId).single();
  const { error } = await supabase
    .from('profiles')
    .update({ signature_video_url: null, signature_video_path: null })
    .eq('id', userId);
  if (error) throw error;
  // Legacy clips lived in Supabase Storage (path like `<uid>/signature-…`);
  // Cloudinary public_ids look like `signatures/…`. Only clean up the former.
  const p = prev?.signature_video_path;
  if (p && !p.startsWith('signatures/')) {
    await supabase.storage.from(PROFILE_BUCKET).remove([p]).catch(() => {});
  }
}
