import { LoaderCircle, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export function SpinningLoader({ className, ...props }: LucideProps) {
  return <LoaderCircle className={cn(className, "animate-spin")} {...props} />;
}
