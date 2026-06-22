import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Elemento #root não encontrado no index.html");
}

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
