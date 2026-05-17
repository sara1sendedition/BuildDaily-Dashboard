import { PricingTable } from "@clerk/nextjs";

export const metadata = {
  title: "Pricing",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold">BuildDaily Multiplier</h1>
        <p className="mt-2 text-gray-600">
          Three free Multiplications. After that, $12.99/mo for unlimited.
        </p>
      </header>
      <PricingTable />
    </main>
  );
}
