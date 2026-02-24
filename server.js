const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const db = require("./database");

const app = express();
app.use(express.json());

app.use(
  session({
    secret: "CHANGE_THIS_TO_A_LONG_RANDOM_STRING",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 }
  })
);

function nowISO() {
  return new Date().toISOString();
}

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

// Auth
app.post("/api/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const cleanUser = String(username).trim().toLowerCase();
  if (cleanUser.length < 3) return res.status(400).json({ error: "Username too short" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short" });

  const hash = await bcrypt.hash(String(password), 12);

  try {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
      .run(cleanUser, hash, nowISO());

    req.session.userId = info.lastInsertRowid;
    req.session.username = cleanUser;
    res.json({ ok: true, username: cleanUser });
  } catch {
    res.status(400).json({ error: "Username already exists" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const cleanUser = String(username).trim().toLowerCase();
  const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username=?").get(cleanUser);
  if (!row) return res.status(400).json({ error: "Invalid username or password" });

  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(400).json({ error: "Invalid username or password" });

  req.session.userId = row.id;
  req.session.username = row.username;
  res.json({ ok: true, username: row.username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.username });
});

// Stories (public read, owner-only write)
app.get("/api/stories", (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.username as owner_username
    FROM stories s
    JOIN users u ON u.id = s.user_id
    ORDER BY datetime(s.updated_at) DESC
  `).all();

  res.json(rows.map(r => ({
    id: r.id,
    owner: r.owner_username,
    title: r.title,
    author: r.author,
    fandom: r.fandom,
    rating: r.rating,
    status: r.status,
    summary: r.summary,
    series: r.series,
    tags: JSON.parse(r.tags_json),
    chapters: JSON.parse(r.chapters_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })));
});

app.post("/api/stories", requireLogin, (req, res) => {
  const userId = req.session.userId;
  const s = req.body || {};
  if (!s.title || !s.author) return res.status(400).json({ error: "Missing title/author" });

  const tags = Array.isArray(s.tags) ? s.tags : [];
  const chapters = Array.isArray(s.chapters) ? s.chapters : [];
  if (!chapters.length) return res.status(400).json({ error: "Need at least 1 chapter" });

  const t = nowISO();
  const info = db.prepare(`
    INSERT INTO stories
    (user_id, title, author, fandom, rating, status, summary, series, tags_json, chapters_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    String(s.title),
    String(s.author),
    String(s.fandom || ""),
    String(s.rating || "T"),
    String(s.status || "Ongoing"),
    String(s.summary || ""),
    String(s.series || ""),
    JSON.stringify(tags),
    JSON.stringify(chapters),
    t,
    t
  );

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put("/api/stories/:id", requireLogin, (req, res) => {
  const userId = req.session.userId;
  const storyId = Number(req.params.id);
  const s = req.body || {};

  const owner = db.prepare("SELECT user_id FROM stories WHERE id=?").get(storyId);
  if (!owner) return res.status(404).json({ error: "Not found" });
  if (owner.user_id !== userId) return res.status(403).json({ error: "Not your story" });

  const tags = Array.isArray(s.tags) ? s.tags : [];
  const chapters = Array.isArray(s.chapters) ? s.chapters : [];
  if (!chapters.length) return res.status(400).json({ error: "Need at least 1 chapter" });

  db.prepare(`
    UPDATE stories SET
      title=?, author=?, fandom=?, rating=?, status=?, summary=?, series=?,
      tags_json=?, chapters_json=?, updated_at=?
    WHERE id=?
  `).run(
    String(s.title),
    String(s.author),
    String(s.fandom || ""),
    String(s.rating || "T"),
    String(s.status || "Ongoing"),
    String(s.summary || ""),
    String(s.series || ""),
    JSON.stringify(tags),
    JSON.stringify(chapters),
    nowISO(),
    storyId
  );

  res.json({ ok: true });
});

app.delete("/api/stories/:id", requireLogin, (req, res) => {
  const userId = req.session.userId;
  const storyId = Number(req.params.id);

  const owner = db.prepare("SELECT user_id FROM stories WHERE id=?").get(storyId);
  if (!owner) return res.status(404).json({ error: "Not found" });
  if (owner.user_id !== userId) return res.status(403).json({ error: "Not your story" });

  db.prepare("DELETE FROM stories WHERE id=?").run(storyId);
  db.prepare("DELETE FROM bookmarks WHERE story_id=?").run(storyId);
  res.json({ ok: true });
});

// Bookmarks
app.get("/api/bookmarks", requireLogin, (req, res) => {
  const rows = db.prepare("SELECT story_id FROM bookmarks WHERE user_id=?").all(req.session.userId);
  res.json(rows.map(r => r.story_id));
});

app.post("/api/bookmarks/:storyId", requireLogin, (req, res) => {
  try {
    db.prepare("INSERT INTO bookmarks (user_id, story_id, created_at) VALUES (?, ?, ?)")
      .run(req.session.userId, Number(req.params.storyId), nowISO());
  } catch {}
  res.json({ ok: true });
});

app.delete("/api/bookmarks/:storyId", requireLogin, (req, res) => {
  db.prepare("DELETE FROM bookmarks WHERE user_id=? AND story_id=?")
    .run(req.session.userId, Number(req.params.storyId));
  res.json({ ok: true });
});

// Subscriptions
app.get("/api/subscriptions", requireLogin, (req, res) => {
  const rows = db.prepare("SELECT author FROM author_subscriptions WHERE user_id=? ORDER BY author ASC")
    .all(req.session.userId);
  res.json(rows.map(r => r.author));
});

app.post("/api/subscriptions/:author", requireLogin, (req, res) => {
  const author = String(req.params.author || "").trim().toLowerCase();
  try {
    db.prepare("INSERT INTO author_subscriptions (user_id, author, created_at) VALUES (?, ?, ?)")
      .run(req.session.userId, author, nowISO());
  } catch {}
  res.json({ ok: true });
});

app.delete("/api/subscriptions/:author", requireLogin, (req, res) => {
  const author = String(req.params.author || "").trim().toLowerCase();
  db.prepare("DELETE FROM author_subscriptions WHERE user_id=? AND author=?")
    .run(req.session.userId, author);
  res.json({ ok: true });
});

// Frontend
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3000;
app.listen(PORT, () => console.log("Server running on http://localhost:" + PORT));