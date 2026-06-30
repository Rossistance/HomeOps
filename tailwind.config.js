/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm "paper & clay" surface palette — the material base of the home.
        sand: {
          50: "#faf8f5",
          100: "#f4f0e9",
          200: "#e9e1d4",
          300: "#d9cdb8",
          400: "#c2b094",
        },
        // Layered material surfaces (Tactile Hearth). Raised sits lighter than the
        // page so cards physically "lift"; sunken is for wells/inputs.
        surface: {
          base: "#ece3d5", // page — warm oat
          raised: "#fdfbf7", // card — warm porcelain
          sunken: "#e6dccb", // inset well
          overlay: "#fbf8f2", // popovers / modals
          rim: "#ffffff", // lit top edge
        },
        // Deep warm charcoal-navy navigation.
        ink: {
          50: "#f3f4f7",
          100: "#e6e8ee",
          200: "#cfd3dd",
          300: "#aab1c1",
          900: "#171b26",
          800: "#1f2535",
          700: "#2b3346",
          600: "#3a435a",
          500: "#525d76",
          400: "#7b8499",
        },
        // Ember — the signature brand warmth (the "hearth glow"). Distinct from the
        // status colors below; used for the hero, primary delight, and live accents.
        ember: {
          50: "#fdf1e7",
          100: "#fad9be",
          200: "#f5bc8c",
          300: "#ee9c5c",
          400: "#e47f35",
          500: "#d26420",
          600: "#ae4d18",
        },
        // Sage success / done
        sage: {
          50: "#eef5ee",
          100: "#d7e8d6",
          400: "#6fa873",
          500: "#558a59",
          600: "#436e46",
        },
        // Coral attention / danger
        coral: {
          50: "#fdeeea",
          100: "#fad7cd",
          400: "#f08a6c",
          500: "#e26948",
          600: "#c4502f",
        },
        // Amber warning
        amber: {
          50: "#fdf6e7",
          100: "#fbe9bf",
          400: "#eab308",
          500: "#d99a06",
          600: "#b27c04",
        },
        // Sky informational
        sky: {
          50: "#ebf4fb",
          100: "#cfe6f6",
          400: "#5aa9e0",
          500: "#3a8bc7",
          600: "#2c6e9f",
        },
        // Muted lavender — caregiving / family
        lavender: {
          50: "#f2effa",
          100: "#e2dbf3",
          400: "#9b86d4",
          500: "#7d66c0",
          600: "#634c9f",
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
        // Display — soft optical serif (Fraunces). Warm, human, used with restraint
        // for heroes, greetings, and big numbers.
        display: ["Fraunces", "Georgia", "Cambria", "Times New Roman", "serif"],
      },
      boxShadow: {
        // Tactile elevation scale — warm-tinted shadows + a lit top inner-highlight
        // so surfaces read as physical, lit material rather than flat SaaS cards.
        e1: "inset 0 1px 0 rgba(255,255,255,0.65), 0 1px 2px rgba(38,30,20,0.05), 0 3px 8px rgba(38,30,20,0.05)",
        e2: "inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 4px rgba(38,30,20,0.06), 0 14px 30px rgba(38,30,20,0.11)",
        e3: "inset 0 1px 0 rgba(255,255,255,0.6), 0 16px 34px rgba(31,24,16,0.16), 0 36px 70px rgba(31,24,16,0.18)",
        well: "inset 0 2px 4px rgba(38,30,20,0.10), inset 0 1px 0 rgba(255,255,255,0.5)",
        ember: "0 6px 24px rgba(214,108,46,0.32), 0 2px 6px rgba(214,108,46,0.22)",
        // Back-compat aliases (used across existing screens) — upgraded to the new
        // material depth so the whole app lifts at once.
        card: "inset 0 1px 0 rgba(255,255,255,0.65), 0 1px 2px rgba(38,30,20,0.05), 0 3px 8px rgba(38,30,20,0.05)",
        pop: "inset 0 1px 0 rgba(255,255,255,0.6), 0 16px 34px rgba(31,24,16,0.16), 0 36px 70px rgba(31,24,16,0.18)",
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
