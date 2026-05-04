// YouTube video loading + diacritic-insensitive name matching.
// Shared by videos.html (full grid) and player.html (related videos on profile).

import Data from './data.js';

const CHANNEL_HANDLE = 'ACEPickleball-NZ';
const API_KEY = 'AIzaSyCMBB5vPyMVLr-r-XRGFsjW1GmxkVw03AM';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// "Hiền Trần" → ["hien", "tran"]; "Phúc Đăng" → ["phuc", "dang"]; title
// "Tung & Hien Tran vs Hung Trang" → ["tung", "hien", "tran", "vs", "hung", "trang"].
// NFD strips combining marks (ề → e), but Vietnamese đ/Đ is a base letter with
// a stroke (not a combining diacritic), so we map it manually before the rest
// of the pipeline.
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

// Match rule: the player's name tokens must appear as a *contiguous* run in
// the title's token sequence. Single-token names (e.g. "Tùng") need the token
// present; compound names ("Hùng Trần") need both tokens adjacent and in order
// — this is what disambiguates "Hùng Trần" from "Hùng Trang", and prevents
// a title like "Hung Trang vs Hien Tran" from matching "Hùng Trần" just
// because both `hung` and `tran` appear somewhere.
export function findRelatedVideos(player, videos, limit = 2) {
  const nameTokens = tokenize(player?.name);
  if (!nameTokens.length || !videos?.length) return [];

  const matches = videos.filter(v => {
    const titleTokens = tokenize(v.title);
    if (titleTokens.length < nameTokens.length) return false;
    for (let i = 0; i <= titleTokens.length - nameTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < nameTokens.length; j++) {
        if (titleTokens[i + j] !== nameTokens[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  });

  return matches
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
      const s = item.snippet;
      return {
        id: s.resourceId.videoId,
        title: s.title,
        date: s.publishedAt,
        thumb: s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
      };
    })
    .filter(v => v.id && v.title !== 'Private video' && v.title !== 'Deleted video');
}

// Returns { videos, fromCache, error? }. Never throws — callers (especially
// the profile page) must keep rendering even if YouTube is unreachable.
export async function loadVideos({ forceRefresh = false } = {}) {
  if (!API_KEY) return { videos: [], fromCache: false, error: 'No API key configured.' };

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
    if (cache?.videos) return { videos: cache.videos, fromCache: true, error: err.message };
    return { videos: [], fromCache: false, error: err.message };
  }
}
