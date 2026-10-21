/// <reference types="vite/client" />

/**
 * Метка сборки, подставляется в `define` из vite.config.ts и показывается в меню приложения.
 * Помогает отличить на телефоне старую установленную версию от свежесобранной.
 */
declare const __BUILD_ID__: string;
