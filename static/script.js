/* static/script.js
   Robust image-fixer for reports/pending pages.
   - Finds images from: server-rendered <img>, JSON script[type="application/json"][data-report-images-for],
     <a href="..."> links, plain-text tokens, or data-* attrs.
   - Injects thumbnails into .evidence-gallery (creates it if missing) without duplicating.
   - Delegated click handler opens lightbox (reuses #lightbox if present).
   - Exposes window.__image_fixer.run()
*/

(function () {
  'use strict';

  // --- config / helpers ---
  const IMG_EXT_RE = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(?:[?#].*)?$/i;
  const HTTP_IMG_TOKEN_RE = /\bhttps?:\/\/[^\s'"]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:[?#][^\s'"]*)?/gi;

  function trim(s) { return (s || '').toString().trim(); }
  function normalizeRaw(u) {
    if (!u) return '';
    let s = trim(u);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
    if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim();
    return s;
  }
  function toAbsolute(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
  }
  function isImageUrl(u) {
    if (!u) return false;
    const stripped = normalizeRaw(u).split('?')[0].split('#')[0].replace(/\/+$/, '');
    return IMG_EXT_RE.test(stripped);
  }

  function uniqueArray(arr) {
    const seen = new Set();
    return arr.reduce((acc, v) => {
      if (!v) return acc;
      const key = toAbsolute(normalizeRaw(v));
      if (!seen.has(key)) { seen.add(key); acc.push(key); }
      return acc;
    }, []);
  }

  // --- parsing helpers ---
  function parsePayloadScript(scriptEl) {
    if (!scriptEl) return [];
    const txt = scriptEl.textContent || scriptEl.innerText || '';
    try {
      const parsed = JSON.parse(txt || '[]');
      if (Array.isArray(parsed)) return parsed.map(normalizeRaw).filter(Boolean);
      if (typeof parsed === 'string') return parsed.split(/[\r\n,]+/).map(normalizeRaw).filter(Boolean);
      return [];
    } catch (e) {
      // fallback: look for http(s) image tokens
      const found = txt.match(HTTP_IMG_TOKEN_RE) || [];
      return found.map(normalizeRaw);
    }
  }

  function parseDataAttributes(card) {
    const keys = ['data-images', 'data-image-urls', 'data-imageUrls', 'data-image_list', 'data-images-only'];
    const out = [];
    keys.forEach(k => {
      const v = card.getAttribute(k);
      if (!v) return;
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) parsed.forEach(x => out.push(normalizeRaw(x)));
        else if (typeof parsed === 'string') out.push(...parsed.split(/[\r\n,]+/).map(normalizeRaw));
      } catch (e) {
        out.push(...v.split(/[\r\n,]+/).map(normalizeRaw));
      }
    });
    return out;
  }

  function scanCardForUrls(card) {
    const found = new Set();

    // 1) existing imgs
    card.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.src || '';
      if (src) found.add(normalizeRaw(src));
    });

    // 2) anchors with img-looking href
    card.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (isImageUrl(href)) found.add(normalizeRaw(href));
    });

    // 3) JSON payload script (data-report-images-for matching this card)
    const dataId = card.getAttribute('data-id') || '';
    if (dataId) {
      const script = document.querySelector(`script[type="application/json"][data-report-images-for="${CSS.escape(dataId)}"]`);
      if (script) parsePayloadScript(script).forEach(u => found.add(normalizeRaw(u)));
    }

    // 4) data-* attributes
    parseDataAttributes(card).forEach(u => found.add(normalizeRaw(u)));

    // 5) text node scanning (quick heuristic)
    const text = card.innerText || card.textContent || '';
    let m;
    while ((m = HTTP_IMG_TOKEN_RE.exec(text)) !== null) {
      if (m[0]) found.add(normalizeRaw(m[0]));
    }

    return Array.from(found);
  }

  // --- gallery builder ---
  function ensureGallery(card) {
    let gallery = card.querySelector('.evidence-gallery');
    if (!gallery) {
      gallery = document.createElement('div');
      gallery.className = 'evidence-gallery';
      const evidenceContainer = card.querySelector('.report-evidence') || card.querySelector('.report-card-body') || card;
      evidenceContainer.appendChild(gallery);
    }
    return gallery;
  }

  function appendThumbIfMissing(gallery, rawUrl) {
    if (!rawUrl) return false;
    const abs = toAbsolute(normalizeRaw(rawUrl));
    // avoid duplicates (compare absolute URLs)
    const exists = Array.from(gallery.querySelectorAll('img')).some(img => {
      try { return img.src === abs; } catch (e) { return false; }
    });
    if (exists) return false;
    const img = document.createElement('img');
    img.className = 'thumb';
    img.loading = 'lazy';
    img.alt = 'Additional evidence';
    img.src = abs;
    img.setAttribute('data-auto-injected', '1');
    gallery.appendChild(img);
    return true;
  }

  // --- main gather/inject routine ---
  function gatherAndInjectAll() {
    const cards = Array.from(document.querySelectorAll('.report-card'));
    if (!cards.length) return;
    cards.forEach(card => {
      try {
        // If card already has .thumb or .evidence-image, we will still try to inject missing ones,
        // but skip heavy scanning if user already has at least one thumbnail and a payload script absent.
        const candidateUrls = scanCardForUrls(card).filter(Boolean);
        const imageUrls = candidateUrls.filter(isImageUrl).map(u => toAbsolute(u));
        const uniqueImages = uniqueArray(imageUrls);

        if (!uniqueImages.length) return; // nothing image-like found

        const gallery = ensureGallery(card);
        let injected = 0;
        uniqueImages.forEach(u => { if (appendThumbIfMissing(gallery, u)) injected++; });

        if (injected) {
          // mark card so we don't repeatedly spam logs
          if (!card.getAttribute('data-image-fixer-injected')) {
            card.setAttribute('data-image-fixer-injected', '1');
            console.info('image-fixer: injected', injected, 'images into card', card.getAttribute('data-id') || card.querySelector('[id^="p-"],[id^="r-"]')?.id || '');
          }
        }
      } catch (e) {
        console.warn('image-fixer: error processing card', e);
      }
    });
  }

  // --- lightbox wiring (delegated) ---
  function createFallbackLightbox() {
    // Only create if there's no #lightbox in the DOM
    if (document.getElementById('lightbox')) return document.getElementById('lightbox');
    const overlay = document.createElement('div');
    overlay.id = 'lightbox';
    overlay.className = 'lightbox-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.85);z-index:99999;padding:20px;';
    overlay.innerHTML = `
      <div class="lightbox-container" style="position:relative;max-width:95%;max-height:95%;display:flex;align-items:center;justify-content:center;">
        <button class="lightbox-arrow left" aria-label="Previous" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);">‹</button>
        <img id="lightbox-img" class="lightbox-image" style="max-width:100%;max-height:100%;display:block;border-radius:8px;" src="" alt="">
        <button class="lightbox-arrow right" aria-label="Next" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);">›</button>
        <button class="lightbox-close" aria-label="Close" style="position:absolute;top:8px;right:8px;">×</button>
      </div>
      <div id="lightbox-caption" class="lightbox-caption" style="color:#fff;margin-top:10px;text-align:center;"></div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function wireLightbox() {
    const lb = createFallbackLightbox();
    const imgEl = lb.querySelector('#lightbox-img');
    const captionEl = lb.querySelector('#lightbox-caption');
    const prev = lb.querySelector('.lightbox-arrow.left');
    const next = lb.querySelector('.lightbox-arrow.right');
    const close = lb.querySelector('.lightbox-close');

    let currentGallery = [];
    let currentIndex = 0;

    function showLightbox(gallery, idx) {
      if (!gallery || !gallery.length) return;
      currentGallery = gallery.slice();
      currentIndex = Math.max(0, Math.min(idx || 0, currentGallery.length - 1));
      imgEl.src = currentGallery[currentIndex];
      imgEl.alt = `Image ${currentIndex + 1} of ${currentGallery.length}`;
      captionEl.textContent = imgEl.alt;
      lb.classList.add('visible');
      lb.style.display = 'flex';
      lb.setAttribute('aria-hidden', 'false');
      // show/hide arrows
      if (prev) prev.style.display = currentGallery.length > 1 ? 'block' : 'none';
      if (next) next.style.display = currentGallery.length > 1 ? 'block' : 'none';
    }
    function hideLightbox() {
      lb.classList.remove('visible');
      lb.style.display = 'none';
      lb.setAttribute('aria-hidden', 'true');
      imgEl.src = '';
      currentGallery = [];
      currentIndex = 0;
    }
    function showPrev() {
      if (!currentGallery.length) return;
      currentIndex = (currentIndex - 1 + currentGallery.length) % currentGallery.length;
      imgEl.src = currentGallery[currentIndex];
      captionEl.textContent = `Image ${currentIndex + 1} of ${currentGallery.length}`;
    }
    function showNext() {
      if (!currentGallery.length) return;
      currentIndex = (currentIndex + 1) % currentGallery.length;
      imgEl.src = currentGallery[currentIndex];
      captionEl.textContent = `Image ${currentIndex + 1} of ${currentGallery.length}`;
    }

    // delegated click handler for thumbs
    // remove previous if we replaced it earlier in the session
    if (window.__image_fixer_delegate_handler) {
      document.removeEventListener('click', window.__image_fixer_delegate_handler);
    }
    window.__image_fixer_delegate_handler = function (ev) {
      const t = ev.target;
      if (!t || !t.classList) return;
      if (!(t.classList.contains('thumb') || t.classList.contains('evidence-image'))) return;

      const card = t.closest('.report-card');
      if (!card) return;

      // build gallery from card's images (use absolute URLs)
      const imgs = Array.from(card.querySelectorAll('.evidence-image, .thumb'))
        .map(i => normalizeRaw(i.getAttribute('src') || i.src || ''))
        .filter(Boolean)
        .map(toAbsolute);

      // fallback: try payload script data
      if (!imgs.length) {
        const id = card.getAttribute('data-id');
        if (id) {
          const script = document.querySelector(`script[type="application/json"][data-report-images-for="${CSS.escape(id)}"]`);
          if (script) {
            const parsed = parsePayloadScript(script).map(toAbsolute);
            if (parsed && parsed.length) imgs.push(...parsed);
          }
        }
      }

      if (!imgs.length) return;

      const clickedSrc = toAbsolute(normalizeRaw(t.getAttribute('src') || t.src || ''));
      let idx = imgs.indexOf(clickedSrc);
      if (idx === -1) idx = 0;
      showLightbox(imgs, idx);
    };
    document.addEventListener('click', window.__image_fixer_delegate_handler);

    // wire controls
    if (prev) {
      prev.removeEventListener('click', prev._if_listener);
      prev._if_listener = function (e) { e.stopPropagation(); showPrev(); };
      prev.addEventListener('click', prev._if_listener);
    }
    if (next) {
      next.removeEventListener('click', next._if_listener);
      next._if_listener = function (e) { e.stopPropagation(); showNext(); };
      next.addEventListener('click', next._if_listener);
    }
    if (close) {
      close.removeEventListener('click', close._if_listener);
      close._if_listener = function (e) { e.stopPropagation(); hideLightbox(); };
      close.addEventListener('click', close._if_listener);
    }

    // keyboard & overlay click
    document.removeEventListener('keydown', window.__image_fixer_key_listener);
    window.__image_fixer_key_listener = function (e) {
      if (!lb.classList.contains('visible') && lb.style.display !== 'flex') return;
      if (e.key === 'Escape') hideLightbox();
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    };
    document.addEventListener('keydown', window.__image_fixer_key_listener);

    lb.removeEventListener('click', lb._if_overlay);
    lb._if_overlay = function (ev) { if (ev.target === lb) hideLightbox(); };
    lb.addEventListener('click', lb._if_overlay);
  }

  // --- public API + autostart ---
  function run() {
    try {
      gatherAndInjectAll();
      wireLightbox();
      console.info('image-fixer: run complete');
    } catch (e) {
      console.error('image-fixer: run failed', e);
    }
  }

  // expose API
  window.__image_fixer = window.__image_fixer || {};
  window.__image_fixer.run = run;

  // also maintain legacy name used elsewhere
  window.__reports_image_fixer = window.__reports_image_fixer || window.__image_fixer;

  // auto-run on DOM ready (safe idempotent)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 80));
  } else {
    setTimeout(run, 80);
  }

})();
