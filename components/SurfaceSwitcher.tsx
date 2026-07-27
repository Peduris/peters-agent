import Link from "next/link";

type Surface = "visitor" | "admin";

export function SurfaceSwitcher({ current }: { current: Surface }) {
  return (
    <nav className="surface-switcher" aria-label="Switch surface">
      <Link
        href="/"
        className={current === "visitor" ? "active" : undefined}
        aria-current={current === "visitor" ? "page" : undefined}
      >
        Public
      </Link>
      <Link
        href="/admin"
        className={current === "admin" ? "active" : undefined}
        aria-current={current === "admin" ? "page" : undefined}
      >
        Admin
      </Link>
    </nav>
  );
}
