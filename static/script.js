// static/script.js

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
            })
            .catch(err => console.error('Error loading reports:', err));
    }
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
