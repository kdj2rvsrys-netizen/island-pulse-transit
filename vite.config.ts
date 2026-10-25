import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.API_PORT || 8788);
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
