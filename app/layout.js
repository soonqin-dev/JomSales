import "./globals.css";

export const metadata = {
  title: "JomSales — Mobile Sales Catalog & Quotation Tool",
  description: "移动产品目录与报价工具。快速查找、展示和分享产品，生成专业报价 PDF。"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
