import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { WorkflowForm } from "./components/workflow-form";

export const metadata = {
  title: "New Workflow — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
  });

  if (!company) redirect("/company");

  return <WorkflowForm companyId={company.id} userId={session.userId} />;
}
