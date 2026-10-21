import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The speech-recognition worker loads its runtime in pieces, which needs ES-module workers.
  worker: { format: 'es' },
  // Prepare the lazily-loaded libraries at startup, so the dev server doesn't
  // reload the page the first time someone exports or uses an AI tool.
  optimizeDeps: { include: ['@huggingface/transformers', '@mediapipe/tasks-vision', 'mediabunny'] },
});
