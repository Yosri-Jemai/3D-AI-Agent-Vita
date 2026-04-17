// Configuration de l'API
const API_BASE_URL = 'http://localhost:8080/api/v1';  // ← AJOUT DU CONTEXT-PATH /api/v1

console.log('🔧 Auth.js chargé - API Spring Boot sur:', API_BASE_URL);

// Éléments DOM
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginMessage = document.getElementById('loginMessage');
const registerMessage = document.getElementById('registerMessage');
const toggleBtns = document.querySelectorAll('.toggle-btn');

// Gestion des onglets
toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const formType = btn.dataset.form;
        
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.getElementById('signin-form').classList.remove('active');
        document.getElementById('signup-form').classList.remove('active');
        document.getElementById(`${formType}-form`).classList.add('active');
        
        clearMessages();
    });
});

function clearMessages() {
    loginMessage.className = 'message';
    loginMessage.style.display = 'none';
    registerMessage.className = 'message';
    registerMessage.style.display = 'none';
}

function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `message ${type}`;
    element.style.display = 'block';
    
    setTimeout(() => {
        if (element.style.display === 'block') {
            element.style.display = 'none';
        }
    }, 8000);
}

function setLoading(button, isLoading, originalText = null) {
    if (isLoading) {
        button.disabled = true;
        button.innerHTML = '<span class="spinner"></span> Chargement...';
    } else {
        button.disabled = false;
        button.innerHTML = originalText || button.getAttribute('data-original-text') || 'Se connecter';
    }
}

function saveAuthData(token, user) {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    
    // Format compatible avec vos pages
    const sessionUser = {
        id: user.id,
        firstname: user.fullName?.split(' ')[0] || '',
        lastname: user.fullName?.split(' ').slice(1).join(' ') || '',
        email: user.email,
        role: user.role === 'DELEGATE' ? 'commercial' : 'professional',
        fullName: user.fullName,
        numTelephone: user.numTelephone
    };
    sessionStorage.setItem('vita_user', JSON.stringify(sessionUser));
}

function clearAuthData() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('vita_user');
}

function redirectBasedOnRole(role) {
    console.log('🔄 Redirection basée sur le rôle:', role);
    if (role === 'DELEGATE') {
        window.location.href = 'commercial.html';
    } else if (role === 'PROFESSIONAL') {
        window.location.href = 'index.html';
    }
}

function checkAlreadyLoggedIn() {
    const token = localStorage.getItem('auth_token');
    const userJson = localStorage.getItem('user');
    
    if (token && userJson) {
        try {
            const user = JSON.parse(userJson);
            console.log('✅ Déjà connecté:', user.fullName, user.role);
            redirectBasedOnRole(user.role);
            return true;
        } catch(e) {
            console.error('Erreur parsing user:', e);
        }
    }
    return false;
}

// Vérifier au chargement
if (!checkAlreadyLoggedIn()) {
    console.log('🔓 Non connecté, formulaire affiché');
}

// Test de connexion au backend
async function testBackendConnection() {
    try {
        console.log('🔌 Test de connexion à', API_BASE_URL);
        const response = await fetch(`${API_BASE_URL}/auth-health`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend accessible:', data);
            return true;
        }
        console.log('⚠️ Backend réponse non OK:', response.status);
        return false;
    } catch (error) {
        console.error('❌ Backend inaccessible:', error.message);
        showMessage(loginMessage, '⚠️ Impossible de contacter le serveur. Vérifiez que Spring Boot tourne sur le port 8080.', 'error');
        return false;
    }
}

// Tester la connexion au chargement
setTimeout(() => testBackendConnection(), 1000);

// Formulaire de connexion
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = loginForm.querySelector('.btn-submit');
    
    console.log('🔐 Tentative de login pour:', email);
    
    submitBtn.setAttribute('data-original-text', submitBtn.textContent);
    setLoading(submitBtn, true, 'Se connecter');
    
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });
        
        console.log('📡 Réponse reçue, status:', response.status);
        const data = await response.json();
        console.log('📦 Données reçues:', data);
        
        if (response.ok) {
            saveAuthData(data.token, data.user);
            showMessage(loginMessage, '✅ Connexion réussie ! Redirection...', 'success');
            
            setTimeout(() => {
                redirectBasedOnRole(data.user.role);
            }, 1500);
        } else {
            let errorMessage = 'Email ou mot de passe incorrect';
            if (data.message === 'Account Not Active') {
                errorMessage = '⚠️ Votre compte n\'est pas encore activé. Vérifiez vos emails.';
            } else if (data.message) {
                errorMessage = data.message;
            }
            showMessage(loginMessage, `❌ ${errorMessage}`, 'error');
            setLoading(submitBtn, false);
        }
    } catch (error) {
        console.error('❌ Erreur réseau:', error);
        let errorMsg = '❌ Erreur de connexion au serveur.\n\n';
        errorMsg += 'Vérifications :\n';
        errorMsg += '1. Spring Boot est-il démarré ? (port 8080)\n';
        errorMsg += '2. Le context-path est /api/v1\n';
        errorMsg += '3. URL complète: ' + API_BASE_URL;
        showMessage(loginMessage, errorMsg, 'error');
        setLoading(submitBtn, false);
    }
});

// Formulaire d'inscription
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const numTelephone = document.getElementById('numTelephone').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const role = document.getElementById('role').value;
    const submitBtn = registerForm.querySelector('.btn-submit');
    
    console.log('📝 Tentative d\'inscription pour:', email);
    console.log('📍 URL:', `${API_BASE_URL}/register`);
    
    if (password !== confirmPassword) {
        showMessage(registerMessage, '❌ Les mots de passe ne correspondent pas', 'error');
        return;
    }
    
    if (password.length < 6) {
        showMessage(registerMessage, '❌ Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    submitBtn.setAttribute('data-original-text', submitBtn.textContent);
    setLoading(submitBtn, true, 'Créer mon compte');
    
    try {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fullName,
                email,
                numTelephone,
                password,
                role
            })
        });
        
        console.log('📡 Réponse inscription, status:', response.status);
        
        if (response.status === 201 || response.ok) {
            const data = await response.json();
            console.log('✅ Inscription réussie:', data);
            showMessage(
                registerMessage, 
                '✅ Inscription réussie ! Un email d\'activation vous a été envoyé. Vérifiez votre boîte mail.',
                'success'
            );
            
            registerForm.reset();
            
            setTimeout(() => {
                document.querySelector('[data-form="signin"]').click();
                showMessage(loginMessage, '🎉 Compte créé ! Connectez-vous après activation.', 'info');
            }, 3000);
            
            setLoading(submitBtn, false);
        } else {
            const data = await response.json();
            let errorMessage = 'Erreur lors de l\'inscription';
            if (data.message) {
                errorMessage = data.message;
            }
            showMessage(registerMessage, `❌ ${errorMessage}`, 'error');
            setLoading(submitBtn, false);
        }
    } catch (error) {
        console.error('❌ Erreur réseau inscription:', error);
        showMessage(registerMessage, `❌ Erreur de connexion au serveur. Vérifiez que Spring Boot tourne sur ${API_BASE_URL}`, 'error');
        setLoading(submitBtn, false);
    }
});

window.logout = function() {
    clearAuthData();
    window.location.href = 'auth.html';
};