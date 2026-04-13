import { redirect } from "next/navigation";

// Registration is handled via Google OAuth on the login page.
export default function RegisterPage() {
  redirect("/login");
}
