import type { MetadataRoute } from "next";

// Named separately from the page title: a home-screen label only has room
// for about a dozen characters before iOS and Android truncate it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fitness Optimizer",
    short_name: "Optimizer",
    description:
      "One training decision every morning, read from your WHOOP recovery.",
    start_url: "/",
    // Kept in the browser for the same reason iOS is not "capable": the
    // WHOOP OAuth round trip leaves this origin and has to come back.
    display: "browser",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
