/**
 * Test stub for the `server-only` package.
 *
 * The real module throws unless the Next.js bundler resolves its `react-server`
 * export condition, which no plain Node runner does. Aliasing it here lets tests
 * import server modules; the boundary itself is still enforced in the app, where
 * Next rejects any client component that reaches for one.
 */
export {};
