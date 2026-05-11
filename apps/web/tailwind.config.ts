import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Dark theme backgrounds: neutral/gray ≤20% lightness
        background: {
          DEFAULT: "#0a0a0a", // ~4% lightness
          secondary: "#141414", // ~8% lightness
          tertiary: "#1a1a1a", // ~10% lightness
          card: "#1f1f1f", // ~12% lightness
          elevated: "#262626", // ~15% lightness
          border: "#2e2e2e", // ~18% lightness
        },
        // Text colors: neutral tones ≥80% lightness
        foreground: {
          DEFAULT: "#ededed", // ~93% lightness
          secondary: "#d4d4d4", // ~83% lightness
          muted: "#a3a3a3", // ~64% lightness (for less emphasis)
        },
        // Status colors
        status: {
          healthy: "#22c55e",
          degraded: "#eab308",
          offline: "#ef4444",
        },
        // Accent
        accent: {
          DEFAULT: "#6366f1",
          hover: "#818cf8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
