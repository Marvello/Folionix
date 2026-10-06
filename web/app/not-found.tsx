import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <h1 className="text-lg font-medium text-tprimary">Page not found.</h1>
      <p className="text-sm text-tmuted">The address does not match any Folionix view.</p>
      <Link href="/" className="text-sm text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}
