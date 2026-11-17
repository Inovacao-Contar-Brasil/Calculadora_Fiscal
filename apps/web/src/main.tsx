import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Design System oficial (Hub Premium v1.2), na ordem canônica da cascata. Uma única vez.
import "./ds/styles";
// Folha do módulo fiscal (só tokens), depois do Design System.
import "./pages/pages.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
