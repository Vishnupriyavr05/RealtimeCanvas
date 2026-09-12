/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Socket.IO server. Unset/`auto` = same-origin. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
