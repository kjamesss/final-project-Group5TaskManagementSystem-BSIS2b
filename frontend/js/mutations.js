const mutationFields = {
    tasks: [
        { key: 'title', label: 'Task title', required: true, maxLength: 150 },
        { key: 'description', label: 'Description', type: 'textarea', maxLength: 2000 },
        { key: 'dueDate', label: 'Due date', type: 'date', required: true },
        { key: 'priority', label: 'Priority', options: ['Low', 'Medium', 'High'] },
        { key: 'status', label: 'Status', options: ['To Do', 'In Progress', 'Completed'] },
        { key: 'category', label: 'Subject', options: [] }
    ],
    categories: [
        { key: 'name', label: 'Subject name', required: true, maxLength: 100 },
        { key: 'color', label: 'Display color (optional hex value)', placeholder: '#b32c68', pattern: '#[0-9a-fA-F]{6}' }
    ],
    users: [
        { key: 'name', label: 'Full name', required: true, maxLength: 100 },
        { key: 'email', label: 'Email address', type: 'email', required: true, maxLength: 254 }
    ]
};
const recordNames = { tasks: 'task', categories: 'subject', users: 'account' };
const deleteNotes = {
    tasks: 'The task will be permanently removed.',
    categories: 'The subject will be removed. Its tasks will become uncategorized.',
    users: 'The account will be removed if it has no saved tasks or subjects.'
};

function mutationActions(resource, record, categories = [], allowDelete = true) {
    const actions = element('div', undefined, 'd-flex flex-wrap gap-2');
    const methods = allowDelete ? ['PUT', 'DELETE'] : ['PUT'];
    for (const method of methods) {
        const editing = method === 'PUT';
        const button = element('button', editing ? 'Edit' : 'Delete',
            'btn btn-sm ' + (editing ? 'btn-outline-primary' : 'btn-outline-danger'));
        button.type = 'button';
        button.dataset.id = record._id;
        button.setAttribute('aria-label', button.textContent + ' ' + (record.title || record.name));
        button.addEventListener('click', () => openMutation(resource, record, method, categories, button));
        actions.append(button);
    }
    return actions;
}

function editControl(field, record, categories) {
    const group = element('div');
    const id = 'change-' + field.key;
    const label = element('label', field.label, 'form-label');
    label.htmlFor = id;
    const control = element(field.options ? 'select' : field.type === 'textarea' ? 'textarea' : 'input',
        undefined, field.options ? 'form-select' : 'form-control');
    control.id = id;
    control.name = field.key;
    if (control.tagName === 'INPUT') control.type = field.type || 'text';
    if (field.required) control.required = true;
    if (field.maxLength) control.maxLength = field.maxLength;
    if (field.pattern) control.pattern = field.pattern;
    if (field.placeholder) control.placeholder = field.placeholder;
    if (field.options) {
        const options = field.key === 'category'
            ? [new Option('Uncategorized', ''), ...categories.map(item => new Option(item.name, item._id))]
            : field.options.map(value => new Option(value, value));
        control.replaceChildren(...options);
    }
    const value = record[field.key];
    control.value = (field.key === 'category' ? value?._id : field.key === 'dueDate' ? value?.slice(0, 10) : value) ?? '';
    group.append(label, control);
    return group;
}

function openMutation(resource, record, method, categories, trigger) {
    const dialog = document.querySelector('#mutation-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(dialog);
    const form = dialog.querySelector('form');
    const editing = method === 'PUT';
    const title = record.title || record.name;
    dialog.querySelector('h2').textContent = (editing ? 'Edit ' : 'Delete ') + recordNames[resource];
    const fields = dialog.querySelector('#mutation-fields');
    fields.replaceChildren(...(editing
        ? mutationFields[resource].map(field => editControl(field, record, categories))
        : [element('p', 'Delete “' + title + '”? ' + deleteNotes[resource], 'mb-0')]));
    const submit = form.querySelector('[type="submit"]');
    submit.className = 'btn ' + (editing ? 'btn-primary' : 'btn-danger');
    submit.textContent = editing ? 'Save changes' : 'Confirm delete';
    submit.disabled = false;
    const notice = form.querySelector('[role="status"]');
    notice.className = 'd-none';
    notice.textContent = '';
    let busy = false;
    let savedMessage = '';
    const preventClose = event => { if (busy) event.preventDefault(); };
    dialog.addEventListener('hide.bs.modal', preventClose);
    dialog.addEventListener('shown.bs.modal', () => {
        (editing ? fields.querySelector('input, select, textarea') : form.querySelector('[data-bs-dismiss]'))?.focus();
    }, { once: true });
    dialog.addEventListener('hidden.bs.modal', () => {
        dialog.removeEventListener('hide.bs.modal', preventClose);
        if (savedMessage) refreshView(savedMessage);
        else trigger.focus();
    }, { once: true });

    form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        const payload = Object.fromEntries(new FormData(form));
        if (editing && (payload.title ?? payload.name ?? '').trim() === '') {
            formMessage(form, 'Enter a name or title with at least one visible character.', false);
            return;
        }
        busy = true;
        submit.disabled = true;
        form.setAttribute('aria-busy', 'true');
        try {
            const result = await apiRequest('/api/' + resource + '/' + encodeURIComponent(record._id), {
                method,
                ...(editing && { body: JSON.stringify(payload) })
            });
            savedMessage = result.message;
            busy = false;
            modal.hide();
        } catch (error) {
            formMessage(form, error instanceof TypeError ? 'Unable to reach the server.' :
                error.name === 'AbortError' ? 'The request timed out. Refresh the list before retrying.' : error.message, false);
        } finally {
            busy = false;
            submit.disabled = false;
            form.removeAttribute('aria-busy');
        }
    };
    modal.show();
}
