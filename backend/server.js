const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { createApp } = require('./app');
const { User } = require('./models');

async function start() {
    const port = Number(process.env.PORT || 3000);
    if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error('Set MONGODB_URI and a JWT_SECRET of at least 32 characters in .env.');
    }
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await User.init();
    const origins = [
        'http://localhost:' + port, 'http://127.0.0.1:' + port,
        ...(process.env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
    ];
    const app = createApp({
        origins, secret: process.env.JWT_SECRET, production: process.env.NODE_ENV === 'production'
    });
    const server = app.listen(port, '127.0.0.1', () => console.log('BU Task Planner is ready at http://localhost:' + port));
    async function stop() {
        server.close(async () => { await mongoose.disconnect(); process.exit(0); });
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

start().catch(error => {
    console.error('Startup failed:', error.name, error.message.includes('Set MONGODB_URI') ? error.message : 'Check the MongoDB connection and environment settings.');
    process.exitCode = 1;
});
