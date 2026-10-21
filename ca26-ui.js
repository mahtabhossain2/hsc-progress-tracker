/*!
 * ca26-ui.js — CA26 gallery view + "Edit Report" manager for the Study Planner.
 * Requires: window.supabase (supabase-js UMD), window.CA26Core (ca26-core.js), ca26.css.
 *
 * Public API (called from index.html):
 *   CA26UI.renderGallery({ container, cfg:{url,key}, onBack })
 *   CA26UI.renderEditor ({ container, cfg:{url,key}, onBack })
 *
 * SECURITY: the "is admin" checks in this file only decide what to SHOW. Real
 * enforcement is Row Level Security + Storage policies in setup_ca26.sql.
 * A separate Supabase client (own auth storage key) is used so that signing in
 * as admin never changes the role used by the rest of the app.
 */
(function () {
  'use strict';
  var Core = window.CA26Core;
  var esc = Core.escapeHtml;

  var STATIC = {
    title: 'Some Unforgettable Memories', brandName: 'THE ARCHIVE', brandSub: 'A collection of memories',
    datePill: '16/10/2026', photoBadge: '✦ MEMORY SNAPSHOT', galleryTitle: 'The Gallery',
    commentsTitle: 'Comments &amp; Quotes', bottomNote: 'A LITTLE NOSTALGIA · <span>16/10/2026</span>', autoplayMs: 4000
  };

  var S = { client: null, clientKey: '', gallery: null, token: 0, manifest: null };
  var ED = null; // editor state

  /* ------------------------------------------------------------ infrastructure */

  function getClient(cfg) {
    var id = cfg.url + '|' + cfg.key;
    if (!S.client || S.clientKey !== id) {
      S.client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ca26-admin-auth' }
      });
      S.clientKey = id;
    }
    return S.client;
  }

  function ensureFonts() {
    if (document.getElementById('ca26-fonts')) return;
    var l = document.createElement('link');
    l.id = 'ca26-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap';
    document.head.appendChild(l);
  }

  function baseUrl(rel) { return new URL(rel, document.baseURI).href; }

  async function loadManifest() {
    if (S.manifest) return S.manifest;
    var r = await fetch(baseUrl('ca26/original/manifest.json'), { cache: 'no-cache' });
    if (!r.ok) throw new Error('Could not load ca26/original/manifest.json (HTTP ' + r.status + ')');
    S.manifest = await r.json();
    return S.manifest;
  }

  async function staticData() {
    var m = await loadManifest();
    return {
      images: m.images.map(function (i) { return { url: baseUrl('ca26/original/' + i.file), caption: i.caption }; }),
      comments: m.comments
    };
  }

  /* ----------------------------------------------------------- gallery component */

  function slideHtml(c) {
    var avatar = (c.avatar_text || '').trim() || Core.initialsFor(c.author);
    var en = Core.hasBengali(c.body) ? '' : ' ca26-quote-en';
    var date = Core.formatDate(c.comment_date);
    var bottom = (c.note || date)
      ? '<div class="ca26-comment-bottom">' + (c.note ? '<span>' + esc(c.note) + '</span>' : '') +
        (date ? '<span class="ca26-date">' + esc(date) + '</span>' : '') + '</div>'
      : '';
    return '<article class="ca26-comment-slide"><div class="ca26-comment-meta"><div class="ca26-avatar">' + esc(avatar) +
      '</div><div><div class="ca26-author">' + esc(c.author) + '</div>' +
      (c.category ? '<div class="ca26-comment-type">' + esc(c.category) + '</div>' : '') +
      '</div></div><blockquote class="ca26-quote' + en + '">' + esc(c.body) + '</blockquote>' + bottom + '</article>';
  }

  function galleryHtml(data, opts) {
    var hasPhotos = data.images.length > 0, hasComments = data.comments.length > 0;
    return '<div class="ca26-root"><div class="ca26-page">' +
      '<header class="ca26-topbar"><div class="ca26-brand"><div class="ca26-brand-icon">✳</div><div><div class="ca26-brand-name">' + STATIC.brandName +
      '</div><div class="ca26-brand-sub">' + STATIC.brandSub + '</div></div></div><div class="ca26-date-pill">' + STATIC.datePill + '</div></header>' +
      '<section class="ca26-hero"><h1>' + STATIC.title + '</h1></section>' +
      '<div class="ca26-section-head"><div class="ca26-section-title">' + STATIC.galleryTitle + '</div><div class="ca26-counter" data-role="photoCount">00 / 00</div></div>' +
      '<section class="ca26-gallery-card"><div class="ca26-photo-stage" data-role="photoStage">' +
      (hasPhotos
        ? '<div class="ca26-photo-top">' + STATIC.photoBadge + '</div><img data-role="mainPhoto" alt="Memory screenshot">' +
          '<button type="button" class="ca26-photo-nav ca26-prev" data-role="prevPhoto" aria-label="Previous image">‹</button>' +
          '<button type="button" class="ca26-photo-nav ca26-next" data-role="nextPhoto" aria-label="Next image">›</button>'
        : '<div class="ca26-empty">No photos yet.</div>') +
      '</div><div class="ca26-photo-footer"><div class="ca26-photo-label" data-role="photoLabel"></div><div class="ca26-dots" data-role="photoDots"></div></div>' +
      '<div class="ca26-thumb-row" data-role="thumbnails"></div></section>' +
      '<div class="ca26-comment-head"><div class="ca26-comment-heading"><div class="ca26-comment-icon">❝</div>' + STATIC.commentsTitle +
      '</div><div class="ca26-swipe-hint">Swipe ↔</div></div>' +
      '<section class="ca26-comment-viewport" data-role="commentViewport"><div class="ca26-comment-track" data-role="commentTrack">' +
      (hasComments ? data.comments.map(slideHtml).join('') : '<div class="ca26-comment-slide"><div class="ca26-empty">No comments yet.</div></div>') +
      '</div></section>' +
      (hasComments
        ? '<div class="ca26-comment-controls"><button type="button" class="ca26-control-btn" data-role="prevComment" aria-label="Previous comment">←</button>' +
          '<button type="button" class="ca26-control-btn ca26-play" data-role="autoPlay">▶ <span>Auto slide</span></button>' +
          '<button type="button" class="ca26-control-btn" data-role="nextComment" aria-label="Next comment">→</button></div>' +
          '<div class="ca26-quote-progress"><div data-role="quoteProgress"></div></div>'
        : '') +
      '<footer class="ca26-bottom-note">' + STATIC.bottomNote + '</footer>' +
      (opts.fallbackNote ? '<div class="ca26-fallback-note">Showing the built-in copy of this page — the live version is unavailable right now.</div>' : '') +
      '</div></div>';
  }

  /** Port of the original page script. One instance per mount; no global IDs; fully cleaned up by destroy(). */
  function mountGallery(host, data, opts) {
    opts = opts || {};
    host.innerHTML = galleryHtml(data, opts);
    var root = host.querySelector('.ca26-root');
    var $ = function (r) { return root.querySelector('[data-role="' + r + '"]'); };
    var images = data.images.map(function (im, i) { return { src: im.url, label: (im.caption || '').trim() || ('Photo ' + (i + 1)) }; });
    var slides = Array.prototype.slice.call(root.querySelectorAll('.ca26-comment-slide'));
    var hasComments = data.comments.length > 0;
    var photoIndex = 0, commentIndex = 0, autoTimer = null, destroyed = false;
    var mainPhoto = $('mainPhoto'), photoCount = $('photoCount'), photoLabel = $('photoLabel'), photoDots = $('photoDots'),
      thumbnails = $('thumbnails'), commentTrack = $('commentTrack'), quoteProgress = $('quoteProgress'), autoPlayButton = $('autoPlay');
    var pad = function (n) { return String(n).padStart(2, '0'); };

    function renderPhotoControls() {
      photoDots.innerHTML = ''; thumbnails.innerHTML = '';
      images.forEach(function (item, index) {
        var dot = document.createElement('button'); dot.type = 'button';
        dot.className = 'ca26-dot' + (index === photoIndex ? ' ca26-active' : '');
        dot.setAttribute('aria-label', 'Show image ' + (index + 1)); dot.onclick = function () { showPhoto(index); };
        photoDots.appendChild(dot);
        var thumb = document.createElement('button'); thumb.type = 'button';
        thumb.className = 'ca26-thumb' + (index === photoIndex ? ' ca26-active' : '');
        thumb.setAttribute('aria-label', item.label);
        var image = document.createElement('img'); image.src = item.src; image.alt = item.label; image.loading = 'lazy';
        thumb.appendChild(image); thumb.onclick = function () { showPhoto(index); };
        thumbnails.appendChild(thumb);
      });
    }
    function showPhoto(index) {
      if (!images.length) return;
      photoIndex = (index + images.length) % images.length;
      var item = images[photoIndex];
      if (mainPhoto.getAttribute('src') !== item.src) {
        mainPhoto.style.opacity = '.25';
        mainPhoto.onload = mainPhoto.onerror = function () { mainPhoto.style.opacity = '1'; };
        mainPhoto.src = item.src;
      }
      mainPhoto.alt = item.label;
      photoCount.textContent = pad(photoIndex + 1) + ' / ' + pad(images.length);
      photoLabel.textContent = item.label;
      renderPhotoControls();
    }
    function showComment(index) {
      if (!hasComments) return;
      commentIndex = (index + slides.length) % slides.length;
      commentTrack.style.transform = 'translateX(-' + (commentIndex * 100) + '%)';
      quoteProgress.style.width = (((commentIndex + 1) / slides.length) * 100) + '%';
    }
    function stopAutoSlide() {
      clearInterval(autoTimer); autoTimer = null;
      if (autoPlayButton) { autoPlayButton.classList.remove('ca26-playing'); autoPlayButton.innerHTML = '▶ <span>Auto slide</span>'; }
    }
    function startAutoSlide() {
      stopAutoSlide();
      if (autoPlayButton) { autoPlayButton.classList.add('ca26-playing'); autoPlayButton.innerHTML = 'Ⅱ <span>Pause slides</span>'; }
      autoTimer = setInterval(function () {
        if (!root.isConnected) { destroy(); return; }       // safety net if the view was replaced
        showPhoto(photoIndex + 1); showComment(commentIndex + 1);
      }, STATIC.autoplayMs);
    }
    function addSwipe(el, onLeft, onRight) {
      if (!el) return;
      var startX = 0, startY = 0;
      el.addEventListener('touchstart', function (e) { startX = e.changedTouches[0].clientX; startY = e.changedTouches[0].clientY; }, { passive: true });
      el.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { dx < 0 ? onLeft() : onRight(); }
      }, { passive: true });
    }
    function onKey(e) {
      if (destroyed || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { showPhoto(photoIndex + 1); showComment(commentIndex + 1); }
      if (e.key === 'ArrowLeft') { showPhoto(photoIndex - 1); showComment(commentIndex - 1); }
    }
    function destroy() {
      destroyed = true; clearInterval(autoTimer); autoTimer = null;
      document.removeEventListener('keydown', onKey);
    }

    if (images.length) {
      $('prevPhoto').onclick = function () { showPhoto(photoIndex - 1); };
      $('nextPhoto').onclick = function () { showPhoto(photoIndex + 1); };
      addSwipe($('photoStage'), function () { showPhoto(photoIndex + 1); }, function () { showPhoto(photoIndex - 1); });
      showPhoto(0);
    } else { photoCount.textContent = '00 / 00'; }
    if (hasComments) {
      $('prevComment').onclick = function () { showComment(commentIndex - 1); };
      $('nextComment').onclick = function () { showComment(commentIndex + 1); };
      autoPlayButton.onclick = function () { autoTimer ? stopAutoSlide() : startAutoSlide(); };
      addSwipe($('commentViewport'), function () { showComment(commentIndex + 1); }, function () { showComment(commentIndex - 1); });
      showComment(0);
    }
    document.addEventListener('keydown', onKey);
    if (opts.autoplay !== false && hasComments && (images.length > 1 || slides.length > 1)) startAutoSlide();

    return {
      destroy: destroy,
      state: function () { return { photoIndex: photoIndex, commentIndex: commentIndex, playing: !!autoTimer }; }
    };
  }

  /* ---------------------------------------------------------------- gallery view */

  function destroyGallery() {
    if (S.gallery) { S.gallery.destroy(); S.gallery = null; }
    document.body.classList.remove('ca26-bg');
  }

  async function renderGallery(o) {
    destroyGallery(); destroyEditor();
    var token = ++S.token, host = o.container;
    host.innerHTML = '<div class="ca26-viewbar"><button type="button" class="btn btn-outline btn-sm" data-ca26-back>' + esc(o.backLabel || '← Reports') +
      '</button></div><div class="ca26-stagehost"><div class="ca26-loading">Loading…</div></div>';
    host.querySelector('[data-ca26-back]').onclick = o.onBack;
    document.body.classList.add('ca26-bg');
    ensureFonts();
    var stage = host.querySelector('.ca26-stagehost'), data, fallback = false;
    try {
      data = await Core.loadContent(getClient(o.cfg));
    } catch (e) {
      // Live content unavailable (tables not created yet, network down…): show the built-in copy so the page never breaks.
      fallback = true;
      try { data = await staticData(); }
      catch (e2) {
        if (token === S.token) stage.innerHTML = '<div class="error-box"><h4>Could not load CA26</h4><p>' + esc(Core.describeError(e)) + '</p></div>';
        return;
      }
    }
    if (token !== S.token) return;
    S.gallery = mountGallery(stage, data, { autoplay: true, fallbackNote: fallback });
  }

  /* ----------------------------------------------------------------- editor view */

  function destroyEditor() {
    if (!ED) return;
    if (ED.preview) ED.preview.destroy();
    ED.staged.forEach(function (s) { try { URL.revokeObjectURL(s.url); } catch (_) {} });
    window.removeEventListener('beforeunload', ED.beforeUnload);
    ED = null;
  }

  function pending() { return !!(ED && (ED.staged.length || ED.form || ED.editingImage)); }

  function setMsg(type, text, items) {
    var m = { type: type, text: text, items: items || null };
    ED.msg = m;
    if (type === 'ok') setTimeout(function () {
      if (ED && ED.msg === m) { ED.msg = null; var n = ED.root.querySelector('[data-ca26-msg]'); if (n) n.remove(); }
    }, 6000);
  }

  async function refreshAuth() {
    try { ED.auth = await Core.getAdminStatus(ED.client); }
    catch (e) { ED.auth = { signedIn: false, isAdmin: false, error: e }; }
  }

  async function reloadContent() {
    try { ED.content = await Core.loadContent(ED.client); ED.loadError = null; }
    catch (e) { ED.content = null; ED.loadError = Core.describeError(e); }
  }

  async function run(fn) {
    if (!ED || ED.busy) return;
    var mine = ED; ED.busy = true; render();
    try { await fn(); } catch (e) { if (ED === mine) setMsg('err', Core.describeError(e)); }
    if (ED === mine) { ED.busy = false; render(); }
  }

  async function renderEditor(o) {
    destroyGallery(); destroyEditor();
    var token = ++S.token;
    ensureFonts();
    var root = document.createElement('div'); root.className = 'ca26e';
    o.container.innerHTML = ''; o.container.appendChild(root);
    ED = {
      root: root, client: getClient(o.cfg), onBack: o.onBack, tab: 'photos', auth: null, content: null, loadError: null,
      staged: [], rejected: [], progress: null, editingImage: null, captionDraft: '', form: null, formErrors: {}, msg: null,
      busy: false, importResult: null, verifyResult: null, preview: null
    };
    ED.beforeUnload = function (e) { if (pending()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', ED.beforeUnload);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('dragover', function (e) { if (e.target.closest && e.target.closest('[data-ca26-drop]')) e.preventDefault(); });
    root.addEventListener('drop', onDrop);
    render();
    var mine = ED;
    await refreshAuth();
    if (ED !== mine || token !== S.token) return;
    if (ED.auth.isAdmin) await reloadContent();
    if (ED === mine) render();
  }

  /* ---- rendering ---- */

  function render() {
    if (!ED) return;
    if (ED.preview) { ED.preview.destroy(); ED.preview = null; }
    var h = '<div class="page-head"><div><h1>Edit Report — CA26</h1><div class="page-sub">Manage the photos and comments shown in the CA26 gallery</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn btn-outline btn-sm" data-ca26-action="open-gallery">View gallery</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="back">← Editor</button></div></div>';
    h += msgHtml();
    if (!ED.auth) h += '<div class="state-box"><div class="spinner"></div><h3>Checking sign-in…</h3></div>';
    else if (!ED.auth.signedIn) h += signInHtml();
    else if (!ED.auth.isAdmin) h += notAdminHtml();
    else h += managerHtml();
    ED.root.innerHTML = h;
    if (ED.auth && ED.auth.isAdmin && ED.tab === 'preview' && ED.content) {
      ED.preview = mountGallery(ED.root.querySelector('[data-ca26-previewhost]'), ED.content, { autoplay: false });
    }
  }

  function msgHtml() {
    if (!ED.msg) return '';
    return '<div class="ca26e-notice ' + ED.msg.type + '" role="' + (ED.msg.type === 'err' ? 'alert' : 'status') + '" data-ca26-msg>' + esc(ED.msg.text) +
      (ED.msg.items ? '<ul>' + ED.msg.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  function signInHtml() {
    return '<div class="card" style="max-width:420px;"><h3 style="font-size:15px;margin-bottom:4px;">Admin sign-in</h3>' +
      '<p class="small muted" style="margin:0 0 12px;">The gallery is public to view. Changing it requires the CA26 admin account (set up in Supabase).</p>' +
      (ED.auth.error ? '<div class="ca26e-notice err">' + esc(Core.describeError(ED.auth.error)) + '</div>' : '') +
      '<form data-ca26-form="signin" novalidate><label class="field-label" for="ca26-email">Email</label>' +
      '<input type="email" id="ca26-email" autocomplete="username" required' + (ED.busy ? ' disabled' : '') + '>' +
      '<label class="field-label" for="ca26-password">Password</label>' +
      '<input type="password" id="ca26-password" autocomplete="current-password" required' + (ED.busy ? ' disabled' : '') + '>' +
      '<div class="modal-actions"><button type="submit" class="btn btn-primary"' + (ED.busy ? ' disabled' : '') + '>' + (ED.busy ? 'Signing in…' : 'Sign in') + '</button></div></form></div>';
  }

  function notAdminHtml() {
    return '<div class="card" style="max-width:520px;"><h3 style="font-size:15px;margin-bottom:6px;">Signed in, but not authorised</h3>' +
      '<p class="small" style="margin:0 0 10px;"><b>' + esc(ED.auth.email || '') + '</b> is not listed as a CA26 admin, so editing is disabled. ' +
      'Ask the project owner to add this account to <code>ca26_admins</code> (see README).</p>' +
      (ED.auth.error ? '<div class="ca26e-notice err">' + esc(Core.describeError(ED.auth.error)) + '</div>' : '') +
      '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="signout">Sign out</button></div>';
  }

  function managerHtml() {
    var c = ED.content, nImg = c ? c.images.length : 0, nCom = c ? c.comments.length : 0;
    var tabs = [['photos', 'Photos (' + nImg + ')'], ['comments', 'Comments (' + nCom + ')'], ['preview', 'Preview'], ['import', 'Import original']];
    var h = '<div class="flex-between" style="margin-bottom:12px;flex-wrap:wrap;"><div class="chip-row">' +
      tabs.map(function (t) { return '<button type="button" class="chip' + (ED.tab === t[0] ? ' active' : '') + '" data-ca26-action="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') +
      '</div><div class="small muted">' + esc(ED.auth.email || '') + ' · <button type="button" class="ca26e-link" data-ca26-action="signout">Sign out</button></div></div>';
    if (ED.loadError) return h + '<div class="error-box"><h4>Could not load CA26 content</h4><p>' + esc(ED.loadError) + '</p></div>';
    if (!c) return h + '<div class="state-box"><div class="spinner"></div></div>';
    if (ED.tab === 'photos') return h + photosHtml();
    if (ED.tab === 'comments') return h + commentsHtml();
    if (ED.tab === 'preview') return h + '<div class="ca26e-previewframe"><div data-ca26-previewhost></div></div>';
    return h + importHtml();
  }

  function photosHtml() {
    var dis = ED.busy ? ' disabled' : '';
    var h = '<div class="card" style="margin-bottom:14px;"><h3 style="font-size:14px;margin-bottom:10px;">Add photos</h3>' +
      '<label class="ca26e-drop" data-ca26-drop><input type="file" multiple accept="' + Core.ALLOWED_MIME.join(',') + '" data-ca26-input="files"' + dis + '>' +
      '<b>Choose photos</b><span> or drop them here</span><span class="small muted">JPG, PNG, WebP or GIF · up to ' + Core.formatBytes(Core.LIMITS.maxFileBytes) + ' each · up to ' + Core.LIMITS.maxFilesPerBatch + ' at a time</span></label>';
    if (ED.rejected.length) h += '<div class="ca26e-notice err" role="alert">Some files were not added:<ul>' + ED.rejected.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
    if (ED.staged.length) {
      h += '<div style="margin-top:12px;">' + ED.staged.map(function (s, i) {
        var st = ED.progress && ED.progress[i] ? ED.progress[i] : null;
        var status = s.error ? '<div class="small" style="color:var(--red)">' + esc(s.error) + '</div>'
          : st && st.status === 'uploading' ? '<div class="small muted">Uploading…</div>'
          : st && st.status === 'done' ? '<div class="small" style="color:var(--green)">✓ Uploaded</div>' : '';
        return '<div class="ca26e-row"><img class="ca26e-thumb" src="' + esc(s.url) + '" alt="Preview of ' + esc(s.file.name) + '"><div class="ca26e-grow">' +
          '<div class="small"><b>' + esc(s.file.name) + '</b> · ' + Core.formatBytes(s.file.size) + '</div>' +
          '<input type="text" maxlength="' + Core.LIMITS.caption + '" placeholder="Caption (optional)" value="' + esc(s.caption) + '" data-ca26-input="stage-caption" data-key="' + esc(s.key) + '" aria-label="Caption for ' + esc(s.file.name) + '"' + dis + '>' +
          status + '</div><div class="ca26e-actions"><button type="button" class="btn btn-outline btn-sm" data-ca26-action="stage-remove" data-key="' + esc(s.key) + '"' + dis + '>Remove</button></div></div>';
      }).join('') + '</div>';
      if (ED.busy && ED.progress) {
        var done = ED.progress.filter(function (p) { return p && (p.status === 'done' || p.status === 'error'); }).length;
        h += '<div style="margin-top:10px;"><div class="small muted" style="margin-bottom:4px;">Uploading ' + done + ' of ' + ED.staged.length + '…</div>' +
          '<div class="progress-track blue"><i style="width:' + Math.round(done / ED.staged.length * 100) + '%"></i></div></div>';
      }
      h += '<div class="modal-actions"><button type="button" class="btn btn-outline" data-ca26-action="stage-clear"' + dis + '>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-ca26-action="stage-upload"' + dis + '>Upload ' + ED.staged.length + ' photo' + (ED.staged.length > 1 ? 's' : '') + '</button></div>';
    }
    h += '</div>';

    var imgs = ED.content.images;
    h += '<div class="card"><h3 style="font-size:14px;margin-bottom:10px;">Photos in the gallery (' + imgs.length + ')</h3>';
    if (!imgs.length) h += '<div class="state-box" style="padding:24px;"><p>No photos yet. Upload some above, or use “Import original” to restore the original five.</p></div>';
    h += imgs.map(function (im, i) {
      var editing = ED.editingImage === im.id;
      return '<div class="ca26e-row" data-id="' + esc(im.id) + '"><img class="ca26e-thumb" src="' + esc(im.url) + '" alt="" loading="lazy"><div class="ca26e-grow">' +
        (editing
          ? '<input type="text" maxlength="' + Core.LIMITS.caption + '" value="' + esc(ED.captionDraft) + '" data-ca26-input="caption-draft" aria-label="Caption"' + dis + '>' +
            '<div class="ca26e-inline"><button type="button" class="btn btn-primary btn-sm" data-ca26-action="img-save" data-id="' + esc(im.id) + '"' + dis + '>Save</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="img-cancel"' + dis + '>Cancel</button></div>'
          : '<div class="ca26e-cap">' + (im.caption ? esc(im.caption) : '<span class="muted">(no caption)</span>') + '</div>') +
        '<div class="small muted">#' + (i + 1) + (im.size_bytes ? ' · ' + Core.formatBytes(im.size_bytes) : '') + (im.source_key ? ' · original' : '') + '</div></div>' +
        '<div class="ca26e-actions">' + moveBtns('img', im.id, i, imgs.length, dis) +
        '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="img-edit" data-id="' + esc(im.id) + '"' + dis + '>Edit</button>' +
        '<button type="button" class="btn btn-outline btn-sm ca26e-danger" data-ca26-action="img-delete" data-id="' + esc(im.id) + '"' + dis + '>Delete</button></div></div>';
    }).join('');
    return h + '</div>';
  }

  function moveBtns(kind, id, i, n, dis) {
    return '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="' + kind + '-up" data-id="' + esc(id) + '" aria-label="Move up"' + (i === 0 ? ' disabled' : dis) + '>↑\uFE0E</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="' + kind + '-down" data-id="' + esc(id) + '" aria-label="Move down"' + (i === n - 1 ? ' disabled' : dis) + '>↓\uFE0E</button>';
  }

  function commentsHtml() {
    var dis = ED.busy ? ' disabled' : '', list = ED.content.comments;
    var h = '<div class="flex-between" style="margin-bottom:10px;"><h3 style="font-size:14px;">Comments &amp; quotes (' + list.length + ')</h3>' +
      (ED.form ? '' : '<button type="button" class="btn btn-primary btn-sm" data-ca26-action="cm-new"' + dis + '>+ Add comment</button>') + '</div>';
    if (ED.form) h += formHtml(dis);
    if (!list.length && !ED.form) h += '<div class="state-box"><p>No comments yet.</p></div>';
    h += list.map(function (c, i) {
      return '<div class="ca26e-row"><div class="ca26e-grow"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:3px;"><b class="small">' + esc(c.author) + '</b>' +
        (c.category ? '<span class="badge badge-blue">' + esc(c.category) + '</span>' : '') +
        (c.comment_date ? '<span class="badge badge-gray">' + esc(Core.formatDate(c.comment_date)) + '</span>' : '') +
        (c.source_key ? '<span class="badge badge-gray">original</span>' : '') + '</div>' +
        '<div class="ca26e-cap" dir="auto">' + esc(c.body.length > 140 ? c.body.slice(0, 140) + '…' : c.body) + '</div></div>' +
        '<div class="ca26e-actions">' + moveBtns('cm', c.id, i, list.length, dis) +
        '<button type="button" class="btn btn-outline btn-sm" data-ca26-action="cm-edit" data-id="' + esc(c.id) + '"' + dis + '>Edit</button>' +
        '<button type="button" class="btn btn-outline btn-sm ca26e-danger" data-ca26-action="cm-delete" data-id="' + esc(c.id) + '"' + dis + '>Delete</button></div></div>';
    }).join('');
    return h;
  }

  function formHtml(dis) {
    var f = ED.form, er = ED.formErrors || {};
    var field = function (key, label, input) {
      return '<label class="field-label" for="cf-' + key + '">' + label + '</label>' + input + (er[key] ? '<div class="small" style="color:var(--red);margin-top:3px;">' + esc(er[key]) + '</div>' : '');
    };
    var cats = Array.from(new Set(ED.content.comments.map(function (c) { return c.category; }).filter(Boolean)));
    return '<div class="card" style="margin-bottom:14px;"><h3 style="font-size:14px;margin-bottom:10px;">' + (f.id ? 'Edit comment' : 'New comment') + '</h3>' +
      '<form data-ca26-form="comment" novalidate>' +
      field('author', 'Author name *', '<input type="text" id="cf-author" maxlength="' + Core.LIMITS.author + '" value="' + esc(f.author) + '" data-ca26-input="cf" data-f="author" dir="auto"' + dis + '>') +
      field('body', 'Comment / quote * (Bengali or English)', '<textarea id="cf-body" maxlength="' + Core.LIMITS.body + '" data-ca26-input="cf" data-f="body" dir="auto" style="min-height:96px;"' + dis + '>' + esc(f.body) + '</textarea>') +
      '<div class="grid-2"><div>' + field('comment_date', 'Date (optional)', '<input type="date" id="cf-comment_date" value="' + esc(f.comment_date || '') + '" data-ca26-input="cf" data-f="comment_date"' + dis + '>') + '</div>' +
      '<div>' + field('category', 'Category / type (optional)', '<input type="text" id="cf-category" list="ca26-cats" maxlength="' + Core.LIMITS.category + '" value="' + esc(f.category) + '" data-ca26-input="cf" data-f="category"' + dis + '>' +
        '<datalist id="ca26-cats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>') + '</div></div>' +
      '<div class="grid-2"><div>' + field('avatar_text', 'Avatar initials (optional)', '<input type="text" id="cf-avatar_text" maxlength="' + Core.LIMITS.avatar + '" placeholder="auto" value="' + esc(f.avatar_text) + '" data-ca26-input="cf" data-f="avatar_text"' + dis + '>') + '</div>' +
      '<div>' + field('note', 'Footer note (optional)', '<input type="text" id="cf-note" maxlength="' + Core.LIMITS.note + '" value="' + esc(f.note) + '" data-ca26-input="cf" data-f="note" dir="auto"' + dis + '>') + '</div></div>' +
      '<div class="field-label">Preview</div><div class="ca26-root ca26e-slidepreview"><div class="ca26-comment-viewport"><div class="ca26-comment-track" data-ca26-formpreview>' + previewSlide(f) + '</div></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-outline" data-ca26-action="cm-cancel"' + dis + '>Cancel</button>' +
      '<button type="submit" class="btn btn-primary"' + dis + '>' + (f.id ? 'Save changes' : 'Add comment') + '</button></div></form></div>';
  }

  function previewSlide(f) {
    return slideHtml({ author: f.author || 'Author name', body: f.body || 'Your comment or quote appears here.', category: f.category, avatar_text: f.avatar_text, note: f.note, comment_date: f.comment_date });
  }

  function importHtml() {
    var c = ED.content, m = S.manifest;
    var nImg = c.images.filter(function (i) { return i.source_key; }).length, nCom = c.comments.filter(function (i) { return i.source_key; }).length;
    var tI = m ? m.images.length : 5, tC = m ? m.comments.length : 2, dis = ED.busy ? ' disabled' : '';
    var r = ED.importResult, v = ED.verifyResult;
    return '<div class="card"><h3 style="font-size:14px;margin-bottom:6px;">Import the original CA26 content</h3>' +
      '<p class="small muted" style="margin:0 0 10px;">Copies the original ' + tI + ' photos and ' + tC + ' comments (shipped in <code>ca26/original/</code>) into Supabase. ' +
      '<b>Safe to run repeatedly:</b> it only adds items that are missing, never creates duplicates and never overwrites your edits. ' +
      'If you deleted an original on purpose, running this again will restore it.</p>' +
      '<div class="chip-row" style="margin-bottom:12px;"><span class="badge ' + (nImg >= tI ? 'badge-green' : 'badge-orange') + '">Original photos: ' + nImg + ' / ' + tI + '</span>' +
      '<span class="badge ' + (nCom >= tC ? 'badge-green' : 'badge-orange') + '">Original comments: ' + nCom + ' / ' + tC + '</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn btn-primary" data-ca26-action="import-run"' + dis + '>' + (ED.busy ? 'Working…' : 'Import original content') + '</button>' +
      '<button type="button" class="btn btn-outline" data-ca26-action="import-verify"' + dis + '>Verify original photos</button></div>' +
      (r ? '<div class="ca26e-notice ' + (r.errors.length ? 'err' : 'ok') + '" style="margin-top:12px;">Photos: ' + r.images.added + ' added, ' + r.images.skipped + ' already present, ' + r.images.failed + ' failed. ' +
        'Comments: ' + r.comments.added + ' added, ' + r.comments.skipped + ' already present, ' + r.comments.failed + ' failed.' +
        (r.errors.length ? '<ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') + '</div>' : '') +
      (v ? '<div class="ca26e-notice ' + (v.every(function (x) { return x.ok; }) ? 'ok' : 'err') + '" style="margin-top:12px;"><b>Verification</b> (download each original from its public URL; compare size and SHA-256 with the manifest):<ul>' +
        v.map(function (x) { return '<li>' + esc(x.file) + ': ' + (x.ok ? '✓ intact' : '✗ ' + esc(x.reason)) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }

  /* ---- events ---- */

  function addFiles(fileList) {
    var rejected = [];
    Array.prototype.slice.call(fileList).forEach(function (f) {
      var v = Core.validateImageFile(f);
      if (!v.ok) { rejected.push(v.error); return; }
      if (ED.staged.length >= Core.LIMITS.maxFilesPerBatch) { rejected.push(f.name + ': only ' + Core.LIMITS.maxFilesPerBatch + ' photos can be uploaded at a time.'); return; }
      if (ED.staged.some(function (s) { return s.file.name === f.name && s.file.size === f.size && s.file.lastModified === f.lastModified; })) { rejected.push(f.name + ': already added.'); return; }
      ED.staged.push({ key: Core.uid(), file: f, url: URL.createObjectURL(f), caption: '', error: null });
    });
    ED.rejected = rejected; ED.progress = null;
    render();
  }

  function onDrop(e) {
    if (!ED || !e.target.closest || !e.target.closest('[data-ca26-drop]')) return;
    e.preventDefault();
    if (!ED.busy && e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function onChange(e) {
    var t = e.target;
    if (t.matches && t.matches('[data-ca26-input="files"]')) { var files = t.files; addFiles(files); }
  }

  function onInput(e) {
    var t = e.target; if (!ED || !t.getAttribute) return;
    var kind = t.getAttribute('data-ca26-input');
    if (kind === 'stage-caption') { var s = ED.staged.find(function (x) { return x.key === t.getAttribute('data-key'); }); if (s) s.caption = t.value; }
    else if (kind === 'caption-draft') ED.captionDraft = t.value;
    else if (kind === 'cf' && ED.form) {
      ED.form[t.getAttribute('data-f')] = t.value;
      var pv = ED.root.querySelector('[data-ca26-formpreview]'); if (pv) pv.innerHTML = previewSlide(ED.form);
    }
  }

  function onSubmit(e) {
    var form = e.target.closest && e.target.closest('[data-ca26-form]'); if (!form || !ED) return;
    e.preventDefault();
    var which = form.getAttribute('data-ca26-form');
    if (which === 'signin') {
      var email = form.querySelector('#ca26-email').value.trim(), pw = form.querySelector('#ca26-password').value;
      if (!email || !pw) { setMsg('err', 'Enter your email and password.'); render(); return; }
      ED.msg = null;
      run(async function () {
        var r = await ED.client.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) throw r.error;
        await refreshAuth();
        if (ED.auth.isAdmin) { await reloadContent(); setMsg('ok', 'Signed in.'); }
      });
    } else if (which === 'comment') saveComment();
  }

  function saveComment() {
    var n = Core.normalizeComment(ED.form);
    ED.formErrors = n.errors;
    if (!n.ok) { setMsg('err', 'Please fix the highlighted fields.'); render(); return; }
    var id = ED.form.id;
    run(async function () {
      if (id) await Core.updateComment(ED.client, id, n.value);
      else {
        var max = ED.content.comments.reduce(function (m, c) { return Math.max(m, c.sort_order || 0); }, 0);
        await Core.createComment(ED.client, n.value, max + 1);
      }
      ED.form = null; ED.formErrors = {};
      await reloadContent();
      setMsg('ok', id ? 'Comment updated.' : 'Comment added.');
    });
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-ca26-action]');
    if (!b || !ED || b.disabled) return;
    var act = b.getAttribute('data-ca26-action'), id = b.getAttribute('data-id');
    var c = ED.content;
    switch (act) {
      case 'back':
        if (pending() && !confirm('You have unsaved changes. Leave without saving?')) return;
        return ED.onBack();
      case 'open-gallery':
        if (pending() && !confirm('You have unsaved changes. Leave without saving?')) return;
        location.hash = '#/reports/ca26'; return;
      case 'tab': ED.tab = b.getAttribute('data-tab'); ED.msg = null; if (ED.tab === 'import') { loadManifest().catch(function () {}).then(render); } return render();
      case 'signout':
        return run(async function () {
          await ED.client.auth.signOut();
          ED.staged.forEach(function (s) { try { URL.revokeObjectURL(s.url); } catch (_) {} });
          ED.staged = []; ED.form = null; ED.editingImage = null; ED.content = null;
          await refreshAuth(); setMsg('info', 'Signed out.');
        });
      case 'stage-remove': {
        var i = ED.staged.findIndex(function (s) { return s.key === b.getAttribute('data-key'); });
        if (i >= 0) { URL.revokeObjectURL(ED.staged[i].url); ED.staged.splice(i, 1); }
        ED.progress = null; return render();
      }
      case 'stage-clear':
        ED.staged.forEach(function (s) { URL.revokeObjectURL(s.url); }); ED.staged = []; ED.rejected = []; ED.progress = null; return render();
      case 'stage-upload': {
        ED.rejected = []; ED.progress = [];
        var items = ED.staged.map(function (s) { return { file: s.file, caption: s.caption }; });
        var startOrder = c.images.reduce(function (m, x) { return Math.max(m, x.sort_order || 0); }, 0);
        return run(async function () {
          var results = await Core.uploadImages(ED.client, items, { startOrder: startOrder, onProgress: function (p) { if (ED) { ED.progress[p.index] = p; render(); } } });
          var failed = [];
          ED.staged = ED.staged.filter(function (s, i) {
            if (results[i] && results[i].ok) { URL.revokeObjectURL(s.url); return false; }
            s.error = results[i] ? results[i].error : 'Not uploaded'; failed.push(s.file.name + ': ' + s.error); return true;
          });
          ED.progress = null;
          await reloadContent();
          var ok = results.filter(function (r) { return r.ok; }).length;
          if (failed.length) setMsg('err', ok + ' uploaded, ' + failed.length + ' failed (kept below so you can retry).');
          else setMsg('ok', ok + ' photo' + (ok === 1 ? '' : 's') + ' uploaded and saved.');
        });
      }
      case 'img-edit': { var im = c.images.find(function (x) { return x.id === id; }); ED.editingImage = id; ED.captionDraft = im ? im.caption : ''; return render(); }
      case 'img-cancel': ED.editingImage = null; return render();
      case 'img-save': return run(async function () {
        await Core.updateImageCaption(ED.client, id, ED.captionDraft);
        ED.editingImage = null; await reloadContent(); setMsg('ok', 'Caption saved.');
      });
      case 'img-up': case 'img-down': return moveItem('images', c.images, id, act === 'img-up' ? -1 : 1);
      case 'img-delete': {
        var del = c.images.find(function (x) { return x.id === id; });
        if (!del || !confirm('Delete this photo' + (del.caption ? ' (“' + del.caption + '”)' : '') + ' from the CA26 gallery? This cannot be undone.')) return;
        return run(async function () {
          var r = await Core.deleteImage(ED.client, del);
          await reloadContent(); setMsg(r.warning ? 'info' : 'ok', r.warning || 'Photo deleted.');
        });
      }
      case 'cm-new': ED.form = { id: null, author: '', body: '', category: '', comment_date: '', avatar_text: '', note: '' }; ED.formErrors = {}; return render();
      case 'cm-edit': {
        var cm = c.comments.find(function (x) { return x.id === id; });
        if (cm) { ED.form = { id: cm.id, author: cm.author, body: cm.body, category: cm.category || '', comment_date: cm.comment_date || '', avatar_text: cm.avatar_text || '', note: cm.note || '' }; ED.formErrors = {}; }
        return render();
      }
      case 'cm-cancel': ED.form = null; ED.formErrors = {}; return render();
      case 'cm-up': case 'cm-down': return moveItem('comments', c.comments, id, act === 'cm-up' ? -1 : 1);
      case 'cm-delete': {
        var dc = c.comments.find(function (x) { return x.id === id; });
        if (!dc || !confirm('Delete the comment by “' + dc.author + '”? This cannot be undone.')) return;
        return run(async function () { await Core.deleteComment(ED.client, id); await reloadContent(); setMsg('ok', 'Comment deleted.'); });
      }
      case 'import-run': return run(async function () {
        var manifest = await loadManifest();
        ED.importResult = await Core.importOriginals(ED.client, manifest, async function (name) {
          var r = await fetch(baseUrl('ca26/original/' + name), { cache: 'no-cache' });
          if (!r.ok) throw new Error('Could not load ' + name + ' (HTTP ' + r.status + ')');
          return await r.blob();
        });
        await reloadContent();
        var res = ED.importResult;
        setMsg(res.errors.length ? 'err' : 'ok', res.errors.length ? 'Import finished with errors.' : 'Import complete.');
      });
      case 'import-verify': return run(async function () {
        var manifest = await loadManifest();
        ED.verifyResult = await Core.verifyOriginals(ED.client, manifest, {
          fetch: function (u) { return fetch(u, { cache: 'no-store' }); },
          sha256: async function (ab) { var d = await crypto.subtle.digest('SHA-256', ab); return Array.from(new Uint8Array(d)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
        });
      });
    }
  }

  function moveItem(kind, list, id, delta) {
    var ids = list.map(function (x) { return x.id; });
    var next = Core.moveId(ids, id, delta);
    if (next.join() === ids.join()) return;
    run(async function () { await Core.reorder(ED.client, kind, next); await reloadContent(); setMsg('ok', 'Order saved.'); });
  }

  /* --------------------------------------------------------------- lifecycle */

  window.addEventListener('hashchange', function () {
    var h = location.hash;
    if (!/^#\/reports\/ca26\/?$/.test(h)) destroyGallery();
    if (!/^#\/editor\/report\/?$/.test(h)) destroyEditor();
  });

  window.CA26UI = {
    version: '1.0.0', renderGallery: renderGallery, renderEditor: renderEditor,
    cleanup: function () { destroyGallery(); destroyEditor(); },
    _mountGallery: mountGallery, _slideHtml: slideHtml
  };
})();
