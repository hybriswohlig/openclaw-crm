import { redirect } from "next/navigation";

/** Legacy URL — workspace selection was removed. */
export default function SelectWorkspacePage() {
  redirect("/home");
}
