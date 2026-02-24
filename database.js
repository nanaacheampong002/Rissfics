const Database = require("better-sqlite3");

const db = new Database("database.sqlite");

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    fandom TEXT,
    rating TEXT,
    status TEXT,
    summary TEXT,
    series TEXT,
    tags_json TEXT NOT NULL,
    chapters_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    story_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, story_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(story_id) REFERENCES stories(id)
  );

  CREATE TABLE IF NOT EXISTS author_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, author),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

module.exports = db;