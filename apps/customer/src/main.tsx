import React from "react";
import { createRoot } from "react-dom/client";

import App from "./app";
import { applyTheme, preferredTheme } from "./shared/theme";

// Before the first paint, so a stored dark preference does not flash light.
applyTheme(preferredTheme());

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  throw new Error("Could not find root element");
}
