/** Injected at build time via Vite `define` (zie root `vite.config.ts`). */
declare const __LICENSE_SERVER_URL__: string | undefined
declare const __LICENSE_PRODUCT_KEY__: string | undefined

export function getLicenseBuildConfig(): { serverUrl: string; productKey: string } {
  const serverUrl =
    (typeof __LICENSE_SERVER_URL__ !== 'undefined' ? __LICENSE_SERVER_URL__ : '')?.trim() || ''
  const productKey =
    (typeof __LICENSE_PRODUCT_KEY__ !== 'undefined' ? __LICENSE_PRODUCT_KEY__ : '')?.trim() || ''
  return { serverUrl, productKey }
}
