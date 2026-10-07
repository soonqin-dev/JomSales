import { Inter } from "next/font/google";
import "./globals.css";
import { FeedbackProvider } from "./ui";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = {
  title: "JomSales — Mobile Sales Catalog & Quotation Tool",
  description: "移动产品目录与报价工具。快速查找、展示和分享产品，生成专业报价 PDF。"
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body><FeedbackProvider>{children}</FeedbackProvider></body>
    </html>
  );
}
