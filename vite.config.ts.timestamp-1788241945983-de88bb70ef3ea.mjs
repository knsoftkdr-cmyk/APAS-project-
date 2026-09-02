// vite.config.ts
import { defineConfig } from "file:///C:/Users/ADMIN%20PC/OneDrive/Documents/APAS-project-/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/ADMIN%20PC/OneDrive/Documents/APAS-project-/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///C:/Users/ADMIN%20PC/OneDrive/Documents/APAS-project-/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "C:\\Users\\ADMIN PC\\OneDrive\\Documents\\APAS-project-";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://checkout.razorpay.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: https: blob:; media-src 'self' https: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https: wss: http://localhost:8000; frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com https://checkout.razorpay.com https://api.razorpay.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(self), microphone=(self), camera=()"
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxBRE1JTiBQQ1xcXFxPbmVEcml2ZVxcXFxEb2N1bWVudHNcXFxcQVBBUy1wcm9qZWN0LVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcQURNSU4gUENcXFxcT25lRHJpdmVcXFxcRG9jdW1lbnRzXFxcXEFQQVMtcHJvamVjdC1cXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL0FETUlOJTIwUEMvT25lRHJpdmUvRG9jdW1lbnRzL0FQQVMtcHJvamVjdC0vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0LXN3Y1wiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XHJcbiAgc2VydmVyOiB7XHJcbiAgICBob3N0OiBcIjo6XCIsXHJcbiAgICBwb3J0OiA1MTczLFxyXG4gICAgaG1yOiB7XHJcbiAgICAgIG92ZXJsYXk6IGZhbHNlLFxyXG4gICAgfSxcclxuICAgIGhlYWRlcnM6IHtcclxuICAgICAgXCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zXCI6IFwibm9zbmlmZlwiLFxyXG4gICAgICBcIlgtRnJhbWUtT3B0aW9uc1wiOiBcIkRFTllcIixcclxuICAgICAgXCJYLVhTUy1Qcm90ZWN0aW9uXCI6IFwiMTsgbW9kZT1ibG9ja1wiLFxyXG4gICAgICBcIlN0cmljdC1UcmFuc3BvcnQtU2VjdXJpdHlcIjogXCJtYXgtYWdlPTMxNTM2MDAwOyBpbmNsdWRlU3ViRG9tYWluczsgcHJlbG9hZFwiLFxyXG4gICAgICBcIkNvbnRlbnQtU2VjdXJpdHktUG9saWN5XCI6IFwiZGVmYXVsdC1zcmMgJ3NlbGYnOyBzY3JpcHQtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgJ3Vuc2FmZS1ldmFsJyBibG9iOiBodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQgaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbSBodHRwczovL3VucGtnLmNvbSBodHRwczovL2NoZWNrb3V0LnJhem9ycGF5LmNvbTsgd29ya2VyLXNyYyAnc2VsZicgYmxvYjo7IHN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnIGh0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb20gaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbTsgaW1nLXNyYyAnc2VsZicgZGF0YTogaHR0cHM6IGJsb2I6OyBtZWRpYS1zcmMgJ3NlbGYnIGh0dHBzOiBibG9iOjsgZm9udC1zcmMgJ3NlbGYnIGh0dHBzOi8vZm9udHMuZ3N0YXRpYy5jb207IGNvbm5lY3Qtc3JjICdzZWxmJyBodHRwczogd3NzOiBodHRwOi8vbG9jYWxob3N0OjgwMDA7IGZyYW1lLXNyYyAnc2VsZicgYmxvYjogaHR0cHM6Ly93d3cueW91dHViZS5jb20gaHR0cHM6Ly93d3cueW91dHViZS1ub2Nvb2tpZS5jb20gaHR0cHM6Ly9jaGVja291dC5yYXpvcnBheS5jb20gaHR0cHM6Ly9hcGkucmF6b3JwYXkuY29tOyBmcmFtZS1hbmNlc3RvcnMgJ25vbmUnOyBiYXNlLXVyaSAnc2VsZic7IGZvcm0tYWN0aW9uICdzZWxmJztcIixcclxuICAgICAgXCJSZWZlcnJlci1Qb2xpY3lcIjogXCJzdHJpY3Qtb3JpZ2luLXdoZW4tY3Jvc3Mtb3JpZ2luXCIsXHJcbiAgICAgIFwiUGVybWlzc2lvbnMtUG9saWN5XCI6IFwiZ2VvbG9jYXRpb249KHNlbGYpLCBtaWNyb3Bob25lPShzZWxmKSwgY2FtZXJhPSgpXCIsXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgcGx1Z2luczogW3JlYWN0KCksIG1vZGUgPT09IFwiZGV2ZWxvcG1lbnRcIiAmJiBjb21wb25lbnRUYWdnZXIoKV0uZmlsdGVyKEJvb2xlYW4pLFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxyXG4gICAgfSxcclxuICB9LFxyXG59KSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBc1YsU0FBUyxvQkFBb0I7QUFDblgsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUhoQyxJQUFNLG1DQUFtQztBQU16QyxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssT0FBTztBQUFBLEVBQ3pDLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxNQUNILFNBQVM7QUFBQSxJQUNYO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCwwQkFBMEI7QUFBQSxNQUMxQixtQkFBbUI7QUFBQSxNQUNuQixvQkFBb0I7QUFBQSxNQUNwQiw2QkFBNkI7QUFBQSxNQUM3QiwyQkFBMkI7QUFBQSxNQUMzQixtQkFBbUI7QUFBQSxNQUNuQixzQkFBc0I7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVMsQ0FBQyxNQUFNLEdBQUcsU0FBUyxpQkFBaUIsZ0JBQWdCLENBQUMsRUFBRSxPQUFPLE9BQU87QUFBQSxFQUM5RSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
