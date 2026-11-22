const view = document.querySelector('[data-view]').dataset.view;
const feedback = document.querySelector('#view-feedback');
const results = [...document.querySelectorAll('[data-results]')];
const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' });
const statuses = ['To Do', 'In Progress', 'Completed'];
let refreshVersion = 0;

function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
}

function dateLabel(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.valueOf()) ? dateFormat.format(date) : '—';
}

function taskDay(task) {
    return task.dueDate?.slice(0, 10) || '';
}

function showFeedback(message, error) {
    if (!feedback) return;
    feedback.replaceChildren();
    feedback.className = message ? 'alert ' + (error ? 'alert-danger' : 'alert-light') : '';
    if (!message) return;
    feedback.append(element('span', message));
    if (error) {
        const action = error.status === 401 || error.status === 403
            ? element('a', 'Log in', 'btn btn-sm btn-outline-primary ms-2')
            : element('button', 'Retry', 'btn btn-sm btn-outline-primary ms-2');
        if (action.tagName === 'A') action.href = 'login.html';
        else action.addEventListener('click', refreshView);
        feedback.append(action);
    }
}

function createList(container, controls, renderRow, emptyRow, pageSize = 5) {
    let page = 1;
    let records = [];

    function draw() {
        const pages = Math.max(1, Math.ceil(records.length / pageSize));
        page = Math.min(page, pages);
        const start = (page - 1) * pageSize;
        const rows = records.slice(start, start + pageSize).map(renderRow);
        container.replaceChildren(...(rows.length ? rows : [emptyRow()]));

        const bar = element('div', undefined, 'd-flex flex-wrap gap-2 align-items-center justify-content-between py-3');
        const label = element('span', records.length
            ? 'Showing ' + (start + 1) + '–' + Math.min(start + pageSize, records.length) + ' of ' + records.length
            : '0 results', 'small text-secondary');
        label.setAttribute('role', 'status');
        const buttons = element('div', undefined, 'd-flex gap-2');
        for (const [text, offset, disabled] of [['Previous', -1, page === 1], ['Next', 1, page === pages]]) {
            const button = element('button', text, 'btn btn-sm btn-outline-primary');
            button.type = 'button';
            button.disabled = disabled;
            button.addEventListener('click', () => {
                page += offset;
                draw();
                const replacement = [...controls.querySelectorAll('button')];
                (replacement.find(item => item.textContent === text && !item.disabled) ||
                    replacement.find(item => !item.disabled))?.focus();
            });
            buttons.append(button);
        }
        bar.append(label, buttons);
        controls.replaceChildren(bar);
    }

    return (items, reset = true) => {
        records = items;
        if (reset) page = 1;
        draw();
    };
}

function statusBadge(status) {
    const colors = { 'To Do': 'todo', 'In Progress': 'progress-tag', Completed: 'completed' };
    return element('span', status, 'chip ' + (colors[status] || 'todo'));
}

function taskCard(task) {
    const card = element('article', undefined, 'task-row');
    const description = element('div');
    description.append(element('h3', task.title), element('div', task.category?.name || 'Uncategorized', 'task-subject'));
    if (task.description) description.append(element('p', task.description));
    card.append(description, element('div', dateLabel(task.dueDate)),
        element('div', task.priority), statusBadge(task.status));
    card.classList.add('editable-task');
    card.append(mutationActions('tasks', task, subjectRecords));
    return card;
}

function renderDashboard(tasks) {
    const summary = statuses.map(status => {
        const cell = element('div', undefined, 'col-4 summary-cell');
        cell.append(element('strong', tasks.filter(task => task.status === status).length), element('span', status));
        return cell;
    });
    document.querySelector('#task-summary').replaceChildren(...summary);
    const today = new Date(dayFormat.format(new Date()) + 'T00:00:00Z');
    const start = today.toISOString().slice(0, 10);
    today.setUTCDate(today.getUTCDate() + 7);
    const end = today.toISOString().slice(0, 10);
    const incomplete = tasks.filter(task => task.status !== 'Completed' && taskDay(task));

    for (const [selector, items, empty] of [
        ['#upcoming-list', incomplete.filter(task => taskDay(task) >= start && taskDay(task) <= end), 'No upcoming deadlines.'],
        ['#overdue-list', incomplete.filter(task => taskDay(task) < start), 'No overdue tasks.']
    ]) {
        const rows = items.map(task => {
            const row = element('div', undefined, 'deadline-item');
            const details = element('div');
            const link = element('a', task.title);
            link.href = 'tasks.html?q=' + encodeURIComponent(task.title);
            details.append(link, element('small', task.category?.name || 'Uncategorized'));
            row.append(details, element('span', dateLabel(task.dueDate), 'deadline-date'));
            return row;
        });
        document.querySelector(selector).replaceChildren(...(rows.length ? rows : [element('p', empty, 'section-note mb-0')]));
    }
}

const filters = document.querySelector('#task-filters');
let taskRecords = [];
let subjectRecords = [];
let userRecords = [];

const drawTasks = filters && createList(
    document.querySelector('#task-list'), document.querySelector('#task-pages'), taskCard,
    () => element('p', taskRecords.length ? 'No matching tasks.' : 'No tasks yet. Use New task to add one.', 'section-note py-3')
);

function applyTaskFilters(reset = true) {
    const values = new FormData(filters);
    const query = values.get('q').trim().toLowerCase();
    const category = values.get('category');
    const status = values.get('status');
    const priority = values.get('priority');
    const matches = taskRecords.filter(task =>
        (!query || [task.title, task.description, task.category?.name].join(' ').toLowerCase().includes(query)) &&
        (!category || (task.category?._id || 'uncategorized') === category) &&
        (!status || task.status === status) && (!priority || task.priority === priority)
    );
    document.querySelector('#task-count').textContent = matches.length + ' of ' + taskRecords.length + ' tasks';
    drawTasks(matches, reset);
}

if (filters) {
    filters.elements.q.value = new URLSearchParams(location.search).get('q') || '';
    filters.addEventListener('input', () => applyTaskFilters());
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('reset', () => setTimeout(() => applyTaskFilters(), 0));
}

function tableRow(values) {
    const row = element('tr');
    values.forEach(value => {
        const cell = element('td');
        cell.append(value instanceof Node ? value : document.createTextNode(value ?? '—'));
        row.append(cell);
    });
    return row;
}

function emptyTable(message, columns) {
    const row = tableRow([message]);
    row.firstElementChild.colSpan = columns;
    row.firstElementChild.className = 'text-secondary py-3';
    return row;
}

const accountSearch = document.querySelector('#account-search');
const drawAccounts = accountSearch && createList(
    document.querySelector('#admin-accounts'), document.querySelector('#account-pages'),
    user => tableRow([user.name, user.email, user.role === 'admin' ? 'Administrator' : 'Student',
        user.role === 'user' ? mutationActions('users', user) : '—']),
    () => emptyTable('No matching accounts.', 4)
);
const drawAdminTasks = accountSearch && createList(
    document.querySelector('#admin-tasks'), document.querySelector('#admin-task-pages'),
    task => tableRow([task.title, task.owner?.name, dateLabel(task.dueDate), task.priority, statusBadge(task.status)]),
    () => emptyTable('No saved tasks.', 5)
);

function applyAccountSearch() {
    const query = accountSearch.value.trim().toLowerCase();
    drawAccounts(userRecords.filter(user => [user.name, user.email, user.role === 'admin' ? 'Administrator' : 'Student']
        .join(' ').toLowerCase().includes(query)));
}
accountSearch?.addEventListener('input', applyAccountSearch);

async function refreshView(savedMessage = '') {
    const version = ++refreshVersion;
    results.forEach(section => { section.hidden = true; });
    showFeedback('Loading saved data…');
    try {
        const { user } = await apiRequest('/api/session');
        if (version !== refreshVersion) return;
        const logout = document.querySelector('#logout');
        logout?.classList.remove('d-none');
        document.querySelector('.navbar a[href="login.html"]')?.classList.add('d-none');
        if (view === 'dashboard') {
            const { tasks } = await apiRequest('/api/tasks');
            if (version !== refreshVersion) return;
            renderDashboard(tasks);
        } else if (view === 'tasks') {
            const [{ tasks }, { categories }] = await Promise.all([apiRequest('/api/tasks'), apiRequest('/api/categories')]);
            if (version !== refreshVersion) return;
            taskRecords = tasks;
            subjectRecords = categories;
            const select = filters.elements.category;
            const selected = select.value;
            select.replaceChildren(new Option('Any subject', ''), new Option('Uncategorized', 'uncategorized'),
                ...categories.map(category => new Option(category.name, category._id)));
            if ([...select.options].some(option => option.value === selected)) select.value = selected;
            applyTaskFilters(false);
            const subjects = document.querySelector('#subject-list');
            subjects.replaceChildren(...(categories.length ? categories.map(subject => {
                const row = element('div', undefined, 'd-flex flex-wrap gap-2 align-items-center justify-content-between border-top py-2');
                row.append(element('span', subject.name), mutationActions('categories', subject));
                return row;
            }) : [element('p', 'No subjects yet. Use New subject to add one.', 'section-note mb-0')]));
            fillSubjectOptions(categories);
        } else if (view === 'admin') {
            const [{ users }, { tasks }] = await Promise.all([apiRequest('/api/users'), apiRequest('/api/admin/tasks')]);
            if (version !== refreshVersion) return;
            userRecords = users;
            applyAccountSearch();
            drawAdminTasks(tasks);
        } else if (view === 'profile') {
            const fields = [['Name', user.name], ['Email', user.email],
                ['Role', user.role === 'admin' ? 'Administrator' : 'Student'], ['Joined', dateLabel(user.createdAt)]];
            document.querySelector('#profile-details').replaceChildren(...fields.map(([label, value]) => {
                const row = element('div');
                row.append(element('dt', label), element('dd', value));
                return row;
            }));
            document.querySelector('#profile-actions').replaceChildren(mutationActions('users', user, [], false));
        }
        results.forEach(section => { section.hidden = false; });
        showFeedback(savedMessage);
        if (savedMessage && feedback) {
            feedback.className = 'alert alert-success';
            feedback.tabIndex = -1;
            feedback.focus();
        }
    } catch (error) {
        if (version !== refreshVersion) return;
        const message = error instanceof TypeError ? 'Unable to reach the server.' :
            error.name === 'AbortError' ? 'The server took too long to respond.' : error.message;
        showFeedback(savedMessage ? savedMessage + ' The list could not refresh. ' + message : message, error);
    }
}

document.querySelector('#logout')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await apiRequest('/api/logout', { method: 'POST' });
        location.assign('login.html');
    } catch (error) {
        showFeedback('Unable to log out. Try again.', error);
        button.disabled = false;
    }
});
window.addEventListener('record-saved', () => {
    if (view === 'tasks') refreshView();
});
refreshView();
