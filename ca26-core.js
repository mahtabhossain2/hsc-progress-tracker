/*!
 * ca26-core.js — CA26 gallery logic that does NOT touch the DOM.
 *
 * Works in the browser (exposes window.CA26Core) and in Node (module.exports),
 * so the same code is used by the app, by import_ca26.js and by the tests.
 *
 * SECURITY NOTE: nothing in this file grants any access. Every write below is
 * enforced by Postgres Row Level Security / Storage policies defined in
 * setup_ca26.sql (admin = a row in public.ca26_admins). Client-side checks
 * here are only for friendlier error messages.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CA26Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BUCKET = 'ca26-images';
  var IMAGES_TABLE = 'ca26_images';
  var COMMENTS_TABLE = 'ca26_comments';
  var ADMINS_TABLE = 'ca26_admins';
  var RPC = { images: 'ca26_reorder_images', comments: 'ca26_reorder_comments' };

  var LIMITS = {
    maxFileBytes: 6 * 1024 * 1024,           // keep in sync with the bucket limit in setup_ca26.sql
    maxFilesPerBatch: 20,
    caption: 300, author: 120, body: 3000, category: 80, avatar: 4, note: 300
  };
  var ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

  /* ------------------------------------------------------------------ helpers */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function hasBengali(s) { return /[\u0980-\u09FF]/.test(String(s || '')); }

  function isValidIsoDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2100) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  /** "2026-10-03" -> "3/10/2026" (the original page's d/m/yyyy style). Pure string math: no timezone shifts. */
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + '/' + (+m[2]) + '/' + m[1] : '';
  }

  function initialsFor(author) {
    var words = String(author || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
    var pick = function (w) {
      var ch = Array.from(w).find(function (c) { return /[\p{L}\p{N}]/u.test(c); });
      return ch ? ch.toUpperCase() : '';
    };
    return words.slice(0, 2).map(pick).join('') || '?';
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function describeError(err) {
    if (!err) return 'Unknown error';
    var msg = String(err.message || err.error_description || err.error || err);
    var code = String(err.code || err.statusCode || err.status || '');
    if (code === '42501' || /row-level security|permission denied|not authorized|violates row-level/i.test(msg)) {
      return 'Not authorized. Sign in as the CA26 admin, and make sure setup_ca26.sql has been applied and your user is listed in ca26_admins. (' + msg + ')';
    }
    if (isMissingSetup(err)) {
      return 'The CA26 tables/functions were not found. Apply setup_ca26.sql in the Supabase SQL editor. (' + msg + ')';
    }
    if (/jwt expired/i.test(msg)) return 'Your session expired. Please sign in again.';
    if (/bucket not found/i.test(msg)) return 'The storage bucket "' + BUCKET + '" was not found. Apply setup_ca26.sql. (' + msg + ')';
    if (/mime type .* not supported|invalid.*mime/i.test(msg)) return 'That file type is not accepted by the storage bucket. (' + msg + ')';
    if (/exceeded the maximum allowed size|payload too large|too large/i.test(msg)) return 'That file is larger than the storage bucket allows. (' + msg + ')';
    return msg;
  }

  function isMissingSetup(err) {
    if (!err) return false;
    var msg = String(err.message || err);
    var code = String(err.code || '');
    return code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || code === '42883' ||
      /could not find the (table|function)|does not exist|schema cache/i.test(msg);
  }

  /** Supabase returns plain error objects; throw real Errors that keep code/status. */
  function toError(err) {
    if (err instanceof Error) return err;
    var e = new Error(String((err && (err.message || err.error_description)) || err || 'Unknown error'));
    if (err && typeof err === 'object') { e.code = err.code; e.status = err.status || err.statusCode; e.details = err.details; }
    return e;
  }

  /** PostgREST silently returns [] when RLS filters an UPDATE/DELETE. Treat that as a failure. */
  function expectRows(res, label) {
    if (res.error) throw toError(res.error);
    if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
      var e = new Error(label + ': nothing was changed (not authorized, or the item no longer exists).');
      e.code = 'NO_ROWS';
      throw e;
    }
    return res.data;
  }

  /* --------------------------------------------------------------- validation */

  function validateImageFile(file) {
    if (!file) return { ok: false, error: 'No file.' };
    var name = file.name || 'file';
    if (ALLOWED_MIME.indexOf(file.type) === -1) {
      return { ok: false, error: name + ': unsupported file type' + (file.type ? ' (' + file.type + ')' : '') + '. Use JPG, PNG, WebP or GIF.' };
    }
    if (!(file.size > 0)) return { ok: false, error: name + ': the file is empty.' };
    if (file.size > LIMITS.maxFileBytes) {
      return { ok: false, error: name + ': ' + formatBytes(file.size) + ' is larger than the ' + formatBytes(LIMITS.maxFileBytes) + ' limit.' };
    }
    return { ok: true };
  }

  function validateCaption(s) {
    var v = String(s == null ? '' : s).trim();
    if (v.length > LIMITS.caption) return { ok: false, error: 'Caption must be ' + LIMITS.caption + ' characters or fewer.' };
    return { ok: true, value: v };
  }

  function normalizeComment(inp) {
    var errors = {};
    var author = String(inp.author || '').trim();
    var body = String(inp.body || '').trim();
    var category = String(inp.category || '').trim();
    var avatar = String(inp.avatar_text || '').trim();
    var note = String(inp.note || '').trim();
    var date = String(inp.comment_date || '').trim();

    if (!author) errors.author = 'Author name is required.';
    else if (author.length > LIMITS.author) errors.author = 'Author must be ' + LIMITS.author + ' characters or fewer.';
    if (!body) errors.body = 'The comment/quote text is required.';
    else if (body.length > LIMITS.body) errors.body = 'Text must be ' + LIMITS.body + ' characters or fewer.';
    if (category.length > LIMITS.category) errors.category = 'Category must be ' + LIMITS.category + ' characters or fewer.';
    if (Array.from(avatar).length > LIMITS.avatar) errors.avatar_text = 'Initials must be ' + LIMITS.avatar + ' characters or fewer.';
    if (note.length > LIMITS.note) errors.note = 'Footer note must be ' + LIMITS.note + ' characters or fewer.';
    if (date && !isValidIsoDate(date)) errors.comment_date = 'Enter a valid date.';

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      value: { author: author, body: body, category: category, avatar_text: avatar, note: note, comment_date: date || null }
    };
  }

  function moveId(ids, id, delta) {
    var i = ids.indexOf(id);
    if (i < 0) return ids.slice();
    var j = Math.max(0, Math.min(ids.length - 1, i + delta));
    if (i === j) return ids.slice();
    var out = ids.slice();
    out.splice(i, 1);
    out.splice(j, 0, id);
    return out;
  }

  /* --------------------------------------------------------------- data layer */

  function publicUrl(client, path) {
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function loadContent(client) {
    var results = await Promise.all([
      client.from(IMAGES_TABLE).select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      client.from(COMMENTS_TABLE).select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
    ]);
    if (results[0].error) throw toError(results[0].error);
    if (results[1].error) throw toError(results[1].error);
    var images = results[0].data.map(function (r) { return Object.assign({}, r, { url: publicUrl(client, r.storage_path) }); });
    return { images: images, comments: results[1].data };
  }

  async function getAdminStatus(client) {
    var s = await client.auth.getSession();
    var session = s && s.data && s.data.session;
    if (s.error || !session) return { signedIn: false, isAdmin: false };
    var email = session.user && session.user.email;
    var res = await client.from(ADMINS_TABLE).select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (res.error) return { signedIn: true, email: email, isAdmin: false, error: res.error };
    return { signedIn: true, email: email, isAdmin: !!res.data };
  }

  async function uploadImages(client, items, opts) {
    opts = opts || {};
    var order = opts.startOrder || 0;
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var file = items[i].file;
      var report = function (status, extra) {
        if (opts.onProgress) opts.onProgress(Object.assign({ index: i, total: items.length, name: file && file.name, status: status }, extra || {}));
      };
      var v = validateImageFile(file);
      if (!v.ok) { results.push({ ok: false, name: file && file.name, error: v.error }); report('error', { error: v.error }); continue; }
      var cap = validateCaption(items[i].caption);
      if (!cap.ok) { results.push({ ok: false, name: file.name, error: cap.error }); report('error', { error: cap.error }); continue; }
      var path = 'uploads/' + uid() + '.' + MIME_EXT[file.type];
      report('uploading');
      try {
        var up = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
        if (up.error) throw toError(up.error);
        var ins = await client.from(IMAGES_TABLE).insert({
          storage_path: path, caption: cap.value, sort_order: ++order, mime_type: file.type, size_bytes: file.size
        }).select().single();
        if (ins.error) {
          try { await client.storage.from(BUCKET).remove([path]); } catch (_) { /* best effort: avoid orphaned file */ }
          throw toError(ins.error);
        }
        results.push({ ok: true, name: file.name, row: ins.data });
        report('done');
      } catch (e) {
        var msg = describeError(e);
        results.push({ ok: false, name: file.name, error: msg });
        report('error', { error: msg });
      }
    }
    return results;
  }

  async function updateImageCaption(client, id, caption) {
    var cap = validateCaption(caption);
    if (!cap.ok) throw new Error(cap.error);
    expectRows(await client.from(IMAGES_TABLE).update({ caption: cap.value }).eq('id', id).select(), 'Update caption');
    return cap.value;
  }

  /** Row first, file second: worst case is an unreachable orphan file, never a gallery entry with a missing file. */
  async function deleteImage(client, image) {
    expectRows(await client.from(IMAGES_TABLE).delete().eq('id', image.id).select(), 'Delete photo');
    var warning = null;
    try {
      var rm = await client.storage.from(BUCKET).remove([image.storage_path]);
      if (rm.error) warning = 'The photo was removed from the gallery, but its file could not be deleted from storage: ' + describeError(rm.error);
      else if (Array.isArray(rm.data) && rm.data.length === 0) warning = 'The photo was removed from the gallery. Storage reported no file to delete (it may already be gone).';
    } catch (e) { warning = 'The photo was removed from the gallery, but deleting its file failed: ' + describeError(e); }
    return { warning: warning };
  }

  async function createComment(client, value, sortOrder) {
    var row = Object.assign({}, value, { sort_order: sortOrder });
    var res = await client.from(COMMENTS_TABLE).insert(row).select().single();
    if (res.error) throw toError(res.error);
    return res.data;
  }

  async function updateComment(client, id, value) {
    return expectRows(await client.from(COMMENTS_TABLE).update(value).eq('id', id).select(), 'Update comment')[0];
  }

  async function deleteComment(client, id) {
    expectRows(await client.from(COMMENTS_TABLE).delete().eq('id', id).select(), 'Delete comment');
  }

  async function reorder(client, kind, orderedIds) {
    var res = await client.rpc(RPC[kind], { p_ids: orderedIds });
    if (res.error) throw toError(res.error);
  }

  /* ---------------------------------------------- original-content import */

  /**
   * Idempotent: rows are keyed by source_key (UNIQUE in the DB). Running it any
   * number of times adds only what is missing and never overwrites edits.
   * readFile(name) -> Blob | Uint8Array | Buffer   (browser: fetch, Node: fs)
   */
  async function importOriginals(client, manifest, readFile, hooks) {
    hooks = hooks || {};
    var log = hooks.onLog || function () {};
    var out = { images: { added: 0, skipped: 0, failed: 0 }, comments: { added: 0, skipped: 0, failed: 0 }, errors: [] };

    var cur = await Promise.all([
      client.from(IMAGES_TABLE).select('source_key, sort_order'),
      client.from(COMMENTS_TABLE).select('source_key, sort_order')
    ]);
    if (cur[0].error) throw toError(cur[0].error);
    if (cur[1].error) throw toError(cur[1].error);

    function plan(rows) {
      var have = new Set(rows.filter(function (r) { return r.source_key; }).map(function (r) { return r.source_key; }));
      var custom = rows.some(function (r) { return !r.source_key; });
      var max = rows.reduce(function (m, r) { return Math.max(m, r.sort_order || 0); }, 0);
      // Only originals present -> keep the original numbering; otherwise append after existing items.
      return { have: have, base: custom ? max : 0 };
    }
    var ip = plan(cur[0].data), cp = plan(cur[1].data);

    for (var i = 0; i < manifest.images.length; i++) {
      var im = manifest.images[i];
      if (ip.have.has(im.source_key)) { out.images.skipped++; log('skip image ' + im.source_key); continue; }
      try {
        var bytes = await readFile(im.file);
        var path = 'original/' + im.file;
        var up = await client.storage.from(BUCKET).upload(path, bytes, { contentType: im.mime, cacheControl: '31536000', upsert: true });
        if (up.error) throw toError(up.error);
        var ins = await client.from(IMAGES_TABLE).upsert({
          source_key: im.source_key, storage_path: path, caption: im.caption,
          sort_order: ip.base + im.sort_order, mime_type: im.mime, size_bytes: im.bytes
        }, { onConflict: 'source_key', ignoreDuplicates: true }).select();
        if (ins.error) throw toError(ins.error);
        out.images.added++; log('added image ' + im.source_key);
      } catch (e) {
        out.images.failed++; out.errors.push(im.source_key + ': ' + describeError(e));
      }
    }

    for (var k = 0; k < manifest.comments.length; k++) {
      var c = manifest.comments[k];
      if (cp.have.has(c.source_key)) { out.comments.skipped++; log('skip comment ' + c.source_key); continue; }
      try {
        var cres = await client.from(COMMENTS_TABLE).upsert({
          source_key: c.source_key, author: c.author, body: c.body, category: c.category || '',
          avatar_text: c.avatar_text || '', note: c.note || '', comment_date: c.comment_date || null,
          sort_order: cp.base + c.sort_order
        }, { onConflict: 'source_key', ignoreDuplicates: true }).select();
        if (cres.error) throw toError(cres.error);
        out.comments.added++; log('added comment ' + c.source_key);
      } catch (e2) {
        out.comments.failed++; out.errors.push(c.source_key + ': ' + describeError(e2));
      }
    }
    return out;
  }

  /** Re-downloads every original image from its public URL and compares size (+ sha256 if provided). */
  async function verifyOriginals(client, manifest, deps) {
    var report = [];
    for (var i = 0; i < manifest.images.length; i++) {
      var im = manifest.images[i];
      var url = publicUrl(client, 'original/' + im.file);
      try {
        var res = await deps.fetch(url);
        if (!res.ok) { report.push({ file: im.file, ok: false, reason: 'HTTP ' + res.status }); continue; }
        var buf = await res.arrayBuffer();
        if (buf.byteLength !== im.bytes) { report.push({ file: im.file, ok: false, reason: 'size ' + buf.byteLength + ' != ' + im.bytes }); continue; }
        if (deps.sha256) {
          var hex = await deps.sha256(buf);
          if (hex !== im.sha256) { report.push({ file: im.file, ok: false, reason: 'sha256 mismatch' }); continue; }
        }
        report.push({ file: im.file, ok: true });
      } catch (e) {
        report.push({ file: im.file, ok: false, reason: String(e.message || e) });
      }
    }
    return report;
  }

  return {
    BUCKET: BUCKET, IMAGES_TABLE: IMAGES_TABLE, COMMENTS_TABLE: COMMENTS_TABLE, ADMINS_TABLE: ADMINS_TABLE,
    LIMITS: LIMITS, ALLOWED_MIME: ALLOWED_MIME, MIME_EXT: MIME_EXT,
    escapeHtml: escapeHtml, uid: uid, hasBengali: hasBengali, isValidIsoDate: isValidIsoDate, formatDate: formatDate,
    initialsFor: initialsFor, formatBytes: formatBytes, describeError: describeError, isMissingSetup: isMissingSetup,
    expectRows: expectRows, toError: toError, validateImageFile: validateImageFile, validateCaption: validateCaption,
    normalizeComment: normalizeComment, moveId: moveId,
    publicUrl: publicUrl, loadContent: loadContent, getAdminStatus: getAdminStatus,
    uploadImages: uploadImages, updateImageCaption: updateImageCaption, deleteImage: deleteImage,
    createComment: createComment, updateComment: updateComment, deleteComment: deleteComment, reorder: reorder,
    importOriginals: importOriginals, verifyOriginals: verifyOriginals
  };
});
