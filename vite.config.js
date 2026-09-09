import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    base: '/',
    build: {
        target: 'esnext',
        minify: 'esbuild',
        cssCodeSplit: true,
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // React core
                    if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
                        return 'react-core';
                    }
                    // Supabase
                    if (id.includes('@supabase')) {
                        return 'supabase';
                    }
                    // Chart libraries
                    if (id.includes('recharts') || id.includes('chart.js') || id.includes('react-chartjs')) {
                        return 'charts';
                    }
                    // Radix UI components
                    if (id.includes('@radix-ui')) {
                        return 'radix';
                    }
                    // Swiper / embla carousel
                    if (id.includes('swiper') || id.includes('embla')) {
                        return 'carousel';
                    }
                    // Framer motion
                    if (id.includes('framer-motion')) {
                        return 'motion';
                    }
                    // Icons
                    if (id.includes('lucide-react') || id.includes('react-icons') || id.includes('font-awesome')) {
                        return 'icons';
                    }
                    // Form libraries
                    if (id.includes('react-hook-form') || id.includes('zod') || id.includes('@hookform')) {
                        return 'forms';
                    }
                    // Date utilities
                    if (id.includes('date-fns') || id.includes('flatpickr') || id.includes('react-day-picker')) {
                        return 'date-utils';
                    }
                    // Other vendor
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                },
            },
        },
        // Output detailed CSS
        cssMinify: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    },
    server: {
        host: true,
        port: 5173,
        strictPort: false, // allow fallback to another port if 5173 is busy
        open: false,
    },
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            '@supabase/supabase-js',
            'lucide-react',
        ],
    },
});
