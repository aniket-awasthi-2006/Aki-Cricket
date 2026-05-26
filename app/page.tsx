import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import loginBackground from "@/app/assets/login-background.jpeg";
import { AuthForm } from "@/app/components/auth-form";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/app/lib/auth-session";

export default async function Home() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    const session = await verifySessionToken(sessionToken);
    if (session) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#020c1f] text-white">
      <Image
        src={loginBackground}
        alt="Cricket batter in stadium"
        fill
        priority
        className="object-contain object-center"
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(61,191,255,0.28),transparent_50%),linear-gradient(90deg,rgba(1,8,25,0.86)_0%,rgba(2,14,39,0.76)_34%,rgba(2,14,39,0.3)_56%,rgba(0,0,0,0.08)_100%)]" />

      <div className="relative z-10 flex w-full items-center py-8 pl-6 pr-4 sm:pl-12 sm:pr-8 md:pl-20 md:pr-12 lg:pl-28 lg:pr-16">
        <AuthForm />
      </div>
    </main>
  );
}
