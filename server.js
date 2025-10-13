require('dotenv').config(); // This line loads the .env file

const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // Mongoose for MongoDB
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- DATABASE CONNECTION ---
// Connect to MongoDB Atlas using the connection string from your .env file
mongoose.connect(process.env.ATLASDB_URL)
    .then(() => console.log('✅ MongoDB connected successfully.'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// --- DEFINE DATABASE SCHEMA ---
const PortfolioItemSchema = new mongoose.Schema({
    public_id: { type: String, required: true, unique: true },
    secure_url: { type: String, required: true },
    category: {
        type: String,
        required: true,
        enum: ['wedding_photos', 'birthday_photos', 'wedding_videos', 'portraits']
    },
    createdAt: { type: Date, default: Date.now }
});

const PortfolioItem = mongoose.model('PortfolioItem', PortfolioItemSchema);

// --- CONFIGURE CLOUDINARY ACCOUNT ---
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_SECRET_KEY,
});

// Configure multer for Cloudinary uploads
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const isVideo = file.mimetype.startsWith('video');
        const category = req.body.category;

        // --- NEW: Define transformations to apply on upload ---
        let transformation = [
            { quality: "auto", fetch_format: "auto" }
        ];

        if (isVideo) {
            // Transformations for videos
            transformation.push({
                width: 1280, // Set a standard width for videos
                crop: 'limit' // Ensure video is not scaled up
            });
        } else {
            // Transformations for images based on category
            if (category === 'portraits') {
                // Apply a portrait aspect ratio (2:3)
                transformation.push({
                    width: 800,
                    height: 1200,
                    crop: 'fill',
                    gravity: 'auto'
                });
            } else {
                // Apply a landscape aspect ratio (3:2) for all other photos
                transformation.push({
                    width: 1200,
                    height: 800,
                    crop: 'fill',
                    gravity: 'auto'
                });
            }
        }

        return {
            folder: 'portfolio',
            resource_type: isVideo ? 'video' : 'image',
            allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'mov'],
            tags: category ? [category] : [],
            transformation: transformation // Apply the defined transformations
        };
    },
});

// --- ADD FILE SIZE LIMIT TO MULTER ---
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100 MB limit
});

const app = express();
const PORT = 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'components' directory
app.use(express.static(path.join(__dirname, 'components')));

// --- API ENDPOINTS ---

// GET endpoint
app.get('/api/portfolio', async (req, res) => {
    try {
        const items = await PortfolioItem.find().sort({ createdAt: 'desc' });
        res.json({ resources: items });
    } catch (error) {
        console.error('Error fetching from MongoDB:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// POST endpoint
app.post('/api/upload', upload.single('imageFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file was uploaded.' });
    }
    try {
        const newItem = new PortfolioItem({
            public_id: req.file.filename,
            secure_url: req.file.path,
            category: req.body.category,
        });
        await newItem.save();
        res.status(201).json({
            message: 'File uploaded and saved successfully!',
            fileInfo: newItem
        });
    } catch (error) {
        console.error('Error saving item to MongoDB:', error);
        const isVideo = req.file.mimetype.startsWith('video');
        await cloudinary.uploader.destroy(req.file.filename, { resource_type: isVideo ? 'video' : 'image' });
        res.status(500).json({ error: 'Failed to save item to database.' });
    }
});

// DELETE endpoint
app.delete('/api/delete', async (req, res) => {
    const { public_id } = req.body;
    if (!public_id) {
        return res.status(400).json({ error: 'Image public_id is required.' });
    }
    try {
        const itemToDelete = await PortfolioItem.findOne({ public_id: public_id });
        const resource_type = itemToDelete?.secure_url.match(/\.mp4|\.mov$/) ? 'video' : 'image';

        const cloudinaryResult = await cloudinary.uploader.destroy(public_id, { resource_type });

        if (cloudinaryResult.result !== 'ok' && cloudinaryResult.result !== 'not found') {
            return res.status(500).json({ message: 'Error deleting from Cloudinary.' });
        }

        const dbResult = await PortfolioItem.findOneAndDelete({ public_id: public_id });

        if (!dbResult) {
            return res.status(404).json({ message: 'Item not found in database, but removed from Cloudinary if it existed.' });
        }

        res.status(200).json({ message: 'Item deleted successfully.' });
    } catch (error) {
        console.error('Error during deletion:', error);
        res.status(500).json({ error: 'Failed to delete item.' });
    }
});

// Main route to serve your website
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'components', 'index.html'));
});

// --- START SERVER WITH INCREASED TIMEOUT ---
const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

server.setTimeout(600000); // Set timeout to 10 minutes (600,000 milliseconds)

