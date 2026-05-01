/**
 * Brand Configuration — single OnBuzz Community brand for the OSS edition.
 */

export const brand = {
  id: 'onbuzz',
  name: 'OnBuzz',
  productName: 'OnBuzz',
  fullProductName: 'OnBuzz Community',
  tagline: 'Your local AI fleet',
  logoPath: '/brands/onbuzz/logo.webp',
  logo2Path: '/brands/onbuzz/logo2.webp',
  faviconPath: '/brands/onbuzz/icon.svg',
  storagePrefix: 'onbuzz',
  // Yellow accent palette (Tailwind space-separated RGB).
  colors: {
    50:  '254 252 232',
    100: '254 249 195',
    200: '253 230 138',
    300: '252 211 77',
    400: '250 204 21',
    500: '234 179 8',
    600: '202 138 4',
    700: '161 98 7',
    800: '133 77 14',
    900: '113 63 18',
  },
};

/**
 * Apply brand colors to CSS variables and data attribute.
 * Call once on app init (e.g. in App.jsx or main.jsx).
 */
export function applyBrand() {
  const root = document.documentElement;
  root.dataset.brand = brand.id;

  Object.entries(brand.colors).forEach(([shade, rgb]) => {
    root.style.setProperty(`--loxia-${shade}`, rgb);
  });

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = brand.faviconPath;

  document.title = brand.fullProductName;
}

export default brand;
