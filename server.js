
const path = require("path");
const dns = require("node:dns");
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

require("dotenv").config();

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const Url = require("./models/Url");

const app = express();

// Resolve project folders correctly for local development and Netlify
const projectDir = process.env.NETLIFY
    ? path.resolve(__dirname, "../..")
    : __dirname;

// Express configuration
app.set("view engine", "ejs");
app.set("views", path.join(projectDir, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(projectDir, "public")));

// MongoDB connection
let dbConnectionPromise = null;

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing from environment variables");
    }

    if (!dbConnectionPromise) {
        dbConnectionPromise = mongoose.connect(process.env.MONGO_URI)
            .catch((error) => {
                dbConnectionPromise = null;
                throw error;
            });
    }

    await dbConnectionPromise;
}

// Homepage
app.get("/", async (req, res) => {
    try {
        await connectDB();
        res.render("index");
    } catch (error) {
        console.error("Homepage error:", error);
        res.status(500).send("Database connection failed.");
    }
});

// Shorten URL
app.post("/shorten", async (req, res) => {
    try {
        await connectDB();

        let originalUrl = req.body.originalUrl;

        if (!originalUrl) {
            return res.status(400).send("Please enter a URL.");
        }

        originalUrl = originalUrl.trim();

        // Validate URL
        let parsedUrl;

        try {
            parsedUrl = new URL(originalUrl);
        } catch {
            return res.status(400).send("Please enter a valid URL.");
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return res.status(400).send("Only HTTP and HTTPS URLs are allowed.");
        }

        // Generate short code
        const shortCode = crypto.randomBytes(5).toString("hex");

        // Save URL
        const newUrl = new Url({
            originalUrl,
            shortCode
        });

        await newUrl.save();

        const siteUrl = (
            process.env.SITE_URL ||
            `${req.protocol}://${req.get("host")}`
        ).replace(/\/$/, "");

        const shortUrl = `${siteUrl}/${shortCode}`;

        res.render("result", {
            originalUrl,
            shortUrl,
            shortCode
        });

    } catch (error) {
        console.error("URL shortening error:", error);
        res.status(500).send("Unable to shorten URL. Please try again.");
    }
});

// Redirect short URL
app.get("/:shortCode", async (req, res) => {
    try {
        await connectDB();

        const url = await Url.findOne({
            shortCode: req.params.shortCode
        });

        if (!url) {
            return res.status(404).send("Shortened URL not found.");
        }

        url.clicks += 1;
        await url.save();

        res.redirect(url.originalUrl);

    } catch (error) {
        console.error("Redirect error:", error);
        res.status(500).send("Unable to redirect. Please try again.");
    }
});

// Export app for Netlify
module.exports = app;

// Start local server
if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    connectDB()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`TheBuild Link running on port ${PORT}`);
            });
        })
        .catch((error) => {
            console.error("MongoDB connection error:", error);
            process.exit(1);
        });
}
