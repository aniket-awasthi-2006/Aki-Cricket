import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GameScreen } from "@/app/components/game-screen";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/app/lib/auth-session";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect("/");
  }

  const session = await verifySessionToken(sessionToken);

  if (!session) {
    redirect("/");
  }

  return <GameScreen user={{ uid: session.uid, email: session.email, name: session.name }} />;
}
