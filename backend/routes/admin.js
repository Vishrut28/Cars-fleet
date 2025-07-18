const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

async function syncHubsFromGoogleSheets(pool) {
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('TRUNCATE hubs, car_assignments RESTART IDENTITY CASCADE');
        
        for (const row of rows) {
            const [reg_no, hub_location, reason] = row;
            if (hub_location && hub_location.trim()) {
                await client.query(`INSERT INTO hubs (name, location, sheet_id) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
                    [hub_location, hub_location, '1Of8Wl0xnLdtQb2MLeaYXvw_ZX9RKI1o1yrhxNZlyhnM']);
            }
            if (reg_no && hub_location) {
                await client.query(`INSERT INTO car_assignments (reg_no, hub_location, reason) VALUES ($1, $2, $3) ON CONFLICT (reg_no) DO UPDATE SET hub_location = EXCLUDED.hub_location, reason = EXCLUDED.reason`,
                    [reg_no, hub_location, reason || 'unknown']);
            }
        }
        await client.query('COMMIT');
        return { message: `Synced ${rows.length} car assignments and hubs successfully.` };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Google Sheets sync transaction error:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = (pool) => {
    router.post('/sync-hubs', async (req, res, next) => {
        try {
            const result = await syncHubsFromGoogleSheets(pool);
            res.json({ success: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    router.get('/stats', async (req, res, next) => {
        try {
            const queries = [
                pool.query('SELECT COUNT(*) as count FROM car_assignments'),
                pool.query(`SELECT COUNT(DISTINCT reg_no) as count FROM cleaning_reports WHERE audit_status = 'approved'`),
                pool.query(`SELECT COUNT(*) as count FROM car_assignments ca LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no WHERE cr.id IS NULL AND NOW() - ca.assigned_at > INTERVAL '5 days'`),
                pool.query(`SELECT COUNT(*) as count FROM cleaning_reports WHERE audit_status = 'pending'`)
            ];
            const [assignedResult, cleanedResult, overdueResult, pendingResult] = await Promise.all(queries);
            res.json({
                total_assigned: parseInt(assignedResult.rows[0].count, 10),
                total_cleaned: parseInt(cleanedResult.rows[0].count, 10),
                overdue_count: parseInt(overdueResult.rows[0].count, 10),
                pending_reports: parseInt(pendingResult.rows[0].count, 10)
            });
        } catch (err) {
            next(err);
        }
    });

    router.get('/hub-adherence-summary', async (req, res, next) => {
        try {
            const sql = `SELECT ca.hub_location, COUNT(DISTINCT ca.reg_no)::int AS total_assigned, COUNT(DISTINCT CASE WHEN cr.audit_status='approved' THEN cr.reg_no END)::int AS total_cleaned FROM car_assignments ca LEFT JOIN cleaning_reports cr ON ca.reg_no = cr.reg_no AND ca.hub_location = cr.hub_location GROUP BY ca.hub_location ORDER BY total_assigned DESC`;
            const result = await pool.query(sql);
            const summary = result.rows.map(row => ({
                ...row,
                adherence_rate: row.total_assigned > 0 ? parseFloat(((row.total_cleaned / row.total_assigned) * 100).toFixed(1)) : 0
            }));
            res.json(summary);
        } catch (err) {
            next(err);
        }
    });

    router.post('/set-user-role', async (req, res, next) => {
        const { email, role } = req.body;
        if (!email || !role) return res.status(400).json({ error: 'Email and role are required.' });
        try {
            await pool.query(`INSERT INTO users (email, role) VALUES ($1, $2) ON CONFLICT(email) DO UPDATE SET role = EXCLUDED.role`, [email, role]);
            res.json({ success: true, message: `Role for ${email} set to ${role}` });
        } catch (err) {
            next(err);
        }
    });

    router.post('/assign-car', async (req, res, next) => {
        const { reg_no, hub, reason } = req.body;
        try {
            await pool.query(`INSERT INTO car_assignments (reg_no, hub_location, reason) VALUES ($1, $2, $3) ON CONFLICT(reg_no) DO UPDATE SET hub_location=EXCLUDED.hub_location, reason=EXCLUDED.reason`, [reg_no, hub, reason || 'unknown']);
            res.json({ success: true, message: 'Car assigned successfully' });
        } catch (err) {
            next(err);
        }
    });
    
    router.get('/yard-managers', async (req, res, next) => {
        try {
            const query = `SELECT u.id, u.email, u.role, COALESCE(array_agg(h.name) FILTER (WHERE h.name IS NOT NULL), '{}') as assigned_hubs FROM users u LEFT JOIN hub_assignments ha ON u.id = ha.user_id AND ha.role = 'yard_manager' LEFT JOIN hubs h ON ha.hub_id = h.id WHERE u.role = 'yard_manager' GROUP BY u.id ORDER BY u.email`;
            const result = await pool.query(query);
            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    });

    router.post('/assign-yard-manager', async (req, res, next) => {
        const { email, hub_id } = req.body;
        if (!email || !hub_id) return res.status(400).json({ error: 'Email and hub_id are required' });
        try {
            let userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            let userId;
            if (userResult.rows.length > 0) {
                userId = userResult.rows[0].id;
            } else {
                userResult = await pool.query(`INSERT INTO users (email, role) VALUES ($1, 'yard_manager') RETURNING id`, [email]);
                userId = userResult.rows[0].id;
            }
            await pool.query(`INSERT INTO hub_assignments (hub_id, user_id, role) VALUES ($1, $2, 'yard_manager') ON CONFLICT (hub_id, user_id, role) DO NOTHING`, [hub_id, userId]);
            res.json({ success: true, message: 'Yard manager assigned successfully' });
        } catch (err) {
            next(err);
        }
    });

    router.delete('/remove-yard-manager', async (req, res, next) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        try {
            const userResult = await pool.query(`SELECT id FROM users WHERE email = $1 AND role = 'yard_manager'`, [email]);
            if (userResult.rows.length === 0) return res.status(404).json({ error: 'Yard manager not found' });
            const userId = userResult.rows[0].id;
            await pool.query(`DELETE FROM hub_assignments WHERE user_id = $1 AND role = 'yard_manager'`, [userId]);
            res.json({ success: true, message: 'All hub assignments removed for user' });
        } catch (err) {
            next(err);
        }
    });

    return router;
};