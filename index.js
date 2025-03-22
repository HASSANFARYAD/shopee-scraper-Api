// Import required modules
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const { HttpsProxyAgent } = require("https-proxy-agent");
const NodeCache = require("node-cache");
const userAgents = require("./userAgents");

const app = express();
const PORT = process.env.PORT || 3005;
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 mins
const proxyCache = new NodeCache({ stdTTL: 600 }); // Cache working proxies for 10 mins
app.set("trust proxy", 1);

app.use(cors());

// ✅ Rate Limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Allow max 10 requests per minute
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// ✅ Logging function
const logToFile = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync("logs.txt", logMessage);
};

// ✅ Function to fetch free proxies dynamically
const getFreeProxies = async () => {
  try {
    const response = await axios.get(
      "https://www.proxy-list.download/api/v1/get?type=https"
    );
    return response.data.split("\r\n").filter((proxy) => proxy.trim() !== "");
  } catch (error) {
    logToFile(`Failed to fetch proxies: ${error.message}`);
    return [];
  }
};

// ✅ Function to test a proxy
const testProxy = async (proxy) => {
  try {
    await axios.get("https://www.google.com", {
      proxy: { host: proxy.split(":")[0], port: proxy.split(":")[1] },
      timeout: 5000,
    });
    return true;
  } catch (error) {
    return false;
  }
};

// ✅ Function to fetch and cache working proxies
const getWorkingProxies = async () => {
  let workingProxies = proxyCache.get("proxies");
  if (workingProxies && workingProxies.length > 0) return workingProxies;

  let proxies = await getFreeProxies();
  workingProxies = [];
  for (const proxy of proxies) {
    if (await testProxy(proxy)) workingProxies.push(proxy);
  }

  if (workingProxies.length > 0) {
    proxyCache.set("proxies", workingProxies);
    logToFile(`Cached ${workingProxies.length} working proxies`);
  } else {
    logToFile("No working proxies found.");
  }
  return workingProxies;
};

// ✅ Function to fetch Shopee data with retry logic
// const fetchShopeeData = async (storeId, dealId) => {
//   let proxies = await getWorkingProxies();
//   if (proxies.length === 0) throw new Error("No working proxies available");

//   for (let attempt = 1; attempt <= 3; attempt++) {
//     for (const proxy of proxies) {
//       try {
//         const agent = new HttpsProxyAgent(`http://${proxy}`);
//         const randomUserAgent =
//           userAgents[Math.floor(Math.random() * userAgents.length)];

//         const response = await axios.get(
//           `https://shopee.tw/api/v4/pdp/get_pc?shopid=${storeId}&itemid=${dealId}`,
//           {
//             headers: {
//               "User-Agent": randomUserAgent,
//               "Accept-Language": "en-US,en;q=0.9",
//               Referer: "https://shopee.tw/",
//             },
//             httpsAgent: agent,
//             timeout: 7000,
//           }
//         );

//         // ✅ Detect Invalid Responses (Shopee CAPTCHA or errors)
//         if (!response.data || response.status !== 200) {
//           logToFile(`Proxy failed: ${proxy}, trying next...`);
//           continue;
//         }

//         logToFile(
//           `Successfully fetched data for storeId: ${storeId}, dealId: ${dealId}`
//         );
//         return response.data;
//       } catch (error) {
//         logToFile(`Proxy failed: ${proxy}, trying next...`);
//       }
//     }
//   }
//   throw new Error("All proxies failed after multiple attempts");
// };

const fetchShopeeData = async (storeId, dealId) => {
  const brightDataProxy = {
    host: "brd.superproxy.io", // Bright Data proxy server
    port: 33335, // Bright Data proxy port
    auth: {
      username: "brd-customer-hl_fbbe4dd5", // Bright Data username
      zone: "zone-residential_proxy1", // Bright Data username
      password: "wm1b5x6rd9ue", // Bright Data password
    },
  };

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const agent = new HttpsProxyAgent(
        `http://${brightDataProxy.username}-${brightDataProxy.zone}:${brightDataProxy.password}@${brightDataProxy.host}:${brightDataProxy.port}`
      );
      const randomUserAgent =
        userAgents[Math.floor(Math.random() * userAgents.length)];

      const response = await axios.get(
        `https://shopee.tw/api/v4/pdp/get_pc?shopid=${storeId}&itemid=${dealId}`,
        {
          headers: {
            "User-Agent": randomUserAgent,
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://shopee.tw/",
          },
          httpsAgent: agent,
          timeout: 7000,
        }
      );

      if (!response.data || response.status !== 200) {
        console.warn(`Bright Data proxy failed, retrying...`);
        continue;
      }

      console.log(
        `Successfully fetched data for storeId: ${storeId}, dealId: ${dealId}`
      );
      return response.data;
    } catch (error) {
      console.warn(
        `Bright Data proxy failed on attempt ${attempt}, retrying...`
      );
    }
  }

  throw new Error("All proxy attempts failed.");
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

    // ✅ Fetch Shopee data with retries
    const data = await fetchShopeeData(storeId, dealId);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    logToFile(`Error fetching Shopee data: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve data" });
  }
});

// ✅ Health Check Endpoint
app.get("/status", async (req, res) => {
  try {
    const proxies = proxyCache.get("proxies") || [];
    const healthStatus = {
      status: "OK",
      uptime: process.uptime(),
      cachedProxies: proxies.length,
      timestamp: new Date().toISOString(),
    };

    logToFile("Health check requested.");
    res.json(healthStatus);
  } catch (error) {
    logToFile(`Health check error: ${error.message}`);
    res.status(500).json({ error: "Health check failed" });
  }
});

// ✅ Start Server
app.listen(PORT, () => {
  logToFile(`Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
});
