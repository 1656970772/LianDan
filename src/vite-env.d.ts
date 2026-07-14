/// <reference types="vite/client" />

import type { M1BrowserApi } from './game/m1/contracts.ts'

declare global {
  interface Window {
    __LIANDAN_M1__?: M1BrowserApi
  }
}
