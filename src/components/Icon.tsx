import * as Lucide from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Renders a lucide icon by name. Entity records store icon names as strings,
 * so this resolves them safely with a sensible fallback.
 */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const map = Lucide as unknown as Record<string, React.ComponentType<LucideProps>>;
  const Cmp = map[name] ?? map[toPascal(name)] ?? Lucide.Circle;
  return <Cmp {...props} />;
}

function toPascal(name: string): string {
  return name
    .replace(/(^|[-_\s])(\w)/g, (_, __, c) => c.toUpperCase())
    .replace(/[-_\s]/g, "");
}
