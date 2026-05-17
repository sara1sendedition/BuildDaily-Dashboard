import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        palette: {
          /** Muted sage green */
          sage: "#7FAF8F",
          /** Soft moss green: primary actions */
          moss: "#6E9F82",
          /** Green with slight blue tint: borders, secondary accents */
          teal: "#6FA6A0",
          /** Desaturated teal-gray: hover / emphasis */
          depth: "#5F8F95",
          /** Pale green-gray: soft surfaces */
          pale: "#A9C3B5",
        },
      },
    },
  },
  plugins: [],
};

export default config;
