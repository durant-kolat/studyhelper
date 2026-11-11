import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B1F3B", // fond sombre — sidebar, en-têtes
        paper: "#FBF7F0", // fond de contenu, chaleureux
        gold: "#E8A33D", // accent principal — réussite, énergie
        clay: "#C1542E", // accent secondaire — examens, urgence
        forest: "#3F7A5D", // succès, progression positive
        slate: "#454A5E", // texte courant
        mist: "#E4E1D8", // bordures, séparateurs
        mist2: "#EFEAE0",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
