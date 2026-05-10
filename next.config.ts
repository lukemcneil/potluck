import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server's HMR + RSC traffic from common LAN ranges and
  // any *.trycloudflare.com tunnel so the app can be opened on phones
  // during development.
  allowedDevOrigins: [
    "192.168.0.105",
    "192.168.0.0/24",
    "192.168.1.0/24",
    "10.0.0.0/8",
    "*.trycloudflare.com",
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
};

export default nextConfig;
