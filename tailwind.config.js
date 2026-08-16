/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // AUPP brand
        navy: "#202F64",        // AUPP crest navy — teacher header, primary actions
        "navy-deep": "#141F45", // darker navy, student page ground
        red: "#C12033",         // AUPP red — accents, flagged/rejection
        ink: "#141F45",         // student page ground (alias of navy-deep)
        signal: "#2FB37A",      // success green — clearest "you're in" signal
        halt: "#C12033",        // rejection / flagged — AUPP red
        dusk: "#26315C",        // panels on the dark student page (navy-tinted)
        mist: "#EEF1F8",        // light text
        // teacher UI neutrals
        slate: {
          50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1",
          400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155",
          800: "#1e293b", 900: "#0f172a",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
