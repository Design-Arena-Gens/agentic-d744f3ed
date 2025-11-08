"use client";

import "./globals.css";
import { useEffect } from "react";

const fontUrl =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap";

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontUrl;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <html lang="en">
      <body>
        <div className="app-container">{children}</div>
      </body>
    </html>
  );
}
