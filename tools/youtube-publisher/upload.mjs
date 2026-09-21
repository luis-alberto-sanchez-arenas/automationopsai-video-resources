import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;
const required = [
  'DATABASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'VIDEO_URL','THUMBNAIL_URL','VIDEO_TITLE','AUTOMATION_KEY',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const requestedPrivacy = (process.env.VIDEO_PRIVACY_STATUS || 'unlisted').toLowerCase();
const privacyStatus = ['private', 'unlisted', 'public'].includes(requestedPrivacy)
  ? requestedPrivacy
  : 'unlisted';
const videoLanguage = process.env.VIDEO_LANGUAGE || 'es';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /sslmode=require|render\.com/i.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined,
  max: 2,
});

function decryptRefreshToken(value, clientSecret) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted refresh token');
  const [iv, tag, data] = parts;
  const key = createHash('sha256')
    .update(`${clientSecret}|youtube-refresh-token-v2`)
    .digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function accessToken() {
  const owner = process.env.OWNER_USER_ID || 'owner';
  const found = await pool.query(
    `SELECT record FROM app_records
     WHERE table_name='youtube_tokens_v2' AND record @> $1::jsonb
     ORDER BY created_at DESC LIMIT 1`,
    [JSON.stringify({ userId: owner })],
  );
  if (!found.rows[0]) throw new Error('YouTube OAuth token not found');
  const refreshToken = decryptRefreshToken(
    found.rows[0].record.encryptedRefreshToken,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || 'Unable to refresh Google access token');
  }
  return data.access_token;
}

async function findExisting() {
  const owner = process.env.OWNER_USER_ID || 'owner';
  const result = await pool.query(
    `SELECT record FROM app_records
     WHERE table_name='youtube_publish_jobs_v2' AND record @> $1::jsonb
     ORDER BY created_at DESC LIMIT 1`,
    [JSON.stringify({ userId: owner, automationKey: process.env.AUTOMATION_KEY })],
  );
  return result.rows[0]?.record || null;
}

async function ensureCaption(videoId, access) {
  if (!process.env.CAPTIONS_URL || !videoId) return 'not-configured';
  const listed = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`,
    { headers: { authorization: `Bearer ${access}` } },
  );
  const listData = await listed.json();
  if (!listed.ok) throw new Error(`Caption lookup failed: HTTP ${listed.status}`);
  if ((listData.items || []).some(item => item.snippet?.language === 'en')) return 'already-set';

  const source = await fetch(process.env.CAPTIONS_URL, { redirect: 'follow' });
  if (!source.ok) throw new Error(`Caption download failed: HTTP ${source.status}`);
  const srt = Buffer.from(await source.arrayBuffer());
  const boundary = `automationopsai_${Date.now().toString(16)}`;
  const metadata = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ snippet: { videoId, language: 'en', name: 'English', isDraft: false } }) +
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([metadata, srt, closing]);
  const uploaded = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': `multipart/related; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      body,
    },
  );
  if (!uploaded.ok) throw new Error(`Caption upload failed: HTTP ${uploaded.status} ${(await uploaded.text()).slice(0,500)}`);
  return 'set';
}

async function findExistingOnYouTube(access) {
  const channelResponse = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
    { headers: { authorization: `Bearer ${access}` } },
  );
  const channelData = await channelResponse.json();
  if (!channelResponse.ok) throw new Error(`Channel lookup failed: HTTP ${channelResponse.status}`);
  const uploads = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;
  const itemsResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=50`,
    { headers: { authorization: `Bearer ${access}` } },
  );
  const itemsData = await itemsResponse.json();
  if (!itemsResponse.ok) throw new Error(`Uploads lookup failed: HTTP ${itemsResponse.status}`);
  const match = (itemsData.items || []).find(item => item.snippet?.title === process.env.VIDEO_TITLE);
  return match?.contentDetails?.videoId || null;
}

async function fetchBytes(url, label) {
  if (url.startsWith('/') || url.startsWith('file://')) {
    const filePath = url.startsWith('file://') ? new URL(url) : url;
    const bytes = await readFile(filePath);
    const type = String(url).toLowerCase().endsWith('.mp4') ? 'video/mp4'
      : String(url).toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { bytes, type };
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${label} download failed: HTTP ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function startUpload(access, size) {
  const response = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: process.env.VIDEO_TITLE,
          description: process.env.VIDEO_DESCRIPTION || '',
          tags: (process.env.VIDEO_TAGS || '').split(',').map(x => x.trim()).filter(Boolean),
          categoryId: '28',
          defaultLanguage: videoLanguage,
          defaultAudioLanguage: videoLanguage,
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: true,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`YouTube session failed: HTTP ${response.status} ${(await response.text()).slice(0,500)}`);
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube did not return a resumable upload URL');
  return location;
}

async function uploadVideo(sessionUrl, access, bytes) {
  const response = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${access}`,
      'content-type': 'video/mp4',
      'content-length': String(bytes.length),
      'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
    },
    body: bytes,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw new Error(`YouTube upload failed: HTTP ${response.status} ${JSON.stringify(data).slice(0,500)}`);
  }
  return data.id;
}

async function setThumbnail(videoId, access, bytes, contentType) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const response = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': contentType,
          'content-length': String(bytes.length),
        },
        body: bytes,
      },
    );
    if (response.ok) return 'set';
    const error = (await response.text()).slice(0,500);
    if (attempt === 8) throw new Error(`Thumbnail upload failed: HTTP ${response.status} ${error}`);
    await sleep(5000);
  }
}

async function saveJob(videoId, videoSize, thumbnailStatus) {
  const now = new Date().toISOString();
  const owner = process.env.OWNER_USER_ID || 'owner';
  const record = {
    userId: owner,
    automationKey: process.env.AUTOMATION_KEY,
    title: process.env.VIDEO_TITLE,
    description: process.env.VIDEO_DESCRIPTION || '',
    tags: (process.env.VIDEO_TAGS || '').split(',').map(x => x.trim()).filter(Boolean),
    privacyStatus,
    targetPrivacyStatus: privacyStatus,
    preparedStoragePath: 'external-reviewed-cut',
    thumbnailStoragePath: 'external-reviewed-thumbnail',
    transcript: '',
    status: 'published',
    totalBytes: videoSize,
    uploadedBytes: videoSize,
    youtubeVideoId: videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailStatus,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await pool.query(
    `INSERT INTO app_records(table_name,id,record,created_at,updated_at)
     VALUES('youtube_publish_jobs_v2',$1,$2::jsonb,now(),now())`,
    [randomUUID(), JSON.stringify(record)],
  );
  return record.youtubeUrl;
}

async function main() {
  const existing = await findExisting();
  if (existing?.youtubeUrl) {
    const access = await accessToken();
    const captionStatus = await ensureCaption(existing.youtubeVideoId, access);
    console.log(`ALREADY_PUBLISHED ${existing.youtubeUrl} captions=${captionStatus}`);
    return;
  }

  const [video, thumb, access] = await Promise.all([
    fetchBytes(process.env.VIDEO_URL, 'Video'),
    fetchBytes(process.env.THUMBNAIL_URL, 'Thumbnail'),
    accessToken(),
  ]);
  const minimumVideoBytes = Number(process.env.MIN_VIDEO_BYTES || 500_000);
  if (video.bytes.length < minimumVideoBytes) {
    throw new Error(`Video integrity check failed: ${video.bytes.length} < ${minimumVideoBytes}`);
  }
  if (thumb.bytes.length < 20_000) throw new Error('Thumbnail integrity check failed');

  const priorVideoId = await findExistingOnYouTube(access);
  if (priorVideoId) {
    const thumbnailStatus = await setThumbnail(priorVideoId, access, thumb.bytes, thumb.type);
    const url = await saveJob(priorVideoId, video.bytes.length, thumbnailStatus);
    const captionStatus = await ensureCaption(priorVideoId, access);
    console.log(`RECOVERED_EXISTING_UPLOAD ${url} captions=${captionStatus}`);
    return;
  }

  const session = await startUpload(access, video.bytes.length);
  const videoId = await uploadVideo(session, access, video.bytes);
  const thumbnailStatus = await setThumbnail(videoId, access, thumb.bytes, thumb.type);
  const url = await saveJob(videoId, video.bytes.length, thumbnailStatus);
  const captionStatus = await ensureCaption(videoId, access);
  console.log(`PUBLISHED_${privacyStatus.toUpperCase()} ${url} captions=${captionStatus}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
