module.exports = {
  apps: [
    {
      name: "openmarket-ai",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3010",
      env: {
        NODE_ENV: "production",
        PORT: 3010,
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3010",
        ALLOW_DEV_FAKE_SETTLEMENT: process.env.ALLOW_DEV_FAKE_SETTLEMENT || "true",
        OM_DATA_DIR: process.env.OM_DATA_DIR || require("path").join(__dirname, "data"),
        HEDERA_OPERATOR_ID: process.env.HEDERA_OPERATOR_ID || "",
        PLATFORM_FEE_BPS: process.env.PLATFORM_FEE_BPS || "200",
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
