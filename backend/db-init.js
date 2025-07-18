module.exports = (db) => {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'ground'
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS car_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, reg_no TEXT NOT NULL UNIQUE, hub_location TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT 'unknown', assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS cleaning_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, reg_no TEXT NOT NULL, hub_location TEXT NOT NULL,
            cleaning_date TEXT NOT NULL, exterior_video_path TEXT, interior_video_path TEXT,
            submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, audit_status TEXT DEFAULT 'pending',
            audit_rating INTEGER, audit_notes TEXT, user_email TEXT NOT NULL, reason TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS hubs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, location TEXT NOT NULL, sheet_id TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS hub_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, hub_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL,
            FOREIGN KEY(hub_id) REFERENCES hubs(id), FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_cleaning_report ON cleaning_reports(reg_no, hub_location, cleaning_date)`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hub_assignment ON hub_assignments(hub_id, user_id, role)`);
        db.run(`INSERT OR IGNORE INTO users (email, role) VALUES (?, ?)`, ['aditya.thakur@cariotauto.com', 'admin']);
        console.log('✅ Database tables initialized.');
    });
};