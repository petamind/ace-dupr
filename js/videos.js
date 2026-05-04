import Data from './data.js';

const CHANNEL_HANDLE = 'ACEPickleball-NZ';
const API_KEY = 'AIzaSyCMBB5vPyMVLr-r-XRGFsjW1GmxkVw03AM';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Vietnamese đ/Đ is a base letter with a stroke (not a combining mark), so
// NFD won't decompose it — replace manually before normalize().
export function tokenize(str) {
  if (!str) return [];
  return str
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Match on the player's first name token only — "Hùng Trang" and "Hùng Trần"
// both reduce to "hung". Imprecise on purpose: titles aren't reliably typed
// with both tokens, and surfacing a few extra cards from a same-first-name
// teammate is preferable to surfacing none.
export function findRelatedVideos(player, videos, limit = 2) {
  const [firstToken] = tokenize(player?.name);
  if (!firstToken || !videos?.length) return [];

  return videos
    .filter(v => tokenize(v.title).includes(firstToken))
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit);
}

async function _getUploadsPlaylistId(cachedId) {
  if (cachedId) return cachedId;
  const url = `${YT_API}/channels?part=contentDetails&forHandle=${encodeURIComponent(CHANNEL_HANDLE)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error(`Channel not found: ${CHANNEL_HANDLE}`);
  return playlistId;
}

async function _fetchVideos(playlistId) {
  const url = `${YT_API}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.items || [])
    .map(item => {
      const s = item.snippet ?? {};
      return {
        id: s.resourceId?.videoId,
        title: s.title,
        date: s.publishedAt,
        thumb: s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
      };
    })
    .filter(v => v.id && v.title && v.title !== 'Private video' && v.title !== 'Deleted video');
}

// Never throws — callers (especially the profile page) must keep rendering
// even if YouTube is unreachable. `errorKind` is structured so callers don't
// regex-match human-readable messages: 'no_api_key' | 'api_error'.
export async function loadVideos({ forceRefresh = false } = {}) {
  if (!API_KEY) return { videos: [], fromCache: false, errorKind: 'no_api_key' };

  const cache = Data.loadVideoCache();
  if (!forceRefresh && cache?.videos && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { videos: cache.videos, fromCache: true };
  }

  try {
    const playlistId = await _getUploadsPlaylistId(cache?.playlistId);
    const videos = await _fetchVideos(playlistId);
    Data.saveVideoCache({ videos, playlistId });
    return { videos, fromCache: false };
  } catch (err) {
    console.error('loadVideos: YouTube API failed', err);
    if (cache?.videos) {
      console.warn('loadVideos: serving stale cache');
      return { videos: cache.videos, fromCache: true, errorKind: 'api_error', errorMessage: err.message };
    }
    return { videos: [], fromCache: false, errorKind: 'api_error', errorMessage: err.message };
  }
}
