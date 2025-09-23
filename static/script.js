/* ==================== Anti-inspect / anti-devtools layer ==================== */
(function initAntiInspect() {
    try {
        // Bypass if developer explicitly requests it in URL or storage
        const urlParams = new URLSearchParams(window.location.search || '');
        const bypassQuery = urlParams.get('allow_devtools') === '1' || urlParams.get('debug') === '1';
        const bypassLocal = (function(){
            try { return localStorage && localStorage.getItem && localStorage.getItem('ALLOW_DEVTOOLS') === '1'; } catch(e) { return false; }
        })();
        const bypassSession = (function(){
            try { return sessionStorage && sessionStorage.getItem && sessionStorage.getItem('ALLOW_DEVTOOLS') === '1'; } catch(e) { return false; }
        })();
        if (bypassQuery || bypassLocal || bypassSession) {
            // short-circuit: devtools protection disabled
            console.info('Anti-inspect bypass active (allow_devtools set).');
            return;
        }
    } catch (err) {
        // If any error checking bypass, continue and enable protection (safe default)
        console.warn('Anti-inspect init error (continuing with protection):', err);
    }

    const RELOAD = () => {
        try {
            // Immediate reload — use replace so back button not abused by users
            // but we prefer reload() to re-run page state cleanly
            location.reload();
        } catch (e) {
            try { location.href = location.href; } catch(_) {}
        }
    };

    // 1) Intercept common key combos used to open devtools / view source / inspect
    window.addEventListener('keydown', function (e) {
        try {
            // F12
            if (e.key === 'F12') { e.preventDefault(); RELOAD(); return; }

            // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C  (Windows/Linux)
            if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C' || e.key === 'i' || e.key === 'j' || e.key === 'c')) {
                e.preventDefault();
                RELOAD();
                return;
            }

            // Cmd+Option+I (Mac)
            if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'I' || e.key === 'i')) {
                e.preventDefault();
                RELOAD();
                return;
            }

            // Ctrl+U (view-source)
            if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
                e.preventDefault();
                RELOAD();
                return;
            }

            // Ctrl+Shift+K / Cmd+Option+J — other console combos
            if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
                e.preventDefault();
                RELOAD();
                return;
            }

            // Ctrl+Shift+S (some extensions)
            if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                RELOAD();
                return;
            }
        } catch (err) {
            // swallow
        }
    }, { passive: false });

    // 2) Intercept right-click / context menu attempts (often used to Inspect Element)
    window.addEventListener('contextmenu', function (e) {
        try {
            e.preventDefault();
            // small delay so user sees it refresh
            setTimeout(RELOAD, 10);
            return false;
        } catch (err) {}
    }, { passive: false });

    // 3) Detect devtools via size heuristics + timing heuristic
    (function devtoolsDetector() {
        let lastOpen = false;
        let lastCheck = 0;
        const checkInterval = 500; // ms
        const sizeThreshold = 160; // px — heuristic; adjust if needed

        function isDevToolsOpenBySize() {
            // When devtools are open, outer-inner deltas are often > threshold
            try {
                const widthDelta = (window.outerWidth - window.innerWidth) > sizeThreshold;
                const heightDelta = (window.outerHeight - window.innerHeight) > sizeThreshold;
                return widthDelta || heightDelta;
            } catch (e) { return false; }
        }

        function isDevToolsOpenByDebuggerTiming() {
            // timing check using debugger; when devtools open the `debugger` can cause a blocking pause
            try {
                const start = performance.now();
                // The `debugger` statement will pause when devtools are open and configured to pause on "debugger" statements.
                // It's noisy and not always reliable, but combined with size heuristic gives better coverage.
                // We avoid using a raw `debugger;` because it will halt JS when devtools are open and user has selected pause-on-exceptions.
                // Instead, we use Function constructor to call debugger in an isolated function to reduce accidental pausing.
                (new Function('/* anti-inspect-timing */')).call(null);
                const end = performance.now();
                return (end - start) > 100; // if slowed down significantly, assume devtools
            } catch (e) {
                return false;
            }
        }

        function checkNow() {
            try {
                const now = Date.now();
                if (now - lastCheck < 100) return; // throttle
                lastCheck = now;

                const sizeOpen = isDevToolsOpenBySize();
                const timingOpen = isDevToolsOpenByDebuggerTiming();
                const open = sizeOpen || timingOpen;

                if (open && !lastOpen) {
                    // just opened
                    lastOpen = true;
                    // immediate action: reload
                    RELOAD();
                } else if (!open && lastOpen) {
                    // just closed
                    lastOpen = false;
                }
            } catch (err) {
                // ignore detection errors
            }
        }

        // run on resize (covers many cases where devtools toggle changes window metrics)
        window.addEventListener('resize', checkNow);
        // also poll periodically (cover detached devtools and other cases)
        setInterval(checkNow, checkInterval);
        // initial check
        setTimeout(checkNow, 50);
    })();

    // 4) Warn/refresh if DevTools console is opened by using toString detection (older trick)
    //    Combined with above; kept lightweight to avoid CPU overhead.
    (function consoleTrap() {
        try {
            const element = new Image();
            let triggered = false;
            Object.defineProperty(element, 'id', {
                get: function () {
                    // someone logging the image to console will trigger this getter
                    if (!triggered) {
                        triggered = true;
                        RELOAD();
                    }
                    return 'anti-inspect';
                }
            });
            // periodically log this image subtly — if the console prints it, getter runs.
            setInterval(function () {
                try {
                    // Clear any silent console interception by extensions by not directly calling console.log in some browsers,
                    // but writing to console is still common — we use a non-obvious pattern.
                    // If console is open and user inspects logged objects, the getter will run.
                    // Note: this is noisy to console detection and not guaranteed, combined with other checks.
                    // eslint-disable-next-line no-console
                    console.log(element);
                } catch (e) {}
            }, 2000);
        } catch (err) {}
    })();

    // 5) Mutation observer: if someone injects elements commonly used by extensions (e.g. devtools extensions)
    //    attempt a reload. This is broad and conservative and may reload pages on extension manipulations.
    (function mutationGuard() {
        try {
            const observer = new MutationObserver((mutations) => {
                try {
                    for (const m of mutations) {
                        if (!m.addedNodes) continue;
                        for (const n of m.addedNodes) {
                            if (!n) continue;
                            if (n.nodeType === 1) {
                                const tag = (n.tagName || '').toLowerCase();
                                // heuristic: extension/devtools panels sometimes inject iframes, devtools-specific ids/classes
                                if (tag === 'iframe' || tag === 'inspector' || (n.id && /devtools|inspector|extension/i.test(n.id)) || (n.className && /devtools|inspector|extension/i.test(n.className))) {
                                    RELOAD();
                                    return;
                                }
                            }
                        }
                    }
                } catch (err) {}
            });
            observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        } catch (err) {}
    })();

    // 6) defensive: if the URL was opened by someone using view-source:, force reload without that scheme
    try {
        if (window.location && window.location.protocol === 'view-source:') {
            RELOAD();
        }
    } catch (e) {}

    // End anti-inspect layer
})();


document.addEventListener('DOMContentLoaded', () => {
    // Report form submit
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // --- guard: if capture already handled it, bail out ---
            if (window.__reportSubmitting) {
                console.warn('Submission already in progress (script.js handler). Ignoring duplicate.');
                return;
            }
            window.__reportSubmitting = true;

            // disable the submit button if present
            const submitBtn = document.getElementById('report-submit');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const formData = new FormData(reportForm);

                // Safely read image_urls and normalize into an array
                const rawImageUrls = formData.get('image_urls') || '';
                const imageUrls = (typeof rawImageUrls === 'string' ? rawImageUrls : '')
                    .split(/\r?\n/)
                    .map(u => u.trim())
                    .filter(url => url !== '');

                // Build payload and include multiple image-key aliases for server compatibility
                const report = {
                    full_name: (formData.get('full_name') || '').toString().trim(),
                    location: (formData.get('location') || '').toString().trim() || null,
                    occupation: (formData.get('occupation') || '').toString().trim() || null,
                    employer: (formData.get('employer') || '').toString().trim() || null,
                    address: (formData.get('address') || '').toString().trim() || null,
                    employer_email: (formData.get('employer_email') || '').toString().trim() || null,
                    email: (formData.get('email') || '').toString().trim() || null,
                    phone: (formData.get('phone') || '').toString().trim() || null,
                    evidence_url: (formData.get('evidence_url') || '').toString().trim(),
                    description: (formData.get('description') || '').toString().trim(),
                    category: (formData.get('category') || '').toString().trim(),
                    platform: (formData.get('platform') || '').toString().trim(),
                    // canonical & alias arrays
                    image_urls: imageUrls,
                    imageUrls: imageUrls,
                    images: imageUrls,
                    image_list: imageUrls,
                    images_only: imageUrls
                };

                // Keep backward compatibility: mirror employer_email/email
                if (!report.email && report.employer_email) {
                    report.email = report.employer_email;
                }
                if (!report.employer_email && report.email) {
                    report.employer_email = report.email;
                }

                // Basic client-side required check
                if (!report.full_name || !report.evidence_url || !report.description || !report.category || !report.platform || !report.employer) {
                    alert('Please fill in all required fields.');
                    window.__reportSubmitting = false;
                    if (submitBtn) submitBtn.disabled = false;
                    return;
                }

                const response = await fetch('/submit_report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(report)
                });

                if (response.ok) {
                    // attempt to read any JSON message
                    let dataText = '';
                    try {
                        const json = await response.json();
                        dataText = json.message ? ` — ${json.message}` : '';
                        if (json && json.redirect) {
                            window.location.href = json.redirect;
                            return;
                        }
                    } catch (err) {
                        // not JSON or empty, ignore
                    }
                    alert('Report submitted successfully!' + dataText);
                    reportForm.reset();
                    console.log('Report submitted:', report);
                } else {
                    const text = await response.text();
                    console.error('Submit failed', response.status, text);
                    alert(`Error submitting report: ${response.status}\nServer response: ${text}`);
                }
            } catch (err) {
                console.error('Error during submit handler:', err);
                alert('Error: ' + (err && err.message ? err.message : String(err)));
            } finally {
                window.__reportSubmitting = false;
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // Load approved reports on reports page
    const reportsList = document.getElementById('reports-list');
    if (reportsList) {
        fetch('/approved_reports')
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(reports => {
                reports.forEach(report => {
                    const card = document.createElement('div');
                    card.className = 'report-card';
                    card.innerHTML = `
                        <h2>${escapeHtml(report.full_name || 'Anonymous')}</h2>
                        <p>${escapeHtml(report.location || 'N/A')} - ${escapeHtml(report.occupation || 'N/A')}</p>
                        <p>${escapeHtml(report.employer || 'N/A')}</p>
                        <p>${escapeHtml(report.description || '')}</p>
                        <a href="${escapeAttr(report.evidence_url || '#')}" target="_blank" rel="noopener noreferrer">${escapeAttr(report.evidence_url || '')}</a>
                    `;
                    // try several keys the server might have saved
                    const imgs = report.image_urls || report.imageUrls || report.images || report.image_list || report.images_only || [];
                    if (Array.isArray(imgs) && imgs.length > 0) {
                        const evidenceDiv = document.createElement('div');
                        evidenceDiv.className = 'evidence';
                        imgs.forEach(url => {
                            const img = document.createElement('img');
                            img.src = url;
                            img.alt = 'Evidence Image';
                            evidenceDiv.appendChild(img);
                        });
                        card.appendChild(evidenceDiv);
                    }
                    reportsList.appendChild(card);
                });

                // *** important: trigger the reports image fixer if it exists (for dynamic insertion) ***
                if (window.__reports_image_fixer && typeof window.__reports_image_fixer.run === 'function') {
                    try {
                        window.__reports_image_fixer.run();
                        console.info('script.js: triggered window.__reports_image_fixer after approved_reports fetch');
                    } catch (err) {
                        console.warn('script.js: error running reports fixer after fetch', err);
                    }
                } else {
                    // try again shortly (in case fixer hasn't registered yet)
                    setTimeout(() => {
                        if (window.__reports_image_fixer && typeof window.__reports_image_fixer.run === 'function') {
                            try { window.__reports_image_fixer.run(); console.info('script.js: delayed trigger of reports fixer'); } catch(e){ console.warn('script.js: delayed fixer error', e); }
                        }
                    }, 200);
                }
            })
            .catch(err => console.error('Error loading reports:', err));
    }

    // Trigger the reports-fixer on DOM ready (for server-rendered reports.html)
    (function triggerReportsFixerWithRetry(retries = 6) {
        function tryRun() {
            if (window.__reports_image_fixer && typeof window.__reports_image_fixer.run === 'function') {
                try {
                    window.__reports_image_fixer.run();
                    console.info('script.js: triggered window.__reports_image_fixer on DOMContentLoaded');
                    return;
                } catch (err) {
                    console.warn('script.js: reports fixer threw', err);
                }
            }
            if (retries > 0) {
                retries--;
                setTimeout(tryRun, 150);
            } else {
                console.info('script.js: reports fixer not present after retries (okay if page does not include it)');
            }
        }
        // small initial delay so page scripts have a chance to register globals
        setTimeout(tryRun, 120);
    })();
});

// small helper functions for approved reports rendering
function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(s) {
    if (!s) return '';
    return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Admin access (unchanged)
const obfuscatedCodes = [105, 66, 75, 88, 70, 67, 79, 97, 67, 88, 65, 103, 79, 71, 69, 88, 67, 75, 70, 107, 78, 71, 67, 68, 121, 79, 73, 95, 88, 79, 122, 75, 89, 89, 24, 26, 24, 31, 11, 106, 9, 102, 69, 68, 77, 107, 108];
const key = 42;
const password = obfuscatedCodes.map(c => String.fromCharCode(c ^ key)).join('');

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.key === '`') {
        showPasswordModal();
    }
});

function showPasswordModal() {
    let modal = document.getElementById('admin-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-modal';
        modal.innerHTML = `
            <h3>Enter Admin Password</h3>
            <input type="password" id="admin-password" placeholder="Password">
            <button id="admin-submit">Submit</button>
        `;
        document.body.appendChild(modal);

        document.getElementById('admin-submit').addEventListener('click', () => {
            const input = document.getElementById('admin-password').value;
            if (input === password) {
                modal.style.display = 'none';
                showAdminPanel();
            } else {
                alert('Incorrect password');
            }
        });
    }
    modal.style.display = 'block';
}

async function showAdminPanel() {
    let panel = document.getElementById('admin-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'admin-panel';
        document.body.appendChild(panel);
    }
    panel.style.display = 'block';
    await refreshAdminReports(panel);
}

async function refreshAdminReports(panel) {
    try {
        const response = await fetch('/pending_reports');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reports = await response.json();
        panel.innerHTML = '<h2>Pending Reports</h2>';
        reports.forEach((r, i) => {
            const div = document.createElement('div');
            div.className = 'admin-report';
            div.innerHTML = `
                <p><strong>Name:</strong> ${r.full_name}</p>
                <p><strong>Description:</strong> ${r.description}</p>
                <button class="admin-button" onclick="approveReport('${r.id}')">Approve</button>
                <button class="deny-button" onclick="denyReport('${r.id}')">Deny</button>
            `;
            panel.appendChild(div);
        });
    } catch (err) {
        console.error('Error loading pending reports:', err);
        panel.innerHTML = '<p>Error loading reports.</p>';
    }
}

window.approveReport = async (reportId) => {
    try {
        const response = await fetch(`/approve/${reportId}`, { method: 'POST' });
        if (response.ok) {
            alert('Approved');
            const panel = document.getElementById('admin-panel');
            await refreshAdminReports(panel);
        } else {
            const text = await response.text();
            console.error('Approve failed', response.status, text);
            alert(`Approve failed: ${response.status}\n${text}`);
        }
    } catch (err) {
        console.error('Error approving report:', err);
        alert('Error');
    }
};

window.denyReport = async (reportId) => {
    try {
        const response = await fetch(`/deny/${reportId}`, { method: 'POST' });
        if (response.ok) {
            alert('Denied');
            const panel = document.getElementById('admin-panel');
            await refreshAdminReports(panel);
        } else {
            const text = await response.text();
            console.error('Deny failed', response.status, text);
            alert(`Deny failed: ${response.status}\n${text}`);
        }
    } catch (err) {
        console.error('Error denying report:', err);
        alert('Error');
    }
};

/* ====== Append: small, non-destructive patch to add missing thumbnails if template didn't render them ======
   This scans server-rendered cards and populates .evidence-gallery thumbnails from the JSON payload,
   from links/text in the card, or from data-* attributes. It also wires a delegated lightbox click handler.
   Safe to append — does not remove or replace existing code.
========================================================= */

(function addMissingThumbnails() {
    // safe list of image extensions
    const IMG_EXT = ['jpg','jpeg','png','gif','webp','bmp','svg'];

    function looksLikeImageUrl(u) {
        if (!u || typeof u !== 'string') return false;
        try {
            // strip wrapping < > or quotes
            let s = u.trim().replace(/^<|>$/g, '').replace(/^["'`“”’]/, '').replace(/["'`“”’]$/, '');
            // drop query/hash for extension check
            const candidate = s.split('?')[0].split('#')[0].replace(/\/+$/,'');
            if (!candidate.includes('.')) return false;
            const ext = candidate.split('.').pop().toLowerCase();
            return IMG_EXT.indexOf(ext) !== -1;
        } catch (e) {
            return false;
        }
    }

    function ensureGallery(card) {
        let gallery = card.querySelector('.evidence-gallery');
        if (!gallery) {
            gallery = document.createElement('div');
            gallery.className = 'evidence-gallery';
            // prefer inserting after any .report-evidence block if present
            const evidence = card.querySelector('.report-evidence') || card.querySelector('.report-card-body') || card;
            evidence.appendChild(gallery);
        }
        return gallery;
    }

    function appendThumb(gallery, url) {
        if (!url) return;
        const normalized = ('' + url).trim();
        // avoid duplicates
        const existing = Array.from(gallery.querySelectorAll('img')).some(img => img.src === normalized);
        if (existing) return;
        const img = document.createElement('img');
        img.className = 'thumb';
        img.loading = 'lazy';
        img.alt = 'Additional evidence';
        img.src = normalized;
        gallery.appendChild(img);
    }

    // run on DOM ready (if already ready, run quickly)
    function run() {
        const cards = Array.from(document.querySelectorAll('.report-card'));
        if (!cards.length) return;
        cards.forEach(card => {
            // if there are already thumbs or evidence-image, skip
            if (card.querySelector('.thumb, .evidence-image')) return;

            // 1) Try JSON payload script inserted by template
            let added = false;
            const id = card.getAttribute('data-id') || (card.querySelector('[id^="p-"], [id^="r-"]') && (card.querySelector('[id^="p-"], [id^="r-"]').id.replace(/^p-|^r-/,'')));
            if (id) {
                const payloadScript = document.querySelector(`script[type="application/json"][data-report-images-for="${id}"]`);
                if (payloadScript) {
                    try {
                        const arr = JSON.parse(payloadScript.textContent || '[]');
                        if (Array.isArray(arr) && arr.length) {
                            const gallery = ensureGallery(card);
                            arr.forEach(u => {
                                if (looksLikeImageUrl(u)) {
                                    appendThumb(gallery, ('' + u).trim());
                                    added = true;
                                }
                            });
                        }
                    } catch(e){}
                }
            }

            // 2) fallback: search links and text nodes inside the card for image-like URLs
            if (!added) {
                const urls = new Set();

                // check <a> hrefs
                Array.from(card.querySelectorAll('a[href]')).forEach(a => {
                    const h = a.getAttribute('href');
                    if (looksLikeImageUrl(h)) urls.add(h.trim());
                });

                // check any visible text nodes for http(s) tokens
                const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while ((node = walker.nextNode())) {
                    const txt = node.nodeValue || '';
                    // quick heuristic split by whitespace / commas
                    txt.replace(/[,;|]/g, ' ').split(/\s+/).forEach(tok => {
                        if (looksLikeImageUrl(tok)) urls.add(tok.trim());
                    });
                }

                if (urls.size) {
                    const gallery = ensureGallery(card);
                    urls.forEach(u => appendThumb(gallery, u));
                    added = true;
                }
            }

            // 3) final attempt: check data attributes (sometimes servers dump arrays into data-* attributes)
            if (!added) {
                const dataKeys = ['data-images','data-image-urls','data-imageUrls','data-image_list'];
                dataKeys.forEach(k => {
                    const attr = card.getAttribute(k);
                    if (attr) {
                        // try JSON then comma/line split
                        let arr = [];
                        try { arr = JSON.parse(attr || '[]'); } catch(e) { arr = attr.split(/[\r\n,]+/).map(s=>s.trim()).filter(Boolean); }
                        if (arr.length) {
                            const gallery = ensureGallery(card);
                            arr.forEach(u => { if (looksLikeImageUrl(u)) appendThumb(gallery, u); });
                        }
                    }
                });
            }
        });

        // Re-bind lightbox clicks for thumbnails we just added (delegated handler)
        try {
            const lightbox = document.getElementById('lightbox');
            const imgEl = document.getElementById('lightbox-img');
            const captionEl = document.getElementById('lightbox-caption');
            if (!lightbox || !imgEl) return;

            let currentGallery = [];
            let currentIndex = 0;

            function showLightbox(gallery, index){
                if (!gallery || !gallery.length) return;
                currentGallery = gallery;
                currentIndex = Math.max(0, Math.min(index, gallery.length - 1));
                imgEl.src = currentGallery[currentIndex];
                imgEl.alt = 'Image ' + (currentIndex + 1) + ' of ' + currentGallery.length;
                captionEl.textContent = imgEl.alt;
                lightbox.classList.add('visible');
                lightbox.setAttribute('aria-hidden','false');
            }
            function hideLightbox(){
                lightbox.classList.remove('visible');
                lightbox.setAttribute('aria-hidden','true');
                imgEl.src = '';
                currentGallery = [];
                currentIndex = 0;
            }
            function showPrev(){
                if (currentGallery.length <= 1) return;
                currentIndex = (currentIndex - 1 + currentGallery.length) % currentGallery.length;
                imgEl.src = currentGallery[currentIndex];
                imgEl.alt = 'Image ' + (currentIndex + 1) + ' of ' + currentGallery.length;
                captionEl.textContent = imgEl.alt;
            }
            function showNext(){
                if (currentGallery.length <= 1) return;
                currentIndex = (currentIndex + 1) % currentGallery.length;
                imgEl.src = currentGallery[currentIndex];
                imgEl.alt = 'Image ' + (currentIndex + 1) + ' of ' + currentGallery.length;
                captionEl.textContent = imgEl.alt;
            }

            // remove previous delegated handler if exists
            if (window.__thumbLightboxHandler) {
                document.removeEventListener('click', window.__thumbLightboxHandler);
            }
            window.__thumbLightboxHandler = function(e){
                const t = e.target;
                if (!t) return;
                if (!(t.classList && (t.classList.contains('thumb') || t.classList.contains('evidence-image')))) return;
                const card = t.closest('.report-card');
                if (!card) return;
                const imgs = Array.from(card.querySelectorAll('.evidence-image, .thumb')).map(el => el.src).filter(Boolean);
                const actualGallery = imgs.length ? imgs : (function(){
                    const id = card.getAttribute('data-id');
                    const payloadScript = id && document.querySelector(`script[type="application/json"][data-report-images-for="${id}"]`);
                    try { return payloadScript ? (JSON.parse(payloadScript.textContent||'[]') || []) : []; } catch(e) { return []; }
                })();
                if (!actualGallery.length) return;
                const clickedSrc = t.src || t.getAttribute('src');
                let idx = actualGallery.indexOf(clickedSrc);
                if (idx === -1) idx = 0;
                showLightbox(actualGallery, idx);
            };
            document.addEventListener('click', window.__thumbLightboxHandler);

            // attach prev/next/close controls (ensure not duplicated)
            const prevBtn = document.querySelector('.lightbox-arrow.left');
            const nextBtn = document.querySelector('.lightbox-arrow.right');
            const closeBtn = document.querySelector('.lightbox-close');
            if (prevBtn && nextBtn && closeBtn) {
                if (window.__thumbPrev) { prevBtn.removeEventListener('click', window.__thumbPrev); }
                if (window.__thumbNext) { nextBtn.removeEventListener('click', window.__thumbNext); }
                if (window.__thumbClose) { closeBtn.removeEventListener('click', window.__thumbClose); }

                window.__thumbPrev = showPrev; window.__thumbNext = showNext; window.__thumbClose = hideLightbox;
                prevBtn.addEventListener('click', window.__thumbPrev);
                nextBtn.addEventListener('click', window.__thumbNext);
                closeBtn.addEventListener('click', window.__thumbClose);

                if (window.__thumbKey) { document.removeEventListener('keydown', window.__thumbKey); }
                window.__thumbKey = function(ev){ if (!lightbox.classList.contains('visible')) return; if (ev.key === 'Escape') hideLightbox(); if (ev.key === 'ArrowLeft') showPrev(); if (ev.key === 'ArrowRight') showNext(); };
                document.addEventListener('keydown', window.__thumbKey);

                // clicking on overlay to close
                lightbox.addEventListener('click', function(ev){ if (ev.target === lightbox) hideLightbox(); });
            }
        } catch(e){ /* ignore lightbox wiring errors */ }
    }

    // run shortly after load (in case server DOM is still parsing) and again after a small delay
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { setTimeout(run, 80); setTimeout(run, 600); });
    } else {
        setTimeout(run, 80); setTimeout(run, 600);
    }
})();

/* ====== Non-destructive: robust filter/search compatibility patch (FIXED state-only filtering) ======
   This appended block will:
   - Always operate over all .report-card elements (avoid container mismatch)
   - Populate and normalize state selection (match abbr or full name)
   - Annotate cards with data-state (abbr) and data-state-full (full name) for reliable matching
   - Observe DOM changes and re-run filter
====================================================================== */

(function() {
    const STATES = [
        {name:'Alabama', abbr:'AL'},{name:'Alaska', abbr:'AK'},{name:'Arizona', abbr:'AZ'},{name:'Arkansas', abbr:'AR'},
        {name:'California', abbr:'CA'},{name:'Colorado', abbr:'CO'},{name:'Connecticut', abbr:'CT'},{name:'Delaware', abbr:'DE'},
        {name:'Florida', abbr:'FL'},{name:'Georgia', abbr:'GA'},{name:'Hawaii', abbr:'HI'},{name:'Idaho', abbr:'ID'},
        {name:'Illinois', abbr:'IL'},{name:'Indiana', abbr:'IN'},{name:'Iowa', abbr:'IA'},{name:'Kansas', abbr:'KS'},
        {name:'Kentucky', abbr:'KY'},{name:'Louisiana', abbr:'LA'},{name:'Maine', abbr:'ME'},{name:'Maryland', abbr:'MD'},
        {name:'Massachusetts', abbr:'MA'},{name:'Michigan', abbr:'MI'},{name:'Minnesota', abbr:'MN'},{name:'Mississippi', abbr:'MS'},
        {name:'Missouri', abbr:'MO'},{name:'Montana', abbr:'MT'},{name:'Nebraska', abbr:'NE'},{name:'Nevada', abbr:'NV'},
        {name:'New Hampshire', abbr:'NH'},{name:'New Jersey', abbr:'NJ'},{name:'New Mexico', abbr:'NM'},{name:'New York', abbr:'NY'},
        {name:'North Carolina', abbr:'NC'},{name:'North Dakota', abbr:'ND'},{name:'Ohio', abbr:'OH'},{name:'Oklahoma', abbr:'OK'},
        {name:'Oregon', abbr:'OR'},{name:'Pennsylvania', abbr:'PA'},{name:'Rhode Island', abbr:'RI'},{name:'South Carolina', abbr:'SC'},
        {name:'South Dakota', abbr:'SD'},{name:'Tennessee', abbr:'TN'},{name:'Texas', abbr:'TX'},{name:'Utah', abbr:'UT'},
        {name:'Vermont', abbr:'VT'},{name:'Virginia', abbr:'VA'},{name:'Washington', abbr:'WA'},{name:'West Virginia', abbr:'WV'},
        {name:'Wisconsin', abbr:'WI'},{name:'Wyoming', abbr:'WY'}
    ];

    function norm(s) { return (s || '').toString().trim().toLowerCase(); }

    function parseStateFromLocation(loc) {
        if (!loc) return null;
        const s = loc.replace(/\s+/g, ' ').trim();
        const lower = s.toLowerCase();
        for (let st of STATES) {
            if (lower.includes(st.name.toLowerCase())) return {abbr: st.abbr, name: st.name};
        }
        for (let st of STATES) {
            const ab = st.abbr.toLowerCase();
            const re = new RegExp('\\b' + ab + '\\b', 'i');
            if (re.test(s)) return {abbr: st.abbr, name: st.name};
        }
        return null;
    }

    // always use global .report-card list to avoid container mismatch
    function allReportCards() {
        return Array.from(document.querySelectorAll('.report-card'));
    }

    function getReportsContainer() {
        return document.getElementById('reports-list') ||
               document.getElementById('reports-grid') ||
               document.querySelector('.reports-grid') ||
               null;
    }

    function findControlsOrCreate() {
        let searchInput = document.getElementById('reports-search') || document.getElementById('reports-search-input');
        let stateSelect = document.getElementById('reports-state') || document.getElementById('reports-state-select');
        let noResultsEl = document.getElementById('no-results') || document.getElementById('reports-no-results') || document.getElementById('reports-no-results');

        const reportsContainer = getReportsContainer();
        if (!reportsContainer) return {searchInput, stateSelect, noResultsEl};

        if (searchInput && stateSelect) return { searchInput, stateSelect, noResultsEl };

        const injectedPanel = document.getElementById('reports-filter-panel');
        if (injectedPanel) {
            searchInput = searchInput || document.getElementById('reports-search-input');
            stateSelect = stateSelect || document.getElementById('reports-state-select');
            noResultsEl = noResultsEl || document.getElementById('reports-no-results');
            return { searchInput, stateSelect, noResultsEl };
        }

        // create minimal panel (non-destructive)
        const panel = document.createElement('div');
        panel.id = 'reports-filter-panel';
        panel.style.margin = '12px 0';
        panel.style.display = 'flex';
        panel.style.gap = '8px';
        panel.style.flexWrap = 'wrap';
        panel.style.alignItems = 'center';

        const s = document.createElement('input');
        s.type = 'search';
        s.id = 'reports-search-input';
        s.placeholder = 'Search name, employer, location, description...';
        s.style.padding = '8px';
        s.style.minWidth = '260px';
        panel.appendChild(s);

        const sel = document.createElement('select');
        sel.id = 'reports-state-select';
        sel.style.padding = '8px';
        const o = document.createElement('option');
        o.value = '';
        o.textContent = 'All States';
        sel.appendChild(o);
        panel.appendChild(sel);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.style.padding = '8px';
        clearBtn.addEventListener('click', () => {
            s.value = '';
            sel.value = '';
            filterReports();
        });
        panel.appendChild(clearBtn);

        reportsContainer.parentNode.insertBefore(panel, reportsContainer);
        let nr = document.createElement('div');
        nr.id = 'reports-no-results';
        nr.className = 'no-results';
        nr.style.display = 'none';
        nr.textContent = 'No results found.';
        reportsContainer.parentNode.insertBefore(nr, reportsContainer.nextSibling);

        return { searchInput: s, stateSelect: sel, noResultsEl: nr };
    }

    function populateStateSelect(stateSelect) {
        if (!stateSelect) return;
        const meaningfulOptions = Array.from(stateSelect.options || []).filter(o => (o.value || '').toString().trim() !== '');
        if (meaningfulOptions.length > 1) return;
        stateSelect.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All States';
        stateSelect.appendChild(allOpt);
        STATES.forEach(st => {
            const opt = document.createElement('option');
            opt.value = st.abbr; // abbr is safer as a value, UI shows full name
            opt.textContent = st.name;
            stateSelect.appendChild(opt);
        });
    }

    // annotate a single card with data-* attributes used for filtering (adds both abbr and full)
    function annotateCard(card) {
        try {
            if (!card || !card.classList || !card.classList.contains('report-card')) return;
            if (card.getAttribute('data-annotated') === '1') return;

            const nameEl = card.querySelector('h2, h3, [id^="r-"], [id^="p-"]');
            const fullName = nameEl ? nameEl.textContent.trim() : '';

            let location = '', platform = '', occupation = '', employer = '';
            const meta = card.querySelector('.meta');
            if (meta) {
                const items = Array.from(meta.querySelectorAll('.meta-item, span')).map(s => s.textContent.trim()).filter(Boolean);
                if (items.length >= 1) location = items[0];
                if (items.length >= 2) platform = items[1];
            } else {
                const pEls = Array.from(card.querySelectorAll('p'));
                if (pEls.length) {
                    const first = pEls[0].textContent.trim();
                    if (first.includes(' - ')) {
                        const parts = first.split(' - ').map(s => s.trim());
                        location = parts[0] || '';
                        occupation = parts[1] || occupation;
                    } else {
                        if (first.includes(',')) location = first;
                    }
                }
            }

            const labeled = Array.from(card.querySelectorAll('p.small, p')).map(p => p.textContent.trim());
            labeled.forEach(txt => {
                const lower = txt.toLowerCase();
                if (!employer && lower.startsWith('employer:')) employer = txt.split(':').slice(1).join(':').trim();
                else if (!occupation && lower.startsWith('occupation:')) occupation = txt.split(':').slice(1).join(':').trim();
                else if (!employer && txt.match(/^[A-Z][\w\s&\-\.]{2,}$/) && txt.length < 60 && txt.length > 2 && txt.indexOf(' ') > -1) {
                    if (!employer) employer = txt;
                }
            });

            let description = '';
            const descEl = card.querySelector('.desc') || card.querySelector('p.desc') || card.querySelector('p');
            if (descEl) description = descEl.textContent.trim();
            else description = card.textContent.trim();

            // allow server-side data-state-full or data-state already present; otherwise parse location
            let existingFull = (card.getAttribute('data-state-full') || '').trim();
            let existingAbbr = (card.getAttribute('data-state') || '').trim();

            const parsed = parseStateFromLocation(location || '');
            if (!existingAbbr && parsed && parsed.abbr) existingAbbr = parsed.abbr;
            if (!existingFull && parsed && parsed.name) existingFull = parsed.name;

            if (fullName) card.setAttribute('data-fullname', fullName);
            if (location) card.setAttribute('data-location', location);
            if (occupation) card.setAttribute('data-occupation', occupation);
            if (employer) card.setAttribute('data-employer', employer);
            if (platform) card.setAttribute('data-platform', platform);
            if (description) card.setAttribute('data-description', description);
            if (existingAbbr) card.setAttribute('data-state', existingAbbr);
            else if (!card.hasAttribute('data-state')) card.setAttribute('data-state', '');
            if (existingFull) card.setAttribute('data-state-full', existingFull);
            else if (!card.hasAttribute('data-state-full')) card.setAttribute('data-state-full', '');
            card.setAttribute('data-annotated', '1');
        } catch (e) {
            console.warn('annotateCard error', e);
        }
    }

    // derive desired abbr and name from selection value (supports both abbr and full name)
    function normalizeSelectedState(value) {
        // <<< FIX HERE >>>: treat empty or "ALL" as no selection
        if (!value) return { abbr: '', name: '' };
        const vv = ('' + value).trim();
        if (vv.toUpperCase() === 'ALL') return { abbr: '', name: '' };

        const v = vv;
        if (v.length === 2) {
            const found = STATES.find(s => s.abbr.toLowerCase() === v.toLowerCase());
            return found ? { abbr: found.abbr, name: found.name } : { abbr: v.toUpperCase(), name: '' };
        }
        // might be full name or abbr spelled out (e.g., "Wyoming")
        const byName = STATES.find(s => s.name.toLowerCase() === v.toLowerCase());
        if (byName) return { abbr: byName.abbr, name: byName.name };
        // also accept if value is a full name but casing different, or if value is the display text in option but value is abbr
        const byAbbr = STATES.find(s => s.abbr.toLowerCase() === v.toLowerCase());
        if (byAbbr) return { abbr: byAbbr.abbr, name: byAbbr.name };
        // fallback: return string in both fields so we can compare against full name
        return { abbr: '', name: v };
    }

    // main filtering function (uses all report cards on the page)
    function filterReports() {
        const searchInput = document.getElementById('reports-search') || document.getElementById('reports-search-input');
        const stateSelect = document.getElementById('reports-state') || document.getElementById('reports-state-select');
        const noResults = document.getElementById('no-results') || document.getElementById('reports-no-results') || document.getElementById('reports-no-results');

        const q = norm(searchInput && searchInput.value);
        const rawState = (stateSelect && (stateSelect.value || '') ) || '';
        // <<< FIX HERE >>>: normalize server template "ALL" to empty
        const normalizedRawState = ('' + rawState).trim().toUpperCase() === 'ALL' ? '' : rawState;
        const desired = normalizeSelectedState(normalizedRawState);

        const cards = allReportCards();
        let visible = 0;

        cards.forEach(card => {
            annotateCard(card);
            let show = true;

            // state filtering: if a state is chosen, only show exact matches
            if (desired && (desired.abbr || desired.name)) {
                const csAbbr = (card.getAttribute('data-state') || '').toString().trim().toUpperCase();
                const csFull = (card.getAttribute('data-state-full') || '').toString().trim().toLowerCase();
                const desiredAbbr = (desired.abbr || '').toString().trim().toUpperCase();
                const desiredName = (desired.name || '').toString().trim().toLowerCase();

                // show card only if it matches abbr OR matches full name
                const abbrMatch = desiredAbbr && csAbbr && csAbbr === desiredAbbr;
                const nameMatch = desiredName && csFull && csFull === desiredName;

                // Also accept if either location text contains the full name (defensive)
                let fallbackMatch = false;
                if (!abbrMatch && !nameMatch) {
                    const loc = (card.getAttribute('data-location') || '').toString().trim().toLowerCase();
                    if (desiredName && loc && loc.includes(desiredName)) fallbackMatch = true;
                }

                if (!(abbrMatch || nameMatch || fallbackMatch)) {
                    show = false;
                }
            }

            // free-text filtering
            if (q) {
                const fields = [
                    card.getAttribute('data-fullname') || '',
                    card.getAttribute('data-employer') || '',
                    card.getAttribute('data-location') || '',
                    card.getAttribute('data-description') || '',
                    card.getAttribute('data-platform') || '',
                    card.textContent || ''
                ].map(norm).join(' ');
                if (!fields.includes(q)) show = false;
            }

            if (show) {
                card.style.display = '';
                visible++;
            } else {
                card.style.display = 'none';
            }
        });

        if (noResults) {
            noResults.style.display = visible === 0 ? '' : 'none';
        }
    }

    // observe DOM for added report-cards and re-run annotate+filter
    function wireObserver() {
        // annotate existing immediately
        allReportCards().forEach(annotateCard);

        const observer = new MutationObserver(mutations => {
            let relevant = false;
            for (const m of mutations) {
                if (m.addedNodes && m.addedNodes.length) {
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1 && (n.matches && n.matches('.report-card') || n.querySelector && n.querySelector('.report-card'))) {
                            relevant = true; break;
                        }
                    }
                }
                if (m.type === 'attributes' && m.target && m.target.matches && m.target.matches('.report-card')) {
                    relevant = true; break;
                }
                if (relevant) break;
            }
            if (relevant) {
                setTimeout(() => {
                    allReportCards().forEach(annotateCard);
                    filterReports();
                }, 40);
            }
        });

        const target = document.body;
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-id', 'class'] });
        window.__reports_filter_observer_2 = observer;
    }

    function init() {
        const container = getReportsContainer();
        if (!container) return;
        const controls = findControlsOrCreate();
        if (!controls) return;
        const stateEl = controls.stateSelect || document.getElementById('reports-state') || document.getElementById('reports-state-select');
        populateStateSelect(stateEl);

        // normalize server-side "ALL" first option if present
        if (stateEl && stateEl.options && stateEl.options.length) {
            const first = stateEl.options[0];
            if (first && first.value && first.value.toUpperCase() === 'ALL') first.value = '';
        }

        // wire events
        const searchEl = controls.searchInput || document.getElementById('reports-search') || document.getElementById('reports-search-input');
        const stateSelect = controls.stateSelect || document.getElementById('reports-state') || document.getElementById('reports-state-select');

        function debounce(fn, ms) {
            let t;
            return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
        }
        const debouncedFilter = debounce(filterReports, 160);

        if (searchEl) searchEl.addEventListener('input', debouncedFilter);
        if (stateSelect) stateSelect.addEventListener('change', filterReports);
        if (searchEl) searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); filterReports(); } });

        // initial run
        setTimeout(() => {
            allReportCards().forEach(annotateCard);
            filterReports();
        }, 240);

        wireObserver();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 10);
})();
