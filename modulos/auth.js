// ==============================================================================
// === modulos/auth.js ===
// ==============================================================================

// ── Firebase Auth ──────────────────────────────────────────────────────────────
import {
    getAuth,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signOut,
    sendPasswordResetEmail,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// ── Estado global ──────────────────────────────────────────────────────────────
import {
    auth,
    setAuth,
    currentUser,
    setCurrentUser,
    currentPerfil,
    setCurrentPerfil,
    setActivePersonId,
    setActivePersonName,
    getWeekStart,
    currentWeekStart,
    setCurrentWeekStart,
} from './state.js';

// ── Otros módulos ──────────────────────────────────────────────────────────────
import { showOnboardingModal }                    from './onboarding.js';
import { setupSummaryClickHandlers,
         updateActiveUserUI, showToast }          from './ui.js';
import { setupRealtimeListener }                  from './firestore.js';
import { getElements }                            from './elements.js';
import { setupWeekNavigation }                    from '../script_dev.js';
import { deleteLogItem }                          from '../script_dev.js';
import { inicializarUIComidas } from "./ui_recetas.js";
const elements = getElements();

export function switchAuthTab(tab) {
            _authTab = tab;
            document.getElementById('tab-login').classList.toggle('active', tab === 'login');
            document.getElementById('tab-register').classList.toggle('active', tab === 'register');
            document.getElementById('register-extra').style.display = tab === 'register' ? 'block' : 'none';
            document.getElementById('forgot-wrap').style.display    = tab === 'login'    ? 'block' : 'none';
            document.getElementById('auth-submit-btn').textContent  = tab === 'login'    ? 'Ingresar' : 'Crear cuenta';
            document.getElementById('auth-password').autocomplete   = tab === 'login'    ? 'current-password' : 'new-password';
            clearAuthError();
        }
// ==============================================================================
// === AUTENTICACIÓN ============================================================
// ==============================================================================

export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        showLoadingButton('auth-submit-btn', true);
        await signInWithPopup(auth, provider);
        // onAuthStateChanged en script_dev.js toma el control desde acá
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton('auth-submit-btn', false);
    }
}

export async function loginWithEmail(email, password) {
    try {
        showLoadingButton('auth-submit-btn', true);
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton('auth-submit-btn', false);
    }
}

export async function registerWithEmail(email, password, displayName) {
    try {
        showLoadingButton('auth-submit-btn', true);
        const result = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(result.user, { displayName });
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    } finally {
        showLoadingButton('auth-submit-btn', false);
    }
}

export async function logout() {
    try {
        await signOut(auth);
        // onAuthStateChanged → showAuthScreen() se llama automáticamente
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }
}

export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Te enviamos un email para restablecer tu contraseña.', 'success');
    } catch (error) {
        showAuthError(getAuthErrorMessage(error.code));
    }
}

export function getAuthErrorMessage(code) {
    const errors = {
        'auth/user-not-found':         'No existe una cuenta con ese email.',
        'auth/wrong-password':         'Contraseña incorrecta.',
        'auth/invalid-credential':     'Email o contraseña incorrectos.',
        'auth/email-already-in-use':   'Ese email ya está registrado.',
        'auth/invalid-email':          'El email no es válido.',
        'auth/weak-password':          'La contraseña debe tener al menos 6 caracteres.',
        'auth/too-many-requests':      'Demasiados intentos. Intentá más tarde.',
        'auth/popup-closed-by-user':   'Cerraste el popup antes de completar el login.',
        'auth/network-request-failed': 'Error de red. Verificá tu conexión.',
    };
    return errors[code] || `Error inesperado (${code}). Intentá de nuevo.`;
}


// ==============================================================================
// === UI DE AUTENTICACIÓN ======================================================
// ==============================================================================

export function showAuthScreen() {
    elements.authScreen.style.display = 'flex';
    elements.appMain.style.display    = 'none';
    elements.loadingIndicator.style.display    = 'none';
}

export function onLoginSuccess() {
    elements.authScreen.style.display = 'none';
    elements.appMain.style.display    = 'block';

    if (!currentPerfil?.onboarding_completado) {
        showOnboardingModal();
        return;
    }

    setActivePersonId(currentUser.uid);
    setActivePersonName(currentPerfil.display_name || currentPerfil.email);

    setCurrentWeekStart(getWeekStart(new Date()));
    setupWeekNavigation();
    setupSummaryClickHandlers();
    setupRealtimeListener();
    updateActiveUserUI();

    inicializarUIComidas();
    window.deleteLogItem = deleteLogItem;
}


// ==============================================================================
// === HELPERS INTERNOS =========================================================
// ==============================================================================

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
}

export function clearAuthError() {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = '';
    el.classList.remove('visible');
}

function showLoadingButton(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Cargando...`;
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    }
}