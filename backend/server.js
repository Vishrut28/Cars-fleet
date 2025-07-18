if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    httpOnly: true, 
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const DB_PATH = './database.db';
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error('Error connecting to database:', err);
  } else {
    logger.info('✅ SQLite Database connected.');
    db.run('PRAGMA foreign_keys = ON;');
  }
});

require('./db-init')(db);

const requireAuth = (role = null) => (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    if (role && req.session.role !== role) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to access this resource.' });
    }
    next();
};

const authRoutes = require('./routes/auth')(db);
const adminRoutes = require('./routes/admin')(db);
const auditorRoutes = require('./routes/auditor')(db);
const groundRoutes = require('./routes/ground')(db);
const yardRoutes = require('./routes/yard')(db);
const publicRoutes = require('./routes/public')(db);

app.use('/api/auth', authRoutes);
app.use('/api/admin', requireAuth('admin'), adminRoutes);
app.use('/api/auditor', requireAuth('auditor'), auditorRoutes);
app.use('/api/ground', requireAuth('ground'), groundRoutes);
app.use('/api/yard', requireAuth('yard_manager'), yardRoutes);
app.use('/api', publicRoutes);

app.use((err, req, res, next) => {
    logger.error({ message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'An internal server error occurred.' });
});

app.listen(port, () => logger.info(`🚀 Server listening on port ${port}`));

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) logger.error(err.message);
    logger.info('Database connection closed.');
    process.exit(0);
  });
});