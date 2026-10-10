const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbFile = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
