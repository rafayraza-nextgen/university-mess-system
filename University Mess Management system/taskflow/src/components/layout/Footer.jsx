import { Utensils } from "lucide-react";
import { Link } from "react-router-dom";

const footerLinks = [
  { label: "Privacy Policy", to: "/#privacy" },
  { label: "Terms of Service", to: "/#terms" },
];

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col gap-4 md:flex-row justify-between items-center text-center md:text-left">
        <div>
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-lg text-slate-900 no-underline"
          >
            <Utensils className="size-4 text-blue-600" aria-hidden="true" />
            University Mess
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            © 2026 University Mess. All rights reserved.
          </p>
        </div>

        <nav
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 md:justify-end"
          aria-label="Footer navigation"
        >
          {footerLinks.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="text-sm text-slate-500 transition-colors no-underline hover:text-blue-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
