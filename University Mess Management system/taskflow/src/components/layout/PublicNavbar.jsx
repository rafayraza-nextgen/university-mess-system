import { useState } from "react";
import { Menu, Utensils, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const marketingLinks = [
  { label: "Home", to: "/" },
  { label: "Features", to: "/#features" },
  { label: "About Us", to: "/#about" },
];

export function PublicNavbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          onClick={closeMobileMenu}
          className="flex min-w-0 items-center gap-2.5 font-bold tracking-tight text-slate-950 no-underline"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Utensils className="size-5" aria-hidden="true" />
          </span>
          <span className="truncate">University Mess</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Marketing navigation">
          {marketingLinks.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="text-sm font-medium text-slate-600 no-underline transition-colors hover:text-blue-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button
            nativeButton={false}
            render={<Link to="/login" />}
            variant="outline"
            className="font-semibold text-slate-700 no-underline transition-colors"
          >
            Log in
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/signup" />}
            className="bg-blue-600 font-semibold text-white no-underline transition-colors hover:bg-blue-700"
          >
            Sign up
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          className="shrink-0 text-slate-700 md:hidden"
          aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? (
            <X className="size-5" aria-hidden="true" />
          ) : (
            <Menu className="size-5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {isMobileMenuOpen && (
        <div className="border-t border-slate-200 bg-white shadow-lg md:hidden">
          <nav
            className="mx-auto flex w-full max-w-7xl flex-col space-y-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            aria-label="Mobile marketing navigation"
          >
            {marketingLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={closeMobileMenu}
                className="text-sm font-semibold text-slate-700 no-underline transition-colors hover:text-blue-600"
              >
                {item.label}
              </Link>
            ))}

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
              <Button
                nativeButton={false}
                render={<Link to="/login" />}
                variant="outline"
                onClick={closeMobileMenu}
                className="w-full justify-center font-semibold text-slate-700 no-underline sm:w-auto"
              >
                Log in
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/signup" />}
                onClick={closeMobileMenu}
                className="w-full justify-center bg-blue-600 font-semibold text-white no-underline hover:bg-blue-700 sm:w-auto"
              >
                Sign up
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
