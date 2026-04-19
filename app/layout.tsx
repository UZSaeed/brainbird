import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMG-HCI Interface | Neuroscience & Human-Computer Interaction",
  description: "An open-source EMG-controlled interface using ESP32 BLE, bridging neuromuscular biopotentials and digital interaction.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
