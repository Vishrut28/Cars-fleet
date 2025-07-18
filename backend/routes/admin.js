const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

async function syncHubsFromGoogleSheets(db) {
    try {
        const credentialsContent = process.env.GOOGLE_CREDENTIALS;
        if (!credentialsContent) {
            throw new Error('Server is not configured for Google Sheets sync. GOOGLE_CREDENTIALS environment variable is missing.');
        }
        const credentials = JSON.parse(credentialsContent);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: '1Of8Wl0xnLdtQb2MLeaYXvw_ZX9RKI1o1yrhxNZlyhnM',
            range: 'Sheet1!A2:C',
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return { message: 'No data found in Google Sheets to sync.' };
        }
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                db.run('DELETE FROM hubs');
                db.run('DELETE FROM car_assignments');
                rows.forEach(row => {
                    const [reg_no, hub_location, reason] = row;
                    if (hub_location && hub_location.trim()) {
                        db.run(`INSERT OR IGNORE INTO hubs (name, location, sheet_id) VALUES (?, ?, ?)`, [hub_location, hub_location, '1Of8Wl0xnLdtQb2MLeaYXvw_ZX9RKI1o1yrhxNZlyhnM']);
                    }
                    if (reg_no && hub_location) {
                        db.run(`INSERT OR REPLACE INTO car_assignments (reg_no, hub_location, reason) VALUES (?, ?, ?)`, [reg_no, hub_location, reason || 'unknown']);
                    }
                });
                db.run('COMMIT', (err) => {
                    if (err) return reject(err);
                    resolve({ message: `Synced ${rows.length} car assignments and hubs successfully.` });
                });
            });
        });
    } catch (err) {
        console.error('❌ Google Sheets sync error:', err);
        throw err;
    }
}

module.exports = (db) => {
    router.post('/sync-hubs', async (req, res, next) => {
        try {
            const result = await syncHubsFromGoogleSheets(db);
            res.json({ success: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    router.get('/stats', (req, res, next) => {
        const queries = {
            total_assigned: 'SELECT COUNT(*) as count FROM car_assignments',
            total_cleaned: `SELECT COUNT(DISTINCT reg_no) as count FROM cleaning_reports WHERE audit_status = 'approved'`,
            overdue_count: `SELECT COUNT(*) as count FROM car_assignments ca LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no WHERE cr.id IS NULL AND julianday('now') - julianday(ca.assigned_at) > 5`,
            pending_reports: `SELECT COUNT(*) as count FROM cleaning_reports WHERE audit_status = 'pending'`
        };
        let stats = {};
        let completed = 0;
        const totalQueries = Object.keys(queries).length;
        for (const [key, query] of Object.entries(queries)) {
            db.get(query, (err, row) => {
                if (err) return next(err);
                stats[key] = row.count || 0;
                completed++;
                if (completed === totalQueries) res.json(stats);
            });
        }
    });

    router.get('/hub-adherence-summary', (req, res, next) => {
        const sql = `SELECT ca.hub_location, COUNT(DISTINCT ca.reg_no) AS total_assigned, COUNT(DISTINCT CASE WHEN cr.audit_status='approved' THEN cr.reg_no END) AS total_cleaned, ROUND((COUNT(DISTINCT CASE WHEN cr.audit_status='approved' THEN cr.reg_no END) * 100.0) / NULLIF(COUNT(DISTINCT ca.reg_no), 0), 1) AS adherence_rate FROM car_assignments ca LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no AND ca.hub_location = cr.hub_location GROUP BY ca.hub_location ORDER BY adherence_rate DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    router.post('/set-user-role', (req, res, next) => {
        const { email, role } = req.body;
        if (!email || !role) return res.status(400).json({ error: 'Email and role are required.' });
        db.run(`INSERT INTO users (email, role) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role`, [email, role], (err) => {
            if (err) return next(err);
            res.json({ success: true, message: `Role for ${email} set to ${role}` });
        });
    });

    router.post('/assign-car', (req, res, next) => {
        const { reg_no, hub, reason } = req.body;
        db.run(`INSERT INTO car_assignments (reg_no, hub_location, reason) VALUES (?, ?, ?) ON CONFLICT(reg_no) DO UPDATE SET hub_location=excluded.hub_location, reason=excluded.reason`, [reg_no, hub, reason], (err) => {
            if (err) return next(err);
            res.json({ success: true, message: 'Car assigned successfully' });
        });
    });
    
    router.get('/yard-managers', (req, res, next) => {
        const query = `SELECT u.id, u.email, u.role, GROUP_CONCAT(h.name) as assigned_hubs FROM users u LEFT JOIN hub_assignments ha ON u.id = ha.user_id AND ha.role = 'yard_manager' LEFT JOIN hubs h ON ha.hub_id = h.id WHERE u.role = 'yard_manager' GROUP BY u.id ORDER BY u.email`;
        db.all(query, [], (err, rows) => {
            if (err) return next(err);
            res.json(rows);
        });
    });

    router.post('/assign-yard-manager', (req, res, next) => {
        const { email, hub_id } = req.body;
        if (!email || !hub_id) return res.status(400).json({ error: 'Email and hub_id are required' });
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
            if (err) return next(err);
            const assignToHub = (userId) => {
                db.run(`INSERT OR REPLACE INTO hub_assignments (hub_id, user_id, role) VALUES (?, ?, 'yard_manager')`, [hub_id, userId], (err) => {
                    if (err) return next(err);
                    res.json({ success: true, message: 'Yard manager assigned successfully' });
                });
            };
            if (user) {
                assignToHub(user.id);
            } else {
                db.run(`INSERT INTO users (email, role) VALUES (?, 'yard_manager')`, [email], function(err) {
                    if (err) return next(err);
                    assignToHub(this.lastID);
                });
            }
        });
    });

    router.delete('/remove-yard-manager', (req, res, next) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        db.get(`SELECT id FROM users WHERE email = ? AND role = 'yard_manager'`, [email], (err, user) => {
            if (err) return next(err);
            if (!user) return res.status(404).json({ error: 'Yard manager not found' });
            db.run(`DELETE FROM hub_assignments WHERE user_id = ? AND role = 'yard_manager'`, [user.id], (err) => {
                if (err) return next(err);
                res.json({ success: true, message: 'All hub assignments removed for user' });
            });
        });
    });

    return router;
};