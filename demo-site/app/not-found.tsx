import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
      <div>
        <p style={{ fontSize: 13, letterSpacing: ".08em", opacity: 0.6, margin: 0 }}>404</p>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: "8px 0 16px" }}>找不到这个页面 · Page not found</h1>
        <Link href="/" style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>
          返回首页 · Back to home
        </Link>
      </div>
    </main>
  );
}
