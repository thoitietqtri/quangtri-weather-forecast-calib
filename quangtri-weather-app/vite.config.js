import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Cổng cố định 5173 — PHẢI khớp với targetPort trong netlify.toml.
    // strictPort=true: nếu 5173 đang bị chiếm, Vite BÁO LỖI ngay thay vì tự
    // âm thầm nhảy sang cổng khác (5174, 5175...) — tránh lệch cổng với
    // netlify.toml gây lỗi "Timed out waiting for port".
    port: 5173,
    strictPort: true,
  },
})
