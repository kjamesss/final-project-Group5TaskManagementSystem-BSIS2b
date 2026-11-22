const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('node:path');
const { User, Task, Category } = require('./models');

function createApp(config) {
    const app = express();
    const origins = new Set(config.origins);
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        const origin = req.get('Origin');
        if (origin && !origins.has(origin)) {
            return res.status(403).json({ message: 'This frontend origin is not allowed.' });
        }
        next();
    });
    app.use(cors({ origin: [...origins], credentials: true }));
    app.use(express.json({ limit: '20kb' }));
    app.use(cookieParser());
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    function signIn(res, user) {
        const token = jwt.sign({ sub: String(user._id) }, config.secret, { expiresIn: '8h' });
        res.cookie('bu_session', token, {
            httpOnly: true, sameSite: 'lax', secure: config.production,
            maxAge: 8 * 60 * 60 * 1000, path: '/'
        });
    }

    async function authenticated(req, res, next) {
        try {
            const payload = jwt.verify(req.cookies.bu_session || '', config.secret);
            req.user = await User.findById(payload.sub);
            if (!req.user) return res.status(401).json({ message: 'Log in to access your account.' });
            next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Log in to access your account.' });
            }
            next(error);
        }
    }

    function validText(value, min, max) {
        return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function validAccount(name, email) {
        return validText(name, 1, 100) && validText(email, 3, 254) && emailPattern.test(email.trim());
    }

    function validId(req, res, next) {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: 'The record ID is invalid.' });
        }
        next();
    }

    // Serialize related writes for each owner in this Express instance.
    const writes = new Map();
    async function writeFor(owner, operation) {
        const key = String(owner);
        const previous = writes.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        writes.set(key, current);
        try {
            await current;
        } finally {
            if (writes.get(key) === current) writes.delete(key);
        }
    }

    function ownedWrite(handler) {
        return async (req, res) => writeFor(req.user._id, async () => {
            if (!await User.exists({ _id: req.user._id })) {
                return res.status(401).json({ message: 'Log in to access your account.' });
            }
            return handler(req, res);
        });
    }

    function accountData(user) {
        return { _id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
    }

    function administrator(req, res, next) {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'An administrator account is required.' });
        }
        next();
    }

    app.get('/api/health', (req, res) => {
        const connected = mongoose.connection.readyState === 1;
        res.status(connected ? 200 : 503).json({ database: connected ? 'connected' : 'unavailable' });
    });

    app.post('/api/users', async (req, res) => {
        const { name, email, password } = req.body || {};
        if (!validAccount(name, email) ||
            typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
            return res.status(400).json({ message: 'Enter a name, valid email, and a password of 8 to 72 bytes.' });
        }
        const user = await User.create({
            name, email, passwordHash: await bcrypt.hash(password, 12), role: 'user'
        });
        signIn(res, user);
        res.status(201).json({ message: 'Account created successfully. You can now add a task.', user: accountData(user) });
    });

    app.post('/api/login', async (req, res) => {
        const { email, password } = req.body || {};
        if (!validText(email, 3, 254) || typeof password !== 'string' || Buffer.byteLength(password) > 72) {
            return res.status(400).json({ message: 'Enter your email and password.' });
        }
        const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
        if (!user || !await bcrypt.compare(password, user.passwordHash)) {
            return res.status(401).json({ message: 'Email or password is incorrect.' });
        }
        signIn(res, user);
        res.json({ message: 'Logged in successfully. You can now add a task.', user: accountData(user) });
    });

    app.post('/api/logout', (req, res) => {
        res.clearCookie('bu_session', { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/' });
        res.json({ message: 'Logged out successfully.' });
    });

    app.get('/api/session', authenticated, (req, res) => {
        res.json({ user: accountData(req.user) });
    });

    app.get('/api/categories', authenticated, async (req, res) => {
        res.json({ categories: await Category.find({ owner: req.user._id }).sort({ name: 1 }).lean() });
    });

    app.get('/api/tasks', authenticated, async (req, res) => {
        const tasks = await Task.find({ owner: req.user._id })
            .populate({ path: 'category', select: 'name color', match: { owner: req.user._id } })
            .sort({ dueDate: 1, _id: 1 }).lean();
        res.json({ tasks });
    });

    app.get('/api/users', authenticated, administrator, async (req, res) => {
        const users = await User.find().select('name email role createdAt')
            .sort({ name: 1, _id: 1 }).lean();
        res.json({ users });
    });

    app.get('/api/admin/tasks', authenticated, administrator, async (req, res) => {
        const tasks = await Task.find().populate('owner', 'name')
            .sort({ dueDate: 1, _id: 1 }).lean();
        res.json({ tasks });
    });


    function subjectValues(body) {
        const { name, color } = body || {};
        if (!validText(name, 1, 100) || (color != null && color !== '' &&
            (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)))) return null;
        return { name: name.trim(), color: color || undefined };
    }

    app.post('/api/categories', authenticated, ownedWrite(async (req, res) => {
        const values = subjectValues(req.body);
        if (!values) return res.status(400).json({ message: 'Enter a subject name and a valid display color.' });
        const category = await Category.create({ ...values, owner: req.user._id });
        res.status(201).json({ message: 'Subject saved successfully.', category });
    }));

    app.put('/api/categories/:id', authenticated, validId, ownedWrite(async (req, res) => {
        const values = subjectValues(req.body);
        if (!values) return res.status(400).json({ message: 'Enter a subject name and a valid display color.' });
        const update = values.color ? { $set: values } : { $set: { name: values.name }, $unset: { color: 1 } };
        const category = await Category.findOneAndUpdate(
            { _id: req.params.id, owner: req.user._id }, update, { returnDocument: 'after', runValidators: true }
        );
        if (!category) return res.status(404).json({ message: 'Subject not found.' });
        res.json({ message: 'Subject updated.', category });
    }));

    app.delete('/api/categories/:id', authenticated, validId, ownedWrite(async (req, res) => {
        const scope = { _id: req.params.id, owner: req.user._id };
        if (!await Category.exists(scope)) return res.status(404).json({ message: 'Subject not found.' });
        await Task.updateMany({ category: scope._id, owner: scope.owner }, { $set: { category: null } });
        await Category.deleteOne(scope);
        res.json({ message: 'Subject deleted. Its tasks are now uncategorized.' });
    }));

    async function taskValues(body, owner) {
        const { title, description = '', dueDate, status = 'To Do', priority = 'Medium', category } = body || {};
        const date = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00.000Z') : new Date(NaN);
        const dateValid = typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
            Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === dueDate;
        if (!validText(title, 1, 150) || typeof description !== 'string' || description.length > 2000 ||
            !dateValid || !['To Do', 'In Progress', 'Completed'].includes(status) ||
            !['Low', 'Medium', 'High'].includes(priority)) {
            return { error: 'Check the task title, valid due date, priority, status, and description.' };
        }
        const hasCategory = category != null && category !== '';
        if (hasCategory && (!mongoose.isObjectIdOrHexString(category) ||
            !await Category.exists({ _id: category, owner }))) {
            return { error: 'Choose a subject belonging to your account, or leave it uncategorized.' };
        }
        return { values: { title, description, dueDate: date, status, priority, category: hasCategory ? category : null } };
    }

    app.post('/api/tasks', authenticated, ownedWrite(async (req, res) => {
        const { values, error } = await taskValues(req.body, req.user._id);
        if (error) return res.status(400).json({ message: error });
        const task = await Task.create({ ...values, owner: req.user._id });
        res.status(201).json({ message: 'Task saved successfully.', task });
    }));

    app.put('/api/tasks/:id', authenticated, validId, ownedWrite(async (req, res) => {
        const scope = { _id: req.params.id, owner: req.user._id };
        if (!await Task.exists(scope)) return res.status(404).json({ message: 'Task not found.' });
        const { values, error } = await taskValues(req.body, scope.owner);
        if (error) return res.status(400).json({ message: error });
        const task = await Task.findOneAndUpdate(scope, { $set: values }, {
            returnDocument: 'after', runValidators: true
        });
        if (!task) return res.status(404).json({ message: 'Task not found.' });
        res.json({ message: 'Task updated.', task });
    }));

    app.delete('/api/tasks/:id', authenticated, validId, ownedWrite(async (req, res) => {
        const removed = await Task.deleteOne({ _id: req.params.id, owner: req.user._id });
        if (!removed.deletedCount) return res.status(404).json({ message: 'Task not found.' });
        res.json({ message: 'Task deleted.' });
    }));

    app.put('/api/users/:id', authenticated, validId, async (req, res) => {
        const { name, email } = req.body || {};
        const self = req.params.id.toLowerCase() === String(req.user._id);
        if (!self && req.user.role !== 'admin') return res.status(404).json({ message: 'Account not found.' });
        if (!validAccount(name, email)) return res.status(400).json({ message: 'Enter a name and valid email.' });
        const scope = self ? { _id: req.params.id } : { _id: req.params.id, role: 'user' };
        const user = await User.findOneAndUpdate(scope, { $set: { name, email } }, {
            returnDocument: 'after', runValidators: true
        });
        if (!user) return res.status(404).json({ message: 'Account not found.' });
        res.json({ message: 'Account updated.', user: accountData(user) });
    });

    app.delete('/api/users/:id', authenticated, administrator, validId, async (req, res) => {
        await writeFor(req.params.id.toLowerCase(), async () => {
            const scope = { _id: req.params.id, role: 'user' };
            if (!await User.exists(scope)) return res.status(404).json({ message: 'Student account not found.' });
            const [tasks, subjects] = await Promise.all([
                Task.exists({ owner: scope._id }), Category.exists({ owner: scope._id })
            ]);
            if (tasks || subjects) return res.status(409).json({ message: 'This account still owns tasks or subjects.' });
            await User.deleteOne(scope);
            res.json({ message: 'Student account deleted.' });
        });
    });

    app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found.' }));
    app.use(express.static(path.join(__dirname, '../frontend')));

    app.use((error, req, res, next) => {
        if (error.code === 11000) return res.status(409).json({ message: 'This email is already registered. Log in or use another email.' });
        if (error.name === 'ValidationError' || error.name === 'CastError' || error.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'The submitted data is invalid. Check the fields and try again.' });
        }
        if (error.type === 'entity.too.large') return res.status(413).json({ message: 'The submitted data is too large.' });
        console.error('Request failed:', error.name);
        res.status(500).json({ message: 'Unable to complete the request. Please try again.' });
    });
    return app;
}

module.exports = { createApp };
