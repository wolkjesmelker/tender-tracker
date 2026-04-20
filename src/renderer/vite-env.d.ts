/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  readonly VITE_DEV_SERVER_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
