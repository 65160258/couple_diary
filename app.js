const express = require('express');
const path = require('path');
const multer = require('multer');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');


const app = express();

// ตั้งค่า EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret', // ใช้ค่าเริ่มต้นถ้าไม่มีใน .env
    resave: false,
    saveUninitialized: true
}));


// Multer config
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Database connection
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Middleware to check if user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Routes
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/diary');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/diary', isAuthenticated, async (req, res) => {
    try {
        const [entries] = await pool.execute(`
            SELECT d.*, u.username as author_name  
            FROM diary_entries d
            JOIN users u ON d.author_id = u.id
            JOIN couples c ON d.couple_id = c.id
            WHERE c.user1_id = ? OR c.user2_id = ?
            ORDER BY d.created_at DESC
        `, [req.session.userId, req.session.userId]);
        
        
        res.render('diary-entries', { entries });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/new-entry', isAuthenticated, (req, res) => {
    res.render('new-entry');
});

app.post('/diary/new', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const { title, content, mood, location } = req.body;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        
        const [couple] = await pool.execute(
            'SELECT id FROM couples WHERE user1_id = ? OR user2_id = ?',
            [req.session.userId, req.session.userId]
        );
        
        if (couple.length === 0) {
            return res.status(400).send('No couple relationship found');
        }
        
        await pool.execute(
            'INSERT INTO diary_entries (couple_id, author_id, title, content, mood, location, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [couple[0].id, req.session.userId, title, content, mood, location, imageUrl]
        );
        
        res.redirect('/diary');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/signup', (req, res) => {
    res.render('signup'); // แสดงหน้า signup
});

// Route สำหรับรับข้อมูลจากฟอร์ม signup
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        // เช็คว่ามีผู้ใช้อยู่แล้วหรือไม่
        const [existingUser] = await pool.execute(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );

        if (existingUser.length > 0) {
            return res.status(400).send('Username already exists');
        }

        // เข้ารหัสรหัสผ่านก่อนบันทึก
        const hashedPassword = await bcrypt.hash(password, 10);

        // บันทึกข้อมูลผู้ใช้ในฐานข้อมูล
        await pool.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );

        res.redirect('/login'); // หลังสมัครสำเร็จให้ไปหน้า login
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // ค้นหาผู้ใช้ในฐานข้อมูล
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(400).send('Invalid username or password');
        }

        const user = users[0];

        // ตรวจสอบรหัสผ่าน
        const bcrypt = require('bcrypt');
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).send('Invalid username or password');
        }

        // บันทึก userId ใน session
        req.session.userId = user.id;

        res.redirect('/diary'); // หลังจากล็อกอินสำเร็จให้ไปที่หน้า diary
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/diary/:id', isAuthenticated, async (req, res) => {
    try {
        const [entries] = await pool.execute(
            'SELECT d.*, u.username AS author_name FROM diary_entries d JOIN users u ON d.author_id = u.id WHERE d.id = ?',
            [req.params.id]
        );

        if (entries.length === 0) {
            return res.status(404).send('Entry not found');
        }

        const entry = entries[0];
        res.render('diary-detail', { entry });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// ดึงข้อมูลบันทึกสำหรับแก้ไข
app.get('/diary/edit/:id', isAuthenticated, async (req, res) => {
    const diaryId = req.params.id;

    if (!diaryId) {
        return res.status(400).send('Invalid diary ID');
    }

    try {
        const [results] = await pool.execute('SELECT * FROM diary_entries WHERE id = ?', [diaryId]);

        if (results.length === 0) {
            return res.status(404).send('ไม่พบบันทึกที่ต้องการ');
        }

        res.render('edit-entry', { entry: results[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('เกิดข้อผิดพลาดในระบบ');
    }
});

// Edit Diary Entry - Handle Form Submission
app.post('/diary/edit/:id', isAuthenticated, upload.single('image'), async (req, res) => {
    const diaryId = req.params.id;
    const { title, content, mood, location, removeImage } = req.body;
    let imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        // Check if the user is the author of the entry
        const [entry] = await pool.execute('SELECT * FROM diary_entries WHERE id = ?', [diaryId]);

        if (entry.length === 0) {
            return res.status(404).send('Entry not found');
        }

        // If the user wants to remove the image, set imageUrl to null
        if (removeImage && entry[0].image_url) {
            imageUrl = null;
        }

        // Update the diary entry in the database
        await pool.execute(
            'UPDATE diary_entries SET title = ?, content = ?, mood = ?, location = ?, image_url = ? WHERE id = ?',
            [title, content, mood, location, imageUrl, diaryId]
        );

        res.redirect('/diary'); // Redirect back to the diary page
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating the entry');
    }
});

// ลบบันทึก
app.post('/diary/delete/:id', isAuthenticated, async (req, res) => {
    const diaryId = req.params.id;

    try {
        await pool.execute('DELETE FROM diary_entries WHERE id = ?', [diaryId]);
        res.redirect('/diary');
    } catch (err) {
        console.error(err);
        res.status(500).send('เกิดข้อผิดพลาดในการลบ');
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});