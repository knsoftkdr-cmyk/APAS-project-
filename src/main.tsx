import { createRoot } from "react-dom/client";
import "./index.css";
import { App as CapacitorApp } from "@capacitor/app";
import { HelmetProvider } from "react-helmet-async";
import { loadActiveLocale } from "@/i18n/runtime";

// The UI language's messages must be loaded before any app module is evaluated:
// module-level tables (nav items, option lists) are translated when their module
// first runs. So the app itself is imported only after the locale is ready.
async function start() {
  await loadActiveLocale();

  const { applyPrefsToDocument, loadLocalPrefs } = await import("@/lib/accessibility");
  // Accessibility Engine: apply the device's saved settings before React renders, so there is no flash.
  applyPrefsToDocument(loadLocalPrefs());

  const { default: App } = await import("./App.tsx");

  console.log("🔍 main.tsx: Starting app initialization...");
  const rootElement = document.getElementById("root");
  console.log("🔍 main.tsx: Root element found:", rootElement ? "✓" : "✗");

  if (rootElement) {
    console.log("🔍 main.tsx: Creating React root...");
    const root = createRoot(rootElement);
    console.log("🔍 main.tsx: Rendering App component...");
    root.render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    console.log("🔍 main.tsx: App rendered successfully");
  } else {
    console.error("❌ CRITICAL: Root element not found in DOM");
    document.body.innerHTML = "<h1>Error: Root element not found</h1>";
  }
}

start().catch((error) => {
  console.error("❌ CRITICAL: App failed to start", error);
});

CapacitorApp.addListener("backButton", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    CapacitorApp.exitApp();
  }
});
