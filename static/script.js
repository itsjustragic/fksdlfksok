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

/* ====== Non-destructive: client-side search + 50-state dropdown + no-results behavior ======
   Append this at the end of static/script.js.
   It will:
     - Insert a search UI above #reports-list (if present)
     - Observe new .report-card nodes, extract useful fields, and set data-* attrs
     - Provide filtering by state + free-text and show "No results" when appropriate
   This code intentionally avoids changing or removing any of your existing logic.
====================================================================== */

(function() {
    // list of 50 US states
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

    // helper: normalize text
    function norm(s) {
        return (s || '').toString().trim().toLowerCase();
    }

    // parse state from a location string (e.g. "Houston, TX" or "Austin, Texas" or "Seattle, WA 98101")
    function parseStateFromLocation(loc) {
        if (!loc) return null;
        const s = loc.replace(/\s+/g, ' ').trim();
        const lower = s.toLowerCase();

        // check full name first (e.g. "new york")
        for (let st of STATES) {
            if (lower.includes(st.name.toLowerCase())) return {abbr: st.abbr, name: st.name};
        }

        // check for common patterns with 2-letter codes (", TX" or " TX " or "TX" at end)
        // create word-boundary regex for each abbr
        for (let st of STATES) {
            const ab = st.abbr.toLowerCase();
            // match like ", tx" or " tx " or " tx$" or "(tx)"
            const re = new RegExp('\\b' + ab + '\\b', 'i');
            if (re.test(s)) return {abbr: st.abbr, name: st.name};
        }
        return null;
    }

    // create filter UI (only if reportsList exists)
    function insertFilterUI(reportsList) {
        if (!reportsList) return null;
        // guard: don't insert twice
        if (document.getElementById('reports-filter-panel')) return document.getElementById('reports-filter-panel');

        const container = document.createElement('div');
        container.id = 'reports-filter-panel';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.alignItems = 'center';
        container.style.margin = '12px 0';
        container.style.flexWrap = 'wrap';

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.id = 'reports-search-input';
        searchInput.placeholder = 'Search name, employer, location, description...';
        searchInput.style.flex = '1 1 320px';
        searchInput.style.padding = '8px';

        const stateSelect = document.createElement('select');
        stateSelect.id = 'reports-state-select';
        stateSelect.style.padding = '8px';
        stateSelect.title = 'Filter by U.S. state';

        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All states';
        stateSelect.appendChild(allOpt);

        STATES.forEach(st => {
            const o = document.createElement('option');
            o.value = st.abbr;
            o.textContent = st.name;
            stateSelect.appendChild(o);
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.id = 'reports-filter-clear';
        clearBtn.textContent = 'Clear';
        clearBtn.style.padding = '8px';

        const noResults = document.createElement('div');
        noResults.id = 'reports-no-results';
        noResults.style.display = 'none';
        noResults.style.marginTop = '10px';
        noResults.style.fontWeight = '600';
        noResults.textContent = 'No results found.';

        container.appendChild(searchInput);
        container.appendChild(stateSelect);
        container.appendChild(clearBtn);

        // put panel before reportsList
        reportsList.parentNode.insertBefore(container, reportsList);
        reportsList.parentNode.insertBefore(noResults, reportsList.nextSibling);

        // events
        const debounced = debounce(filterReports, 180);
        searchInput.addEventListener('input', debounced);
        stateSelect.addEventListener('change', filterReports);
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            stateSelect.value = '';
            filterReports();
        });

        return container;
    }

    // debounce helper
    function debounce(fn, wait) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    // filter logic: show/hide .report-card
    function filterReports() {
        const reportsList = document.getElementById('reports-list');
        if (!reportsList) return;
        const searchInput = document.getElementById('reports-search-input');
        const stateSelect = document.getElementById('reports-state-select');
        const noResults = document.getElementById('reports-no-results');

        const q = norm(searchInput && searchInput.value);
        const state = stateSelect && stateSelect.value; // abbr or ''

        const cards = Array.from(reportsList.querySelectorAll('.report-card'));
        let visible = 0;

        cards.forEach(card => {
            let show = true;

            // state filtering: check data-state attr or try parse fallback using location text
            const cardState = (card.getAttribute('data-state') || '').toUpperCase();
            if (state) {
                if (cardState && cardState.toUpperCase() === state.toUpperCase()) {
                    show = show && true;
                } else {
                    show = false;
                }
            }

            // text search: check fullname, employer, location, description, and card text fallback
            if (q) {
                const fields = [
                    card.getAttribute('data-fullname') || '',
                    card.getAttribute('data-employer') || '',
                    card.getAttribute('data-location') || '',
                    card.getAttribute('data-description') || '',
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
            noResults.style.display = visible === 0 ? 'block' : 'none';
        }
    }

    // Called for newly-added .report-card nodes: extract fields and set data-* attributes
    function annotateCard(card) {
        try {
            if (!card || !card.classList) return;
            if (!card.classList.contains('report-card')) return;

            // avoid double-annotating
            if (card.getAttribute('data-annotated') === '1') return;

            // find h2 for name
            const h2 = card.querySelector('h2');
            const fullName = h2 ? h2.textContent.trim() : '';

            // find first <p> that looks like "location - occupation" or contains comma
            const pEls = Array.from(card.querySelectorAll('p'));
            let location = '';
            let occupation = '';
            if (pEls.length) {
                // try to use the first paragraph; if it contains " - " split
                const first = pEls[0].textContent.trim();
                if (first.includes(' - ')) {
                    const [locPart, occPart] = first.split(' - ').map(s => s.trim());
                    location = locPart;
                    occupation = occPart;
                } else {
                    // fallback heuristics
                    // if paragraph contains a comma (City, State), treat as location
                    if (first.includes(',')) {
                        location = first;
                    } else {
                        // maybe it's "Location: ..." or similar: try to detect "city" tokens
                        location = first;
                    }
                }
            }

            // employer: try to find a line that looks like employer (third <p> or the one with "@" or capitalized word)
            let employer = '';
            if (pEls.length >= 2) {
                employer = pEls[1].textContent.trim();
            }
            // description: try to get the <p> that contains more text or the last <p>
            let description = '';
            if (pEls.length >= 3) {
                description = pEls.slice(2).map(p => p.textContent).join(' ').trim();
            } else {
                // fallback: any long text inside the card not in h2
                description = Array.from(card.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim();
                if (!description) description = (card.textContent || '').trim();
            }

            // attempt to parse a state from location
            const st = parseStateFromLocation(location);

            // set data attributes (keep original DOM intact)
            if (fullName) card.setAttribute('data-fullname', fullName);
            if (location) card.setAttribute('data-location', location);
            if (occupation) card.setAttribute('data-occupation', occupation);
            if (employer) card.setAttribute('data-employer', employer);
            if (description) card.setAttribute('data-description', description);
            if (st) {
                card.setAttribute('data-state', st.abbr);
                card.setAttribute('data-state-full', st.name);
            } else {
                // explicit empty to mark processed
                card.setAttribute('data-state', '');
            }
            card.setAttribute('data-annotated', '1');
        } catch (e) {
            // don't break anything
            console.warn('annotateCard error', e);
        }
    }

    // Observe additions to #reports-list so we can annotate each card (works with your existing fetch code)
    function wireMutationObserver(reportsList) {
        if (!reportsList) return;
        // annotate any existing cards now
        Array.from(reportsList.querySelectorAll('.report-card')).forEach(annotateCard);

        // setup observer
        const mo = new MutationObserver(muts => {
            muts.forEach(m => {
                if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === 1) {
                            if (n.classList && n.classList.contains('report-card')) {
                                annotateCard(n);
                            } else {
                                // maybe appended as wrapper that contains cards
                                Array.from(n.querySelectorAll && n.querySelectorAll('.report-card') || []).forEach(annotateCard);
                            }
                        }
                    });
                }
            });
            // small delay before applying filter to allow other scripts to modify DOM
            setTimeout(filterReports, 40);
        });

        mo.observe(reportsList, { childList: true, subtree: false });
    }

    // On DOM ready: insert UI (if #reports-list exists) and wire observer
    function init() {
        const reportsList = document.getElementById('reports-list');
        if (!reportsList) return;
        insertFilterUI(reportsList);
        wireMutationObserver(reportsList);

        // also trigger an initial filtering attempt after a short delay (handles server-rendered cards)
        setTimeout(() => {
            // annotate any remaining cards then filter
            Array.from(reportsList.querySelectorAll('.report-card')).forEach(annotateCard);
            filterReports();
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
