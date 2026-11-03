import { requireProfile, isAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";
import { PageHeader } from "@/components/static";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  const tabs = [
    { href: "/store", label: "Orders", icon: "cart" },
    ...(isAdmin(profile) ? [{ href: "/store/products", label: "Products", icon: "tag" }, { href: "/store/purchases", label: "Purchase orders", icon: "list" }, { href: "/store/vendors", label: "Vendors", icon: "building" }, { href: "/store/settings", label: "Store settings", icon: "gear" }] : []),
  ];
  return (
    <div>
      <PageHeader icon="cart" tone="green" title="WhatsApp store"
        sub="Your catalog as a mini-store link. Customers order from WhatsApp; every order lands here and on the customer's lead." />
      <SectionTabs label="Store sections" tabs={tabs} />
      {children}
    </div>
  );
}
