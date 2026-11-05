import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/apps/_app/electronica-negotiation/',
    plugins: [react()],
    css: { postcss: { plugins: [] } },
    build: {
        outDir: 'dist-web',
        emptyOutDir: true,
        cssCodeSplit: false,
        rollupOptions: {
            input: { floor: 'src/main.tsx' },
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/floor.[ext]',
            },
        },
    },
});
