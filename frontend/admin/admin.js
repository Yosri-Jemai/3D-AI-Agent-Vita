const API_BASE_URL = "http://localhost:8080/api/v1";

const authSection = document.getElementById("authSection");
const dashboardSection = document.getElementById("dashboardSection");
const authMessage = document.getElementById("authMessage");
const adminIdentity = document.getElementById("adminIdentity");
let sessionsChart;
let productsChart;
let performanceChart;

function setMessage(text, type = "error") {
    authMessage.textContent = text;
    authMessage.className = `message ${type}`;
}

function clearMessage() {
    authMessage.textContent = "";
    authMessage.className = "message";
}

function getToken() {
    return localStorage.getItem("auth_token");
}

function getUser() {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveAuth(token, user) {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("user", JSON.stringify(user));
}

function logoutAdmin() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user");
    location.href = "/admin/admin.html";
}

async function request(path, options = {}) {
    const token = getToken();
    const isPublicPath = path === "/admin/register" || path === "/login" || path === "/auth-health";
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };
    if (token && !isPublicPath) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers
    });
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }
    if (!response.ok) {
        const backendMessage = data.message || data.error || data.details;
        if (response.status === 403) {
            throw new Error(backendMessage || "Acces refuse (403). Redemarre le backend pour charger les nouvelles routes admin.");
        }
        if (response.status === 404) {
            throw new Error(backendMessage || "Endpoint introuvable (404). Verifie que le backend est relance avec la version admin.");
        }
        throw new Error(backendMessage || `Erreur API (${response.status})`);
    }
    return data;
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("fr-FR");
}

function normalizeMode(mode) {
    const value = String(mode || "").toLowerCase();
    if (value === "medical") return "Medical";
    if (value === "commercial" || value === "vita_commercial") return "Commercial";
    return mode || "-";
}

async function loadProfilesMap() {
    try {
        const profiles = await request("/profiles");
        return profiles.reduce((acc, profile) => {
            acc[String(profile.id)] = profile.fullName || `Utilisateur ${profile.id}`;
            return acc;
        }, {});
    } catch {
        return {};
    }
}

function renderCards(containerId, entries) {
    const container = document.getElementById(containerId);
    container.innerHTML = entries.map(([label, value]) => `
        <div class="stat-card">
            <div class="label">${label}</div>
            <div class="value">${value}</div>
        </div>
    `).join("");
}

function renderLatestSessions(sessions, profilesMap = {}) {
    const body = document.getElementById("latestSessionsBody");
    if (!sessions.length) {
        body.innerHTML = `<tr><td colspan="5">Aucune session medicale disponible.</td></tr>`;
        return;
    }
    body.innerHTML = sessions.map((session) => `
        <tr>
            <td>${session.sessionUuid || "-"}</td>
            <td>${session.profileName || profilesMap[String(session.profileId)] || "Utilisateur inconnu"}</td>
            <td>${normalizeMode(session.mode)}</td>
            <td>${formatDate(session.startedAt)}</td>
            <td>${formatDate(session.endedAt)}</td>
        </tr>
    `).join("");
}

function renderTopProducts(products) {
    const body = document.getElementById("topProductsBody");
    body.innerHTML = products.map((product) => `
        <tr>
            <td>${product.product}</td>
            <td>${product.mentions}</td>
        </tr>
    `).join("");
}

function buildDelegatesPerformanceRows(latestSessions = [], completionRate = 0, avgEngagement = 0, profilesMap = {}) {
    const map = new Map();
    latestSessions.forEach((session) => {
        const id = session.profileId ?? "N/A";
        if (!map.has(id)) {
            map.set(id, {
                profileId: id,
                delegateName: session.profileName || profilesMap[String(id)] || "Utilisateur inconnu",
                sessions: 0,
                medical: 0,
                commercial: 0
            });
        }
        const item = map.get(id);
        item.sessions += 1;
        const mode = String(session.mode || "").toLowerCase();
        if (mode === "medical") item.medical += 1;
        if (mode === "commercial" || mode === "vita_commercial") item.commercial += 1;
    });

    const rows = Array.from(map.values()).map((item) => {
        const modeBalance = item.sessions ? ((item.medical + item.commercial) / item.sessions) * 100 : 0;
        const score = Math.min(
            100,
            Math.round((item.sessions * 15) + (completionRate * 0.45) + (avgEngagement * 0.40) + (modeBalance * 0.15))
        );
        let level = "A suivre";
        if (score >= 80) level = "Excellent";
        else if (score >= 60) level = "Bon";
        else if (score >= 40) level = "Moyen";

        return {
            profileId: item.profileId,
            delegateName: item.delegateName,
            sessions: item.sessions,
            score,
            level
        };
    });

    return rows.sort((a, b) => b.score - a.score);
}

function renderDelegatesPerformance(rows) {
    const body = document.getElementById("delegatesPerformanceBody");
    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="4">Aucune donnee delegate disponible.</td></tr>`;
        return;
    }
    body.innerHTML = rows.map((row) => `
        <tr>
            <td>${row.delegateName}</td>
            <td>${row.sessions}</td>
            <td>${row.score}%</td>
            <td>${row.level}</td>
        </tr>
    `).join("");
}

function drawSessionsChart(dashboard) {
    const canvas = document.getElementById("sessionsChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (sessionsChart) sessionsChart.destroy();

    sessionsChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Sessions medicales", "Sessions commerciales"],
            datasets: [{
                data: [dashboard.totalMedicalSessions ?? 0, dashboard.totalCommercialSessions ?? 0],
                backgroundColor: ["#2563eb", "#0ea5e9"],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: "bottom" }
            }
        }
    });
}

function drawProductsChart(commercial) {
    const canvas = document.getElementById("productsChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (productsChart) productsChart.destroy();

    const topProducts = (commercial.topProducts || []).slice(0, 6);
    productsChart = new Chart(canvas, {
        type: "bar",
        data: {
            labels: topProducts.map((p) => p.product),
            datasets: [{
                label: "Mentions",
                data: topProducts.map((p) => p.mentions),
                backgroundColor: "#16a34a",
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function drawPerformanceChart(rows) {
    const canvas = document.getElementById("performanceChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (performanceChart) performanceChart.destroy();

    const topDelegates = rows.slice(0, 8);
    performanceChart = new Chart(canvas, {
        type: "line",
        data: {
            labels: topDelegates.map((row) => row.delegateName),
            datasets: [{
                label: "Performance delegue (%)",
                data: topDelegates.map((row) => row.score),
                borderColor: "#f97316",
                backgroundColor: "rgba(249,115,22,0.18)",
                fill: true,
                tension: 0.35,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

async function loadDashboardAndCommercial() {
    const [dashboard, commercial, profilesMap] = await Promise.all([
        request("/admin/dashboard-stats"),
        request("/admin/commercial-tracking"),
        loadProfilesMap()
    ]);

    renderCards("statsCards", [
        ["Utilisateurs", dashboard.totalUsers ?? 0],
        ["Delegues", dashboard.totalDelegates ?? 0],
        ["Professionnels", dashboard.totalProfessionals ?? 0],
        ["Admins", dashboard.totalAdmins ?? 0],
        ["Sessions medicales", dashboard.totalMedicalSessions ?? 0],
        ["Sessions commerciales", dashboard.totalCommercialSessions ?? 0],
        ["Evaluations", dashboard.totalEvaluations ?? 0],
        ["Taux de progression", `${dashboard.completionRate ?? 0}%`]
    ]);
    renderLatestSessions(dashboard.latestSessions || [], profilesMap);
    renderCards("commercialCards", [
        ["Extractions recentes", commercial.recentExtractions ?? 0],
        ["Score engagement moyen", commercial.averageEngagementScore ?? 0],
        ["Delegues actifs (commercial)", commercial.delegatesActiveInCommercialMode ?? 0]
    ]);
    renderTopProducts(commercial.topProducts || []);

    const rows = buildDelegatesPerformanceRows(
        dashboard.latestSessions || [],
        Number(dashboard.completionRate || 0),
        Number(commercial.averageEngagementScore || 0),
        profilesMap
    );
    renderDelegatesPerformance(rows);
    drawSessionsChart(dashboard);
    drawProductsChart(commercial);
    drawPerformanceChart(rows);
}

async function openAdminDashboard() {
    const user = getUser();
    if (!user || user.role !== "ADMIN") {
        throw new Error("Compte admin requis.");
    }
    adminIdentity.textContent = `${user.fullName} (${user.email})`;
    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    await loadDashboardAndCommercial();
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        clearMessage();
        document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((el) => el.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(tab.dataset.target).classList.add("active");
    });
});

document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".view-btn").forEach((el) => el.classList.remove("active"));
        document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.view).classList.add("active");
    });
});

document.getElementById("adminRegisterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    try {
        await request("/admin/register", {
            method: "POST",
            body: JSON.stringify({
                fullName: document.getElementById("adminFullName").value.trim(),
                email: document.getElementById("adminEmail").value.trim(),
                numTelephone: document.getElementById("adminPhone").value.trim(),
                password: document.getElementById("adminPassword").value,
                role: "ADMIN"
            })
        });
        setMessage("Compte admin cree avec succes. Connectez-vous maintenant.", "success");
    } catch (error) {
        setMessage(error.message, "error");
    }
});

document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();
    try {
        const result = await request("/login", {
            method: "POST",
            body: JSON.stringify({
                email: document.getElementById("adminLoginEmail").value.trim(),
                password: document.getElementById("adminLoginPassword").value
            })
        });
        if (!result.user || result.user.role !== "ADMIN") {
            throw new Error("Ce compte n'est pas admin.");
        }
        saveAuth(result.token, result.user);
        await openAdminDashboard();
    } catch (error) {
        setMessage(error.message, "error");
    }
});

document.getElementById("logoutBtn").addEventListener("click", logoutAdmin);

(async function init() {
    const user = getUser();
    const token = getToken();
    if (user?.role === "ADMIN" && token) {
        try {
            await openAdminDashboard();
        } catch (error) {
            logoutAdmin();
        }
    }
})();
