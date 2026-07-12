import { PublicMapShell } from "@/components/PublicMapShell";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function PublicMapPage({ params }: PageProps) {
  const { token } = await params;
  return <PublicMapShell token={token} />;
}
