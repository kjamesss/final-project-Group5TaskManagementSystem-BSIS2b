const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { User, Task, Category } = require('../models');
let database;
let server;
let base;
let cookie;

async function request(route, body, auth = cookie, headers = {}) {
    return fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}), ...headers },
        body: JSON.stringify(body)
    });
}

before(async () => {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri('phase4_test'));
    await User.init();
    server = createApp({
        origins: ['http://localhost:5500'], secret: 'phase4-integration-test-secret-32-characters', production: false
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (database) await database.stop();
});

test('Registration saves a normalized account with a hash and server-selected user role', async () => {
    const response = await request('/api/users', {
        name: ' Phase Four Student ', email: 'PHASE4@EXAMPLE.TEST', password: 'LabPassword123!', role: 'admin'
    });
    assert.equal(response.status, 201);
    cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    const data = await response.json();
    assert.equal(data.user.role, 'user');
    assert.equal(data.user.email, 'phase4@example.test');
    assert.equal(data.user.passwordHash, undefined);
    const stored = await User.findById(data.user._id).select('+passwordHash');
    assert.equal(stored.name, 'Phase Four Student');
    assert.notEqual(stored.passwordHash, 'LabPassword123!');
    assert.match(stored.passwordHash, /^\$2/);
    assert.ok(stored.createdAt && stored.updatedAt);
});

test('Duplicate emails return 409 without adding an account', async () => {
    const response = await request('/api/users', { name: 'Other', email: 'phase4@example.test', password: 'LabPassword123!' });
    assert.equal(response.status, 409);
    assert.equal(await User.countDocuments(), 1);
});

test('Invalid and missing registration inputs return 400', async () => {
    for (const body of [{}, { name: ' ', email: 'bad', password: 'short' },
        { name: 'Test', email: { $ne: null }, password: 'LabPassword123!' },
        { name: 'Test', email: 'test@example.test', password: 'a'.repeat(73) }]) {
        assert.equal((await request('/api/users', body)).status, 400);
    }
});

test('Login rejects incorrect passwords and accepts normalized email', async () => {
    assert.equal((await request('/api/login', { email: 'phase4@example.test', password: 'wrong' })).status, 401);
    const response = await request('/api/login', { email: 'PHASE4@EXAMPLE.TEST', password: 'LabPassword123!' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.passwordHash, undefined);
});

test('Unauthenticated task and subject submissions return 401', async () => {
    assert.equal((await request('/api/tasks', {}, null)).status, 401);
    assert.equal((await request('/api/categories', {}, null)).status, 401);
});

test('Subject and task insertion preserve ERD values and ignore a spoofed owner', async () => {
    const categoryResponse = await request('/api/categories', { name: ' IT 112 ', color: '#b32c68' });
    assert.equal(categoryResponse.status, 201);
    const { category } = await categoryResponse.json();
    const response = await request('/api/tasks', {
        title: ' Submit Phase 4 report ', description: 'API integration lab', dueDate: '2026-11-30',
        priority: 'High', status: 'In Progress', category: category._id, owner: '6914a2d60000000000000102'
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    const stored = await Task.findById(task._id);
    assert.equal(stored.title, 'Submit Phase 4 report');
    assert.equal(stored.dueDate.toISOString(), '2026-11-30T00:00:00.000Z');
    assert.equal(stored.priority, 'High');
    assert.equal(stored.status, 'In Progress');
    assert.equal(String(stored.category), category._id);
    assert.equal(String(stored.owner), String(category.owner));
    assert.ok(stored.createdAt && stored.updatedAt);
});

test('Tasks can be inserted without a category', async () => {
    const response = await request('/api/tasks', { title: 'Uncategorized task', dueDate: '2026-11-30' });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).task.category, null);
});

test('Invalid task date, status, priority and category are rejected', async () => {
    const valid = { title: 'Test task', dueDate: '2026-11-30' };
    for (const patch of [{ title: ' ' }, { dueDate: '2026-02-30' }, { status: 'Done' },
        { priority: 'Urgent' }, { category: 'not-an-id' }, { description: 'a'.repeat(2001) }]) {
        assert.equal((await request('/api/tasks', { ...valid, ...patch })).status, 400);
    }
    assert.equal(await Task.countDocuments(), 2);
});

test('A student cannot use another student category', async () => {
    const second = await User.create({ name: 'Other', email: 'other@example.test', passwordHash: 'test-hash' });
    const category = await Category.create({ name: 'Private subject', owner: second._id });
    assert.equal((await request('/api/tasks', { title: 'Test', dueDate: '2026-11-30', category: category._id })).status, 400);
});

test('Allowed Live Server origin receives CORS headers and other origins are rejected', async () => {
    const allowed = await request('/api/login', {}, null, { Origin: 'http://localhost:5500' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5500');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    assert.equal((await request('/api/users', {}, null, { Origin: 'https://unapproved.example' })).status, 403);
});

test('Malformed JSON and unknown API routes return JSON errors', async () => {
    const response = await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /invalid/);
    assert.equal((await request('/api/missing', {})).status, 404);
});


test('GET routes enforce ownership and administrator access', async () => {
    const get = (route, auth = cookie) => fetch(base + route, { headers: auth ? { Cookie: auth } : {} });
    assert.equal((await get('/api/tasks', '')).status, 401);
    assert.equal((await get('/api/users', '')).status, 401);
    assert.equal((await get('/api/users')).status, 403);
    assert.equal((await get('/api/admin/tasks')).status, 403);

    const { tasks } = await (await get('/api/tasks')).json();
    assert.equal(tasks.length, 2);
    assert.equal(tasks.find(task => task.title === 'Submit Phase 4 report').category.name, 'IT 112');

    const login = await request('/api/users', {
        name: 'Empty account', email: 'empty@example.test', password: 'LabPassword123!'
    });
    const emptyCookie = login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await get('/api/tasks', emptyCookie)).json(), { tasks: [] });

    const bcrypt = require('bcryptjs');
    await User.create({ name: 'Lab admin', email: 'admin@example.test',
        passwordHash: await bcrypt.hash('LabPassword123!', 4), role: 'admin' });
    const adminLogin = await request('/api/login', { email: 'admin@example.test', password: 'LabPassword123!' });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const { users } = await (await get('/api/users', adminCookie)).json();
    assert.ok(users.some(user => user.role === 'admin'));
    assert.ok(users.every(user => Object.keys(user).every(key => ['_id', 'name', 'email', 'role', 'createdAt'].includes(key))));
    const overview = await (await get('/api/admin/tasks', adminCookie)).json();
    assert.ok(overview.tasks.every(task => task.owner.name === 'Phase Four Student'));
});
test('Task PUT and DELETE validate data, enforce ownership, and change the stored document', async () => {
    const write = (method, route, body) => fetch(base + route, {
        method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
    });
    const original = await Task.findOne({ title: 'Uncategorized task' });
    const route = '/api/tasks/' + original.id;
    const changes = { title: ' Updated coursework ', description: 'Revised instructions', dueDate: '2026-12-01',
        priority: 'High', status: 'Completed', category: null, owner: new mongoose.Types.ObjectId() };
    assert.equal((await write('PUT', route, { ...changes, dueDate: '2026-02-30' })).status, 400);
    const updated = await write('PUT', route, changes);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).task.title, 'Updated coursework');
    const stored = await Task.findById(original.id);
    assert.equal(stored.status, 'Completed');
    assert.equal(String(stored.owner), String(original.owner));

    const other = await User.findOne({ email: 'other@example.test' });
    const privateTask = await Task.create({ owner: other.id, title: 'Private coursework', dueDate: new Date() });
    assert.equal((await write('PUT', '/api/tasks/' + privateTask.id, changes)).status, 404);
    assert.equal((await write('DELETE', '/api/tasks/' + privateTask.id)).status, 404);
    assert.equal((await write('DELETE', '/api/tasks/invalid')).status, 400);
    assert.equal((await write('DELETE', route)).status, 200);
    assert.equal(await Task.exists({ _id: original.id }), null);
    assert.equal((await write('DELETE', route)).status, 404);
});

test('Subject editing and deletion preserve coursework and protect other owners', async () => {
    const category = await Category.findOne({ name: 'IT 112' });
    const route = '/api/categories/' + category.id;
    const change = (method, url, body) => fetch(base + url, {
        method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
    });
    assert.equal((await change('PUT', route, { name: 'IT 112 revised', color: '' })).status, 200);
    const stored = await Category.findById(category.id);
    assert.equal(stored.name, 'IT 112 revised');
    assert.equal(stored.color, undefined);
    const other = await Category.findOne({ name: 'Private subject' });
    assert.equal((await change('DELETE', '/api/categories/' + other.id)).status, 404);
    assert.equal((await change('DELETE', route)).status, 200);
    assert.equal(await Category.exists({ _id: category.id }), null);
    const task = await Task.findOne({ title: 'Submit Phase 4 report' });
    assert.equal(task.category, null);
});

test('Account changes preserve roles and refuse deletion of an administrator or an account with coursework', async () => {
    const student = await User.findOne({ email: 'phase4@example.test' });
    const empty = await User.findOne({ email: 'empty@example.test' });
    const admin = await User.findOne({ email: 'admin@example.test' });
    const login = await request('/api/login', { email: admin.email, password: 'LabPassword123!' });
    const adminCookie = login.headers.get('set-cookie').split(';')[0];
    const change = (method, id, auth, body) => fetch(base + '/api/users/' + id, {
        method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
    });
    assert.equal((await change('PUT', empty.id, cookie, { name: 'Unauthorized', email: empty.email })).status, 404);
    const profile = await change('PUT', student.id, cookie, { name: 'Updated student', email: student.email, role: 'admin' });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.role, 'user');
    assert.equal((await change('DELETE', empty.id, cookie)).status, 403);
    assert.equal((await change('DELETE', admin.id, adminCookie)).status, 404);
    assert.equal((await change('DELETE', student.id, adminCookie)).status, 409);
    const edited = await change('PUT', empty.id, adminCookie, { name: 'Reviewed student', email: 'REVIEWED@EXAMPLE.TEST' });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).user.email, 'reviewed@example.test');
    assert.equal((await change('DELETE', empty.id, adminCookie)).status, 200);
    assert.equal(await User.exists({ _id: empty.id }), null);
});
