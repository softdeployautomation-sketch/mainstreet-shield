import { redirect } from "next/navigation";

export default async function LandingPage() {
  // MainStreet Shield landing — redirect to /shield (the lab entry)
  redirect("/shield");
}