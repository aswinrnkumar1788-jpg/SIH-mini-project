let allVisitors = [];
let deptChartInstance = null;
let currentPassId = null;
let targetExtendId = null;

document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
    setInterval(loadDashboard, 30000); // Check deadlines every 30s
});

document.getElementById("visitorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        host: document.getElementById("host").value.trim(),
        purpose: document.getElementById("purpose").value.trim(),
        manual_entry_time: document.getElementById("entryTimeManual").value || null
    };

    const res = await fetch("/api/visitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        const result = await res.json();
        document.getElementById("visitorForm").reset();
        await loadDashboard();
        showPassModal(result.pass_id, payload.name, payload.phone, payload.host, result.entry_time, result.deadline_time);
    }
});

async function loadDashboard() {
    const res = await fetch("/api/visitors");
    allVisitors = await res.json();
    calculateOverstays(allVisitors);
    updateMetrics(allVisitors);
    renderTable(allVisitors);
    renderChart(allVisitors);
}

// Parses "DD-MM-YYYY hh:mm AM/PM" to standard Date object
function parseCustomDate(str) {
    if (!str || str === '-') return null;
    try {
        const parts = str.split(" ");
        const dateParts = parts[0].split("-");
        const timeParts = parts[1].split(":");
        let hours = parseInt(timeParts[0]);
        const minutes = parseInt(timeParts[1]);
        if (parts[2] === "PM" && hours < 12) hours += 12;
        if (parts[2] === "AM" && hours === 12) hours = 0;
        return new Date(dateParts[2], dateParts[1] - 1, dateParts[0], hours, minutes);
    } catch (e) {
        return null;
    }
}

// Compares current time against each visitor's approved deadline
function calculateOverstays(data) {
    const now = new Date();
    data.forEach(v => {
        v.isOverstay = false;
        if (v.status === 'Inside') {
            const deadlineDate = parseCustomDate(v.deadline_time);
            if (deadlineDate && now > deadlineDate) {
                v.isOverstay = true;
            }
        }
    });
}

function updateMetrics(data) {
    const total = data.length;
    const inside = data.filter(v => v.status === 'Inside').length;
    const extended = data.filter(v => v.is_extended).length;
    const overstay = data.filter(v => v.isOverstay).length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statInside").textContent = inside;
    document.getElementById("statExtended").textContent = extended;
    document.getElementById("statOverstay").textContent = overstay;
}

function renderTable(visitors) {
    const tbody = document.getElementById("visitorTableBody");
    tbody.innerHTML = "";

    if (visitors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">No matching records found.</td></tr>`;
        return;
    }

    visitors.forEach(v => {
        const tr = document.createElement("tr");

        // Status & Separate Extension Indicators
        let statusHtml = '';
        if (v.status === 'Inside') {
            if (v.isOverstay) {
                statusHtml = `<span class="badge badge-overstay">⚠️ Overstay</span>`;
            } else {
                statusHtml = `<span class="badge badge-inside">Inside</span>`;
            }
            if (v.is_extended) {
                statusHtml += ` <span class="badge badge-extended" title="${v.extension_note}">Extended</span>`;
            }
        } else {
            statusHtml = `<span class="badge badge-out">Checked Out</span>`;
            if (v.is_extended) {
                statusHtml += ` <span class="badge badge-extended">Had Ext.</span>`;
            }
        }

        // Action Buttons
        let actionHtml = '';
        if (v.status === 'Inside') {
            actionHtml = `
                <div class="action-btn-group">
                    <button class="btn-extend" onclick="openExtendModal(${v.id}, '${v.name}')">+ Extend</button>
                    <button class="btn-exit" onclick="checkOut(${v.id})">Exit</button>
                </div>
            `;
        } else {
            actionHtml = `<span style="font-size:11px; color:var(--text-muted);">Cleared</span>`;
        }

        tr.innerHTML = `
            <td><strong>#${v.id}</strong></td>
            <td>
                <div style="font-weight:600;">${v.name}</div>
                <div style="font-size:11px; color:var(--text-muted);">${v.phone}</div>
            </td>
            <td>
                <div>${v.host}</div>
                <div style="font-size:11px; color:var(--text-muted);">${v.purpose}</div>
            </td>
            <td style="color:var(--text-muted); font-size:11.5px;">${v.entry_time}</td>
            <td style="font-size:11.5px; font-weight:600; color:${v.isOverstay ? '#fca5a5' : '#93c5fd'};">
                ${v.deadline_time}
                ${v.is_extended ? `<div style="font-size:10px; color:#c084fc;">${v.extension_note}</div>` : ''}
            </td>
            <td><span class="duration-pill">${v.duration}</span></td>
            <td>${statusHtml}</td>
            <td>${actionHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderChart(visitors) {
    const deptCounts = {};
    visitors.forEach(v => {
        const dept = v.host.split("/")[0].trim();
        deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });

    const labels = Object.keys(deptCounts);
    const counts = Object.values(deptCounts);

    const ctx = document.getElementById("deptChart").getContext("2d");
    if (deptChartInstance) {
        deptChartInstance.destroy();
    }

    deptChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length > 0 ? labels : ['No Logs'],
            datasets: [{
                data: counts.length > 0 ? counts : [1],
                backgroundColor: ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', boxWidth: 10, font: { size: 10.5 } }
                }
            }
        }
    });
}

function filterLogs() {
    const query = document.getElementById("searchInput").value.toLowerCase();
    const statusVal = document.getElementById("statusFilter").value;

    const filtered = allVisitors.filter(v => {
        const matchesQuery = 
            v.name.toLowerCase().includes(query) ||
            v.phone.toLowerCase().includes(query) ||
            v.host.toLowerCase().includes(query) ||
            v.purpose.toLowerCase().includes(query);

        let matchesStatus = true;
        if (statusVal === "Inside") matchesStatus = (v.status === "Inside");
        else if (statusVal === "Checked Out") matchesStatus = (v.status === "Checked Out");
        else if (statusVal === "Extended") matchesStatus = (v.is_extended === true);
        else if (statusVal === "Overstay") matchesStatus = (v.isOverstay === true);

        return matchesQuery && matchesStatus;
    });

    renderTable(filtered);
}

// Extension Approval Logic
function openExtendModal(id, name) {
    targetExtendId = id;
    document.getElementById("extendVisitorName").textContent = name;
    document.getElementById("extendPassId").textContent = `#${id}`;
    document.getElementById("extendReason").value = "";
    document.getElementById("extendModal").style.display = "flex";
}

function closeExtendModal() {
    document.getElementById("extendModal").style.display = "none";
}

async function submitExtension() {
    const reason = document.getElementById("extendReason").value.trim();
    const extraMinutes = document.getElementById("extraMinutes").value;

    if (!reason) {
        alert("Please provide an extension reason or authorizing person.");
        return;
    }

    const res = await fetch(`/api/extend/${targetExtendId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_minutes: extraMinutes, reason: reason })
    });

    if (res.ok) {
        closeExtendModal();
        loadDashboard();
    } else {
        const err = await res.json();
        alert(err.error || "Extension failed");
    }
}

async function checkOut(id) {
    const customTime = prompt(
        "Enter manual exit timestamp (YYYY-MM-DDTHH:MM, e.g. 2026-09-10T17:00) or leave blank for Current Time:"
    );

    const bodyData = customTime ? { manual_exit_time: customTime.trim() } : {};

    const res = await fetch(`/api/checkout/${id}`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData)
    });

    if (res.ok) {
        loadDashboard();
    } else {
        const err = await res.json();
        alert(err.error || "Unable to process exit.");
    }
}

function showPassModal(id, name, phone, host, time, deadline) {
    currentPassId = id;
    document.getElementById("modalId").textContent = `#${id}`;
    document.getElementById("modalName").textContent = name;
    document.getElementById("modalPhone").textContent = phone;
    document.getElementById("modalHost").textContent = host;
    document.getElementById("modalTime").textContent = time;
    document.getElementById("modalDeadline").textContent = deadline;

    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
        text: `${window.location.origin}/pass/${id}`,
        width: 120,
        height: 120
    });

    document.getElementById("passModal").style.display = "flex";
}

function openEPassUrl() {
    if (currentPassId) window.open(`/pass/${currentPassId}`, '_blank');
}

function closeModal() {
    document.getElementById("passModal").style.display = "none";
}

function exportCSV() {
    if (allVisitors.length === 0) {
        alert("No visitor data to export.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,Pass ID,Name,Phone,Host,Purpose,Entry Time,Deadline,Exit Time,Extended,Notes,Status\n";
    allVisitors.forEach(v => {
        csvContent += `"${v.id}","${v.name}","${v.phone}","${v.host}","${v.purpose}","${v.entry_time}","${v.deadline_time}","${v.exit_time}","${v.is_extended ? 'YES' : 'NO'}","${v.extension_note}","${v.status}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `campus_gatepass_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}