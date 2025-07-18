const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '../../uploads');
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

module.exports = (db) => {
    router.get('/stats', (req, res, next) => {
        const email = req.session.email;
        db.get(`SELECT COUNT(*) as count FROM cleaning_reports WHERE user_email = ? AND DATE(submission_date) = DATE('now')`, [email], (err, todayRow) => {
            if (err) return next(err);
            db.get(`SELECT COUNT(*) as count FROM cleaning_reports WHERE user_email = ?`, [email], (err, totalRow) => {
                if (err) return next(err);
                res.json({ today_uploads: todayRow.count || 0, total_uploads: totalRow.count || 0 });
            });
        });
    });

    router.get('/car-hub', (req, res, next) => {
        const { reg_no } = req.query;
        if (!reg_no) return res.status(400).json({ error: 'Registration number is required' });
        db.get(`SELECT hub_location FROM car_assignments WHERE reg_no = ?`, [reg_no], (err, row) => {
            if (err) return next(err);
            if (!row) return res.status(404).json({ error: 'Car not assigned' });
            res.json(row);
        });
    });

    router.post('/submit', upload.fields([{ name: 'exterior_video', maxCount: 1 }, { name: 'interior_video', maxCount: 1 }]), (req, res, next) => {
        const { reg_no, hub_location, cleaning_date } = req.body;
        if (!req.files || !req.files.exterior_video || !req.files.interior_video) {
            return res.status(400).json({ error: 'Both exterior and interior videos are required.' });
        }
        
        const exteriorPath = path.join('uploads', req.files.exterior_video[0].filename);
        const interiorPath = path.join('uploads', req.files.interior_video[0].filename);

        db.get(`SELECT reason FROM car_assignments WHERE reg_no = ? AND hub_location = ?`, [reg_no, hub_location], (err, car) => {
            if (err) return next(err);
            if (!car) return res.status(400).json({ error: "This car is not assigned to your hub." });

            db.run(`INSERT INTO cleaning_reports (reg_no, hub_location, cleaning_date, exterior_video_path, interior_video_path, user_email, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [reg_no, hub_location, cleaning_date, exteriorPath, interiorPath, req.session.email, car.reason],
                function(err) {
                    if (err) {
                         if (err.code === 'SQLITE_CONSTRAINT') {
                            return res.status(400).json({ error: `A cleaning report for ${reg_no} on this date already exists.` });
                        }
                        return next(err);
                    }
                    res.status(201).json({ id: this.lastID, message: 'Report submitted successfully!' });
                }
            );
        });
    });

    return router;
};