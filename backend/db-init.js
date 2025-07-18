const logger = require('./logger');

const createTablesQueries = [
    `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'ground'
    )`,
    `CREATE TABLE IF NOT EXISTS hubs (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        location VARCHAR(255) NOT NULL,
        sheet_id VARCHAR(255)
    )`,
    `CREATE TABLE IF NOT EXISTS hub_assignments (
        id SERIAL PRIMARY KEY,
        hub_id INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        UNIQUE (hub_id, user_id, role)
    )`,
    `CREATE TABLE IF NOT EXISTS car_assignments (
        id SERIAL PRIMARY KEY,
        reg_no VARCHAR(255) NOT NULL UNIQUE,
        hub_location VARCHAR(255) NOT NULL,
        reason VARCHAR(255) NOT NULL DEFAULT 'unknown',
        assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS cleaning_reports (
        id SERIAL PRIMARY KEY,
        reg_no VARCHAR(255) NOT NULL,
        hub_location VARCHAR(255) NOT NULL,
        cleaning_date DATE NOT NULL,
        exterior_video_path VARCHAR(255),
        interior_video_path VARCHAR(255),
        submission_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        audit_status VARCHAR(50) DEFAULT 'pending',
        audit_rating INTEGER,
        audit_notes TEXT,
        user_email VARCHAR(255) NOT NULL,
        reason TEXT,
        UNIQUE (reg_no, hub_location, cleaning_date)
    )`,
    `INSERT INTO users (email, role) VALUES ('aditya.thakur@cariotauto.com', 'admin') ON CONFLICT (email) DO NOTHING`
];

module.exports = async (pool) => {
    logger.info('Initializing database schema...');
    const client = await pool.connect();
    try {
        for (const query of createTablesQueries) {
            await client.query(query);
        }
        logger.info('✅ Database tables initialized successfully.');
    } catch (err) {
        logger.error('Error initializing database schema:', err);
    } finally {
        client.release();
    }
};