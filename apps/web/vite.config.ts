import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento o frontend fala com a API pelo proxy, no mesmo origin,
// o que mantém o cookie de sessão SameSite=Strict funcionando sem CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:3333",
        changeOrigin: false,
      },
    },
  },
});
