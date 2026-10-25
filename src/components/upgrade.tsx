import Link from "next/link";
import { EmptyState } from "./kit";

/** Shown in place of a module the company's plan does not include. */
export function UpgradeNotice({ feature }: { feature: string }) {
  return (
    <div className="card">
      <EmptyState icon="sparkle" title={`${feature} is not in your plan`}
        action={<Link href="/billing" className="btn-primary">See plans</Link>}>
        Upgrade your Lead Box plan to unlock it. Your other data and settings are not affected.
      </EmptyState>
    </div>
  );
}
