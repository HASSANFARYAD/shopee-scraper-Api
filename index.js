const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
const { HttpsProxyAgent } = require("https-proxy-agent");
const userAgents = require("./userAgents");

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3005;
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache
app.set("trust proxy", 1);
app.use(cors());

// ✅ Rate Limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Allow max 10 requests per minute
  message: { error: "Too many requests, slow down!" },
});
app.use(limiter);

// ✅ Logging function
const logToFile = (message) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync("logs.txt", `[${timestamp}] ${message}\n`);
};

// ✅ Bright Data Proxy Configuration (FIXED)
const brightDataProxy = {
  host: "brd.superproxy.io",
  port: 22225, // ✅ Corrected Port
  username: "brd-customer-hl_fbbe4dd5-zone-residential_proxy1",
  password: "wm1b5x6rd9ue",
};

// ✅ Function to fetch Shopee data using Puppeteer (Bypassing Detection)
const fetchShopeeData = async (storeId, dealId) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--proxy-server=http://${brightDataProxy.username}:${brightDataProxy.password}@${brightDataProxy.host}:${brightDataProxy.port}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const page = await browser.newPage();
  await page.authenticate({
    username: brightDataProxy.username,
    password: brightDataProxy.password,
  });

  const randomUserAgent =
    userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setUserAgent(randomUserAgent);

  const url = `https://shopee.tw/api/v4/pdp/get_rw?shopid=${storeId}&itemid=${dealId}`;

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 10000 });
    const body = await page.evaluate(() => document.body.innerText);
    await browser.close();

    return JSON.parse(body);
  } catch (error) {
    await browser.close();
    logToFile(`Shopee Puppeteer Error: ${error.message}`);
    throw new Error("Failed to scrape Shopee (Blocked or Error)");
  }
};

// ✅ Shopee Scraper API Endpoint
app.get("/shopee", async (req, res) => {
  try {
    const { storeId, dealId } = req.query;
    if (!storeId || !dealId) {
      return res.status(400).json({ error: "Missing storeId or dealId" });
    }

    logToFile(`Received request: storeId=${storeId}, dealId=${dealId}`);

    // ✅ Check cache
    const cacheKey = `${storeId}-${dealId}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    // ✅ Fetch Shopee data
    const data = await fetchShopeeData(storeId, dealId);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    logToFile(`Error fetching Shopee data: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve data" });
  }
});

// ✅ Health Check Endpoint
app.get("/status", (req, res) => {
  res.json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ✅ Start Server
app.listen(PORT, () => {
  logToFile(`Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
});

module.exports = userAgents;
