# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## GPU Acceleration for Transcription (Optional)

ReadAlong supports optional GPU acceleration using NVIDIA CUDA for faster audio transcription during the import process.

### Prerequisites

To use GPU acceleration, you must have the following installed on your host machine:

1.  **NVIDIA GPU:** A compatible NVIDIA graphics card (e.g., RTX series).
2.  **NVIDIA Drivers:** Ensure your host has the correct NVIDIA drivers installed.
3.  **NVIDIA Container Toolkit:** You *must* install the NVIDIA Container Toolkit to allow Docker to access the host's GPU.
    *   Installation instructions: [NVIDIA Container Toolkit Documentation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
    *   Note: Plain Docker Desktop on Windows/Mac may require additional WSL2 configuration.

### How it Works

The provided `docker-compose.yml` file is already configured to request GPU access via the `deploy.resources.reservations.devices` directive.

When you run `docker-compose up`:

*   **If a compatible GPU and the Toolkit are found:** The container will utilize the GPU, significantly speeding up the whisper.cpp transcription phase.
*   **If no GPU/Toolkit is found (CPU Fallback):** Whisper.cpp is designed to gracefully fall back to CPU execution. The server will still run and transcribe audio, albeit slower. Self-hosting is not broken for users without NVIDIA hardware.
