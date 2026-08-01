/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MINNOW_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
