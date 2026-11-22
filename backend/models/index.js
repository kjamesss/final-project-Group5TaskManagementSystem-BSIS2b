const mongoose = require('mongoose');
const { Schema } = mongoose;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, match: emailPattern, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true, versionKey: false });

const categorySchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 100 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: undefined },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

const taskSchema = new Schema({
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: ['To Do', 'In Progress', 'Completed'], default: 'To Do' },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    dueDate: { type: Date, required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: null }
}, { timestamps: true, versionKey: false });
taskSchema.index({ owner: 1, status: 1, dueDate: 1 });

module.exports = {
    User: mongoose.model('User', userSchema),
    Category: mongoose.model('Category', categorySchema),
    Task: mongoose.model('Task', taskSchema)
};
