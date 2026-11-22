// Exercise a running planner. Use a database account scoped to that planner.
const { chromium } = require('playwright-core');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { User, Task, Category } = require('../backend/models');
require('dotenv').config({ quiet: true });

const base = process.env.QA_BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
const capture = process.env.QA_EVIDENCE;
const email = 'qa-' + randomUUID() + '@example.test';
const adminEmail = 'review-' + randomUUID() + '@example.test';
const password = randomBytes(24).toString('base64url');
const checks = [];
let browser;
let student;
let admin;

function passed(check) { checks.push(check); console.log('PASS', check); }

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Manila', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const go = file => page.goto(new URL(file, base).href);
    async function shot(name) {
        if (!capture) return;
        await fs.mkdir(capture, { recursive: true });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(capture, name + '.png'), animations: 'disabled' });
    }
    async function request(method, route, status, data) {
        const result = await context.request.fetch(base + route, { method, data, headers: { Origin: base } });
        assert.equal(result.status(), status, method + ' ' + route);
        return result.json();
    }
    const button = name => page.getByRole('button', { name, exact: true });
    const today = new Date();
    const deadline = offset => {
        const day = new Date(today.getTime() + offset * 86400000);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(day);
    };

    await go('/');
    await shot('home');
    await request('GET','/api/health',200);
    await request('GET','/api/tasks',401);
    await go('/tasks.html');
    await page.locator('#view-feedback').getByRole('link',{name:'Log in'}).waitFor();
    assert.equal(await button('New task').isVisible(),false);
    await go('/');
    await page.getByRole('link',{name:/Create an account/}).click();
    await button('Create account').click();
    assert.equal(await page.locator('#register-name').evaluate(e => e.validity.valueMissing), true);
    await page.locator('#register-name').fill('Alex Rivera');
    await page.locator('#register-email').fill(email);
    await page.locator('#register-password').fill(password);
    await button('Create account').click();
    await page.waitForURL('**/login.html*');
    await page.getByText('Account created. Log in with your email and password.').waitFor();
    await request('GET','/api/session',401);
    await shot('login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.locator('#login button[type=submit]').click();
    await page.waitForURL('**/dashboard.html');
    await page.getByText('No upcoming deadlines.').waitFor();
    student = await User.findOne({ email });
    assert.ok(student);
    passed('Register, check the login redirect and signed-out session, then log in directly to the dashboard');
    await page.route('**/api/tasks', route => route.abort(), {times:1});
    await page.reload();
    await button('Retry').click();
    await page.getByText('No upcoming deadlines.').waitFor();
    assert.equal(await page.locator('#view-feedback').innerText(),'');
    passed('Hide signed-out task actions and restore the dashboard after a failed read and retry');
    await request('GET','/api/admin/tasks',403);
    await go('/add-task.html');
    await page.locator('#create-category-name').fill('Web Systems');
    await button('Add subject').click();
    await page.locator('#create-task-category option').filter({hasText:'Web Systems'}).waitFor({state:'attached'});
    await page.locator('#create-task-title').fill('Prepare interface review');
    await page.locator('#create-task-description').fill('Bring the updated screens to the project review.');
    await page.locator('#create-task-dueDate').fill(deadline(2));
    await page.locator('#create-task-category').selectOption({label:'Web Systems'});
    await button('Create task').click();
    await page.getByText('Task saved successfully.').waitFor();
    const original = await Task.findOne({owner:student.id,title:'Prepare interface review'});
    assert.ok(original.category);
    await request('POST','/api/tasks',400,{title:'Invalid date',dueDate:'2026-02-30'});
    for (const [title,offset,status] of [['Submit research outline',-1,'In Progress'],['Review lecture notes',1,'Completed']]) {
        await request('POST','/api/tasks',201,{title, dueDate:deadline(offset), status});
    }
    await go('/dashboard.html');
    await page.locator('#overdue-list a').waitFor();
    assert.match(await page.locator('#upcoming-list').innerText(),/Prepare interface review/);
    assert.doesNotMatch(await page.locator('#upcoming-list').innerText(),/Review lecture notes/);
    await shot('dashboard');
    await page.getByRole('link',{name:'Prepare interface review'}).click();
    await page.locator('.task-row').waitFor();
    assert.equal(await page.locator('.task-row').count(),1);
    await button('Clear filters').click();
    await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 3);
    await page.locator('#task-filters-status').selectOption('Completed');
    assert.match(await page.locator('#task-list').innerText(),/Review lecture notes/);
    await page.locator('#task-filters-q').fill('no such assignment');
    await page.getByText('No matching tasks.').waitFor();
    await button('Clear filters').click();
    await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 3);
    await shot('tasks');
    passed('Create a subject and task, reject an impossible date, and verify dashboard links, filters and empty results');

    await button('Edit Prepare interface review').click();
    assert.equal(await page.locator('#change-title').inputValue(),'Prepare interface review');
    await page.locator('#change-status').selectOption('Completed');
    await button('Save changes').click();
    await page.getByText('Task updated.',{exact:true}).waitFor();
    assert.equal((await Task.findById(original.id)).status,'Completed');
    await button('Delete Prepare interface review').click();
    await page.locator('#mutation-modal').getByRole('button',{name:'Cancel'}).click();
    assert.ok(await Task.exists({_id:original.id}));
    await button('Edit Web Systems').click();
    await page.locator('#change-name').fill('IT 112');
    await button('Save changes').click();
    await button('Delete IT 112').click();
    await button('Confirm delete').click();
    await page.getByText(/Subject deleted/).waitFor();
    assert.equal((await Task.findById(original.id)).category,null);
    await button('Delete Prepare interface review').click();
    await button('Confirm delete').click();
    await page.getByText('Task deleted.',{exact:true}).waitFor();
    assert.equal(await Task.findById(original.id),null);
    passed('Edit and delete tasks and subjects, cancel deletion, and verify database readback by original ID');

    await page.setViewportSize({width:390,height:844});
    await shot('tasks-mobile');
    await button('Toggle navigation').click();
    await page.getByRole('link',{name:'Profile'}).click();
    await button('Edit Alex Rivera').click();
    await page.locator('#change-name').fill('Alex Rivera Cruz');
    await button('Save changes').click();
    await page.locator('#profile-details').getByText('Alex Rivera Cruz',{exact:true}).waitFor();
    for (const file of ['index','login','register','dashboard','tasks','add-task','profile','admin']) {
        await go('/'+file+'.html');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), file+' mobile overflow');
    }
    await go('/profile.html');
    await button('Toggle navigation').click();
    await button('Log out').click();
    await page.waitForURL('**/login.html');
    await request('GET','/api/session',401);
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill('incorrect-dummy-password');
    await page.locator('#login button[type=submit]').click();
    await page.getByText('Email or password is incorrect.').waitFor();
    await page.locator('#login-password').fill(password);
    await page.locator('#login button[type=submit]').click();
    await page.waitForURL('**/dashboard.html');
    passed('Use mobile navigation, edit profile, verify eight page widths, sign out, reject invalid login and sign back in');

    admin = await User.create({name:'QA reviewer',email:adminEmail,passwordHash:await bcrypt.hash(password,12),role:'admin'});
    await go('/login.html');
    await page.locator('#login-email').fill(adminEmail);
    await page.locator('#login-password').fill(password);
    await page.locator('#login button[type=submit]').click();
    await page.waitForURL('**/dashboard.html');
    await button('Toggle navigation').click();
    await page.getByRole('link',{name:'Administration'}).click();
    await page.locator('#account-search').fill(email);
    await page.getByRole('cell',{name:email,exact:true}).waitFor();
    await request('PUT','/api/users/'+student.id,200,{name:'Reviewed student',email});
    await request('DELETE','/api/users/'+student.id,409);
    await request('POST','/api/login',200,{email,password});
    for(const task of (await request('GET','/api/tasks',200)).tasks) {
        await request('DELETE','/api/tasks/'+task._id,200);
    }
    await request('POST','/api/login',200,{email:adminEmail,password});
    await request('DELETE','/api/users/'+student.id,200);
    assert.equal(await User.findById(student.id),null);
    assert.deepEqual(errors,[]);
    passed('Verify administrator directory and oversight, account update, deletion protection, eligible deletion and no uncaught page errors');
}

(async () => {
    try {
        await run();
        if(capture) await fs.writeFile(path.join(capture,'results.json'),JSON.stringify({base,checkedAt:new Date().toISOString(),checks},null,2)+'\n');
    } catch (err) {
        console.error(err.name,err.message.replace(/mongodb(\+srv)?:\/\/\S+/g,'[database]'));
        process.exitCode=1;
    } finally {
        await browser?.close();
        if(mongoose.connection.readyState===1) {
            // Delete only random, run-specific fixtures, including after an interrupted assertion.
            const fixture = await User.findOne({email});
            if(fixture) {
                await Task.deleteMany({owner:fixture._id});
                await Category.deleteMany({owner:fixture._id});
                await User.deleteOne({_id:fixture._id,email});
            }
            if(admin) await User.deleteOne({_id:admin._id,email:adminEmail});
        }
        await mongoose.disconnect();
    }
})();
