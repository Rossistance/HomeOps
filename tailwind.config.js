/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Hearth (FamiliOS handoff) — the same token values the iOS app ships.
        // Warm porcelain surfaces, ember accent, ink-navy heroes.
        sand: {
          50: "#fbf9f4",
          100: "#f5f1e9",
          200: "#ede7d9",
          300: "#dfd5c2",
          400: "#c9bca0",
        },
        // Layered material surfaces. Raised = pure white cards on warm porcelain;
        // sunken is for wells/inputs/segmented tracks.
        surface: {
          base: "#f5f1e9", // page — warm porcelain
          raised: "#ffffff", // card
          sunken: "#ede7d9", // inset well
          overlay: "#ffffff", // popovers / modals
          rim: "#ffffff", // lit top edge
        },
        // Ink-navy — text at the dark end, and the hero/nav gradient stops
        // (700→900 is exactly the handoff hero: #2A3147 → #151A26).
        ink: {
          50: "#f4f5f7",
          100: "#ebedf1",
          200: "#dcdfe5",
          300: "#c2c7d1",
          400: "#9aa1b0",
          500: "#6c7488",
          600: "#4a5468",
          700: "#2a3147",
          800: "#232b3e",
          900: "#151a26",
        },
        // Ember — the signature accent (#CE5D1D, per handoff).
        ember: {
          50: "#faede3",
          100: "#f4d6c0",
          200: "#ecb58c",
          300: "#ee9c5c",
          400: "#e0662c",
          500: "#ce5d1d",
          600: "#b14f17",
        },
        // Semantic status colors (handoff table; meaning is fixed).
        sage: {
          50: "#ecf2ed",
          100: "#d5e4d8",
          400: "#6fae7c",
          500: "#4e8c5e",
          600: "#3f7a4f",
        },
        coral: {
          50: "#f9eae7",
          100: "#f3d2ca",
          400: "#e2694b",
          500: "#d25839",
          600: "#c6482e",
        },
        amber: {
          50: "#f7efdf",
          100: "#eeddb9",
          400: "#d9a24b",
          500: "#c78d2f",
          600: "#b4791e",
        },
        sky: {
          50: "#eaf1f7",
          100: "#d2e2ef",
          400: "#6fa6d6",
          500: "#4b85b9",
          600: "#2e6fa3",
        },
        lavender: {
          50: "#f2eef7",
          100: "#e2d9ee",
          400: "#b096d6",
          500: "#9578bf",
          600: "#7c5ca8",
        },
      },
      fontFamily: {
        // Body / UI — neutral, highly legible.
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // Display — Newsreader (matches iOS). Warm, human, used with restraint
        // for heroes, greetings, and big numbers.
        display: ["Newsreader", "Georgia", "Cambria", "Times New Roman", "serif"],
      },
      boxShadow: {
        // Hearth elevation — resting cards are VERY quiet (0 1px 2px @ 4%); only
        // heroes and popovers get real depth.
        e1: "0 1px 2px rgba(32,28,21,0.04)",
        e2: "0 2px 4px rgba(32,28,21,0.05), 0 12px 28px rgba(32,28,21,0.08)",
        e3: "0 18px 40px -20px rgba(21,26,38,0.55), 0 36px 70px rgba(21,26,38,0.12)",
        well: "inset 0 1px 3px rgba(32,28,21,0.06)",
        ember: "0 10px 24px -12px rgba(206,93,29,0.55)",
        // Back-compat aliases (used across existing screens).
        card: "0 1px 2px rgba(32,28,21,0.04)",
        pop: "0 18px 40px -20px rgba(21,26,38,0.55), 0 36px 70px rgba(21,26,38,0.12)",
      },
      borderRadius: {
        xl2: "1.1rem",
        "4xl": "1.75rem",
        "5xl": "2.25rem",
      },
      keyframes: {
        "ember-breathe": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(1.04)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        // Gated behind reduced-motion + Calm Mode in index.css.
        "ember-breathe": "ember-breathe 7s ease-in-out infinite",
        rise: "rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
