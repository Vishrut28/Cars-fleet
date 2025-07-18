const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '../../uploads');
if (!require('fs').existsSync(uploadDir)) {
    require('fs').mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

module.exports = (pool) => {
    router.get('/stats', async (req, res, next) => {
        const email = req.session.email;
        try {
            const todayQuery = pool.query(`SELECT COUNT(*) as count FROM cleaning_reports WHERE user_email = $1 AND submission_date >= CURRENT_DATE`, [email]);
            const totalQuery = pool.query(`SELECT COUNT(*) as count FROM cleaning_reports WHERE user_email = $1`, [email]);
            const [todayResult, totalResult] = await Promise.all([todayQuery, totalQuery]);
            res.json({ 
                today_uploads: parseInt(todayResult.rows[0].count, 10), 
                total_uploads: parseInt(totalResult.rows[0].count, 10)
            });
        } catch (err) {
            next(err);
        }
    });

    router.get('/car-hub', async (req, res, next) => {
        const { reg_no } = req.query;
        if (!reg_no) return res.status(400).json({ error: 'Registration number is required' });
        try {
            const result = await pool.query(`SELECT hub_location FROM car_assignments WHERE reg_no = $1`, [reg_no]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Car not assigned' });
            res.json(result.rows[0]);
        } catch (err) {
            next(err);
        }
    });

    router.post('/submit', upload.fields([{ name: 'exterior_video', maxCount: 1 }, { name: 'interior_video', maxCount: 1 }]), async (req, res, next) => {
        const { reg_no, hub_location, cleaning_date } = req.body;
        if (!req.files || !req.files.exterior_video || !req.files.interior_video) {
            return res.status(400).json({ error: 'Both exterior and interior videos are required.' });
        }
        
        const exteriorPath = path.join('uploads', req.files.exterior_video[0].filename);
        const interiorPath = path.join('uploads', req.files.interior_video[0].filename);

        try {
            const carResult = await pool.query(`SELECT reason FROM car_assignments WHERE reg_no = $1 AND hub_location = $2`, [reg_no, hub_location]);
            if (carResult.rows.length === 0) return res.status(400).json({ error: "This car is not assigned to your hub." });

            const carReason = carResult.rows[0].reason;
            const insertQuery = `INSERT INTO cleaning_reports (reg_no, hub_location, cleaning_date, exterior_video_path, interior_video_path, user_email, reason) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
            const result = await pool.query(insertQuery, [reg_no, hub_location, cleaning_date, exteriorPath, interiorPath, req.session.email, carReason]);
            
            res.status(201).json({ id: result.rows[0].id, message: 'Report submitted successfully!' });
        } catch (err) {
            if (err.code === '23505') { // PostgreSQL unique constraint violation code
                return res.status(400).json({ error: `A cleaning report for ${reg_no} on this date already exists.` });
            }
            next(err);
        }
    });

    return router;
};