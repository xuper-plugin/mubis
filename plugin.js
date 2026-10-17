// @ts-check
/// <reference path="../animes-es/kino.d.ts" />
// Kino plugin: Mubis HD -- movies and series via Xtream Codes player_api.php.
// Sections: 1.config  2.helpers  3.API  4.item-mappers  5.home/section  6.browse  7.search  8.categories
//           9.episodes/details  10.resolve  11.settings

// ---- 1. config ------------------------------------------------------------------------------------------------

function base() { return "https://vseemax.com"; }
// The account is stored encrypted (AES-256-CBC); its key is a sealed secret that only Kino can open, so neither the repo
// nor the manifest holds the user or the password. Decrypted once per run, in memory only.
const CRED_IV = "7b6566449922fc9474fa3898f6df0801";
const CRED_BLOB = "qxwO3vSxqZtUyQ1qFxNo2WQF/VPZkrDh9wbVrKCiGSE=";
let account = null;
function creds() {
  if (!account) {
    const [u, p] = kino.crypto.decrypt("aes-256-cbc", { key: kino.secret("ck"), iv: CRED_IV, ivEncoding: "hex", data: CRED_BLOB }).split("\n");
    account = { u, p };
  }
  return account;
}
function user() { return creds().u; }
function pass() { return creds().p; }
function api() { return base() + "/player_api.php"; }

const PAGE_SIZE = 24;
const HOME_VOD_CATS = 6;
const HOME_SER_CATS = 4;
const HOME_ROW_ITEMS = 20;
const CACHE_CATS_MS = 4 * 60 * 60 * 1000;

const TEXTS = {
  es: {
    movies: "Películas", series: "Series", heroMovies: "Estrenos y clásicos en HD.", heroSeries: "Series completas, temporada a temporada.",
    account: "Cuenta", accountOk: "Activa", accountBad: "No activa", noExpiry: "sin vencimiento", expires: "vence", connections: "conexiones",
    probeOk: "Conexión correcta.", probeFail: "No se pudo conectar con el servidor.", cacheCleared: "Caché vaciada.",
  },
  en: {
    movies: "Movies", series: "Series", heroMovies: "New releases and classics in HD.", heroSeries: "Full series, season by season.",
    account: "Account", accountOk: "Active", accountBad: "Not active", noExpiry: "no expiry", expires: "expires", connections: "connections",
    probeOk: "Connection OK.", probeFail: "Could not reach the server.", cacheCleared: "Cache cleared.",
  },
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

// The plugin's storage holds 256 KB in all: cache only small answers (category lists), never whole catalogs.
async function cached(key, ttlMs, fn) {
  try {
    const raw = kino.storage.get("mh:" + key);
    const e = raw ? JSON.parse(raw) : null;
    if (e && (Date.now() - e.at) < ttlMs) return e.v;
  } catch (_) {}
  const v = await fn();
  try { kino.storage.set("mh:" + key, JSON.stringify({ at: Date.now(), v }), { ttlMs }); } catch (_) {}
  return v;
}

const ADULT = /adult|xxx|porn|erotic|18\+/i;
const safeCats = (cats) => arr(cats).filter((c) => !ADULT.test(String(c.category_name || "")));
const arr = (x) => (Array.isArray(x) ? x : []);
const text = (x, max) => String(x == null ? "" : x).trim().slice(0, max || 1000);
const listOf = (s) => text(s, 300).split(",").map((g) => g.trim()).filter(Boolean).slice(0, 6);
const yearOf = (...c) => { for (const v of c) { const m = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(String(v || "")); if (m) return m[1]; } return undefined; };
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
const tmdbOf = (v) => { const n = parseInt(v, 10); return n > 0 ? n : undefined; };
const imdbOf = (v) => (/^tt\d{5,10}$/.test(String(v || "")) ? String(v) : undefined);
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === "") delete o[k]; return o; };

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
  const p = { action: "get_vod_streams" };
  if (categoryId) p.category_id = categoryId;
  return getJson(apiUrl(p), 25000);
}
async function seriesList(categoryId) {
  const p = { action: "get_series" };
  if (categoryId) p.category_id = categoryId;
  return getJson(apiUrl(p), 25000);
}
const vodInfo = (id) => getJson(apiUrl({ action: "get_vod_info", vod_id: String(id) }));
const seriesInfo = (id) => getJson(apiUrl({ action: "get_series_info", series_id: String(id) }));

// ---- 4. item mappers -------------------------------------------------------------------------------------------

function vodToItem(v) {
  const tmdb = tmdbOf(v.tmdb);
  return clean({
    id: "vod-" + v.stream_id,
    ref: "m:" + v.stream_id + ":" + (v.container_extension || "mp4"),
    title: text(v.name, 200),
    kind: "movie",
    poster: v.stream_icon || undefined,
    rating: num(v.rating),
    year: yearOf(v.name),
    ids: tmdb ? { tmdb } : undefined,
  });
}

function seriesToItem(s) {
  const tmdb = tmdbOf(s.tmdb);
  const backdrop = Array.isArray(s.backdrop_path) ? s.backdrop_path[0] : undefined;
  return clean({
    id: "ser-" + s.series_id,
    ref: "s:" + s.series_id,
    title: text(s.name, 200),
    kind: "series",
    poster: s.cover || undefined,
    backdrop: backdrop || undefined,
    overview: text(s.plot, 600) || undefined,
    genres: s.genre ? listOf(s.genre) : undefined,
    rating: num(s.rating),
    year: yearOf(s.releaseDate, s.release_date, s.name),
    ids: tmdb ? { tmdb } : undefined,
  });
}

// ---- 5. home / section -----------------------------------------------------------------------------------------

async function rowsFor(kind) {
  const isVod = kind === "vod";
  const cats = safeCats(await (isVod ? vodCategories() : seriesCategories()).catch((e) => { kino.log(kind + " cats: " + (e && e.message)); return []; }))
    .slice(0, isVod ? HOME_VOD_CATS : HOME_SER_CATS);
  const rows = await Promise.all(cats.map(async (cat) => {
    try {
      const list = arr(await (isVod ? vodStreams(cat.category_id) : seriesList(cat.category_id)));
      const items = list.slice(0, HOME_ROW_ITEMS).map(isVod ? vodToItem : seriesToItem);
      if (!items.length) return null;
      return { id: (isVod ? "vod-" : "ser-") + cat.category_id, title: text(cat.category_name, 60), items, ref: "cat:" + (isVod ? "vod:" : "series:") + cat.category_id, genre: isVod ? "peliculas" : "series" };
    } catch (e) { kino.log("home " + kind + " " + cat.category_id + ": " + (e && e.message)); return null; }
  }));
  return rows.filter(Boolean);
}

export async function home() {
  const [v, s] = await Promise.all([rowsFor("vod"), rowsFor("series")]);
  return v.concat(s);
}

export async function section({ tab }) {
  const tabs = [{ id: "movies", label: t("movies") }, { id: "series", label: t("series") }];
  const chosen = tab === "series" ? "series" : "movies";
  const rows = await rowsFor(chosen === "series" ? "series" : "vod");
  const answer = { tabs, tab: chosen, rows };
  const pool = rows.length ? rows[0].items : [];
  if (pool.length) {
    const pick = pool[Math.floor(Date.now() / 86400000) % pool.length];
    answer.hero = { title: pick.title, text: t(chosen === "series" ? "heroSeries" : "heroMovies") };
    const img = pick.backdrop || pick.poster;
    if (img) answer.hero.image = img;
  }
  return answer;
}

// ---- 6. browse -------------------------------------------------------------------------------------------------

export async function browse(ref, cursor) {
  const offset = cursor ? parseInt(cursor, 10) : 0;
  const m = /^cat:(vod|series):(.+)$/.exec(String(ref || ""));
  if (!m) return { items: [] };
  const isVod = m[1] === "vod";
  const all = arr(isVod ? await vodStreams(m[2]) : await seriesList(m[2]));
  const page = all.slice(offset, offset + PAGE_SIZE).map(isVod ? vodToItem : seriesToItem);
  const next = offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : undefined;
  return { items: page, next };
}

// ---- 7. search -------------------------------------------------------------------------------------------------
// The server has no search call and the whole catalog is over the 5 MB response cap, so search walks the categories
// (about 52 requests, under the 60 per call).

export async function search(query) {
  const q = String(query.q || "").toLowerCase().trim();
  if (!q) return [];
  const within = query.within ? /^cat:(vod|series):(.+)$/.exec(String(query.within)) : null;
  if (query.within && !within) return null;
  const jobs = [];
  if (!within || within[1] === "vod") {
    const cats = within ? [{ category_id: within[2] }] : await vodCategories().catch(() => []);
    for (const c of (within ? arr(cats) : safeCats(cats))) jobs.push({ vod: true, id: c.category_id });
  }
  if (!within || within[1] === "series") {
    const cats = within ? [{ category_id: within[2] }] : await seriesCategories().catch(() => []);
    for (const c of (within ? arr(cats) : safeCats(cats))) jobs.push({ vod: false, id: c.category_id });
  }
  const vs = [], ss = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const list = await (j.vod ? vodStreams(j.id) : seriesList(j.id));
        for (const it of arr(list)) {
          if (!String(it.name || "").toLowerCase().includes(q)) continue;
          (j.vod ? vs : ss).push(j.vod ? vodToItem(it) : seriesToItem(it));
        }
      } catch (e) { kino.log("search " + (j.vod ? "vod " : "series ") + j.id + ": " + (e && e.message)); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  const out = [];
  const max = Math.max(vs.length, ss.length);
  for (let i = 0; i < max && out.length < 60; i++) { if (vs[i]) out.push(vs[i]); if (ss[i]) out.push(ss[i]); }
  return out;
}

// ---- 8. categories ---------------------------------------------------------------------------------------------

export async function categories() {
  const [v, s] = await Promise.all([vodCategories().catch(() => []), seriesCategories().catch(() => [])]);
  const tile = (kind, c) => ({ id: kind + "-" + c.category_id, title: text(c.category_name, 40), ref: "cat:" + kind + ":" + c.category_id });
  return safeCats(v).slice(0, 12).map((c) => tile("vod", c)).concat(safeCats(s).slice(0, 12).map((c) => tile("series", c)));
}

// ---- 9. episodes / details -------------------------------------------------------------------------------------

function qualityLine(info) {
  const bits = [];
  const w = parseInt(info.video && (info.video.width || info.video.coded_width), 10);
  const h = parseInt(info.video && (info.video.height || info.video.coded_height), 10);
  if (w || h) bits.push(w >= 3000 || h >= 2000 ? "4K" : w >= 1800 || h >= 1000 ? "1080p" : w >= 1200 || h >= 700 ? "720p" : "SD");
  if (info.video && info.video.codec_name) bits.push(String(info.video.codec_name).toUpperCase());
  if (info.audio && info.audio.codec_name) {
    const ch = info.audio.channels;
    bits.push(String(info.audio.codec_name).toUpperCase() + (ch ? " " + (ch > 2 ? ch - 1 + ".1" : ch + ".0") : ""));
  }
  return bits.join(" · ");
}

function seriesMeta(info) {
  const backdrop = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : undefined;
  const tmdb = tmdbOf(info.tmdb || info.tmdb_id);
  return clean({
    title: text(info.name, 200) || undefined,
    poster: info.cover || undefined,
    backdrop: backdrop || undefined,
    overview: text(info.plot, 1500) || undefined,
    genres: info.genre ? listOf(info.genre) : undefined,
    rating: num(info.rating),
    year: yearOf(info.releaseDate, info.release_date),
    ids: tmdb ? { tmdb } : undefined,
  });
}

export async function episodes(ref) {
  const m = /^s:(.+)$/.exec(String(ref || ""));
  if (!m) return { episodes: [] };
  const data = await seriesInfo(m[1]);
  const epsObj = (data && typeof data.episodes === "object" && data.episodes) ? data.episodes : {};
  const eps = [];
  for (const [seasonKey, list] of Object.entries(epsObj)) {
    if (!Array.isArray(list)) continue;
    const seasonNum = parseInt(seasonKey, 10);
    for (const ep of list) {
      const number = parseInt(ep.episode_num, 10);
      if (!ep.id || isNaN(number)) continue;
      const info = ep.info || {};
      const secs = num(info.duration_secs);
      eps.push(clean({
        season: parseInt(ep.season, 10) || seasonNum || 1,
        number,
        ref: "e:" + ep.id + ":" + (ep.container_extension || "mp4"),
        title: text(ep.title, 200) || undefined,
        still: info.movie_image || undefined,
        overview: text(info.plot, 600) || undefined,
        airDate: /^\d{4}-\d{2}-\d{2}$/.test(String(info.releasedate || "")) ? info.releasedate : undefined,
        runtimeMinutes: secs ? Math.max(1, Math.round(secs / 60)) : undefined,
      }));
    }
  }
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  return { series: seriesMeta((data && data.info) || {}), episodes: eps };
}

export async function details(ref) {
  const movie = /^m:(\d+):/.exec(String(ref || ""));
  if (movie) {
    const data = await vodInfo(movie[1]);
    const info = (data && data.info) || {};
    const q = qualityLine(info);
    const plot = text(info.plot || info.description, 1400);
    const cast = text(info.actors || info.cast, 200);
    const extra = [info.director ? "Dir: " + text(info.director, 80) : "", cast ? "Cast: " + cast : "", q].filter(Boolean).join("\n");
    const tmdb = tmdbOf(info.tmdb_id);
    const secs = num(info.duration_secs);
    return clean({
      title: text(info.name, 200) || undefined,
      poster: info.movie_image || info.cover_big || undefined,
      backdrop: Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : undefined,
      overview: [plot, extra].filter(Boolean).join("\n\n").slice(0, 1900) || undefined,
      genres: info.genre ? listOf(info.genre) : undefined,
      year: yearOf(info.releasedate, info.name),
      rating: num(info.rating),
      runtimeMinutes: secs ? Math.round(secs / 60) : num(info.episode_run_time),
      ids: tmdb ? { tmdb } : undefined,
    });
  }
  const ser = /^s:(.+)$/.exec(String(ref || ""));
  if (ser) return seriesMeta(((await seriesInfo(ser[1])) || {}).info || {});
  return null;
}

// ---- 10. resolve -----------------------------------------------------------------------------------------------
// The stream is one file per title (the server offers a single quality); embedded audio and subtitle tracks are
// listed by the player from the container itself.

export async function resolve(ref) {
  const movie = /^m:(\d+):([a-zA-Z0-9]+)$/.exec(String(ref || ""));
  if (movie) return { url: base() + "/movie/" + encodeURIComponent(user()) + "/" + encodeURIComponent(pass()) + "/" + movie[1] + "." + movie[2] };

  const ep = /^e:(\d+):([a-zA-Z0-9]+)$/.exec(String(ref || ""));
  if (ep) return { url: base() + "/series/" + encodeURIComponent(user()) + "/" + encodeURIComponent(pass()) + "/" + ep[1] + "." + ep[2] };

  const live = /^l:(\d+)$/.exec(String(ref || ""));
  if (live) return { url: base() + "/live/" + encodeURIComponent(user()) + "/" + encodeURIComponent(pass()) + "/" + live[1] + ".m3u8", mime: "application/x-mpegURL" };

  throw kino.error("not_found", "unknown ref");
}

// ---- 11. live TV -----------------------------------------------------------------------------------------------

const LIVE_PAGE = 50;
const GUIDE_MAX_CHANNELS = 40;

function liveGenre(name) {
  const n = String(name).toLowerCase();
  if (/sport|ufc|wwe|fight/.test(n)) return "deportes";
  if (/kid|toddler|cartoon/.test(n)) return "infantil";
  if (/movie|netflix|syfy|action|classic/.test(n)) return "peliculas";
  if (/music/.test(n)) return "musica";
  if (/document/.test(n)) return "documentales";
  if (/anime/.test(n)) return "anime";
  if (/news/.test(n)) return "noticias";
  return "entretenimiento";
}

const liveCats = () => cached("live-cats", CACHE_CATS_MS, () => getJson(apiUrl({ action: "get_live_categories" })));

function liveToChannel(s) {
  const number = parseInt(s.num, 10);
  return clean({
    id: "live-" + s.stream_id,
    title: text(s.name, 120),
    ref: "l:" + s.stream_id,
    categoryId: s.category_id ? String(s.category_id) : undefined,
    logo: s.stream_icon || undefined,
    number: number >= 1 && number <= 9999 ? number : undefined,
  });
}

export async function liveCategories() {
  return safeCats(await liveCats()).map((c) => ({ id: String(c.category_id), title: text(c.category_name, 60), genre: liveGenre(c.category_name) }));
}

export async function liveChannels({ categoryId, cursor }) {
  const offset = cursor ? parseInt(cursor, 10) : 0;
  const list = arr(await getJson(apiUrl({ action: "get_live_streams", category_id: categoryId }), 25000));
  const items = list.slice(offset, offset + LIVE_PAGE).map(liveToChannel);
  return { items, next: offset + LIVE_PAGE < list.length ? String(offset + LIVE_PAGE) : null };
}

export async function liveSearch({ query }) {
  const q = String(query || "").toLowerCase().trim();
  if (q.length < 2) return [];
  const [cats, all] = await Promise.all([liveCats().catch(() => []), getJson(apiUrl({ action: "get_live_streams" }), 25000)]);
  const allowed = new Set(safeCats(cats).map((c) => String(c.category_id)));
  return arr(all).filter((s) => allowed.has(String(s.category_id)) && String(s.name || "").toLowerCase().includes(q)).slice(0, 50).map(liveToChannel);
}

function b64text(s) {
  try {
    const bin = atob(String(s || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) { return String(s || ""); }
}

export async function guide({ channelIds, from, to }) {
  const ids = arr(channelIds).map((c) => /^live-(\d+)$/.exec(String(c))).filter(Boolean).slice(0, GUIDE_MAX_CHANNELS);
  const out = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const m = ids[next++];
      try {
        const data = await getJson(apiUrl({ action: "get_short_epg", stream_id: m[1], limit: 12 }));
        for (const e of arr(data && data.epg_listings)) {
          const start = parseInt(e.start_timestamp, 10) * 1000, end = parseInt(e.stop_timestamp, 10) * 1000;
          if (!(start > 0 && end > start) || end < from || start > to) continue;
          out.push(clean({ channelId: "live-" + m[1], title: text(b64text(e.title), 200) || "-", start, end, description: text(b64text(e.description), 600) || undefined }));
        }
      } catch (e) { kino.log("guide " + m[1] + ": " + (e && e.message)); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

// ---- 12. settings ----------------------------------------------------------------------------------------------

async function accountLine() {
  const data = await getJson(apiUrl({}));
  const u = (data && data.user_info) || {};
  const ok = String(u.status || "") === "Active";
  const exp = u.exp_date ? new Date(parseInt(u.exp_date, 10) * 1000).toISOString().slice(0, 10) : t("noExpiry");
  const line = (ok ? t("accountOk") : t("accountBad")) + " · " + t("expires") + ": " + exp + " · " + t("connections") + ": " + text(u.active_cons, 6) + "/" + text(u.max_connections, 6);
  return { ok, line };
}

export async function settingsStatus() {
  try { return { account: (await accountLine()).line.slice(0, 200) }; }
  catch (e) { return { account: t("probeFail") }; }
}

export async function action(key) {
  if (key === "probe") {
    try { const a = await accountLine(); return { message: a.ok ? t("probeOk") : t("accountBad") }; }
    catch (e) { kino.log("probe: " + (e && e.message)); return { message: t("probeFail") }; }
  }
  if (key === "clearCache") {
    for (const k of kino.storage.keys()) if (k.startsWith("mh:")) kino.storage.remove(k);
    return { message: t("cacheCleared") };
  }
  return null;
}
