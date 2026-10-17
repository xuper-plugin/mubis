// @ts-check
/// <reference path="../animes-es/kino.d.ts" />
// Kino plugin: Mubis HD -- movies and series via Xtream Codes player_api.php.
// Server and credentials come from settings (url + text/password); fallback defaults for local testing.
// Sections: 1.config  2.helpers  3.API  4.item-mappers  5.home  6.browse  7.search  8.episodes  9.resolve

// ---- 1. config ------------------------------------------------------------------------------------------------

function base() { return String(kino.config.get("server_override") || kino.secrets.server || "").replace(/\/+$/, ""); }
function user() { return String(kino.secrets.username || ""); }
function pass() { return String(kino.secrets.password || ""); }
function api() { return base() + "/player_api.php"; }

const PAGE_SIZE = 24;
const HOME_VOD_CATS = 6;
const HOME_SER_CATS = 4;
const HOME_ROW_ITEMS = 20;
const CACHE_CATS_MS = 4 * 60 * 60 * 1000;
const CACHE_STREAMS_MS = 30 * 60 * 1000;
const CACHE_INFO_MS = 24 * 60 * 60 * 1000;

const TEXTS = {
  es: { noContent: "No hay contenido disponible ahora.", noConn: "No se pudo conectar con Mubis HD." },
  en: { noContent: "No content available right now.", noConn: "Could not connect to Mubis HD." },
};
function t(key) {
  const lang = String(kino.lang || "").toLowerCase().startsWith("es") ? "es" : "en";
  return TEXTS[lang][key] || TEXTS.es[key] || key;
}

// ---- 2. helpers ------------------------------------------------------------------------------------------------

async function getJson(url, ms) {
  const r = await kino.fetch(url, { timeoutMs: ms || 15000 });
  if (!r.ok) throw new Error("Mubis HD " + r.status);
  return r.json();
}

async function cached(key, ttlMs, fn) {
  try {
    const e = await kino.storage.get("mh:" + key);
    if (e && (Date.now() - e.at) < ttlMs) return e.v;
  } catch (_) {}
  const v = await fn();
  kino.storage.set("mh:" + key, { at: Date.now(), v }).catch(() => {});
  return v;
}

// ---- 3. API ----------------------------------------------------------------------------------------------------

function apiUrl(params) {
  return api() + "?username=" + encodeURIComponent(user()) + "&password=" + encodeURIComponent(pass())
    + Object.entries(params).map(([k, v]) => "&" + k + "=" + encodeURIComponent(String(v))).join("");
}

async function vodCategories() {
  return cached("vod-cats", CACHE_CATS_MS, () => getJson(apiUrl({ action: "get_vod_categories" })));
}
async function seriesCategories() {
  return cached("ser-cats", CACHE_CATS_MS, () => getJson(apiUrl({ action: "get_series_categories" })));
}
async function vodStreams(categoryId) {
  const key = categoryId ? "vod-s-" + categoryId : "vod-s-all";
  const p = { action: "get_vod_streams" };
  if (categoryId) p.category_id = categoryId;
  return cached(key, CACHE_STREAMS_MS, () => getJson(apiUrl(p)));
}
async function seriesList(categoryId) {
  const key = categoryId ? "ser-s-" + categoryId : "ser-s-all";
  const p = { action: "get_series" };
  if (categoryId) p.category_id = categoryId;
  return cached(key, CACHE_STREAMS_MS, () => getJson(apiUrl(p)));
}
async function seriesInfo(id) {
  return cached("ser-info-" + id, CACHE_INFO_MS, () => getJson(apiUrl({ action: "get_series_info", series_id: String(id) })));
}

// ---- 4. item mappers -------------------------------------------------------------------------------------------

function vodToItem(v) {
  const rating = parseFloat(v.rating);
  const year = v.added ? new Date(parseInt(v.added, 10) * 1000).getFullYear() : undefined;
  return {
    id: "vod-" + v.stream_id,
    ref: "m:" + v.stream_id + ":" + (v.container_extension || "mp4"),
    title: String(v.name || ""),
    kind: "movie",
    poster: v.stream_icon || undefined,
    rating: !isNaN(rating) ? rating : undefined,
    year,
  };
}

function seriesToItem(s) {
  const rating = parseFloat(s.rating);
  const genres = s.genre ? s.genre.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 5) : undefined;
  return {
    id: "ser-" + s.series_id,
    ref: "s:" + s.series_id,
    title: String(s.name || ""),
    kind: "series",
    poster: s.cover || undefined,
    overview: s.plot || undefined,
    genres,
    rating: !isNaN(rating) ? rating : undefined,
    year: s.releaseDate || undefined,
  };
}

// ---- 5. home ---------------------------------------------------------------------------------------------------

export async function home() {
  const [vodCats, serCats] = await Promise.all([
    vodCategories().catch(() => []),
    seriesCategories().catch(() => []),
  ]);
  const rows = [];

  for (const cat of (Array.isArray(vodCats) ? vodCats : []).slice(0, HOME_VOD_CATS)) {
    try {
      const streams = await vodStreams(cat.category_id);
      const items = (Array.isArray(streams) ? streams : []).slice(0, HOME_ROW_ITEMS).map(vodToItem);
      if (items.length) rows.push({ id: "vod-" + cat.category_id, title: String(cat.category_name || ""), items, ref: "cat:vod:" + cat.category_id, genre: "peliculas" });
    } catch (e) { kino.log("home vod " + cat.category_id + ": " + (e && e.message)); }
  }

  for (const cat of (Array.isArray(serCats) ? serCats : []).slice(0, HOME_SER_CATS)) {
    try {
      const list = await seriesList(cat.category_id);
      const items = (Array.isArray(list) ? list : []).slice(0, HOME_ROW_ITEMS).map(seriesToItem);
      if (items.length) rows.push({ id: "ser-" + cat.category_id, title: String(cat.category_name || ""), items, ref: "cat:series:" + cat.category_id, genre: "series" });
    } catch (e) { kino.log("home ser " + cat.category_id + ": " + (e && e.message)); }
  }

  return rows;
}

// ---- 6. browse -------------------------------------------------------------------------------------------------

export async function browse(ref, cursor) {
  const offset = cursor ? parseInt(cursor, 10) : 0;
  const m = /^cat:(vod|series):(.+)$/.exec(String(ref || ""));
  if (!m) return { items: [] };
  const isVod = m[1] === "vod";
  const all = isVod ? await vodStreams(m[2]) : await seriesList(m[2]);
  const arr = Array.isArray(all) ? all : [];
  const page = arr.slice(offset, offset + PAGE_SIZE).map(isVod ? vodToItem : seriesToItem);
  const next = offset + PAGE_SIZE < arr.length ? String(offset + PAGE_SIZE) : undefined;
  return { items: page, next };
}

// ---- 7. search -------------------------------------------------------------------------------------------------

export async function search(query) {
  const q = String(query.q || "").toLowerCase().trim();
  if (!q) return [];
  const [vodAll, serAll] = await Promise.all([
    vodStreams(null).catch(() => []),
    seriesList(null).catch(() => []),
  ]);
  const vs = (Array.isArray(vodAll) ? vodAll : []).filter((v) => String(v.name || "").toLowerCase().includes(q)).slice(0, 20).map(vodToItem);
  const ss = (Array.isArray(serAll) ? serAll : []).filter((s) => String(s.name || "").toLowerCase().includes(q)).slice(0, 20).map(seriesToItem);
  const out = [];
  const max = Math.max(vs.length, ss.length);
  for (let i = 0; i < max; i++) { if (vs[i]) out.push(vs[i]); if (ss[i]) out.push(ss[i]); }
  return out;
}

// ---- 8. episodes ------------------------------------------------------------------------------------------------

export async function episodes(ref) {
  const m = /^s:(.+)$/.exec(String(ref || ""));
  if (!m) return { episodes: [] };
  const data = await seriesInfo(m[1]);
  const info = (data && data.info) || {};
  const epsObj = (data && typeof data.episodes === "object") ? data.episodes : {};
  const eps = [];
  for (const [seasonKey, list] of Object.entries(epsObj)) {
    if (!Array.isArray(list)) continue;
    const seasonNum = parseInt(seasonKey, 10);
    for (const ep of list) {
      const num = parseInt(ep.episode_num, 10);
      if (!ep.id || isNaN(num)) continue;
      eps.push({
        season: parseInt(ep.season, 10) || seasonNum || 1,
        number: num,
        ref: "e:" + ep.id + ":" + (ep.container_extension || "mp4"),
        title: ep.title || undefined,
        airDate: ep.added ? new Date(parseInt(ep.added, 10) * 1000).toISOString().slice(0, 10) : undefined,
      });
    }
  }
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  const rating = parseFloat(info.rating);
  return {
    series: {
      title: info.name || undefined,
      poster: info.cover || undefined,
      overview: info.plot || undefined,
      genres: info.genre ? info.genre.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 5) : undefined,
      rating: !isNaN(rating) ? rating : undefined,
      year: info.releaseDate || undefined,
    },
    episodes: eps,
  };
}

// ---- 9. resolve -------------------------------------------------------------------------------------------------

export async function resolve(ref) {
  const movie = /^m:(\d+):([a-zA-Z0-9]+)$/.exec(String(ref || ""));
  if (movie) return { url: base() + "/movie/" + encodeURIComponent(user()) + "/" + encodeURIComponent(pass()) + "/" + movie[1] + "." + movie[2] };

  const ep = /^e:(\d+):([a-zA-Z0-9]+)$/.exec(String(ref || ""));
  if (ep) return { url: base() + "/series/" + encodeURIComponent(user()) + "/" + encodeURIComponent(pass()) + "/" + ep[1] + "." + ep[2] };

  throw new Error("ref desconocido: " + String(ref));
}
