import { SectionTabs } from "@/components/section-tabs";

export function FieldTabs() {
  return (
    <div className="mb-4">
      <SectionTabs label="Field force" tabs={[
        { href: "/field", label: "Field app", icon: "pin" },
        { href: "/field/attendance", label: "Attendance", icon: "clock" },
        { href: "/field/visits", label: "Visits", icon: "target" },
        { href: "/field/expenses", label: "Expenses", icon: "rupee" },
      ]} />
    </div>
  );
}
