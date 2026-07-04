// Tactile Hearth tokens for the mobile client — mirrors the web design system
// (tailwind.config.js / index.css) so the iOS app feels like the same product.
export const Hearth = {
  paper: "#ece3d5",
  surface: "#fdfbf7",
  surfaceSunken: "#e6dccb",
  rim: "#ffffff",
  ink900: "#171b26",
  ink800: "#1f2535",
  ink700: "#2b3346",
  ink600: "#3a435a",
  ink500: "#525d76",
  ink400: "#7b8499",
  ember50: "#fdf1e7",
  ember400: "#e47f35",
  ember500: "#d26420",
  ember600: "#ae4d18",
  sage500: "#558a59",
  sage600: "#436e46",
  sageBg: "#eef5ee",
  coral500: "#e26948",
  coral600: "#c4502f",
  coralBg: "#fdeeea",
  amber500: "#d99a06",
  amber600: "#b27c04",
  amberBg: "#fdf6e7",
  sky500: "#3a8bc7",
  skyBg: "#ebf4fb",
  lavender500: "#7d66c0",
  lavenderBg: "#f2effa",
  border: "rgba(23,27,38,0.08)",
  white: "#ffffff",
};

// Map a risk / status to a semantic color (meaning preserved from web).
export function riskColor(risk: string): string {
  switch (risk) {
    case "Low": return Hearth.sage600;
    case "Medium": return Hearth.amber600;
    case "High": return Hearth.coral600;
    case "Sensitive": return Hearth.lavender500;
    default: return Hearth.ink500;
  }
}
