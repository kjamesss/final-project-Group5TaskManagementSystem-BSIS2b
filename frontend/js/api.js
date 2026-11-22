// The backend serves the frontend on port 3000. Live Server can use port 5500
// on the same hostname. Keep credentials enabled for the HttpOnly session cookie.
const API_BASE = location.port === '5500' ? location.protocol + '//' + location.hostname + ':3000' : '';
const apiForms = {
    register: '/api/users',
    login: '/api/login',
    'create-task': '/api/tasks',
    'create-category': '/api/categories'
};

async function apiRequest(route, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(API_BASE + route, {
            ...options, credentials: 'include', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...options.headers }
        });
        const data = await response.json().catch(() => {
            throw new Error('The server returned an unexpected response. Check that the API is running.');
        });
        if (!response.ok) {
            const error = new Error(data.message || 'Your request could not be completed.');
            error.status = response.status;
            throw error;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

function formMessage(form, message, success) {
    const feedback = form.querySelector('[role="status"]');
    feedback.className = 'form-feedback alert ' + (success ? 'alert-success' : 'alert-danger');
    feedback.textContent = message;
    feedback.tabIndex = -1;
    feedback.focus();
}

async function loadSubjects() {
    const data = await apiRequest('/api/categories');
    fillSubjectOptions(data.categories);
}

function fillSubjectOptions(categories) {
    document.querySelectorAll('form[data-api] [name="category"]').forEach(select => {
        const previous = select.value;
        select.replaceChildren(new Option('Uncategorized', ''));
        categories.forEach(category => select.add(new Option(category.name, category._id)));
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
}

document.querySelectorAll('form[data-api]').forEach(form => {
    form.querySelectorAll('input[type="text"][required]').forEach(input => {
        input.pattern = '.*\\S.*';
        input.title = 'Enter at least one visible character.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (form.dataset.submitting === 'true') return;
        const payload = Object.fromEntries(new FormData(form));
        if (payload.password && (payload.password.length < 8 || new TextEncoder().encode(payload.password).length > 72)) {
            formMessage(form, 'Use a password of at least 8 characters and at most 72 bytes.', false);
            return;
        }
        const button = form.querySelector('[type="submit"]');
        const original = button.textContent;
        form.dataset.submitting = 'true';
        button.disabled = true;
        button.textContent = 'Saving…';
        form.setAttribute('aria-busy', 'true');
        try {
            const data = await apiRequest(apiForms[form.id], { method: 'POST', body: JSON.stringify(payload) });
            console.info('POST ' + apiForms[form.id] + ' succeeded');
            const record = data.task || data.category || data.user;
            form.reset();
            formMessage(form, data.message + (record ? ' Record ID: ' + record._id + '.' : ''), true);
            if (form.id === 'register' || form.id === 'login') {
                const next = document.querySelector('#account-next');
                if (data.user.role === 'admin' && next) {
                    next.querySelector('a').href = 'admin.html';
                    next.querySelector('a').textContent = 'Open administration';
                }
                next?.classList.remove('d-none');
            }
            if (form.id === 'create-category') {
                await loadSubjects().catch(() => {
                    formMessage(form, data.message + ' Reload the page to refresh your subject choices.', true);
                });
            }
            window.dispatchEvent(new Event('record-saved'));
        } catch (error) {
            const message = error.name === 'AbortError' ? 'The request timed out. Check your connection before trying again.' :
                error instanceof TypeError ? 'Cannot reach the API. Check that the backend is running and try again.' : error.message;
            formMessage(form, message, false);
        } finally {
            form.dataset.submitting = 'false';
            button.disabled = false;
            button.textContent = original;
            form.removeAttribute('aria-busy');
        }
    });
});

if (document.querySelector('form[data-api] [name="category"]')) {
    loadSubjects().catch(error => {
        const notice = document.querySelector('#session-notice');
        if (notice) notice.textContent = error instanceof TypeError ?
            'Start the backend to connect this form to your account.' : error.message;
    });
}
