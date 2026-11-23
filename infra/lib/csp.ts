/**
 * The site's Content-Security-Policy, shared by the CloudFront headers (pmt-stack.ts) and the local dev server
 * (web/vite.config.ts), so local testing hits the same restrictions as the deployed site.
 * `connect` lists the extra origins the page may call (Cognito, S3 on AWS; the HMR socket locally).
 */
export function contentSecurityPolicy(connect: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // ECharts sets inline styles
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    // blob: = the source viewer hands pdf.js an object URL of the PDF it downloaded
    ["connect-src 'self' blob:", ...connect].join(" "),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
