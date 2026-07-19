import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4618,
    strictPort: true,
    host: true, // bind all interfaces — phone testing over the LAN (the /api proxy still targets localhost)
    proxy: {
      "/api": { target: "http://127.0.0.1:4617", changeOrigin: true },
    },
  },
});
