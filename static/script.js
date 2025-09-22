// static/script.js

document.addEventListener('DOMContentLoaded', () => {
    // Report form submit
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(reportForm);
            const report = {
                full_name: formData.get('full_name'),
                location: formData.get('location'),
                occupation: formData.get('occupation'),
                employer: formData.get('employer'),
                evidence_url: formData.get('evidence_url'),
                description: formData.get('description'),
                image_urls: formData.get('image_urls').split('\n').filter(url => url.trim() !== ''),
                email: formData.get('email'),
                category: formData.get('category'),
                platform: formData.get('platform')
            };
            try {
                const response = await fetch('/submit_report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(report)
                });
                if (response.ok) {
                    alert('Report submitted successfully!');
                    reportForm.reset();
                } else {
                    alert('Error submitting report.');
                }
            } catch (err) {
                alert('Error: ' + err);
            }
        });
    }
});

// Admin access
const obfuscatedPassword = 'YWRtaW4xMjM='; // base64 for 'admin123'
const password = atob(obfuscatedPassword);

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
        }
    } catch (err) {
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
        }
    } catch (err) {
        alert('Error');
    }
};